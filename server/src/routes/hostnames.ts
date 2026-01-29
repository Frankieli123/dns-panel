import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import NodeCache from 'node-cache';
import { CloudflareService } from '../services/cloudflare';
import { LoggerService } from '../services/logger';
import { successResponse, errorResponse } from '../utils/response';
import { authenticateToken } from '../middleware/auth';
import { dnsLimiter, generalLimiter } from '../middleware/rateLimit';
import { getClientIp } from '../middleware/logger';
import { AuthRequest } from '../types';
import { decrypt } from '../utils/encryption';

const router = Router();
const prisma = new PrismaClient();

const zoneCredentialCache = new NodeCache({ stdTTL: 300 });

async function getCloudflareApiToken(userId: number, zoneId: string, credentialId?: string): Promise<string> {
  let credential;

  const cacheKey = `${userId}:${zoneId}`;
  const cachedCredentialId = !credentialId ? zoneCredentialCache.get<number>(cacheKey) : undefined;
  const effectiveCredentialId = credentialId || (cachedCredentialId ? String(cachedCredentialId) : undefined);

  if (effectiveCredentialId) {
    credential = await prisma.dnsCredential.findFirst({
      where: { id: parseInt(effectiveCredentialId), userId, provider: 'cloudflare' },
    });
    if (!credential) {
      throw new Error('凭证不存在或无权访问');
    }

    const secrets = JSON.parse(decrypt(credential.secrets));
    const apiToken = secrets?.apiToken;
    if (!apiToken) {
      throw new Error('缺少 Cloudflare API Token');
    }

    return apiToken;
  }

  const credentials = await prisma.dnsCredential.findMany({
    where: { userId, provider: 'cloudflare' },
    orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
  });

  if (credentials.length === 0) {
    throw new Error('未配置 Cloudflare 凭证');
  }

  for (const cred of credentials) {
    try {
      const secrets = JSON.parse(decrypt(cred.secrets));
      const apiToken = secrets?.apiToken;
      if (!apiToken) continue;

      const cfService = new CloudflareService(apiToken);
      await cfService.getDomainById(zoneId);

      zoneCredentialCache.set(cacheKey, cred.id);
      return apiToken;
    } catch {
      continue;
    }
  }

  throw new Error('无法访问该域名，请确认选择了正确的 Cloudflare 账户/凭证');
}

/**
 * GET /api/hostnames/:zoneId/fallback_origin
 * 获取回退源
 */
router.get('/:zoneId/fallback_origin', authenticateToken, generalLimiter, async (req: AuthRequest, res) => {
  try {
    const { zoneId } = req.params;
    const credentialId = req.query.credentialId as string | undefined;
    const apiToken = await getCloudflareApiToken(req.user!.id, zoneId, credentialId);
    const cfService = new CloudflareService(apiToken);
    const origin = await cfService.getFallbackOrigin(zoneId);
    return successResponse(res, { origin }, '获取回退源成功');
  } catch (error: any) {
    const statusCode = typeof error?.status === 'number'
      ? error.status
      : (typeof error?.statusCode === 'number' ? error.statusCode : 400);
    return errorResponse(res, error.message, statusCode);
  }
});

/**
 * PUT /api/hostnames/:zoneId/fallback_origin
 * 更新回退源
 */
router.put('/:zoneId/fallback_origin', authenticateToken, dnsLimiter, async (req: AuthRequest, res) => {
  try {
    const { zoneId } = req.params;
    const { origin } = req.body;
    
    if (!origin) return errorResponse(res, '回退源地址不能为空', 400);

    const credentialId = req.query.credentialId as string | undefined;
    const apiToken = await getCloudflareApiToken(req.user!.id, zoneId, credentialId);
    const cfService = new CloudflareService(apiToken);
    let oldOrigin: any;
    try {
      oldOrigin = await cfService.getFallbackOrigin(zoneId);
    } catch {}
    const result = await cfService.updateFallbackOrigin(zoneId, origin);

    await LoggerService.createLog({
      userId: req.user!.id,
      action: 'UPDATE',
      resourceType: 'FALLBACK_ORIGIN',
      domain: zoneId,
      recordName: 'fallback_origin',
      oldValue: oldOrigin !== undefined ? JSON.stringify(oldOrigin) : undefined,
      newValue: JSON.stringify({ origin }),
      status: 'SUCCESS',
      ipAddress: getClientIp(req),
    });

    return successResponse(res, { origin: result }, '更新回退源成功');
  } catch (error: any) {
    try {
      await LoggerService.createLog({
        userId: req.user!.id,
        action: 'UPDATE',
        resourceType: 'FALLBACK_ORIGIN',
        domain: req.params.zoneId,
        recordName: 'fallback_origin',
        status: 'FAILED',
        errorMessage: error.message,
        ipAddress: getClientIp(req),
      });
    } catch {}
    const statusCode = typeof error?.status === 'number'
      ? error.status
      : (typeof error?.statusCode === 'number' ? error.statusCode : 400);
    return errorResponse(res, error.message, statusCode);
  }
});

/**
 * GET /api/hostnames/:zoneId
 * 获取自定义主机名列表
 */
router.get('/:zoneId', authenticateToken, generalLimiter, async (req: AuthRequest, res) => {
  try {
    const { zoneId } = req.params;

    const credentialId = req.query.credentialId as string | undefined;
    const apiToken = await getCloudflareApiToken(req.user!.id, zoneId, credentialId);
    const cfService = new CloudflareService(apiToken);

    const hostnames = await cfService.getCustomHostnames(zoneId);

    return successResponse(res, { hostnames }, '获取自定义主机名成功');
  } catch (error: any) {
    console.error('获取自定义主机名失败:', error);
    console.error('错误详情:', JSON.stringify(error, null, 2));
    const statusCode = typeof error?.status === 'number'
      ? error.status
      : (typeof error?.statusCode === 'number' ? error.statusCode : 400);
    return errorResponse(res, error.message, statusCode);
  }
});

/**
 * POST /api/hostnames/:zoneId
 * 创建自定义主机名
 */
router.post('/:zoneId', authenticateToken, dnsLimiter, async (req: AuthRequest, res) => {
  try {
    const { zoneId } = req.params;
    const { hostname, customOriginServer } = req.body;

    if (!hostname) {
      return errorResponse(res, '缺少主机名参数', 400);
    }

    const originRaw = typeof customOriginServer === 'string' ? customOriginServer.trim() : '';
    let origin: string | undefined;
    if (originRaw) {
      if (/^https?:\/\//i.test(originRaw)) {
        return errorResponse(res, '自定义源服务器不支持包含 http:// 或 https://', 400);
      }
      if (originRaw.includes('*')) {
        return errorResponse(res, '自定义源服务器不支持通配符', 400);
      }
      if (originRaw.includes(':')) {
        return errorResponse(res, '自定义源服务器不支持端口或 IP 地址，请填写域名', 400);
      }
      if (originRaw.includes('/') || originRaw.includes(' ')) {
        return errorResponse(res, '自定义源服务器格式不正确', 400);
      }

      const ipv4 = /^(?:\d{1,3}\.){3}\d{1,3}$/;
      if (ipv4.test(originRaw)) {
        return errorResponse(res, '自定义源服务器不支持 IP 地址，请填写域名', 400);
      }

      origin = originRaw;
    }

    const credentialId = req.query.credentialId as string | undefined;
    const apiToken = await getCloudflareApiToken(req.user!.id, zoneId, credentialId);
    const cfService = new CloudflareService(apiToken);

    const result = await cfService.createCustomHostname(zoneId, hostname, origin);

    // 记录日志
    await LoggerService.createLog({
      userId: req.user!.id,
      action: 'CREATE',
      resourceType: 'HOSTNAME',
      domain: zoneId,
      recordName: hostname,
      newValue: JSON.stringify(result),
      status: 'SUCCESS',
      ipAddress: getClientIp(req),
    });

    return successResponse(res, { hostname: result }, '自定义主机名创建成功', 201);
  } catch (error: any) {
    // 记录失败日志
    await LoggerService.createLog({
      userId: req.user!.id,
      action: 'CREATE',
      resourceType: 'HOSTNAME',
      domain: req.params.zoneId,
      recordName: req.body.hostname,
      status: 'FAILED',
      errorMessage: error.message,
      ipAddress: getClientIp(req),
    });

    const statusCode = typeof error?.status === 'number'
      ? error.status
      : (typeof error?.statusCode === 'number' ? error.statusCode : 400);
    return errorResponse(res, error.message, statusCode);
  }
});

/**
 * DELETE /api/hostnames/:zoneId/:hostnameId
 * 删除自定义主机名
 */
router.delete('/:zoneId/:hostnameId', authenticateToken, dnsLimiter, async (req: AuthRequest, res) => {
  try {
    const { zoneId, hostnameId } = req.params;

    const credentialId = req.query.credentialId as string | undefined;
    const apiToken = await getCloudflareApiToken(req.user!.id, zoneId, credentialId);
    const cfService = new CloudflareService(apiToken);

    await cfService.deleteCustomHostname(zoneId, hostnameId);

    // 记录日志
    await LoggerService.createLog({
      userId: req.user!.id,
      action: 'DELETE',
      resourceType: 'HOSTNAME',
      domain: zoneId,
      recordName: hostnameId,
      status: 'SUCCESS',
      ipAddress: getClientIp(req),
    });

    return successResponse(res, null, '自定义主机名删除成功');
  } catch (error: any) {
    // 记录失败日志
    await LoggerService.createLog({
      userId: req.user!.id,
      action: 'DELETE',
      resourceType: 'HOSTNAME',
      domain: req.params.zoneId,
      recordName: req.params.hostnameId,
      status: 'FAILED',
      errorMessage: error.message,
      ipAddress: getClientIp(req),
    });

    const statusCode = typeof error?.status === 'number'
      ? error.status
      : (typeof error?.statusCode === 'number' ? error.statusCode : 400);
    return errorResponse(res, error.message, statusCode);
  }
});

export default router;
