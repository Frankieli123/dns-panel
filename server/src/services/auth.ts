import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import { encrypt, decrypt } from '../utils/encryption';
import { TwoFactorService } from './twoFactor';

const prisma = new PrismaClient();
const SALT_ROUNDS = 10;

interface LoginResult {
  requires2FA: boolean;
  tempToken?: string;
  token?: string;
  user?: {
    id: number;
    username: string;
    email: string | null;
  };
}

/**
 * 认证服务
 */
export class AuthService {
  /**
   * 用户注册
   */
  static async register(params: {
    username: string;
    email?: string;
    password: string;
    cfApiToken?: string;
    cfAccountId?: string;
  }) {
    // 检查用户名是否已存在
    const orConditions: Array<{ username?: string; email?: string }> = [{ username: params.username }];
    if (params.email) {
      orConditions.push({ email: params.email });
    }
    const existingUser = await prisma.user.findFirst({
      where: {
        OR: orConditions,
      },
    });

    if (existingUser) {
      throw new Error('用户名或邮箱已存在');
    }

    // 密码强度验证
    if (params.password.length < 8) {
      throw new Error('密码长度至少为 8 位');
    }

    if (!/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/.test(params.password)) {
      throw new Error('密码必须包含大小写字母和数字');
    }

    // 加密密码和 API Token
    const hashedPassword = await bcrypt.hash(params.password, SALT_ROUNDS);
    const encryptedToken = params.cfApiToken ? encrypt(params.cfApiToken) : undefined;

    // 创建用户
    const user = await prisma.user.create({
      data: {
        username: params.username,
        ...(params.email ? { email: params.email } : {}),
        password: hashedPassword,
        ...(encryptedToken ? { cfApiToken: encryptedToken } : {}),
        ...(params.cfAccountId ? { cfAccountId: params.cfAccountId } : {}),
      } as any,
      select: {
        id: true,
        username: true,
        email: true,
        createdAt: true,
      },
    });

    return user;
  }

  /**
   * 用户登录（支持 2FA）
   */
  static async login(params: { username: string; password: string }): Promise<LoginResult> {
    // 查找用户（支持用户名或邮箱登录）
    const user = await prisma.user.findFirst({
      where: {
        OR: [{ username: params.username }, { email: params.username }],
      },
    });

    if (!user) {
      throw new Error('用户名或密码错误');
    }

    // 验证密码
    const isPasswordValid = await bcrypt.compare(params.password, user.password);

    if (!isPasswordValid) {
      throw new Error('用户名或密码错误');
    }

    // 如果用户启用了 2FA，返回临时 token
    if (user.twoFactorEnabled) {
      const tempToken = TwoFactorService.generateTempToken(user.id, user.username);
      return {
        requires2FA: true,
        tempToken,
      };
    }

    // 未启用 2FA，直接生成 JWT Token
    const token = jwt.sign(
      {
        id: user.id,
        username: user.username,
        email: user.email,
      },
      config.jwt.secret,
      { expiresIn: config.jwt.expiresIn as any }
    );

    return {
      requires2FA: false,
      token,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
      },
    };
  }

  /**
   * 获取用户信息
   */
  static async getUserById(userId: number) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        username: true,
        email: true,
        cfAccountId: true,
        twoFactorEnabled: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!user) {
      throw new Error('用户不存在');
    }

    return user;
  }

  /**
   * 获取用户的 Cloudflare API Token（解密）
   */
  static async getUserCfToken(userId: number): Promise<string> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { cfApiToken: true },
    });

    if (!user) {
      throw new Error('用户不存在');
    }

    return decrypt(user.cfApiToken);
  }

  /**
   * 更新用户密码
   */
  static async updatePassword(userId: number, oldPassword: string, newPassword: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new Error('用户不存在');
    }

    // 验证旧密码
    const isPasswordValid = await bcrypt.compare(oldPassword, user.password);

    if (!isPasswordValid) {
      throw new Error('原密码错误');
    }

    // 密码强度验证
    if (newPassword.length < 8) {
      throw new Error('密码长度至少为 8 位');
    }

    if (!/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/.test(newPassword)) {
      throw new Error('密码必须包含大小写字母和数字');
    }

    // 加密新密码
    const hashedPassword = await bcrypt.hash(newPassword, SALT_ROUNDS);

    await prisma.user.update({
      where: { id: userId },
      data: { password: hashedPassword },
    });
  }

  /**
   * 更新 Cloudflare API Token
   */
  static async updateCfToken(userId: number, newToken: string) {
    const encryptedToken = encrypt(newToken);

    await prisma.user.update({
      where: { id: userId },
      data: { cfApiToken: encryptedToken },
    });
  }
}

