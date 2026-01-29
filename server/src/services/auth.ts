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
    domainExpiryDisplayMode: string;
    domainExpiryThresholdDays: number;
    domainExpiryNotifyEnabled: boolean;
    domainExpiryNotifyWebhookUrl: string | null;
    domainExpiryNotifyEmailEnabled: boolean;
    domainExpiryNotifyEmailTo: string | null;
    smtpHost: string | null;
    smtpPort: number | null;
    smtpSecure: boolean | null;
    smtpUser: string | null;
    smtpFrom: string | null;
    smtpPassConfigured: boolean;
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
        domainExpiryDisplayMode: user.domainExpiryDisplayMode,
        domainExpiryThresholdDays: user.domainExpiryThresholdDays,
        domainExpiryNotifyEnabled: user.domainExpiryNotifyEnabled,
        domainExpiryNotifyWebhookUrl: user.domainExpiryNotifyWebhookUrl,
        domainExpiryNotifyEmailEnabled: (user as any).domainExpiryNotifyEmailEnabled ?? false,
        domainExpiryNotifyEmailTo: (user as any).domainExpiryNotifyEmailTo ?? null,
        smtpHost: (user as any).smtpHost ?? null,
        smtpPort: (user as any).smtpPort ?? null,
        smtpSecure: (user as any).smtpSecure ?? null,
        smtpUser: (user as any).smtpUser ?? null,
        smtpFrom: (user as any).smtpFrom ?? null,
        smtpPassConfigured: !!(user as any).smtpPass,
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
        domainExpiryDisplayMode: true,
        domainExpiryThresholdDays: true,
        domainExpiryNotifyEnabled: true,
        domainExpiryNotifyWebhookUrl: true,
        domainExpiryNotifyEmailEnabled: true,
        domainExpiryNotifyEmailTo: true,
        smtpHost: true,
        smtpPort: true,
        smtpSecure: true,
        smtpUser: true,
        smtpFrom: true,
        smtpPass: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!user) {
      throw new Error('用户不存在');
    }

    const { smtpPass, ...safe } = user as any;
    return {
      ...safe,
      smtpPassConfigured: !!smtpPass,
    };
  }

  static async updateDomainExpirySettings(
    userId: number,
    input: {
      displayMode?: 'date' | 'days';
      thresholdDays?: number;
      notifyEnabled?: boolean;
      webhookUrl?: string | null;
      notifyEmailEnabled?: boolean;
      emailTo?: string | null;
      smtpHost?: string | null;
      smtpPort?: number | null;
      smtpSecure?: boolean | null;
      smtpUser?: string | null;
      smtpPass?: string | null;
      smtpFrom?: string | null;
    }
  ) {
    const current = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        email: true,
        domainExpiryNotifyEmailEnabled: true,
        domainExpiryNotifyEmailTo: true,
        smtpHost: true,
        smtpPort: true,
        smtpSecure: true,
        smtpUser: true,
        smtpPass: true,
        smtpFrom: true,
      },
    });

    if (!current) {
      throw new Error('用户不存在');
    }

    if (input.emailTo !== undefined) {
      const raw = typeof input.emailTo === 'string' ? input.emailTo.trim() : '';
      if (raw && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw)) {
        throw new Error('收件邮箱格式不正确');
      }
    }

    const nextNotifyEmailEnabled =
      input.notifyEmailEnabled !== undefined
        ? !!input.notifyEmailEnabled
        : !!(current as any).domainExpiryNotifyEmailEnabled;

    const nextEmailToRaw =
      input.emailTo !== undefined
        ? (typeof input.emailTo === 'string' ? input.emailTo.trim() : '')
        : ((current as any).domainExpiryNotifyEmailTo ?? '');
    const nextEmailTo = nextEmailToRaw ? nextEmailToRaw : null;
    const emailTarget = nextEmailTo || current.email || '';

    const smtpTouched =
      input.smtpHost !== undefined ||
      input.smtpPort !== undefined ||
      input.smtpSecure !== undefined ||
      input.smtpUser !== undefined ||
      input.smtpPass !== undefined ||
      input.smtpFrom !== undefined;

    let nextSmtpHost = (current as any).smtpHost ?? null;
    let nextSmtpPort = (current as any).smtpPort ?? null;
    let nextSmtpSecure = (current as any).smtpSecure ?? null;
    let nextSmtpUser = (current as any).smtpUser ?? null;
    let nextSmtpPass = (current as any).smtpPass ?? null;
    let nextSmtpFrom = (current as any).smtpFrom ?? null;

    if (input.smtpHost !== undefined) {
      const raw = typeof input.smtpHost === 'string' ? input.smtpHost.trim() : '';
      if (!raw) {
        nextSmtpHost = null;
        nextSmtpPort = null;
        nextSmtpSecure = null;
        nextSmtpUser = null;
        nextSmtpPass = null;
        nextSmtpFrom = null;
      } else {
        nextSmtpHost = raw;
      }
    }

    const hasCustomSmtp = !!nextSmtpHost;

    if (!hasCustomSmtp) {
      nextSmtpPort = null;
      nextSmtpSecure = null;
      nextSmtpUser = null;
      nextSmtpPass = null;
      nextSmtpFrom = null;
    } else if (smtpTouched) {
      if (input.smtpPort !== undefined) {
        if (input.smtpPort === null) {
          nextSmtpPort = null;
        } else {
          const parsed = Math.floor(Number(input.smtpPort));
          if (!Number.isFinite(parsed) || parsed < 1 || parsed > 65535) {
            throw new Error('SMTP 端口无效，应为 1-65535 的整数');
          }
          nextSmtpPort = parsed;
        }
      }

      if (input.smtpSecure !== undefined) {
        nextSmtpSecure = input.smtpSecure === null ? null : !!input.smtpSecure;
      }

      if (input.smtpUser !== undefined) {
        const raw = typeof input.smtpUser === 'string' ? input.smtpUser.trim() : '';
        nextSmtpUser = raw ? raw : null;
        if (!nextSmtpUser) {
          nextSmtpPass = null;
        }
      }

      if (input.smtpPass !== undefined) {
        const raw = typeof input.smtpPass === 'string' ? input.smtpPass.trim() : '';
        nextSmtpPass = raw ? encrypt(raw) : null;
      }

      if (input.smtpFrom !== undefined) {
        const raw = typeof input.smtpFrom === 'string' ? input.smtpFrom.trim() : '';
        nextSmtpFrom = raw ? raw : null;
      }

      const authUser = typeof nextSmtpUser === 'string' ? nextSmtpUser.trim() : '';
      const authPassPresent = !!(typeof nextSmtpPass === 'string' ? nextSmtpPass.trim() : '');
      if ((authUser && !authPassPresent) || (!authUser && authPassPresent)) {
        throw new Error('SMTP 认证信息不完整');
      }
    }

    if (nextNotifyEmailEnabled) {
      if (!emailTarget) {
        throw new Error('启用邮件通知需要填写收件邮箱');
      }

      if (hasCustomSmtp) {
        const host = String(nextSmtpHost || '').trim();
        const port = nextSmtpPort !== null ? Number(nextSmtpPort) : 587;
        const from = String(nextSmtpFrom || '').trim();

        if (!host) {
          throw new Error('启用邮件通知需要配置 SMTP_HOST');
        }
        if (!Number.isFinite(port) || port <= 0) {
          throw new Error('启用邮件通知需要配置 SMTP_PORT');
        }
        if (!from) {
          throw new Error('启用邮件通知需要配置 SMTP_FROM');
        }
      } else {
        const host = String(config.smtp.host || '').trim();
        const port = Number(config.smtp.port);
        const from = String(config.smtp.from || '').trim();
        const user = String(config.smtp.user || '').trim();
        const pass = String(config.smtp.pass || '').trim();

        if (!host) {
          throw new Error('启用邮件通知需要配置环境变量 SMTP_HOST');
        }
        if (!Number.isFinite(port) || port <= 0) {
          throw new Error('启用邮件通知需要配置环境变量 SMTP_PORT');
        }
        if (!from) {
          throw new Error('启用邮件通知需要配置环境变量 SMTP_FROM');
        }
        if ((user && !pass) || (!user && pass)) {
          throw new Error('环境变量 SMTP_USER/SMTP_PASS 不完整');
        }
      }
    }

    const data: any = {};

    if (input.displayMode) {
      data.domainExpiryDisplayMode = input.displayMode;
    }

    if (input.thresholdDays !== undefined) {
      const parsed = Math.floor(Number(input.thresholdDays));
      if (!Number.isFinite(parsed) || parsed < 1 || parsed > 365) {
        throw new Error('阈值天数无效，应为 1-365 的整数');
      }
      data.domainExpiryThresholdDays = parsed;
    }

    if (input.notifyEnabled !== undefined) {
      data.domainExpiryNotifyEnabled = !!input.notifyEnabled;
    }

    if (input.webhookUrl !== undefined) {
      const raw = typeof input.webhookUrl === 'string' ? input.webhookUrl.trim() : '';
      data.domainExpiryNotifyWebhookUrl = raw ? raw : null;
    }

    if (input.notifyEmailEnabled !== undefined) {
      data.domainExpiryNotifyEmailEnabled = !!input.notifyEmailEnabled;
    }

    if (input.emailTo !== undefined) {
      const raw = typeof input.emailTo === 'string' ? input.emailTo.trim() : '';
      data.domainExpiryNotifyEmailTo = raw ? raw : null;
    }

    if (smtpTouched) {
      data.smtpHost = hasCustomSmtp ? nextSmtpHost : null;
      data.smtpPort = hasCustomSmtp ? nextSmtpPort : null;
      data.smtpSecure = hasCustomSmtp ? nextSmtpSecure : null;
      data.smtpUser = hasCustomSmtp ? nextSmtpUser : null;
      data.smtpPass = hasCustomSmtp ? nextSmtpPass : null;
      data.smtpFrom = hasCustomSmtp ? nextSmtpFrom : null;
    }

    const user = await prisma.user.update({
      where: { id: userId },
      data,
      select: {
        id: true,
        username: true,
        email: true,
        domainExpiryDisplayMode: true,
        domainExpiryThresholdDays: true,
        domainExpiryNotifyEnabled: true,
        domainExpiryNotifyWebhookUrl: true,
        domainExpiryNotifyEmailEnabled: true,
        domainExpiryNotifyEmailTo: true,
        smtpHost: true,
        smtpPort: true,
        smtpSecure: true,
        smtpUser: true,
        smtpFrom: true,
        smtpPass: true,
      },
    });

    const { smtpPass, ...safe } = user as any;
    return {
      ...safe,
      smtpPassConfigured: !!smtpPass,
    };
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
