import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
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

const normalizeHostname = (input: unknown): string => String(input ?? '').trim().replace(/\.+$/, '').toLowerCase();
const parseBool = (value: unknown): boolean => {
  const v = String(value ?? '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'y';
};
const stripWildcardPrefix = (hostname: string): string => normalizeHostname(hostname).replace(/^\*\./, '');
const findBestZone = (hostname: string, zones: Array<{ id: string; name: string }>): { id: string; name: string } | undefined => {
  const host = stripWildcardPrefix(hostname);
  let best: { id: string; name: string } | undefined;

  for (const z of zones) {
    const zone = normalizeHostname(z?.name);
    if (!zone) continue;
    if (host === zone || host.endsWith(`.${zone}`)) {
      if (!best || zone.length > normalizeHostname(best.name).length) best = z;
    }
  }

  return best;
};

const isFallbackIngressRule = (rule: any): boolean => {
  const host = String(rule?.hostname ?? '').trim();
  const path = String(rule?.path ?? '').trim();
  return !host && !path;
};

const ensureFallbackRule = (ingress: any[]): any[] => {
  const rules = Array.isArray(ingress) ? ingress.filter(Boolean) : [];
  if (rules.length === 0) return [{ service: 'http_status:404' }];
  if (isFallbackIngressRule(rules[rules.length - 1])) return rules;
  return [...rules, { service: 'http_status:404' }];
};

const extractConfigObject = (raw: any): any | null => {
  let value = raw;

  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }

  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;

  const cfg = (value as any)?.config;
  if (cfg && typeof cfg === 'object' && !Array.isArray(cfg)) return cfg;

  const v = value as any;
  const looksLikeConfig = 'ingress' in v || 'originRequest' in v || 'warp-routing' in v;
  if (looksLikeConfig) return value;

  return null;
};

const mapCidrRoute = (raw: any) => ({
  id: String(raw?.id || '').trim(),
  network: String(raw?.network || '').trim(),
  comment: String(raw?.comment || '').trim() || undefined,
  tunnelId: String(raw?.tunnel_id || '').trim() || undefined,
  virtualNetworkId: String(raw?.virtual_network_id || '').trim() || undefined,
  createdAt: String(raw?.created_at || '').trim() || undefined,
});

const mapHostnameRoute = (raw: any) => ({
  id: String(raw?.id || raw?.hostname_route_id || '').trim(),
  hostname: String(raw?.hostname || raw?.hostname_pattern || '').trim(),
  comment: String(raw?.comment || '').trim() || undefined,
  tunnelId: String(raw?.tunnel_id || '').trim() || undefined,
  createdAt: String(raw?.created_at || '').trim() || undefined,
});

/**
 * 获取 Cloudflare 凭证上下文（Account 级）
 */
async function getCloudflareContext(userId: number, credentialId?: string) {
  if (!credentialId) {
    throw new Error('缺少 credentialId 参数，请先选择一个 Cloudflare 账户');
  }

  const id = parseInt(credentialId, 10);
  if (!Number.isFinite(id)) {
    throw new Error('无效的 credentialId 参数');
  }

  const credential = await prisma.dnsCredential.findFirst({
    where: { id, userId, provider: 'cloudflare' },
  });
  if (!credential) {
    throw new Error('凭证不存在或无权访问');
  }

  let secrets: any;
  try {
    secrets = JSON.parse(decrypt(credential.secrets));
  } catch (error: any) {
    throw new Error(error?.message || 'Cloudflare 凭证解析失败');
  }

  const apiToken = secrets?.apiToken;
  if (!apiToken) {
    throw new Error('缺少 Cloudflare API Token');
  }

  const cfService = new CloudflareService(apiToken);
  const accountId = String(credential.accountId || '').trim() || (await cfService.getDefaultAccountId());

  if (!accountId) {
    throw new Error('缺少 Cloudflare Account ID，请检查 Token 权限（账户读取或区域读取）');
  }

  return { credential, cfService, accountId };
}

/**
 * GET /api/tunnels?credentialId=xxx
 * 获取 Tunnel 列表（Account 级别）
 */
router.get('/', authenticateToken, generalLimiter, async (req: AuthRequest, res) => {
  try {
    const credentialId = req.query.credentialId as string | undefined;
    const { cfService, accountId } = await getCloudflareContext(req.user!.id, credentialId);
    const tunnels = await cfService.getTunnels(accountId);
    return successResponse(res, { accountId, tunnels }, '获取 Tunnel 列表成功');
  } catch (error: any) {
    const statusCode = typeof error?.status === 'number'
      ? error.status
      : (typeof error?.statusCode === 'number' ? error.statusCode : 400);
    return errorResponse(res, error.message, statusCode);
  }
});

/**
 * GET /api/tunnels/:tunnelId/config?credentialId=xxx
 * 获取 Tunnel 配置（ingress/public hostnames）
 */
router.get('/:tunnelId/config', authenticateToken, generalLimiter, async (req: AuthRequest, res) => {
  try {
    const { tunnelId } = req.params;
    const credentialId = req.query.credentialId as string | undefined;
    const { cfService, accountId } = await getCloudflareContext(req.user!.id, credentialId);

    const raw = await cfService.getTunnelConfig(accountId, tunnelId);
    const config = extractConfigObject(raw);
    if (!config) return errorResponse(res, 'Tunnel 配置解析失败，请重试', 502);
    return successResponse(res, { config }, '获取 Tunnel 配置成功');
  } catch (error: any) {
    const statusCode = typeof error?.status === 'number'
      ? error.status
      : (typeof error?.statusCode === 'number' ? error.statusCode : 400);
    return errorResponse(res, error.message, statusCode);
  }
});

/**
 * POST /api/tunnels?credentialId=xxx
 * 创建 Tunnel
 * body: { name: string }
 */
router.post('/', authenticateToken, dnsLimiter, async (req: AuthRequest, res) => {
  try {
    const name = String(req.body?.name || '').trim();
    if (!name) return errorResponse(res, '缺少 Tunnel 名称', 400);

    const credentialId = req.query.credentialId as string | undefined;
    const { cfService, accountId } = await getCloudflareContext(req.user!.id, credentialId);

    const tunnel = await cfService.createTunnel(accountId, name);
    const token = await cfService.getTunnelToken(accountId, tunnel.id);

    await LoggerService.createLog({
      userId: req.user!.id,
      action: 'CREATE',
      resourceType: 'TUNNEL',
      domain: accountId,
      recordName: tunnel?.name || name,
      newValue: JSON.stringify({ tunnelId: tunnel?.id, name: tunnel?.name || name }),
      status: 'SUCCESS',
      ipAddress: getClientIp(req),
    });

    return successResponse(res, { tunnel, token }, '创建 Tunnel 成功', 201);
  } catch (error: any) {
    try {
      await LoggerService.createLog({
        userId: req.user!.id,
        action: 'CREATE',
        resourceType: 'TUNNEL',
        domain: undefined,
        recordName: String(req.body?.name || '').trim() || undefined,
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
 * PUT /api/tunnels/:tunnelId/config?credentialId=xxx
 * 更新 Tunnel 配置（全量 config）
 * body: { config: any }
 */
router.put('/:tunnelId/config', authenticateToken, dnsLimiter, async (req: AuthRequest, res) => {
  try {
    const { tunnelId } = req.params;
    const credentialId = req.query.credentialId as string | undefined;
    const { cfService, accountId } = await getCloudflareContext(req.user!.id, credentialId);

    const config = req.body?.config;
    if (!config || typeof config !== 'object' || Array.isArray(config)) {
      return errorResponse(res, '缺少或无效的 config 参数', 400);
    }

    await cfService.updateTunnelConfig(accountId, tunnelId, config);

    await LoggerService.createLog({
      userId: req.user!.id,
      action: 'UPDATE',
      resourceType: 'TUNNEL',
      domain: accountId,
      recordName: tunnelId,
      status: 'SUCCESS',
      ipAddress: getClientIp(req),
      newValue: JSON.stringify({ tunnelId, op: 'update_config' }),
    });

    return successResponse(res, { config }, '更新 Tunnel 配置成功');
  } catch (error: any) {
    const statusCode = typeof error?.status === 'number'
      ? error.status
      : (typeof error?.statusCode === 'number' ? error.statusCode : 400);
    return errorResponse(res, error.message, statusCode);
  }
});

/**
 * POST /api/tunnels/:tunnelId/public-hostnames?credentialId=xxx
 * 添加/更新 Public Hostname（ingress）并同步创建/更新 DNS CNAME 记录
 * body: { hostname: string; service: string; path?: string; zoneId: string }
 */
router.post('/:tunnelId/public-hostnames', authenticateToken, dnsLimiter, async (req: AuthRequest, res) => {
  const userId = req.user!.id;
  const ip = getClientIp(req);
  const { tunnelId } = req.params;
  const credentialId = req.query.credentialId as string | undefined;

  const hostnameRaw = String(req.body?.hostname || '').trim();
  const serviceRaw = String(req.body?.service || '').trim();
  const pathRaw = typeof req.body?.path === 'string' ? req.body.path.trim() : '';
  const zoneId = String(req.body?.zoneId || '').trim();

  if (!hostnameRaw) return errorResponse(res, '缺少 hostname', 400);
  if (!serviceRaw) return errorResponse(res, '缺少 service', 400);
  if (!zoneId) return errorResponse(res, '缺少 zoneId', 400);

  const pathKey = pathRaw;
  let accountIdForLog: string | undefined;

  try {
    const { cfService, accountId } = await getCloudflareContext(userId, credentialId);
    accountIdForLog = accountId;

    const raw = await cfService.getTunnelConfig(accountId, tunnelId);
    const config = extractConfigObject(raw);
    if (!config) {
      const err = new Error('获取 Tunnel 配置失败: 返回格式无法解析');
      (err as any).status = 502;
      throw err;
    }
    const oldConfig = JSON.parse(JSON.stringify(config));
    const ingress = Array.isArray(config?.ingress) ? [...config.ingress] : [];

    const hostKey = normalizeHostname(hostnameRaw);

    const existingIndex = ingress.findIndex((r: any) =>
      normalizeHostname(r?.hostname) === hostKey && String(r?.path ?? '').trim() === pathKey
    );

    const rule: any = {
      hostname: hostnameRaw,
      service: serviceRaw,
    };
    if (pathKey) rule.path = pathKey;

    if (existingIndex >= 0) {
      const next = { ...(ingress[existingIndex] || {}), ...rule };
      if (!pathKey) delete (next as any).path;
      ingress[existingIndex] = next;
    } else {
      const fallbackIndex = ingress.findIndex((r: any) => isFallbackIngressRule(r));
      const insertAt = fallbackIndex >= 0 ? fallbackIndex : ingress.length;
      ingress.splice(insertAt, 0, rule);
    }

    config.ingress = ensureFallbackRule(ingress);

    await cfService.updateTunnelConfig(accountId, tunnelId, config);

    let dns: any;
    try {
      dns = await cfService.upsertTunnelCnameRecord(zoneId, hostnameRaw, tunnelId);
    } catch (error: any) {
      const dnsStatus = error?.status || error?.statusCode;
      const dnsMsg = error?.message || String(error);

      try {
        await cfService.updateTunnelConfig(accountId, tunnelId, oldConfig);
      } catch (rollbackError: any) {
        const rollbackMsg = rollbackError?.message || String(rollbackError);
        const err = new Error(`DNS 记录创建/更新失败: ${dnsMsg}。并且 Tunnel 配置回滚失败: ${rollbackMsg}。请手动检查 Tunnel 配置与 DNS 记录。`);
        (err as any).status = dnsStatus;
        throw err;
      }

      const err = new Error(`DNS 记录创建/更新失败: ${dnsMsg}。已自动回滚 Tunnel 配置，请修复后重试。`);
      (err as any).status = dnsStatus;
      throw err;
    }

    await LoggerService.createLog({
      userId,
      action: 'UPDATE',
      resourceType: 'TUNNEL',
      domain: accountId,
      recordName: hostnameRaw,
      status: 'SUCCESS',
      ipAddress: ip,
      newValue: JSON.stringify({ tunnelId, hostname: hostnameRaw, path: pathKey || undefined, service: serviceRaw, dns }),
    });

    return successResponse(res, { config, dns }, '配置 Public Hostname 成功');
  } catch (error: any) {
    try {
      await LoggerService.createLog({
        userId,
        action: 'UPDATE',
        resourceType: 'TUNNEL',
        domain: accountIdForLog,
        recordName: hostnameRaw || tunnelId,
        status: 'FAILED',
        errorMessage: error?.message || String(error),
        ipAddress: ip,
        newValue: JSON.stringify({
          tunnelId,
          op: 'upsert_public_hostname',
          hostname: hostnameRaw,
          path: pathKey || undefined,
          service: serviceRaw,
          zoneId,
        }),
      });
    } catch {}

    const statusCode = typeof error?.status === 'number'
      ? error.status
      : (typeof error?.statusCode === 'number' ? error.statusCode : 400);
    return errorResponse(res, error.message, statusCode);
  }
});

/**
 * DELETE /api/tunnels/:tunnelId/public-hostnames?credentialId=xxx
 * 删除 Public Hostname（ingress），可选同时删除对应 DNS 记录
 * body: { hostname: string; path?: string; zoneId?: string; deleteDns?: boolean }
 */
router.delete('/:tunnelId/public-hostnames', authenticateToken, dnsLimiter, async (req: AuthRequest, res) => {
  const userId = req.user!.id;
  const ip = getClientIp(req);
  const { tunnelId } = req.params;
  const credentialId = req.query.credentialId as string | undefined;

  const hostnameRaw = String(req.body?.hostname || '').trim();
  const pathRaw = typeof req.body?.path === 'string' ? req.body.path.trim() : '';
  const zoneId = String(req.body?.zoneId || '').trim();
  const deleteDns = req.body?.deleteDns === true;

  if (!hostnameRaw) return errorResponse(res, '缺少 hostname', 400);

  const pathKey = pathRaw;
  let accountIdForLog: string | undefined;

  try {
    const { cfService, accountId } = await getCloudflareContext(userId, credentialId);
    accountIdForLog = accountId;

    const raw = await cfService.getTunnelConfig(accountId, tunnelId);
    const config = extractConfigObject(raw);
    if (!config) {
      const err = new Error('获取 Tunnel 配置失败: 返回格式无法解析');
      (err as any).status = 502;
      throw err;
    }
    const oldConfig = JSON.parse(JSON.stringify(config));
    const ingress = Array.isArray(config?.ingress) ? [...config.ingress] : [];

    const hostKey = normalizeHostname(hostnameRaw);

    const nextIngress = ingress.filter((r: any) => {
      const matchHost = normalizeHostname(r?.hostname) === hostKey;
      const matchPath = String(r?.path ?? '').trim() === pathKey;
      return !(matchHost && matchPath);
    });

    config.ingress = ensureFallbackRule(nextIngress);

    await cfService.updateTunnelConfig(accountId, tunnelId, config);

    let dns: any = undefined;
    if (deleteDns && zoneId) {
      try {
        dns = await cfService.deleteTunnelCnameRecordIfMatch(zoneId, hostnameRaw, tunnelId);
      } catch (error: any) {
        const dnsStatus = error?.status || error?.statusCode;
        const dnsMsg = error?.message || String(error);

        try {
          await cfService.updateTunnelConfig(accountId, tunnelId, oldConfig);
        } catch (rollbackError: any) {
          const rollbackMsg = rollbackError?.message || String(rollbackError);
          const err = new Error(`DNS 记录删除失败: ${dnsMsg}。并且 Tunnel 配置回滚失败: ${rollbackMsg}。请手动检查 Tunnel 配置与 DNS 记录。`);
          (err as any).status = dnsStatus;
          throw err;
        }

        const err = new Error(`DNS 记录删除失败: ${dnsMsg}。已自动回滚 Tunnel 配置，请修复后重试。`);
        (err as any).status = dnsStatus;
        throw err;
      }
    }

    await LoggerService.createLog({
      userId,
      action: 'UPDATE',
      resourceType: 'TUNNEL',
      domain: accountId,
      recordName: hostnameRaw,
      status: 'SUCCESS',
      ipAddress: ip,
      newValue: JSON.stringify({ tunnelId, hostname: hostnameRaw, path: pathKey || undefined, op: 'delete_public_hostname', dns }),
    });

    return successResponse(res, { config, dns }, '删除 Public Hostname 成功');
  } catch (error: any) {
    try {
      await LoggerService.createLog({
        userId,
        action: 'UPDATE',
        resourceType: 'TUNNEL',
        domain: accountIdForLog,
        recordName: hostnameRaw || tunnelId,
        status: 'FAILED',
        errorMessage: error?.message || String(error),
        ipAddress: ip,
        newValue: JSON.stringify({
          tunnelId,
          op: 'delete_public_hostname',
          hostname: hostnameRaw,
          path: pathKey || undefined,
          zoneId: zoneId || undefined,
          deleteDns,
        }),
      });
    } catch {}

    const statusCode = typeof error?.status === 'number'
      ? error.status
      : (typeof error?.statusCode === 'number' ? error.statusCode : 400);
    return errorResponse(res, error.message, statusCode);
  }
});

/**
 * GET /api/tunnels/:tunnelId/routes/private?credentialId=xxx
 * 获取 Tunnel 私网路由（CIDR + 主机名路由）
 */
router.get('/:tunnelId/routes/private', authenticateToken, generalLimiter, async (req: AuthRequest, res) => {
  try {
    const { tunnelId } = req.params;
    const credentialId = req.query.credentialId as string | undefined;
    const { cfService, accountId } = await getCloudflareContext(req.user!.id, credentialId);

    const [cidrResult, hostnameResult] = await Promise.allSettled([
      cfService.listCidrRoutes(accountId, tunnelId),
      cfService.listHostnameRoutes(accountId, tunnelId),
    ]);

    if (cidrResult.status === 'rejected' && hostnameResult.status === 'rejected') {
      throw cidrResult.reason || hostnameResult.reason;
    }

    const cidrRaw = cidrResult.status === 'fulfilled' ? cidrResult.value : [];
    const hostnameRaw = hostnameResult.status === 'fulfilled' ? hostnameResult.value : [];

    const cidrRoutes = (Array.isArray(cidrRaw) ? cidrRaw : [])
      .map(mapCidrRoute)
      .filter((r) => r.id && r.network);
    const hostnameRoutes = (Array.isArray(hostnameRaw) ? hostnameRaw : [])
      .map(mapHostnameRoute)
      .filter((r) => r.id && r.hostname);

    const warnings: any = {};
    if (cidrResult.status === 'rejected') {
      warnings.cidr = String((cidrResult.reason as any)?.message || cidrResult.reason || '获取 CIDR 路由失败');
    }
    if (hostnameResult.status === 'rejected') {
      warnings.hostname = String((hostnameResult.reason as any)?.message || hostnameResult.reason || '获取主机名路由失败');
    }

    const hasWarnings = Object.keys(warnings).length > 0;
    return successResponse(
      res,
      { cidrRoutes, hostnameRoutes, warnings: hasWarnings ? warnings : undefined },
      hasWarnings ? '获取私网路由成功（部分失败）' : '获取私网路由成功'
    );
  } catch (error: any) {
    const statusCode = typeof error?.status === 'number'
      ? error.status
      : (typeof error?.statusCode === 'number' ? error.statusCode : 400);
    return errorResponse(res, error.message, statusCode);
  }
});

/**
 * GET /api/tunnels/:tunnelId/routes/cidr?credentialId=xxx
 * 获取 Tunnel CIDR 路由
 */
router.get('/:tunnelId/routes/cidr', authenticateToken, generalLimiter, async (req: AuthRequest, res) => {
  try {
    const { tunnelId } = req.params;
    const credentialId = req.query.credentialId as string | undefined;
    const { cfService, accountId } = await getCloudflareContext(req.user!.id, credentialId);

    const raw = await cfService.listCidrRoutes(accountId, tunnelId);
    const routes = (Array.isArray(raw) ? raw : [])
      .map(mapCidrRoute)
      .filter((r) => r.id && r.network);

    return successResponse(res, { routes }, '获取 CIDR 路由成功');
  } catch (error: any) {
    const statusCode = typeof error?.status === 'number'
      ? error.status
      : (typeof error?.statusCode === 'number' ? error.statusCode : 400);
    return errorResponse(res, error.message, statusCode);
  }
});

/**
 * POST /api/tunnels/:tunnelId/routes/cidr?credentialId=xxx
 * 创建 CIDR 路由
 * body: { network: string; comment?: string; virtualNetworkId?: string }
 */
router.post('/:tunnelId/routes/cidr', authenticateToken, dnsLimiter, async (req: AuthRequest, res) => {
  const userId = req.user!.id;
  const ip = getClientIp(req);
  const { tunnelId } = req.params;
  const credentialId = req.query.credentialId as string | undefined;
  const network = String(req.body?.network || '').trim();
  const comment = String(req.body?.comment || '').trim();
  const virtualNetworkId = String(req.body?.virtualNetworkId || '').trim();

  if (!network) return errorResponse(res, '缺少 network（CIDR）参数', 400);

  let accountIdForLog: string | undefined;
  try {
    const { cfService, accountId } = await getCloudflareContext(userId, credentialId);
    accountIdForLog = accountId;

    const created = await cfService.createCidrRoute(accountId, {
      network,
      tunnelId,
      comment: comment || undefined,
      virtualNetworkId: virtualNetworkId || undefined,
    });
    const route = mapCidrRoute(created);

    await LoggerService.createLog({
      userId,
      action: 'CREATE',
      resourceType: 'TUNNEL',
      domain: accountId,
      recordName: route.network || tunnelId,
      status: 'SUCCESS',
      ipAddress: ip,
      newValue: JSON.stringify({ tunnelId, op: 'create_cidr_route', route }),
    });

    return successResponse(res, { route }, '创建 CIDR 路由成功', 201);
  } catch (error: any) {
    try {
      await LoggerService.createLog({
        userId,
        action: 'CREATE',
        resourceType: 'TUNNEL',
        domain: accountIdForLog,
        recordName: network || tunnelId,
        status: 'FAILED',
        errorMessage: error?.message || String(error),
        ipAddress: ip,
        newValue: JSON.stringify({
          tunnelId,
          op: 'create_cidr_route',
          network,
          comment: comment || undefined,
          virtualNetworkId: virtualNetworkId || undefined,
        }),
      });
    } catch {}

    const statusCode = typeof error?.status === 'number'
      ? error.status
      : (typeof error?.statusCode === 'number' ? error.statusCode : 400);
    return errorResponse(res, error.message, statusCode);
  }
});

/**
 * DELETE /api/tunnels/:tunnelId/routes/cidr/:routeId?credentialId=xxx
 * 删除 CIDR 路由
 */
router.delete('/:tunnelId/routes/cidr/:routeId', authenticateToken, dnsLimiter, async (req: AuthRequest, res) => {
  const userId = req.user!.id;
  const ip = getClientIp(req);
  const { tunnelId, routeId } = req.params;
  const credentialId = req.query.credentialId as string | undefined;

  if (!String(routeId || '').trim()) return errorResponse(res, '缺少 routeId 参数', 400);

  let accountIdForLog: string | undefined;
  try {
    const { cfService, accountId } = await getCloudflareContext(userId, credentialId);
    accountIdForLog = accountId;

    const cidrRoutes = await cfService.listCidrRoutes(accountId, tunnelId);
    const matched = (Array.isArray(cidrRoutes) ? cidrRoutes : [])
      .some((r: any) => String(r?.id || '').trim() === String(routeId || '').trim());
    if (!matched) {
      return errorResponse(res, 'CIDR 路由不存在或不属于当前 Tunnel', 404);
    }

    await cfService.deleteCidrRoute(accountId, routeId);

    await LoggerService.createLog({
      userId,
      action: 'DELETE',
      resourceType: 'TUNNEL',
      domain: accountId,
      recordName: routeId,
      status: 'SUCCESS',
      ipAddress: ip,
      newValue: JSON.stringify({ tunnelId, routeId, op: 'delete_cidr_route' }),
    });

    return successResponse(res, { routeId }, '删除 CIDR 路由成功');
  } catch (error: any) {
    try {
      await LoggerService.createLog({
        userId,
        action: 'DELETE',
        resourceType: 'TUNNEL',
        domain: accountIdForLog,
        recordName: routeId,
        status: 'FAILED',
        errorMessage: error?.message || String(error),
        ipAddress: ip,
        newValue: JSON.stringify({ tunnelId, routeId, op: 'delete_cidr_route' }),
      });
    } catch {}

    const statusCode = typeof error?.status === 'number'
      ? error.status
      : (typeof error?.statusCode === 'number' ? error.statusCode : 400);
    return errorResponse(res, error.message, statusCode);
  }
});

/**
 * GET /api/tunnels/:tunnelId/routes/hostname?credentialId=xxx
 * 获取 Tunnel 主机名路由
 */
router.get('/:tunnelId/routes/hostname', authenticateToken, generalLimiter, async (req: AuthRequest, res) => {
  try {
    const { tunnelId } = req.params;
    const credentialId = req.query.credentialId as string | undefined;
    const { cfService, accountId } = await getCloudflareContext(req.user!.id, credentialId);

    const raw = await cfService.listHostnameRoutes(accountId, tunnelId);
    const routes = (Array.isArray(raw) ? raw : [])
      .map(mapHostnameRoute)
      .filter((r) => r.id && r.hostname);

    return successResponse(res, { routes }, '获取主机名路由成功');
  } catch (error: any) {
    const statusCode = typeof error?.status === 'number'
      ? error.status
      : (typeof error?.statusCode === 'number' ? error.statusCode : 400);
    return errorResponse(res, error.message, statusCode);
  }
});

/**
 * POST /api/tunnels/:tunnelId/routes/hostname?credentialId=xxx
 * 创建主机名路由
 * body: { hostname: string; comment?: string }
 */
router.post('/:tunnelId/routes/hostname', authenticateToken, dnsLimiter, async (req: AuthRequest, res) => {
  const userId = req.user!.id;
  const ip = getClientIp(req);
  const { tunnelId } = req.params;
  const credentialId = req.query.credentialId as string | undefined;
  const hostname = normalizeHostname(req.body?.hostname);
  const comment = String(req.body?.comment || '').trim();

  if (!hostname) return errorResponse(res, '缺少 hostname 参数', 400);

  let accountIdForLog: string | undefined;
  try {
    const { cfService, accountId } = await getCloudflareContext(userId, credentialId);
    accountIdForLog = accountId;

    const created = await cfService.createHostnameRoute(accountId, {
      hostname,
      tunnelId,
      comment: comment || undefined,
    });
    const route = mapHostnameRoute(created);

    await LoggerService.createLog({
      userId,
      action: 'CREATE',
      resourceType: 'TUNNEL',
      domain: accountId,
      recordName: route.hostname || tunnelId,
      status: 'SUCCESS',
      ipAddress: ip,
      newValue: JSON.stringify({ tunnelId, op: 'create_hostname_route', route }),
    });

    return successResponse(res, { route }, '创建主机名路由成功', 201);
  } catch (error: any) {
    try {
      await LoggerService.createLog({
        userId,
        action: 'CREATE',
        resourceType: 'TUNNEL',
        domain: accountIdForLog,
        recordName: hostname || tunnelId,
        status: 'FAILED',
        errorMessage: error?.message || String(error),
        ipAddress: ip,
        newValue: JSON.stringify({ tunnelId, op: 'create_hostname_route', hostname, comment: comment || undefined }),
      });
    } catch {}

    const statusCode = typeof error?.status === 'number'
      ? error.status
      : (typeof error?.statusCode === 'number' ? error.statusCode : 400);
    return errorResponse(res, error.message, statusCode);
  }
});

/**
 * DELETE /api/tunnels/:tunnelId/routes/hostname/:routeId?credentialId=xxx
 * 删除主机名路由
 */
router.delete('/:tunnelId/routes/hostname/:routeId', authenticateToken, dnsLimiter, async (req: AuthRequest, res) => {
  const userId = req.user!.id;
  const ip = getClientIp(req);
  const { tunnelId, routeId } = req.params;
  const credentialId = req.query.credentialId as string | undefined;

  if (!String(routeId || '').trim()) return errorResponse(res, '缺少 routeId 参数', 400);

  let accountIdForLog: string | undefined;
  try {
    const { cfService, accountId } = await getCloudflareContext(userId, credentialId);
    accountIdForLog = accountId;

    const hostnameRoutes = await cfService.listHostnameRoutes(accountId, tunnelId);
    const matched = (Array.isArray(hostnameRoutes) ? hostnameRoutes : [])
      .some((r: any) => String(r?.id || r?.hostname_route_id || '').trim() === String(routeId || '').trim());
    if (!matched) {
      return errorResponse(res, '主机名路由不存在或不属于当前 Tunnel', 404);
    }

    await cfService.deleteHostnameRoute(accountId, routeId);

    await LoggerService.createLog({
      userId,
      action: 'DELETE',
      resourceType: 'TUNNEL',
      domain: accountId,
      recordName: routeId,
      status: 'SUCCESS',
      ipAddress: ip,
      newValue: JSON.stringify({ tunnelId, routeId, op: 'delete_hostname_route' }),
    });

    return successResponse(res, { routeId }, '删除主机名路由成功');
  } catch (error: any) {
    try {
      await LoggerService.createLog({
        userId,
        action: 'DELETE',
        resourceType: 'TUNNEL',
        domain: accountIdForLog,
        recordName: routeId,
        status: 'FAILED',
        errorMessage: error?.message || String(error),
        ipAddress: ip,
        newValue: JSON.stringify({ tunnelId, routeId, op: 'delete_hostname_route' }),
      });
    } catch {}

    const statusCode = typeof error?.status === 'number'
      ? error.status
      : (typeof error?.statusCode === 'number' ? error.statusCode : 400);
    return errorResponse(res, error.message, statusCode);
  }
});

/**
 * DELETE /api/tunnels/:tunnelId?credentialId=xxx
 * 删除 Tunnel
 */
router.delete('/:tunnelId', authenticateToken, dnsLimiter, async (req: AuthRequest, res) => {
  const userId = req.user!.id;
  const ip = getClientIp(req);
  const { tunnelId } = req.params;

  const credentialId = req.query.credentialId as string | undefined;
  const cleanupDns = parseBool((req.query as any)?.cleanupDns);

  let accountIdForLog: string | undefined;
  let cleanupSummary: any = undefined;

  try {
    const { cfService, accountId } = await getCloudflareContext(userId, credentialId);
    accountIdForLog = accountId;

    let hostnames: string[] = [];
    let cleanupTargets: Array<{ hostname: string; zoneId: string; zoneName: string }> = [];
    let cleanupSkipped: Array<{ hostname: string; reason: string }> = [];
    let prepareError: string | undefined;

    if (cleanupDns) {
      try {
        const raw = await cfService.getTunnelConfig(accountId, tunnelId);
        const config = extractConfigObject(raw);
        if (config) {
          const ingress = Array.isArray(config?.ingress) ? config.ingress : [];
          const seen = new Set<string>();
          for (const r of ingress) {
            const h = typeof r?.hostname === 'string' ? r.hostname.trim() : '';
            if (!h) continue;
            const key = normalizeHostname(h);
            if (!key || seen.has(key)) continue;
            seen.add(key);
            hostnames.push(h);
          }
        }

        const zonesRaw = await cfService.getDomains();
        const zones = (Array.isArray(zonesRaw) ? zonesRaw : [])
          .map((z: any) => ({ id: String(z?.id || '').trim(), name: String(z?.name || '').trim() }))
          .filter(z => !!z.id && !!z.name);

        const nextTargets: Array<{ hostname: string; zoneId: string; zoneName: string }> = [];
        const nextSkipped: Array<{ hostname: string; reason: string }> = [];
        for (const h of hostnames) {
          const zone = findBestZone(h, zones);
          if (!zone) {
            nextSkipped.push({ hostname: h, reason: '未找到所属域名（Zone）' });
            continue;
          }
          nextTargets.push({ hostname: h, zoneId: zone.id, zoneName: zone.name });
        }
        cleanupTargets = nextTargets;
        cleanupSkipped = nextSkipped;
      } catch (error: any) {
        prepareError = error?.message || String(error);
      }
    }

    await cfService.deleteTunnel(accountId, tunnelId);

    if (cleanupDns) {
      const deleted: Array<{ hostname: string; zoneName: string }> = [];
      const unchanged: Array<{ hostname: string; zoneName: string }> = [];
      const errors: Array<{ hostname: string; zoneName: string; error: string }> = [];

      for (const t of cleanupTargets) {
        try {
          const resp = await cfService.deleteTunnelCnameRecordIfMatch(t.zoneId, t.hostname, tunnelId);
          if (resp?.deleted) {
            deleted.push({ hostname: t.hostname, zoneName: t.zoneName });
          } else {
            unchanged.push({ hostname: t.hostname, zoneName: t.zoneName });
          }
        } catch (error: any) {
          errors.push({ hostname: t.hostname, zoneName: t.zoneName, error: error?.message || String(error) });
        }
      }

      cleanupSummary = {
        requested: true,
        prepareError,
        publicHostnames: hostnames.length,
        targets: cleanupTargets.length,
        skipped: cleanupSkipped,
        deleted,
        unchanged,
        errors,
      };
    }

    await LoggerService.createLog({
      userId,
      action: 'DELETE',
      resourceType: 'TUNNEL',
      domain: accountId,
      recordName: tunnelId,
      status: 'SUCCESS',
      ipAddress: ip,
      newValue: JSON.stringify({ tunnelId, op: 'delete_tunnel', cleanupDns, cleanup: cleanupSummary }),
    });

    let message = '删除 Tunnel 成功';
    if (cleanupDns) {
      if (cleanupSummary?.prepareError) {
        message = `删除 Tunnel 成功，但 DNS 清理未执行（准备失败：${cleanupSummary.prepareError}）`;
      } else if ((cleanupSummary?.publicHostnames || 0) === 0) {
        message = '删除 Tunnel 成功（未发现公共主机名，未执行 DNS 清理）';
      } else if ((cleanupSummary?.errors || []).length > 0) {
        message = `删除 Tunnel 成功，但部分 DNS 清理失败（成功 ${cleanupSummary.deleted.length}，失败 ${cleanupSummary.errors.length}）。`;
      } else {
        message = `删除 Tunnel 成功，并已完成 DNS 清理（已删除 ${cleanupSummary.deleted.length}）。`;
      }
    }

    return successResponse(res, { cleanup: cleanupSummary }, message);
  } catch (error: any) {
    try {
      await LoggerService.createLog({
        userId,
        action: 'DELETE',
        resourceType: 'TUNNEL',
        domain: accountIdForLog,
        recordName: tunnelId,
        status: 'FAILED',
        errorMessage: error.message,
        ipAddress: ip,
        newValue: JSON.stringify({ tunnelId, op: 'delete_tunnel', cleanupDns }),
      });
    } catch {}

    const statusCode = typeof error?.status === 'number'
      ? error.status
      : (typeof error?.statusCode === 'number' ? error.statusCode : 400);
    return errorResponse(res, error.message, statusCode);
  }
});

/**
 * GET /api/tunnels/:tunnelId/token?credentialId=xxx
 * 获取 Tunnel Token（用于 cloudflared 绑定）
 */
router.get('/:tunnelId/token', authenticateToken, generalLimiter, async (req: AuthRequest, res) => {
  try {
    const { tunnelId } = req.params;
    const credentialId = req.query.credentialId as string | undefined;
    const { cfService, accountId } = await getCloudflareContext(req.user!.id, credentialId);

    const token = await cfService.getTunnelToken(accountId, tunnelId);
    return successResponse(res, { token }, '获取 Tunnel Token 成功');
  } catch (error: any) {
    const statusCode = typeof error?.status === 'number'
      ? error.status
      : (typeof error?.statusCode === 'number' ? error.statusCode : 400);
    return errorResponse(res, error.message, statusCode);
  }
});

export default router;
