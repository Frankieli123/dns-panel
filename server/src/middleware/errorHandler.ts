import { Request, Response, NextFunction } from 'express';
import { errorResponse } from '../utils/response';

/**
 * 全局错误处理中间件
 */
export function errorHandler(
  err: any,
  req: Request,
  res: Response,
  next: NextFunction
) {
  console.error('错误:', err);

  // Prisma 错误处理
  if (err.code === 'P2002') {
    return errorResponse(res, '该记录已存在', 409);
  }

  if (err.code === 'P2025') {
    return errorResponse(res, '记录不存在', 404);
  }

  // JWT 错误处理
  if (err.name === 'JsonWebTokenError') {
    return errorResponse(res, '无效的令牌', 401);
  }

  if (err.name === 'TokenExpiredError') {
    return errorResponse(res, '令牌已过期', 401);
  }

  // 默认错误
  const statusCode = err.statusCode || 500;
  const message = err.message || '服务器内部错误';

  return errorResponse(res, message, statusCode, err);
}

/**
 * 404 错误处理
 */
export function notFoundHandler(req: Request, res: Response) {
  return errorResponse(res, '请求的资源不存在', 404);
}
