import { Response } from 'express';

/**
 * 成功响应
 */
export function successResponse(
  res: Response,
  data: any = null,
  message: string = '操作成功',
  statusCode: number = 200
) {
  return res.status(statusCode).json({
    success: true,
    message,
    data,
  });
}

/**
 * 错误响应
 */
export function errorResponse(
  res: Response,
  message: string = '操作失败',
  statusCode: number = 400,
  error?: any
) {
  const response: any = {
    success: false,
    message,
  };

  if (error && process.env.NODE_ENV === 'development') {
    response.error = error;
  }

  return res.status(statusCode).json(response);
}

/**
 * 分页响应
 */
export function paginatedResponse(
  res: Response,
  data: any[],
  total: number,
  page: number,
  limit: number,
  message: string = '查询成功'
) {
  return res.status(200).json({
    success: true,
    message,
    data,
    pagination: {
      total,
      page,
      limit,
      pages: Math.ceil(total / limit),
    },
  });
}
