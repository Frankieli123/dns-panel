import { Router } from 'express';
import { LoggerService } from '../services/logger';
import { successResponse, errorResponse, paginatedResponse } from '../utils/response';
import { authenticateToken } from '../middleware/auth';
import { generalLimiter } from '../middleware/rateLimit';
import { getClientIp } from '../middleware/logger';
import { AuthRequest } from '../types';

const router = Router();

/**
 * GET /api/logs
 * 获取操作日志
 */
router.get('/', authenticateToken, generalLimiter, async (req: AuthRequest, res) => {
  try {
    const {
      page = '1',
      limit = '50',
      startDate,
      endDate,
      action,
      resourceType,
      domain,
      status,
    } = req.query;

    const params: any = {
      userId: req.user!.id,
      page: parseInt(page as string, 10),
      limit: parseInt(limit as string, 10),
    };

    if (startDate) params.startDate = new Date(startDate as string);
    if (endDate) params.endDate = new Date(endDate as string);
    if (action) params.action = action;
    if (resourceType) params.resourceType = resourceType;
    if (domain) params.domain = domain;
    if (status) params.status = status;

    const result = await LoggerService.getLogs(params);

    return paginatedResponse(
      res,
      result.logs,
      result.total,
      result.page,
      result.limit,
      '获取日志成功'
    );
  } catch (error: any) {
    return errorResponse(res, error.message, 400);
  }
});

/**
 * DELETE /api/logs/cleanup
 * 清理过期日志
 */
router.delete('/cleanup', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const { retentionDays = '90' } = req.query;

    const count = await LoggerService.cleanupOldLogs(parseInt(retentionDays as string, 10));

    await LoggerService.createLog({
      userId: req.user!.id,
      action: 'DELETE',
      resourceType: 'USER',
      recordName: 'cleanup_logs',
      status: 'SUCCESS',
      ipAddress: getClientIp(req),
      newValue: JSON.stringify({ retentionDays: String(retentionDays), deleted: count }),
    });

    return successResponse(res, { count }, `已清理 ${count} 条过期日志`);
  } catch (error: any) {
    try {
      await LoggerService.createLog({
        userId: req.user!.id,
        action: 'DELETE',
        resourceType: 'USER',
        recordName: 'cleanup_logs',
        status: 'FAILED',
        ipAddress: getClientIp(req),
        errorMessage: error?.message || '清理日志失败',
      });
    } catch {}
    return errorResponse(res, error.message, 400);
  }
});

export default router;
