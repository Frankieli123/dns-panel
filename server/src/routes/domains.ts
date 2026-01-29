import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { CloudflareService } from '../services/cloudflare';
import { LoggerService } from '../services/logger';
import { successResponse, errorResponse } from '../utils/response';
import { authenticateToken } from '../middleware/auth';
import { generalLimiter } from '../middleware/rateLimit';
import { getClientIp } from '../middleware/logger';
import { AuthRequest } from '../types';
import { decrypt } from '../utils/encryption';

const router = Router();
const prisma = new PrismaClient();

/**
 * GET /api/domains?credentialId=xxx
 * 获取所有域名列表
 * - credentialId: 可选，指定凭证ID
 * - credentialId="all": 获取所有凭证的域名（聚合）
 * - 不传: 使用默认凭证
 */
router.get('/', authenticateToken, generalLimiter, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const credentialId = req.query.credentialId as string | undefined;

    // 情况1: 获取所有凭证的域名（聚合）
    if (credentialId === 'all') {
      const credentials = await prisma.cfCredential.findMany({
        where: { userId },
        orderBy: { createdAt: 'asc' },
      });

      if (credentials.length === 0) {
        return errorResponse(res, '未配置任何凭证', 400);
      }

      // 并行获取所有凭证的域名
      const results = await Promise.allSettled(
        credentials.map(async (credential) => {
          const apiToken = decrypt(credential.apiToken);
          const cfService = new CloudflareService(apiToken);
          const domains = await cfService.getDomains();

          // 为每个域名添加凭证信息
          return domains.map((domain) => ({
            ...domain,
            credentialId: credential.id,
            credentialName: credential.name,
          }));
        })
      );

      // 合并成功的结果
      const allDomains = results
        .filter((result) => result.status === 'fulfilled')
        .flatMap((result: any) => result.value);

      // 收集失败的凭证
      const failedCredentials = results
        .map((result, index) => ({ result, credential: credentials[index] }))
        .filter(({ result }) => result.status === 'rejected')
        .map(({ credential, result }: any) => ({
          credentialId: credential.id,
          credentialName: credential.name,
          error: result.reason?.message || '未知错误',
        }));

      return successResponse(res, {
        domains: allDomains,
        failedCredentials: failedCredentials.length > 0 ? failedCredentials : undefined,
      }, '获取域名列表成功');
    }

    // 情况2: 获取指定凭证的域名
    let credential;
    if (credentialId) {
      credential = await prisma.cfCredential.findFirst({
        where: {
          id: parseInt(credentialId),
          userId,
        },
      });

      if (!credential) {
        return errorResponse(res, '凭证不存在或无权访问', 404);
      }
    } else {
      // 情况3: 使用默认凭证
      credential = await prisma.cfCredential.findFirst({
        where: {
          userId,
          isDefault: true,
        },
      });

      if (!credential) {
        return errorResponse(res, '未配置默认凭证', 400);
      }
    }

    // 获取域名
    const apiToken = decrypt(credential.apiToken);
    const cfService = new CloudflareService(apiToken);
    const domains = await cfService.getDomains();

    // 为域名添加凭证信息
    const domainsWithCredential = domains.map((domain) => ({
      ...domain,
      credentialId: credential!.id,
      credentialName: credential!.name,
    }));

    return successResponse(res, {
      domains: domainsWithCredential,
      credential: {
        id: credential.id,
        name: credential.name,
      },
    }, '获取域名列表成功');
  } catch (error: any) {
    return errorResponse(res, error.message, 400);
  }
});

/**
 * GET /api/domains/:zoneId?credentialId=xxx
 * 获取域名详情
 */
router.get('/:zoneId', authenticateToken, generalLimiter, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const { zoneId } = req.params;
    const credentialId = req.query.credentialId as string | undefined;

    // 获取凭证
    let credential;
    if (credentialId) {
      credential = await prisma.cfCredential.findFirst({
        where: {
          id: parseInt(credentialId),
          userId,
        },
      });

      if (!credential) {
        return errorResponse(res, '凭证不存在或无权访问', 404);
      }
    } else {
      // 使用默认凭证
      credential = await prisma.cfCredential.findFirst({
        where: {
          userId,
          isDefault: true,
        },
      });

      if (!credential) {
        return errorResponse(res, '未配置默认凭证', 400);
      }
    }

    const apiToken = decrypt(credential.apiToken);
    const cfService = new CloudflareService(apiToken);

    const domain = await cfService.getDomainById(zoneId);

    return successResponse(res, { domain }, '获取域名详情成功');
  } catch (error: any) {
    return errorResponse(res, error.message, 400);
  }
});

/**
 * POST /api/domains/refresh?credentialId=xxx
 * 刷新域名缓存
 * - credentialId: 可选，指定凭证ID
 * - credentialId="all": 刷新所有凭证的缓存
 * - 不传: 刷新默认凭证的缓存
 */
router.post('/refresh', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const credentialId = req.query.credentialId as string | undefined;

    if (credentialId === 'all') {
      // 刷新所有凭证的缓存
      const credentials = await prisma.cfCredential.findMany({
        where: { userId },
      });

      for (const credential of credentials) {
        const apiToken = decrypt(credential.apiToken);
        const cfService = new CloudflareService(apiToken);
        cfService.clearCache('domains');
      }

      await LoggerService.createLog({
        userId,
        action: 'UPDATE',
        resourceType: 'ZONE',
        recordName: 'refresh_cache',
        status: 'SUCCESS',
        ipAddress: getClientIp(req),
        newValue: JSON.stringify({ credentialId: 'all' }),
      });

      return successResponse(res, null, '所有缓存已刷新');
    }

    // 获取凭证
    let credential;
    if (credentialId) {
      credential = await prisma.cfCredential.findFirst({
        where: {
          id: parseInt(credentialId),
          userId,
        },
      });

      if (!credential) {
        return errorResponse(res, '凭证不存在或无权访问', 404);
      }
    } else {
      // 使用默认凭证
      credential = await prisma.cfCredential.findFirst({
        where: {
          userId,
          isDefault: true,
        },
      });

      if (!credential) {
        return errorResponse(res, '未配置默认凭证', 400);
      }
    }

    const apiToken = decrypt(credential.apiToken);
    const cfService = new CloudflareService(apiToken);
    cfService.clearCache('domains');

    await LoggerService.createLog({
      userId,
      action: 'UPDATE',
      resourceType: 'ZONE',
      recordName: 'refresh_cache',
      status: 'SUCCESS',
      ipAddress: getClientIp(req),
      newValue: JSON.stringify({ credentialId: credentialId ? String(credentialId) : 'default' }),
    });

    return successResponse(res, null, '缓存已刷新');
  } catch (error: any) {
    try {
      await LoggerService.createLog({
        userId: req.user!.id,
        action: 'UPDATE',
        resourceType: 'ZONE',
        recordName: 'refresh_cache',
        status: 'FAILED',
        ipAddress: getClientIp(req),
        errorMessage: error?.message || '刷新缓存失败',
      });
    } catch {}
    return errorResponse(res, error.message, 400);
  }
});

export default router;
