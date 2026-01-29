import { Router } from 'express';
import { authenticateToken } from '../middleware/auth';
import { generalLimiter } from '../middleware/rateLimit';
import { successResponse, errorResponse } from '../utils/response';
import { DomainExpiryService } from '../services/domainExpiry';

const router = Router();

/**
 * POST /api/domain-expiry/lookup
 * 批量查询域名注册到期时间（RDAP 优先，结果缓存）
 */
router.post('/lookup', authenticateToken, generalLimiter, async (req, res) => {
  try {
    const domains = req.body?.domains;
    if (!Array.isArray(domains) || domains.length === 0) {
      return errorResponse(res, '缺少参数: domains (string[])', 400);
    }

    if (domains.length > 500) {
      return errorResponse(res, 'domains 数量过多，最多 500 条', 400);
    }

    const results = await DomainExpiryService.lookupDomains(domains);
    return successResponse(res, { results }, '获取域名到期信息成功');
  } catch (error: any) {
    return errorResponse(res, error?.message || '查询失败', 500);
  }
});

export default router;

