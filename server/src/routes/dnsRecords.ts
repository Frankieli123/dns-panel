/**
 * DNS 记录路由 - 支持多提供商
 * 使用新的 DnsService 统一门面
 */

import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { decrypt } from '../utils/encryption';
import { successResponse, errorResponse } from '../utils/response';
import { LoggerService } from '../services/logger';
import { authenticateToken } from '../middleware/auth';
import { dnsLimiter, generalLimiter } from '../middleware/rateLimit';
import { getClientIp } from '../middleware/logger';
import { AuthRequest } from '../types';
import { dnsService, DnsServiceContext } from '../services/dns/DnsService';
import { ProviderType } from '../providers/base/types';
import { DnsProviderError } from '../providers/base/BaseProvider';

const router = Router();
const prisma = new PrismaClient();

function parseDomains(input: unknown): string[] {
  const rawItems: unknown[] = Array.isArray(input)
    ? input
    : typeof input === 'string'
      ? input.split(/[\s,;]+/g)
      : [];

  const seen = new Set<string>();
  const out: string[] = [];

  for (const item of rawItems) {
    let d = typeof item === 'string' ? item : String(item ?? '');
    d = d.trim();
    if (!d) continue;
    d = d.replace(/^https?:\/\//i, '');
    d = d.replace(/\/.*$/, '');
    d = d.replace(/\.$/, '');
    if (!d) continue;

    const key = d.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(d);
  }

  return out;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const safeLimit = Math.max(1, Math.min(limit || 1, items.length || 1));
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  const workers = Array.from({ length: safeLimit }, () =>
    (async () => {
      while (true) {
        const idx = nextIndex;
        if (idx >= items.length) return;
        nextIndex += 1;
        results[idx] = await fn(items[idx], idx);
      }
    })()
  );

  await Promise.all(workers);
  return results;
}

/**
 * 获取凭证并构建 DnsServiceContext
 */
async function getServiceContext(userId: number, credentialId?: string): Promise<DnsServiceContext> {
  let credential;

  if (credentialId) {
    credential = await prisma.dnsCredential.findFirst({
      where: { id: parseInt(credentialId), userId },
    });
    if (!credential) {
      throw new Error('凭证不存在或无权访问');
    }
  } else {
    credential = await prisma.dnsCredential.findFirst({
      where: { userId, isDefault: true },
    });
    if (!credential) {
      throw new Error('未配置默认凭证');
    }
  }

  const secrets = JSON.parse(decrypt(credential.secrets));

  return {
    provider: credential.provider as ProviderType,
    secrets,
    accountId: credential.accountId || undefined,
    credentialKey: `cred-${credential.id}`,
    encrypted: false,
  };
}

/**
 * 处理 Provider 错误
 */
function handleProviderError(res: any, error: any) {
  if (error instanceof DnsProviderError) {
    const status = error.details.httpStatus || 400;
    return errorResponse(res, error.message, status, error.details);
  }
  return errorResponse(res, error.message || '操作失败', 400, error);
}

// ========== 域名相关 ==========

/**
 * GET /api/dns-records/zones?credentialId=xxx
 * 获取域名列表
 */
router.get('/zones', authenticateToken, generalLimiter, async (req: AuthRequest, res) => {
  try {
    const ctx = await getServiceContext(req.user!.id, req.query.credentialId as string);
    const page = parseInt(req.query.page as string) || 1;
    const pageSizeInput = parseInt(req.query.pageSize as string);
    const pageSize = Math.min(Number.isFinite(pageSizeInput) ? pageSizeInput : 20, 100);
    const keyword = req.query.keyword as string;

    const result = await dnsService.getZones(ctx, page, pageSize, keyword);

    return successResponse(res, {
      zones: result.zones,
      total: result.total,
      page,
      pageSize,
    }, '获取域名列表成功');
  } catch (error: any) {
    return handleProviderError(res, error);
  }
});

/**
 * POST /api/dns-records/zones?credentialId=xxx
 * 批量添加域名（如果提供商支持）
 * body: { domains: string[] | string } 或 { domain: string }
 */
router.post('/zones', authenticateToken, dnsLimiter, async (req: AuthRequest, res) => {
  try {
    const ctx = await getServiceContext(req.user!.id, req.query.credentialId as string);
    const body = (req.body || {}) as any;
    const domains = parseDomains(body.domains ?? body.domain ?? body.text);

    if (domains.length === 0) {
      return errorResponse(res, '缺少必需参数: domains', 400);
    }

    const results = await mapWithConcurrency(domains, 3, async (domain) => {
      try {
        const zone = await dnsService.addZone(ctx, domain);
        const meta: any = zone?.meta || {};
        const nameServers: string[] | undefined = Array.isArray(meta?.nameServers) ? meta.nameServers : undefined;
        const existed = meta?.existed === true;

        await LoggerService.createLog({
          userId: req.user!.id,
          action: 'CREATE',
          resourceType: 'ZONE',
          domain: zone.name,
          recordName: 'add_zone',
          status: 'SUCCESS',
          ipAddress: getClientIp(req),
          newValue: JSON.stringify({
            zoneId: zone.id,
            domain: zone.name,
            status: zone.status,
            nameServers,
            existed,
          }),
        });

        return {
          domain,
          success: true,
          existed,
          zone: {
            id: zone.id,
            name: zone.name,
            status: zone.status,
          },
          nameServers,
        };
      } catch (error: any) {
        const providerDetails = error instanceof DnsProviderError ? error.details : undefined;

        await LoggerService.createLog({
          userId: req.user!.id,
          action: 'CREATE',
          resourceType: 'ZONE',
          domain,
          recordName: 'add_zone',
          status: 'FAILED',
          errorMessage: error?.message || '添加域名失败',
          ipAddress: getClientIp(req),
          newValue: JSON.stringify({ domain, providerDetails }),
        });

        return {
          domain,
          success: false,
          error: error?.message || '添加域名失败',
          details: providerDetails,
        };
      }
    });

    return successResponse(res, { results }, '添加域名完成');
  } catch (error: any) {
    return handleProviderError(res, error);
  }
});

/**
 * GET /api/dns-records/zones/:zoneId?credentialId=xxx
 * 获取域名详情
 */
router.get('/zones/:zoneId', authenticateToken, generalLimiter, async (req: AuthRequest, res) => {
  try {
    const ctx = await getServiceContext(req.user!.id, req.query.credentialId as string);
    const zone = await dnsService.getZone(ctx, req.params.zoneId);

    return successResponse(res, { zone }, '获取域名详情成功');
  } catch (error: any) {
    return handleProviderError(res, error);
  }
});

/**
 * DELETE /api/dns-records/zones/:zoneId?credentialId=xxx
 * 删除域名（如果提供商支持）
 */
router.delete('/zones/:zoneId', authenticateToken, dnsLimiter, async (req: AuthRequest, res) => {
  try {
    const ctx = await getServiceContext(req.user!.id, req.query.credentialId as string);
    const { zoneId } = req.params;

    let zoneName = zoneId;
    try {
      const zone = await dnsService.getZone(ctx, zoneId);
      if (zone?.name) zoneName = zone.name;
    } catch {}

    const ok = await dnsService.deleteZone(ctx, zoneId);

    await LoggerService.createLog({
      userId: req.user!.id,
      action: 'DELETE',
      resourceType: 'ZONE',
      domain: zoneName,
      recordName: 'delete_zone',
      status: ok ? 'SUCCESS' : 'FAILED',
      ipAddress: getClientIp(req),
      newValue: JSON.stringify({ zoneId, domain: zoneName, deleted: ok }),
    });

    return successResponse(res, { deleted: ok }, '删除域名成功');
  } catch (error: any) {
    try {
      const details = error instanceof DnsProviderError ? error.details : undefined;
      await LoggerService.createLog({
        userId: req.user!.id,
        action: 'DELETE',
        resourceType: 'ZONE',
        domain: req.params.zoneId,
        recordName: 'delete_zone',
        status: 'FAILED',
        errorMessage: error?.message || '删除域名失败',
        ipAddress: getClientIp(req),
        newValue: JSON.stringify({ zoneId: req.params.zoneId, providerDetails: details }),
      });
    } catch {}

    return handleProviderError(res, error);
  }
});

// ========== DNS 记录相关 ==========

/**
 * GET /api/dns-records/zones/:zoneId/records?credentialId=xxx
 * 获取 DNS 记录列表
 */
router.get('/zones/:zoneId/records', authenticateToken, generalLimiter, async (req: AuthRequest, res) => {
  try {
    const ctx = await getServiceContext(req.user!.id, req.query.credentialId as string);
    const { zoneId } = req.params;

    const params = {
      page: parseInt(req.query.page as string) || 1,
      pageSize: Math.min(parseInt(req.query.pageSize as string) || 20, 500),
      keyword: req.query.keyword as string,
      subDomain: req.query.subDomain as string,
      type: req.query.type as string,
      value: req.query.value as string,
      line: req.query.line as string,
      status: req.query.status as '0' | '1',
    };

    const result = await dnsService.getRecords(ctx, zoneId, params);

    // 获取提供商能力
    const capabilities = dnsService.getCapabilities(ctx);

    return successResponse(res, {
      records: result.records,
      total: result.total,
      page: params.page,
      pageSize: params.pageSize,
      capabilities: {
        supportsWeight: capabilities.supportsWeight,
        supportsLine: capabilities.supportsLine,
        supportsStatus: capabilities.supportsStatus,
        supportsRemark: capabilities.supportsRemark,
      },
    }, '获取 DNS 记录成功');
  } catch (error: any) {
    return handleProviderError(res, error);
  }
});

/**
 * GET /api/dns-records/zones/:zoneId/records/:recordId?credentialId=xxx
 * 获取单条 DNS 记录
 */
router.get('/zones/:zoneId/records/:recordId', authenticateToken, generalLimiter, async (req: AuthRequest, res) => {
  try {
    const ctx = await getServiceContext(req.user!.id, req.query.credentialId as string);
    const { zoneId, recordId } = req.params;

    const record = await dnsService.getRecord(ctx, zoneId, recordId);

    return successResponse(res, { record }, '获取记录详情成功');
  } catch (error: any) {
    return handleProviderError(res, error);
  }
});

/**
 * POST /api/dns-records/zones/:zoneId/records?credentialId=xxx
 * 创建 DNS 记录
 */
router.post('/zones/:zoneId/records', authenticateToken, dnsLimiter, async (req: AuthRequest, res) => {
  try {
    const ctx = await getServiceContext(req.user!.id, req.query.credentialId as string);
    const { zoneId } = req.params;
    const { name, type, value, ttl, line, weight, priority, remark, proxied } = req.body;

    if (!name || !type || !value) {
      return errorResponse(res, '缺少必需参数: name, type, value', 400);
    }

    const record = await dnsService.createRecord(ctx, zoneId, {
      name,
      type,
      value,
      ttl,
      line,
      weight,
      priority,
      remark,
      proxied,
    });

    await LoggerService.createLog({
      userId: req.user!.id,
      action: 'CREATE',
      resourceType: 'DNS',
      domain: record.zoneName,
      recordName: record.name,
      recordType: record.type,
      newValue: JSON.stringify({
        id: record.id,
        name: record.name,
        type: record.type,
        value: record.value,
        ttl: record.ttl,
        line: record.line,
        weight: record.weight,
        priority: record.priority,
        remark: record.remark,
        status: record.status,
        proxied: record.proxied,
      }),
      status: 'SUCCESS',
      ipAddress: getClientIp(req),
    });

    return successResponse(res, { record }, 'DNS 记录创建成功', 201);
  } catch (error: any) {
    await LoggerService.createLog({
      userId: req.user!.id,
      action: 'CREATE',
      resourceType: 'DNS',
      recordName: req.body.name,
      recordType: req.body.type,
      status: 'FAILED',
      errorMessage: error.message,
      ipAddress: getClientIp(req),
    });
    return handleProviderError(res, error);
  }
});

/**
 * PUT /api/dns-records/zones/:zoneId/records/:recordId?credentialId=xxx
 * 更新 DNS 记录
 */
router.put('/zones/:zoneId/records/:recordId', authenticateToken, dnsLimiter, async (req: AuthRequest, res) => {
  try {
    const ctx = await getServiceContext(req.user!.id, req.query.credentialId as string);
    const { zoneId, recordId } = req.params;
    const { name, type, value, ttl, line, weight, priority, remark, proxied } = req.body;

    // 获取旧记录
    let oldRecord;
    try {
      oldRecord = await dnsService.getRecord(ctx, zoneId, recordId);
    } catch {}

    const record = await dnsService.updateRecord(ctx, zoneId, recordId, {
      name,
      type,
      value,
      ttl,
      line,
      weight,
      priority,
      remark,
      proxied,
    });

    await LoggerService.createLog({
      userId: req.user!.id,
      action: 'UPDATE',
      resourceType: 'DNS',
      domain: record.zoneName,
      recordName: record.name,
      recordType: record.type,
      oldValue: oldRecord ? JSON.stringify(oldRecord) : undefined,
      newValue: JSON.stringify({
        id: record.id,
        name: record.name,
        type: record.type,
        value: record.value,
        ttl: record.ttl,
        line: record.line,
        weight: record.weight,
        priority: record.priority,
        remark: record.remark,
        status: record.status,
        proxied: record.proxied,
      }),
      status: 'SUCCESS',
      ipAddress: getClientIp(req),
    });

    return successResponse(res, { record }, 'DNS 记录更新成功');
  } catch (error: any) {
    await LoggerService.createLog({
      userId: req.user!.id,
      action: 'UPDATE',
      resourceType: 'DNS',
      status: 'FAILED',
      errorMessage: error.message,
      ipAddress: getClientIp(req),
    });
    return handleProviderError(res, error);
  }
});

/**
 * DELETE /api/dns-records/zones/:zoneId/records/:recordId?credentialId=xxx
 * 删除 DNS 记录
 */
router.delete('/zones/:zoneId/records/:recordId', authenticateToken, dnsLimiter, async (req: AuthRequest, res) => {
  try {
    const ctx = await getServiceContext(req.user!.id, req.query.credentialId as string);
    const { zoneId, recordId } = req.params;

    // 获取记录信息用于日志
    let record;
    try {
      record = await dnsService.getRecord(ctx, zoneId, recordId);
    } catch {}

    await dnsService.deleteRecord(ctx, zoneId, recordId);

    await LoggerService.createLog({
      userId: req.user!.id,
      action: 'DELETE',
      resourceType: 'DNS',
      domain: record?.zoneName,
      recordName: record?.name,
      recordType: record?.type,
      oldValue: record ? JSON.stringify(record) : undefined,
      status: 'SUCCESS',
      ipAddress: getClientIp(req),
    });

    return successResponse(res, null, 'DNS 记录删除成功');
  } catch (error: any) {
    await LoggerService.createLog({
      userId: req.user!.id,
      action: 'DELETE',
      resourceType: 'DNS',
      status: 'FAILED',
      errorMessage: error.message,
      ipAddress: getClientIp(req),
    });
    return handleProviderError(res, error);
  }
});

/**
 * PUT /api/dns-records/zones/:zoneId/records/:recordId/status?credentialId=xxx
 * 设置记录状态（启用/禁用）
 */
router.put('/zones/:zoneId/records/:recordId/status', authenticateToken, dnsLimiter, async (req: AuthRequest, res) => {
  let recordForLog: any;
  try {
    const ctx = await getServiceContext(req.user!.id, req.query.credentialId as string);
    const { zoneId, recordId } = req.params;
    const { enabled } = req.body;

    if (typeof enabled !== 'boolean') {
      return errorResponse(res, '缺少参数: enabled (boolean)', 400);
    }

    const capabilities = dnsService.getCapabilities(ctx);
    if (!capabilities.supportsStatus) {
      return errorResponse(res, '当前提供商不支持启用/禁用记录', 400);
    }

    try {
      recordForLog = await dnsService.getRecord(ctx, zoneId, recordId);
    } catch {}

    await dnsService.setRecordStatus(ctx, zoneId, recordId, enabled);

    await LoggerService.createLog({
      userId: req.user!.id,
      action: 'UPDATE',
      resourceType: 'DNS',
      domain: recordForLog?.zoneName,
      recordName: recordForLog?.name,
      recordType: recordForLog?.type,
      oldValue: recordForLog
        ? JSON.stringify({ id: recordForLog.id, status: recordForLog.status, enabled: recordForLog.status === '1' })
        : undefined,
      newValue: JSON.stringify({ recordId, enabled, status: enabled ? '1' : '0' }),
      status: 'SUCCESS',
      ipAddress: getClientIp(req),
    });

    return successResponse(res, { enabled }, `记录已${enabled ? '启用' : '禁用'}`);
  } catch (error: any) {
    await LoggerService.createLog({
      userId: req.user!.id,
      action: 'UPDATE',
      resourceType: 'DNS',
      domain: recordForLog?.zoneName,
      recordName: recordForLog?.name,
      recordType: recordForLog?.type,
      status: 'FAILED',
      errorMessage: error.message,
      ipAddress: getClientIp(req),
    });
    return handleProviderError(res, error);
  }
});

/**
 * GET /api/dns-records/zones/:zoneId/lines?credentialId=xxx
 * 获取解析线路列表
 */
router.get('/zones/:zoneId/lines', authenticateToken, generalLimiter, async (req: AuthRequest, res) => {
  try {
    const ctx = await getServiceContext(req.user!.id, req.query.credentialId as string);
    const { zoneId } = req.params;

    const result = await dnsService.getLines(ctx, zoneId);

    return successResponse(res, { lines: result.lines }, '获取线路列表成功');
  } catch (error: any) {
    return handleProviderError(res, error);
  }
});
router.get('/zones/:zoneId/min-ttl', authenticateToken, generalLimiter, async (req: AuthRequest, res) => {
  try {
    const ctx = await getServiceContext(req.user!.id, req.query.credentialId as string);
    const { zoneId } = req.params;

    const minTTL = await dnsService.getMinTTL(ctx, zoneId);

    return successResponse(res, { minTTL }, '获取最低TTL成功');
  } catch (error: any) {
    return handleProviderError(res, error);
  }
});

/**
 * POST /api/dns-records/refresh?credentialId=xxx
 * 刷新缓存
 */
router.post('/refresh', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const ctx = await getServiceContext(req.user!.id, req.query.credentialId as string);
    const { zoneId } = req.body;

    dnsService.clearCache(ctx, 'all', zoneId);

    await LoggerService.createLog({
      userId: req.user!.id,
      action: 'UPDATE',
      resourceType: 'DNS',
      domain: zoneId ? String(zoneId) : undefined,
      recordName: 'refresh_cache',
      status: 'SUCCESS',
      ipAddress: getClientIp(req),
      newValue: JSON.stringify({ zoneId: zoneId ? String(zoneId) : undefined }),
    });

    return successResponse(res, null, '缓存已刷新');
  } catch (error: any) {
    await LoggerService.createLog({
      userId: req.user!.id,
      action: 'UPDATE',
      resourceType: 'DNS',
      recordName: 'refresh_cache',
      status: 'FAILED',
      errorMessage: error.message,
      ipAddress: getClientIp(req),
    });
    return handleProviderError(res, error);
  }
});

export default router;
