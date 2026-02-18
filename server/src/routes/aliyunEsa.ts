import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { Resolver } from 'dns/promises';
import { decrypt } from '../utils/encryption';
import { successResponse, errorResponse } from '../utils/response';
import { authenticateToken } from '../middleware/auth';
import type { AuthRequest } from '../types';
import {
  createEsaRecord,
  applyEsaCertificate,
  createEsaSite,
  deleteEsaRecord,
  deleteEsaSite,
  getEsaCertificate,
  getEsaRecord,
  listEsaCertificatesByRecord,
  listEsaRecords,
  listEsaRatePlanInstances,
  listEsaSites,
  updateEsaRecord,
  verifyEsaSite,
} from '../services/aliyunEsa';

const router = Router();
const prisma = new PrismaClient();

router.use(authenticateToken);

function parseCredentialId(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return undefined;
  const n = parseInt(value, 10);
  return Number.isFinite(n) ? n : undefined;
}

function normalizeRegion(value: unknown): string | undefined {
  const r = String(value || '').trim();
  if (!r) return undefined;
  // cn-hangzhou / ap-southeast-1 ...
  if (!/^[a-z]{2}-[a-z0-9-]+$/i.test(r)) return undefined;
  return r;
}

async function getAliyunAuth(userId: number, credentialId?: number) {
  const credential = credentialId
    ? await prisma.dnsCredential.findFirst({
        where: { id: credentialId, userId },
        select: { id: true, provider: true, secrets: true },
      })
    : await prisma.dnsCredential.findFirst({
        where: { userId, isDefault: true },
        select: { id: true, provider: true, secrets: true },
      });

  if (!credential) {
    throw Object.assign(new Error('凭证不存在或无权访问'), { httpStatus: 404 });
  }

  if (String(credential.provider) !== 'aliyun') {
    throw Object.assign(new Error('该凭证不是阿里云 DNS 账户'), { httpStatus: 400 });
  }

  let parsed: any;
  try {
    parsed = JSON.parse(decrypt(credential.secrets));
  } catch (e: any) {
    throw Object.assign(new Error(e?.message || '凭证密钥解析失败'), { httpStatus: 500 });
  }

  const accessKeyId = String(parsed?.accessKeyId || '').trim();
  const accessKeySecret = String(parsed?.accessKeySecret || '').trim();

  if (!accessKeyId || !accessKeySecret) {
    throw Object.assign(new Error('缺少阿里云 AccessKeyId/AccessKeySecret'), { httpStatus: 400 });
  }

  return {
    credentialId: credential.id,
    auth: { accessKeyId, accessKeySecret },
  };
}

function normalizeDnsName(name: string): string {
  return String(name || '').trim().replace(/\.$/, '').toLowerCase();
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Object.assign(new Error('DNS 查询超时'), { code: 'DNS_TIMEOUT' })), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

async function resolveCnameTargets(resolver: Resolver, hostname: string): Promise<string[]> {
  try {
    const targets = await withTimeout(resolver.resolveCname(hostname), 2500);
    return Array.isArray(targets) ? targets.map((t) => String(t || '').trim()).filter(Boolean) : [];
  } catch {
    return [];
  }
}

async function resolveIps(resolver: Resolver, hostname: string): Promise<string[]> {
  const results: string[] = [];

  try {
    const ips4 = await withTimeout(resolver.resolve4(hostname), 2500);
    if (Array.isArray(ips4)) results.push(...ips4);
  } catch {
    // ignore
  }

  try {
    const ips6 = await withTimeout(resolver.resolve6(hostname), 2500);
    if (Array.isArray(ips6)) results.push(...ips6);
  } catch {
    // ignore
  }

  return Array.from(new Set(results.map((ip) => String(ip || '').trim()).filter(Boolean)));
}

function hasIntersection(a: string[], b: string[]): boolean {
  if (a.length === 0 || b.length === 0) return false;
  const set = new Set(a);
  return b.some((x) => set.has(x));
}

async function checkCnameStatusOne(resolver: Resolver, recordName: string, recordCname: string): Promise<{ recordName: string; status: string }> {
  const name = normalizeDnsName(recordName);
  const expected = normalizeDnsName(recordCname);

  if (!name || !expected) {
    return { recordName, status: 'unknown' };
  }

  const cnames = (await resolveCnameTargets(resolver, name)).map(normalizeDnsName).filter(Boolean);
  if (cnames.includes(expected)) {
    return { recordName, status: 'configured' };
  }

  const [nameIps, expectedIps] = await Promise.all([
    resolveIps(resolver, name),
    resolveIps(resolver, expected),
  ]);

  if (hasIntersection(nameIps, expectedIps)) {
    return { recordName, status: 'configured' };
  }

  if (nameIps.length === 0 && cnames.length === 0) {
    return { recordName, status: 'unconfigured' };
  }

  return { recordName, status: 'unconfigured' };
}

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let idx = 0;

  const workers = Array.from({ length: Math.max(1, concurrency) }, async () => {
    while (true) {
      const current = idx;
      idx += 1;
      if (current >= items.length) return;

      results[current] = await fn(items[current]);
    }
  });

  await Promise.all(workers);
  return results;
}

router.get('/sites', async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const credentialId = parseCredentialId(req.query.credentialId);
    const region = normalizeRegion(req.query.region);

    const pageNumber = parseInt(String(req.query.page || '1'), 10) || 1;
    const pageSizeInput = parseInt(String(req.query.pageSize || '100'), 10);
    const pageSize = Math.max(1, Math.min(500, Number.isFinite(pageSizeInput) ? pageSizeInput : 100));
    const keyword = typeof req.query.keyword === 'string' ? req.query.keyword : undefined;

    const { auth } = await getAliyunAuth(userId, credentialId);
    const result = await listEsaSites(auth, { region, pageNumber, pageSize, keyword });

    return successResponse(res, result, '获取 ESA 站点列表成功');
  } catch (error: any) {
    const status = typeof error?.httpStatus === 'number' ? error.httpStatus : 400;
    return errorResponse(res, error?.message || '获取 ESA 站点列表失败', status, error);
  }
});

router.get('/instances', async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const credentialId = parseCredentialId(req.query.credentialId);
    const region = normalizeRegion(req.query.region);

    const pageNumber = parseInt(String(req.query.page || '1'), 10) || 1;
    const pageSizeInput = parseInt(String(req.query.pageSize || '100'), 10);
    const pageSize = Math.max(1, Math.min(500, Number.isFinite(pageSizeInput) ? pageSizeInput : 100));
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    const checkRemainingSiteQuota =
      String(req.query.checkRemainingSiteQuota || 'false').trim().toLowerCase() === 'true';

    const { auth } = await getAliyunAuth(userId, credentialId);
    const result = await listEsaRatePlanInstances(auth, {
      region,
      pageNumber,
      pageSize,
      status,
      checkRemainingSiteQuota,
    });

    return successResponse(res, result, '获取 ESA 套餐实例成功');
  } catch (error: any) {
    const status = typeof error?.httpStatus === 'number' ? error.httpStatus : 400;
    return errorResponse(res, error?.message || '获取 ESA 套餐实例失败', status, error);
  }
});

router.post('/sites', async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const body = (req.body || {}) as any;
    const credentialId = parseCredentialId(body.credentialId ?? req.query.credentialId);
    const region = normalizeRegion(body.region ?? req.query.region);

    const siteName = String(body.siteName || body.SiteName || '').trim();
    const coverage = String(body.coverage || body.Coverage || '').trim();
    const accessType = String(body.accessType || body.AccessType || '').trim();
    const instanceId = String(body.instanceId || body.InstanceId || '').trim();

    if (!siteName) return errorResponse(res, '缺少参数: siteName', 400);
    if (!coverage) return errorResponse(res, '缺少参数: coverage', 400);
    if (!accessType) return errorResponse(res, '缺少参数: accessType', 400);
    if (!instanceId) return errorResponse(res, '缺少参数: instanceId', 400);

    const { auth } = await getAliyunAuth(userId, credentialId);
    const result = await createEsaSite(auth, { region, siteName, coverage, accessType, instanceId });

    return successResponse(res, result, '创建 ESA 站点成功', 201);
  } catch (error: any) {
    const status = typeof error?.httpStatus === 'number' ? error.httpStatus : 400;
    return errorResponse(res, error?.message || '创建 ESA 站点失败', status, error);
  }
});

router.post('/sites/:siteId/verify', async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const siteId = String(req.params.siteId || '').trim();
    const body = (req.body || {}) as any;
    const credentialId = parseCredentialId(body.credentialId ?? req.query.credentialId);
    const region = normalizeRegion(body.region ?? req.query.region);

    if (!siteId) return errorResponse(res, '缺少参数: siteId', 400);

    const { auth } = await getAliyunAuth(userId, credentialId);
    const result = await verifyEsaSite(auth, { region, siteId });

    return successResponse(res, result, '验证 ESA 站点完成');
  } catch (error: any) {
    const status = typeof error?.httpStatus === 'number' ? error.httpStatus : 400;
    return errorResponse(res, error?.message || '验证 ESA 站点失败', status, error);
  }
});

router.delete('/sites/:siteId', async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const siteId = String(req.params.siteId || '').trim();
    const credentialId = parseCredentialId(req.query.credentialId);
    const region = normalizeRegion(req.query.region);

    if (!siteId) return errorResponse(res, '缺少参数: siteId', 400);

    const { auth } = await getAliyunAuth(userId, credentialId);
    const result = await deleteEsaSite(auth, { region, siteId });

    return successResponse(res, result, '删除 ESA 站点成功');
  } catch (error: any) {
    const status = typeof error?.httpStatus === 'number' ? error.httpStatus : 400;
    return errorResponse(res, error?.message || '删除 ESA 站点失败', status, error);
  }
});

router.get('/records', async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const credentialId = parseCredentialId(req.query.credentialId);
    const region = normalizeRegion(req.query.region);

    const siteId = String(req.query.siteId || '').trim();
    if (!siteId) return errorResponse(res, '缺少参数: siteId', 400);

    const pageNumber = parseInt(String(req.query.page || '1'), 10) || 1;
    const pageSizeInput = parseInt(String(req.query.pageSize || '50'), 10);
    const pageSize = Math.max(1, Math.min(500, Number.isFinite(pageSizeInput) ? pageSizeInput : 50));

    const recordName = typeof req.query.recordName === 'string' ? req.query.recordName : undefined;
    const recordMatchType = typeof req.query.recordMatchType === 'string' ? req.query.recordMatchType : undefined;
    const type = typeof req.query.type === 'string' ? req.query.type : undefined;
    const proxied = req.query.proxied as any;

    const { auth } = await getAliyunAuth(userId, credentialId);
    const result = await listEsaRecords(auth, {
      region,
      siteId,
      recordName,
      recordMatchType,
      type,
      proxied,
      pageNumber,
      pageSize,
    });

    return successResponse(res, result, '获取 ESA DNS 记录成功');
  } catch (error: any) {
    const status = typeof error?.httpStatus === 'number' ? error.httpStatus : 400;
    return errorResponse(res, error?.message || '获取 ESA DNS 记录失败', status, error);
  }
});

router.get('/records/:recordId', async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const recordId = String(req.params.recordId || '').trim();
    const credentialId = parseCredentialId(req.query.credentialId);
    const region = normalizeRegion(req.query.region);

    if (!recordId) return errorResponse(res, '缺少参数: recordId', 400);

    const { auth } = await getAliyunAuth(userId, credentialId);
    const result = await getEsaRecord(auth, { region, recordId });

    return successResponse(res, result, '获取 ESA DNS 记录详情成功');
  } catch (error: any) {
    const status = typeof error?.httpStatus === 'number' ? error.httpStatus : 400;
    return errorResponse(res, error?.message || '获取 ESA DNS 记录详情失败', status, error);
  }
});

router.post('/records', async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const body = (req.body || {}) as any;
    const credentialId = parseCredentialId(body.credentialId ?? req.query.credentialId);
    const region = normalizeRegion(body.region ?? req.query.region);

    const siteId = String(body.siteId || '').trim();
    const recordName = String(body.recordName || '').trim();
    const type = String(body.type || '').trim();
    const proxied = typeof body.proxied === 'boolean' ? body.proxied : undefined;
    const ttl = typeof body.ttl === 'number' ? body.ttl : undefined;
    const sourceType = typeof body.sourceType === 'string' ? body.sourceType : undefined;
    const bizName = typeof body.bizName === 'string' ? body.bizName : undefined;
    const comment = typeof body.comment === 'string' ? body.comment : undefined;
    const hostPolicy = typeof body.hostPolicy === 'string' ? body.hostPolicy : undefined;
    const data = body.data;
    const authConf = body.authConf;

    if (!siteId) return errorResponse(res, '缺少参数: siteId', 400);
    if (!recordName) return errorResponse(res, '缺少参数: recordName', 400);
    if (!type) return errorResponse(res, '缺少参数: type', 400);
    if (!data || typeof data !== 'object') return errorResponse(res, '缺少参数: data(object)', 400);

    const { auth } = await getAliyunAuth(userId, credentialId);
    const result = await createEsaRecord(auth, {
      region,
      siteId,
      recordName,
      type,
      ttl,
      proxied,
      sourceType,
      bizName,
      comment,
      hostPolicy,
      data,
      authConf: authConf && typeof authConf === 'object' ? authConf : undefined,
    });

    return successResponse(res, result, '创建 ESA DNS 记录成功', 201);
  } catch (error: any) {
    const status = typeof error?.httpStatus === 'number' ? error.httpStatus : 400;
    return errorResponse(res, error?.message || '创建 ESA DNS 记录失败', status, error);
  }
});

router.put('/records/:recordId', async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const recordId = String(req.params.recordId || '').trim();
    const body = (req.body || {}) as any;
    const credentialId = parseCredentialId(body.credentialId ?? req.query.credentialId);
    const region = normalizeRegion(body.region ?? req.query.region);

    const proxied = typeof body.proxied === 'boolean' ? body.proxied : undefined;
    const ttl = typeof body.ttl === 'number' ? body.ttl : undefined;
    const sourceType = typeof body.sourceType === 'string' ? body.sourceType : undefined;
    const bizName = typeof body.bizName === 'string' ? body.bizName : undefined;
    const comment = typeof body.comment === 'string' ? body.comment : undefined;
    const hostPolicy = typeof body.hostPolicy === 'string' ? body.hostPolicy : undefined;
    const data = body.data;
    const authConf = body.authConf;

    if (!recordId) return errorResponse(res, '缺少参数: recordId', 400);
    if (!data || typeof data !== 'object') return errorResponse(res, '缺少参数: data(object)', 400);

    const { auth } = await getAliyunAuth(userId, credentialId);
    const result = await updateEsaRecord(auth, {
      region,
      recordId,
      ttl,
      proxied,
      sourceType,
      bizName,
      comment,
      hostPolicy,
      data,
      authConf: authConf && typeof authConf === 'object' ? authConf : undefined,
    });

    return successResponse(res, result, '更新 ESA DNS 记录成功');
  } catch (error: any) {
    const status = typeof error?.httpStatus === 'number' ? error.httpStatus : 400;
    return errorResponse(res, error?.message || '更新 ESA DNS 记录失败', status, error);
  }
});

router.delete('/records/:recordId', async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const recordId = String(req.params.recordId || '').trim();
    const credentialId = parseCredentialId(req.query.credentialId);
    const region = normalizeRegion(req.query.region);

    if (!recordId) return errorResponse(res, '缺少参数: recordId', 400);

    const { auth } = await getAliyunAuth(userId, credentialId);
    const result = await deleteEsaRecord(auth, { region, recordId });

    return successResponse(res, result, '删除 ESA DNS 记录成功');
  } catch (error: any) {
    const status = typeof error?.httpStatus === 'number' ? error.httpStatus : 400;
    return errorResponse(res, error?.message || '删除 ESA DNS 记录失败', status, error);
  }
});

router.post('/certificates/by-record', async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const body = (req.body || {}) as any;
    const credentialId = parseCredentialId(body.credentialId ?? req.query.credentialId);
    const region = normalizeRegion(body.region ?? req.query.region);

    const siteId = String(body.siteId || '').trim();
    const recordNames = Array.isArray(body.recordNames) ? body.recordNames : [];
    const validOnly = body.validOnly === true;
    const detail = body.detail === true;

    if (!siteId) return errorResponse(res, '缺少参数: siteId', 400);
    if (!Array.isArray(recordNames) || recordNames.length === 0) return errorResponse(res, '缺少参数: recordNames(array)', 400);

    const normalized = recordNames
      .map((r: any) => String(r || '').trim())
      .filter(Boolean);
    if (normalized.length === 0) return errorResponse(res, 'recordNames 为空', 400);

    const { auth } = await getAliyunAuth(userId, credentialId);
    const result = await listEsaCertificatesByRecord(auth, { region, siteId, recordNames: normalized, validOnly, detail });

    return successResponse(res, result, '获取 ESA HTTPS 证书状态成功');
  } catch (error: any) {
    const status = typeof error?.httpStatus === 'number' ? error.httpStatus : 400;
    return errorResponse(res, error?.message || '获取 ESA HTTPS 证书状态失败', status, error);
  }
});

router.post('/certificates/apply', async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const body = (req.body || {}) as any;
    const credentialId = parseCredentialId(body.credentialId ?? req.query.credentialId);
    const region = normalizeRegion(body.region ?? req.query.region);

    const siteId = String(body.siteId || body.SiteId || '').trim();
    const domainsInput = body.domains ?? body.Domains ?? body.domain ?? body.Domain;
    const type = String(body.type || body.Type || '').trim() || 'lets_encrypt';

    if (!siteId) return errorResponse(res, '缺少参数: siteId', 400);

    const domainsRaw = Array.isArray(domainsInput)
      ? domainsInput
      : typeof domainsInput === 'string'
        ? domainsInput.split(',')
        : [];
    const domains = domainsRaw.map((d: any) => String(d || '').trim()).filter(Boolean);

    if (domains.length === 0) return errorResponse(res, '缺少参数: domains(array)', 400);
    if (domains.length > 50) return errorResponse(res, 'domains 数量过多（最多 50）', 400);

    const allowedTypes = new Set([
      'lets_encrypt',
      'digicert_single',
      'digicert_wildcard',
    ]);
    if (!allowedTypes.has(type)) {
      return errorResponse(res, `不支持的证书类型: ${type}`, 400);
    }

    const { auth } = await getAliyunAuth(userId, credentialId);
    const result = await applyEsaCertificate(auth, { region, siteId, domains, type });

    return successResponse(res, result, '提交 ESA 免费证书申请成功', 201);
  } catch (error: any) {
    const status = typeof error?.httpStatus === 'number' ? error.httpStatus : 400;
    return errorResponse(res, error?.message || '提交 ESA 免费证书申请失败', status, error);
  }
});

router.get('/certificates/:certificateId', async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const certificateId = String(req.params.certificateId || '').trim();
    const credentialId = parseCredentialId(req.query.credentialId);
    const region = normalizeRegion(req.query.region);
    const siteId = String(req.query.siteId || '').trim();

    if (!certificateId) return errorResponse(res, '缺少参数: certificateId', 400);
    if (!siteId) return errorResponse(res, '缺少参数: siteId', 400);

    const { auth } = await getAliyunAuth(userId, credentialId);
    const result = await getEsaCertificate(auth, { region, siteId, certificateId });

    return successResponse(res, result, '获取 ESA 证书详情成功');
  } catch (error: any) {
    const status = typeof error?.httpStatus === 'number' ? error.httpStatus : 400;
    return errorResponse(res, error?.message || '获取 ESA 证书详情失败', status, error);
  }
});

router.post('/cname-status', async (req: AuthRequest, res) => {
  try {
    const body = (req.body || {}) as any;
    const records: any[] = Array.isArray(body.records) ? body.records : [];

    if (records.length === 0) return errorResponse(res, '缺少参数: records(array)', 400);
    if (records.length > 100) return errorResponse(res, 'records 数量过多（最多 100）', 400);

    const pairs: Array<{ recordName: string; recordCname: string }> = records
      .map((r: any) => ({
        recordName: String(r?.recordName || '').trim(),
        recordCname: String(r?.recordCname || '').trim(),
      }))
      .filter((r: any) => r.recordName && r.recordCname);

    if (pairs.length === 0) return errorResponse(res, 'records 为空或缺少 recordName/recordCname', 400);

    const resolver = new Resolver();
    const results = await mapWithConcurrency(pairs, 6, (r) => checkCnameStatusOne(resolver, r.recordName, r.recordCname));

    return successResponse(res, { results }, '检测 CNAME 状态成功');
  } catch (error: any) {
    return errorResponse(res, error?.message || '检测 CNAME 状态失败', 400, error);
  }
});

export default router;
