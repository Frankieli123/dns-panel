import { Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import { errorResponse } from '../utils/response';
import { AuthRequest } from '../types';

/**
 * JWT 验证中间件
 * 只接受 type 为 'access' 的正式登录 token，拒绝 2fa_pending 等临时 token
 */
export function authenticateToken(
  req: AuthRequest,
  res: Response,
  next: NextFunction
) {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

    if (!token) {
      return errorResponse(res, '未提供认证令牌', 401);
    }

    jwt.verify(token, config.jwt.secret, (err, decoded: any) => {
      if (err) {
        return errorResponse(res, '无效或过期的令牌', 401);
      }

      // 拒绝 2FA 临时 token，只接受正式的 access token
      if (decoded.type === '2fa_pending') {
        return errorResponse(res, '请完成两步验证', 401);
      }

      req.user = {
        id: decoded.id,
        username: decoded.username,
        email: decoded.email,
      };

      next();
    });
  } catch (error) {
    return errorResponse(res, '认证失败', 401);
  }
}
