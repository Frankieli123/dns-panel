import https from 'https';
import { buildCanonicalizedQuery, buildSignedQuery, type AliyunAuth } from '../providers/aliyun/auth';

export interface EsaSite {
  siteId: string;
  siteName: string;
  status?: string;
  accessType?: string;
  coverage?: string;
  cnameZone?: string;
  nameServerList?: string;
  verifyCode?: string;
  instanceId?: string;
  planName?: string;
  planSpecName?: string;
  resourceGroupId?: string;
  createTime?: string;
  updateTime?: string;
  visitTime?: string;
  offlineReason?: string;
  tags?: Record<string, string>;
}

export interface EsaRatePlanInstance {
  instanceId: string;
  planName?: string;
  planType?: string;
  siteQuota?: number;
  usedSiteCount?: number;
  expireTime?: string;
  duration?: number;
  createTime?: string;
  status?: string;
  coverages?: string;
  billingMode?: string;
}

export interface EsaDnsRecord {
  recordId: string;
  recordName: string;
  type: string;
  ttl?: number;
  proxied?: boolean;
  comment?: string;
  createTime?: string;
  updateTime?: string;
  recordCname?: string;
  sourceType?: string;
  bizName?: string;
  hostPolicy?: string;
  data?: Record<string, unknown>;
  authConf?: Record<string, unknown>;
  siteId?: string;
  siteName?: string;
}

export interface EsaCertificate {
  id: string;
  casId?: string;
  name?: string;
  region?: string;
  status?: string;
  type?: string;
  commonName?: string;
  notBefore?: string;
  notAfter?: string;
  issuer?: string;
  issuerCN?: string;
  san?: string;
  sigAlg?: string;
  pubAlg?: string;
  createTime?: string;
  updateTime?: string;
  serialNumber?: string;
  fingerprintSha256?: string;
  applyCode?: number;
  applyMessage?: string;
  dcv?: Array<{ id?: string; type?: string; key?: string; value?: string; status?: string }>;
}

export interface EsaRecordCertificateStatus {
  recordName: string;
  count?: number;
  applyingCount?: number;
  status?: string;
  certificates?: EsaCertificate[];
}

export interface EsaCertificateApplyResult {
  domain: string;
  status?: string;
  certificateId?: string;
}

interface EsaErrorResponse {
  Code?: string;
  Message?: string;
  RequestId?: string;
}

const ESA_VERSION = '2024-09-10';
const DEFAULT_REGION = 'cn-hangzhou';
const TAG_BATCH_SIZE = 20;

function esaEndpoint(region?: string): string {
  const r = String(region || DEFAULT_REGION).trim();
  return `esa.${r}.aliyuncs.com`;
}

function normalizeEsaErrorMessage(code?: string, message?: string): string {
  const c = String(code || '').trim();
  const m = String(message || '').trim();
  if (!c) return m || 'ESA 请求失败';
  if (!m) return c;
  return `${c}: ${m}`;
}

function normalizeEsaJsonRaw(raw: string): string {
  if (!raw) return raw;
  return raw.replace(/"(SiteId|RecordId|ConfigId|CertificateId|CasId|Id)"\s*:\s*(\d{16,})/g, '"$1":"$2"');
}

async function requestEsa<T>(
  auth: AliyunAuth,
  action: string,
  extraParams: Record<string, string | number | undefined>,
  opts?: { region?: string }
): Promise<T> {
  const endpoint = esaEndpoint(opts?.region);
  const doRequest = async (method: 'GET' | 'POST'): Promise<T> => {
    const params = buildSignedQuery(auth, action, extraParams, { version: ESA_VERSION, method });
    const query = buildCanonicalizedQuery(params);
    const url = method === 'GET' ? `https://${endpoint}/?${query}` : `https://${endpoint}/`;
    const body = method === 'POST' ? query : undefined;

    return await new Promise<T>((resolve, reject) => {
      const req = https.request(
        url,
        {
          method,
          headers: body
            ? {
                'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8',
                'Content-Length': Buffer.byteLength(body),
              }
            : undefined,
        },
        res => {
          const chunks: Buffer[] = [];
          res.on('data', d => chunks.push(Buffer.isBuffer(d) ? d : Buffer.from(d)));
          res.on('end', () => {
            const raw = Buffer.concat(chunks).toString('utf8');
            let json: any;

            try {
              json = raw ? JSON.parse(normalizeEsaJsonRaw(raw)) : {};
            } catch (e) {
              reject(new Error('ESA 返回非 JSON 响应'));
              return;
            }

            const httpStatus = res.statusCode;
            const code = (json?.Code ?? json?.code) as unknown;
            const message = (json?.Message ?? json?.message) as unknown;
            const codeStr = typeof code === 'string' ? code.trim() : code === undefined || code === null ? '' : String(code).trim();
            const messageStr =
              typeof message === 'string' ? message.trim() : message === undefined || message === null ? '' : String(message).trim();

            if (codeStr) {
              const msg = normalizeEsaErrorMessage(codeStr, messageStr);
              const err: any = new Error(msg);
              err.code = codeStr;
              err.httpStatus = httpStatus;
              err.requestId = json?.RequestId ?? json?.requestId;
              err.action = action;
              err.endpoint = endpoint;
              err.httpMethod = method;
              reject(err);
              return;
            }

            if (httpStatus && httpStatus >= 400) {
              const msg = messageStr || `HTTP 错误: ${httpStatus}`;
              const err: any = new Error(msg);
              err.code = 'HTTP_ERROR';
              err.httpStatus = httpStatus;
              err.requestId = json?.RequestId ?? json?.requestId;
              err.action = action;
              err.endpoint = endpoint;
              err.httpMethod = method;
              reject(err);
              return;
            }

            resolve(json as T);
          });
        }
      );

      req.on('error', e => {
        const err: any = new Error((e as any)?.message || '网络错误');
        err.code = 'NETWORK_ERROR';
        err.action = action;
        err.endpoint = endpoint;
        err.httpMethod = method;
        reject(err);
      });

      if (body) req.write(body);
      req.end();
    });
  };

  try {
    return await doRequest('POST');
  } catch (error: any) {
    const code = String(error?.code || '').trim();
    if (code === 'UnsupportedHTTPMethod') {
      return await doRequest('GET');
    }
    throw error;
  }
}

export async function listEsaSites(
  auth: AliyunAuth,
  input?: { region?: string; pageNumber?: number; pageSize?: number; keyword?: string }
): Promise<{ sites: EsaSite[]; total: number; pageNumber: number; pageSize: number; requestId?: string }> {
  const pageNumber = Math.max(1, Math.floor(Number(input?.pageNumber || 1)));
  const pageSize = Math.max(1, Math.min(500, Math.floor(Number(input?.pageSize || 100))));
  const keyword = String(input?.keyword || '').trim();

  const resp: any = await requestEsa<any>(
    auth,
    'ListSites',
    {
      PageNumber: pageNumber,
      PageSize: pageSize,
      SiteName: keyword || undefined,
      SiteSearchType: keyword ? 'fuzzy' : undefined,
    },
    { region: input?.region }
  );

  const sites: EsaSite[] = Array.isArray(resp?.Sites)
    ? resp.Sites.map((s: any) => ({
        siteId: s?.SiteId === undefined || s?.SiteId === null ? '' : String(s.SiteId),
        siteName: String(s?.SiteName || '').trim(),
        status: s?.Status ? String(s.Status) : undefined,
        accessType: s?.AccessType ? String(s.AccessType) : undefined,
        coverage: s?.Coverage ? String(s.Coverage) : undefined,
        cnameZone: s?.CnameZone ? String(s.CnameZone) : undefined,
        nameServerList: s?.NameServerList ? String(s.NameServerList) : undefined,
        verifyCode: s?.VerifyCode ? String(s.VerifyCode) : undefined,
        instanceId: s?.InstanceId ? String(s.InstanceId) : undefined,
        planName: s?.PlanName ? String(s.PlanName) : undefined,
        planSpecName: s?.PlanSpecName ? String(s.PlanSpecName) : undefined,
        resourceGroupId: s?.ResourceGroupId ? String(s.ResourceGroupId) : undefined,
        createTime: s?.CreateTime ? String(s.CreateTime) : undefined,
        updateTime: s?.UpdateTime ? String(s.UpdateTime) : undefined,
        visitTime: s?.VisitTime ? String(s.VisitTime) : undefined,
        offlineReason: s?.OfflineReason ? String(s.OfflineReason) : undefined,
        tags: s?.Tags && typeof s.Tags === 'object' ? s.Tags : undefined,
      }))
    : [];

  const total = typeof resp?.TotalCount === 'number' ? resp.TotalCount : sites.length;
  const pn = typeof resp?.PageNumber === 'number' ? resp.PageNumber : pageNumber;
  const ps = typeof resp?.PageSize === 'number' ? resp.PageSize : pageSize;

  return {
    sites: sites.filter(s => s.siteId && s.siteName),
    total,
    pageNumber: pn,
    pageSize: ps,
    requestId: resp?.RequestId ? String(resp.RequestId) : undefined,
  };
}

export async function listEsaRatePlanInstances(
  auth: AliyunAuth,
  input?: { region?: string; checkRemainingSiteQuota?: boolean; status?: string; pageNumber?: number; pageSize?: number }
): Promise<{ instances: EsaRatePlanInstance[]; total: number; pageNumber: number; pageSize: number; requestId?: string }> {
  const pageNumber = Math.max(1, Math.floor(Number(input?.pageNumber || 1)));
  const pageSize = Math.max(1, Math.min(500, Math.floor(Number(input?.pageSize || 100))));
  const status = typeof input?.status === 'string' ? input.status.trim() : '';
  const checkRemainingSiteQuota = input?.checkRemainingSiteQuota === true;

  const resp: any = await requestEsa<any>(
    auth,
    'ListUserRatePlanInstances',
    {
      PageNumber: pageNumber,
      PageSize: pageSize,
      Status: status || undefined,
      CheckRemainingSiteQuota: checkRemainingSiteQuota ? 'true' : undefined,
    },
    { region: input?.region }
  );

  const instances: EsaRatePlanInstance[] = Array.isArray(resp?.InstanceInfo)
    ? resp.InstanceInfo.map((i: any) => ({
        instanceId: String(i?.InstanceId || '').trim(),
        planName: i?.PlanName ? String(i.PlanName) : undefined,
        planType: i?.PlanType ? String(i.PlanType) : undefined,
        siteQuota: (() => {
          const raw = i?.SiteQuota;
          if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
          if (typeof raw === 'string' && raw.trim()) {
            const n = parseInt(raw.trim(), 10);
            return Number.isFinite(n) ? n : undefined;
          }
          return undefined;
        })(),
        usedSiteCount: Array.isArray(i?.Sites) ? i.Sites.length : undefined,
        expireTime: i?.ExpireTime ? String(i.ExpireTime) : undefined,
        duration: (() => {
          const raw = i?.Duration;
          if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
          if (typeof raw === 'string' && raw.trim()) {
            const n = parseInt(raw.trim(), 10);
            return Number.isFinite(n) ? n : undefined;
          }
          return undefined;
        })(),
        createTime: i?.CreateTime ? String(i.CreateTime) : undefined,
        status: i?.Status ? String(i.Status) : undefined,
        coverages: i?.Coverages ? String(i.Coverages) : undefined,
        billingMode: i?.BillingMode ? String(i.BillingMode) : undefined,
      }))
    : [];

  const total = typeof resp?.TotalCount === 'number' ? resp.TotalCount : instances.length;
  const pn = typeof resp?.PageNumber === 'number' ? resp.PageNumber : pageNumber;
  const ps = typeof resp?.PageSize === 'number' ? resp.PageSize : pageSize;

  return {
    instances: instances.filter(i => i.instanceId),
    total,
    pageNumber: pn,
    pageSize: ps,
    requestId: resp?.RequestId ? String(resp.RequestId) : undefined,
  };
}

export async function createEsaSite(
  auth: AliyunAuth,
  input: { region?: string; siteName: string; coverage: string; accessType: string; instanceId: string }
): Promise<{ siteId: string; verifyCode?: string; nameServerList?: string; requestId?: string }> {
  const resp: any = await requestEsa<any>(
    auth,
    'CreateSite',
    {
      SiteName: input.siteName,
      Coverage: input.coverage,
      AccessType: input.accessType,
      InstanceId: input.instanceId,
    },
    { region: input.region }
  );

  return {
    siteId: resp?.SiteId === undefined || resp?.SiteId === null ? '' : String(resp.SiteId),
    verifyCode: resp?.VerifyCode ? String(resp.VerifyCode) : undefined,
    nameServerList: resp?.NameServerList ? String(resp.NameServerList) : undefined,
    requestId: resp?.RequestId ? String(resp.RequestId) : undefined,
  };
}

export async function verifyEsaSite(
  auth: AliyunAuth,
  input: { region?: string; siteId: string }
): Promise<{ passed: boolean; requestId?: string }> {
  const resp: any = await requestEsa<any>(
    auth,
    'VerifySite',
    { SiteId: input.siteId },
    { region: input.region }
  );

  return {
    passed: !!resp?.Passed,
    requestId: resp?.RequestId ? String(resp.RequestId) : undefined,
  };
}

export async function deleteEsaSite(
  auth: AliyunAuth,
  input: { region?: string; siteId: string }
): Promise<{ deleted: boolean; requestId?: string }> {
  const resp: any = await requestEsa<any>(
    auth,
    'DeleteSite',
    { SiteId: input.siteId },
    { region: input.region }
  );

  return {
    deleted: true,
    requestId: resp?.RequestId ? String(resp.RequestId) : undefined,
  };
}

export async function updateEsaSitePause(
  auth: AliyunAuth,
  input: { region?: string; siteId: string; paused: boolean }
): Promise<{ updated: boolean; requestId?: string }> {
  const regionId = String(input.region || DEFAULT_REGION).trim() || DEFAULT_REGION;
  const pausedValue = input.paused ? 'true' : 'false';
  const tried = new Set<string>();
  let lastError: any;

  const candidates = [
    { SiteId: input.siteId, Paused: pausedValue, RegionId: regionId },
    { SiteId: input.siteId, Paused: pausedValue },
  ];

  for (const params of candidates) {
    const key = JSON.stringify(params);
    if (tried.has(key)) continue;
    tried.add(key);
    try {
      const resp: any = await requestEsa<any>(auth, 'UpdateSitePause', params, { region: input.region });
      return {
        updated: true,
        requestId: resp?.RequestId ? String(resp.RequestId) : undefined,
      };
    } catch (error: any) {
      lastError = error;
      const code = String(error?.code || '').trim();
      if (code !== 'InvalidParameter.ArgValue' && code !== 'InvalidPaused') {
        throw error;
      }
    }
  }

  throw lastError || new Error('更新 ESA 站点状态失败');
}

function chunkArray<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  const n = Math.max(1, Math.floor(size));
  for (let i = 0; i < items.length; i += n) {
    out.push(items.slice(i, i + n));
  }
  return out;
}

function buildNumberedParams(prefix: string, values: string[]): Record<string, string> {
  const params: Record<string, string> = {};
  values.forEach((v, idx) => {
    params[`${prefix}.${idx + 1}`] = v;
  });
  return params;
}

function buildTagParams(tags: Array<{ key: string; value?: string }>): Record<string, string> {
  const params: Record<string, string> = {};
  tags.forEach((t, idx) => {
    const i = idx + 1;
    params[`Tag.${i}.Key`] = t.key;
    if (t.value !== undefined) params[`Tag.${i}.Value`] = t.value;
  });
  return params;
}

function normalizeTagMap(tags: unknown): Record<string, string> {
  const raw = tags && typeof tags === 'object' ? (tags as Record<string, unknown>) : {};
  const out: Record<string, string> = {};
  Object.entries(raw).forEach(([k, v]) => {
    const key = String(k || '').trim();
    if (!key) return;
    const value = v === undefined || v === null ? '' : String(v);
    out[key] = value;
  });
  return out;
}

export async function listEsaSiteTags(
  auth: AliyunAuth,
  input: { regionId?: string; siteId: string }
): Promise<{ tags: Record<string, string>; requestId?: string }> {
  const regionId = String(input.regionId || DEFAULT_REGION).trim() || DEFAULT_REGION;
  const siteId = String(input.siteId || '').trim();
  if (!siteId) return { tags: {} };

  const resp: any = await requestEsa<any>(
    auth,
    'ListTagResources',
    {
      RegionId: regionId,
      ResourceType: 'site',
      ...buildNumberedParams('ResourceId', [siteId]),
    },
    { region: regionId }
  );

  const tags: Record<string, string> = {};
  const list = Array.isArray(resp?.TagResources) ? resp.TagResources : [];
  list.forEach((r: any) => {
    const k = String(r?.TagKey || '').trim();
    if (!k) return;
    tags[k] = r?.TagValue === undefined || r?.TagValue === null ? '' : String(r.TagValue);
  });

  return {
    tags,
    requestId: resp?.RequestId ? String(resp.RequestId) : undefined,
  };
}

export async function updateEsaSiteTags(
  auth: AliyunAuth,
  input: { regionId?: string; siteId: string; tags: Record<string, unknown> }
): Promise<{ updated: boolean; requestId?: string }> {
  const regionId = String(input.regionId || DEFAULT_REGION).trim() || DEFAULT_REGION;
  const siteId = String(input.siteId || '').trim();
  if (!siteId) return { updated: false };

  const nextTags = normalizeTagMap(input.tags);

  const current = await listEsaSiteTags(auth, { regionId, siteId });
  const currentTags = current.tags || {};

  const currentKeys = new Set(Object.keys(currentTags));
  const nextKeys = new Set(Object.keys(nextTags));

  const keysToRemove = Array.from(currentKeys).filter((k) => !nextKeys.has(k));
  const tagsToUpsert = Object.entries(nextTags).map(([key, value]) => ({ key, value }));

  let requestId: string | undefined = current.requestId;

  if (tagsToUpsert.length === 0) {
    const resp: any = await requestEsa<any>(
      auth,
      'UntagResources',
      {
        RegionId: regionId,
        ResourceType: 'site',
        ...buildNumberedParams('ResourceId', [siteId]),
        All: 'true',
      },
      { region: regionId }
    );
    requestId = resp?.RequestId ? String(resp.RequestId) : requestId;
    return { updated: true, requestId };
  }

  if (keysToRemove.length > 0) {
    for (const batch of chunkArray(keysToRemove, TAG_BATCH_SIZE)) {
      const resp: any = await requestEsa<any>(
        auth,
        'UntagResources',
        {
          RegionId: regionId,
          ResourceType: 'site',
          ...buildNumberedParams('ResourceId', [siteId]),
          ...buildNumberedParams('TagKey', batch),
        },
        { region: regionId }
      );
      requestId = resp?.RequestId ? String(resp.RequestId) : requestId;
    }
  }

  for (const batch of chunkArray(tagsToUpsert, TAG_BATCH_SIZE)) {
    const resp: any = await requestEsa<any>(
      auth,
      'TagResources',
      {
        RegionId: regionId,
        ResourceType: 'site',
        ...buildNumberedParams('ResourceId', [siteId]),
        ...buildTagParams(batch),
      },
      { region: regionId }
    );
    requestId = resp?.RequestId ? String(resp.RequestId) : requestId;
  }

  return { updated: true, requestId };
}

export async function listEsaRecords(
  auth: AliyunAuth,
  input: {
    region?: string;
    siteId: string;
    recordName?: string;
    recordMatchType?: string;
    type?: string;
    proxied?: boolean | string;
    pageNumber?: number;
    pageSize?: number;
  }
): Promise<{ records: EsaDnsRecord[]; total: number; pageNumber: number; pageSize: number; requestId?: string }> {
  const pageNumber = Math.max(1, Math.floor(Number(input?.pageNumber || 1)));
  const pageSize = Math.max(1, Math.min(500, Math.floor(Number(input?.pageSize || 50))));
  const recordName = String(input?.recordName || '').trim();
  const recordMatchType = String(input?.recordMatchType || '').trim();
  const type = String(input?.type || '').trim();
  const proxiedRaw = input?.proxied;
  const proxied =
    typeof proxiedRaw === 'boolean'
      ? (proxiedRaw ? 'true' : 'false')
      : typeof proxiedRaw === 'string'
        ? proxiedRaw.trim()
        : undefined;

  const resp: any = await requestEsa<any>(
    auth,
    'ListRecords',
    {
      SiteId: input.siteId,
      RecordName: recordName || undefined,
      RecordMatchType: recordMatchType || undefined,
      Type: type || undefined,
      Proxied: proxied || undefined,
      PageNumber: pageNumber,
      PageSize: pageSize,
    },
    { region: input.region }
  );

  const records: EsaDnsRecord[] = Array.isArray(resp?.Records)
    ? resp.Records.map((r: any) => ({
        recordId: r?.RecordId === undefined || r?.RecordId === null ? '' : String(r.RecordId),
        recordName: String(r?.RecordName || '').trim(),
        type: String(r?.RecordType || r?.Type || '').trim(),
        ttl: typeof r?.Ttl === 'number' ? r.Ttl : undefined,
        proxied: typeof r?.Proxied === 'boolean' ? r.Proxied : String(r?.Proxied || '').trim().toLowerCase() === 'true',
        comment: r?.Comment ? String(r.Comment) : undefined,
        createTime: r?.CreateTime ? String(r.CreateTime) : undefined,
        updateTime: r?.UpdateTime ? String(r.UpdateTime) : undefined,
        recordCname: r?.RecordCname ? String(r.RecordCname) : undefined,
        sourceType: r?.RecordSourceType ? String(r.RecordSourceType) : undefined,
        bizName: r?.BizName ? String(r.BizName) : undefined,
        hostPolicy: r?.HostPolicy ? String(r.HostPolicy) : undefined,
        data: r?.Data && typeof r.Data === 'object' ? r.Data : undefined,
        authConf: r?.AuthConf && typeof r.AuthConf === 'object' ? r.AuthConf : undefined,
        siteId: r?.SiteId === undefined || r?.SiteId === null ? undefined : String(r.SiteId),
        siteName: r?.SiteName ? String(r.SiteName) : undefined,
      }))
    : [];

  const total = typeof resp?.TotalCount === 'number' ? resp.TotalCount : records.length;
  const pn = typeof resp?.PageNumber === 'number' ? resp.PageNumber : pageNumber;
  const ps = typeof resp?.PageSize === 'number' ? resp.PageSize : pageSize;

  return {
    records: records.filter(r => r.recordId && r.recordName),
    total,
    pageNumber: pn,
    pageSize: ps,
    requestId: resp?.RequestId ? String(resp.RequestId) : undefined,
  };
}

export async function getEsaRecord(
  auth: AliyunAuth,
  input: { region?: string; recordId: string }
): Promise<{ record: EsaDnsRecord; requestId?: string }> {
  const resp: any = await requestEsa<any>(
    auth,
    'GetRecord',
    { RecordId: input.recordId },
    { region: input.region }
  );

  const model = resp?.RecordModel && typeof resp.RecordModel === 'object' ? resp.RecordModel : resp;
  const record: EsaDnsRecord = {
    recordId: model?.RecordId === undefined || model?.RecordId === null ? '' : String(model.RecordId),
    recordName: String(model?.RecordName || '').trim(),
    type: String(model?.RecordType || model?.Type || '').trim(),
    ttl: typeof model?.Ttl === 'number' ? model.Ttl : undefined,
    proxied: typeof model?.Proxied === 'boolean' ? model.Proxied : String(model?.Proxied || '').trim().toLowerCase() === 'true',
    comment: model?.Comment ? String(model.Comment) : undefined,
    createTime: model?.CreateTime ? String(model.CreateTime) : undefined,
    updateTime: model?.UpdateTime ? String(model.UpdateTime) : undefined,
    recordCname: model?.RecordCname ? String(model.RecordCname) : undefined,
    sourceType: model?.RecordSourceType ? String(model.RecordSourceType) : undefined,
    bizName: model?.BizName ? String(model.BizName) : undefined,
    hostPolicy: model?.HostPolicy ? String(model.HostPolicy) : undefined,
    data: model?.Data && typeof model.Data === 'object' ? model.Data : undefined,
    authConf: model?.AuthConf && typeof model.AuthConf === 'object' ? model.AuthConf : undefined,
    siteId: model?.SiteId === undefined || model?.SiteId === null ? undefined : String(model.SiteId),
    siteName: model?.SiteName ? String(model.SiteName) : undefined,
  };

  if (!record.recordId || !record.recordName) {
    throw Object.assign(new Error('ESA 返回记录信息不完整'), { httpStatus: 502, meta: { resp } });
  }

  return {
    record,
    requestId: resp?.RequestId ? String(resp.RequestId) : undefined,
  };
}

export async function createEsaRecord(
  auth: AliyunAuth,
  input: {
    region?: string;
    siteId: string;
    recordName: string;
    type: string;
    ttl?: number;
    proxied?: boolean;
    sourceType?: string;
    bizName?: string;
    comment?: string;
    hostPolicy?: string;
    data: Record<string, unknown>;
    authConf?: Record<string, unknown>;
  }
): Promise<{ recordId: string; requestId?: string }> {
  const dataStr = JSON.stringify(input.data || {});
  const authConfStr = input.authConf ? JSON.stringify(input.authConf) : undefined;

  const resp: any = await requestEsa<any>(
    auth,
    'CreateRecord',
    {
      SiteId: input.siteId,
      RecordName: input.recordName,
      Type: input.type,
      Proxied: typeof input.proxied === 'boolean' ? (input.proxied ? 'true' : 'false') : undefined,
      SourceType: input.sourceType,
      BizName: input.bizName,
      Ttl: typeof input.ttl === 'number' ? input.ttl : undefined,
      Comment: input.comment,
      HostPolicy: input.hostPolicy,
      Data: dataStr,
      AuthConf: authConfStr,
    },
    { region: input.region }
  );

  return {
    recordId: resp?.RecordId === undefined || resp?.RecordId === null ? '' : String(resp.RecordId),
    requestId: resp?.RequestId ? String(resp.RequestId) : undefined,
  };
}

export async function updateEsaRecord(
  auth: AliyunAuth,
  input: {
    region?: string;
    recordId: string;
    ttl?: number;
    proxied?: boolean;
    sourceType?: string;
    bizName?: string;
    comment?: string;
    hostPolicy?: string;
    data: Record<string, unknown>;
    authConf?: Record<string, unknown>;
  }
): Promise<{ updated: boolean; requestId?: string }> {
  const dataStr = JSON.stringify(input.data || {});
  const authConfStr = input.authConf ? JSON.stringify(input.authConf) : undefined;

  const resp: any = await requestEsa<any>(
    auth,
    'UpdateRecord',
    {
      RecordId: input.recordId,
      Proxied: typeof input.proxied === 'boolean' ? (input.proxied ? 'true' : 'false') : undefined,
      SourceType: input.sourceType,
      BizName: input.bizName,
      Ttl: typeof input.ttl === 'number' ? input.ttl : undefined,
      Comment: input.comment,
      HostPolicy: input.hostPolicy,
      Data: dataStr,
      AuthConf: authConfStr,
    },
    { region: input.region }
  );

  return {
    updated: true,
    requestId: resp?.RequestId ? String(resp.RequestId) : undefined,
  };
}

export async function deleteEsaRecord(
  auth: AliyunAuth,
  input: { region?: string; recordId: string }
): Promise<{ deleted: boolean; requestId?: string }> {
  const resp: any = await requestEsa<any>(
    auth,
    'DeleteRecord',
    { RecordId: input.recordId },
    { region: input.region }
  );

  return {
    deleted: true,
    requestId: resp?.RequestId ? String(resp.RequestId) : undefined,
  };
}

export async function listEsaCertificates(
  auth: AliyunAuth,
  input: {
    region?: string;
    siteId: string;
    keyword?: string;
    validOnly?: boolean;
    pageNumber?: number;
    pageSize?: number;
  }
): Promise<{ certificates: EsaCertificate[]; total: number; pageNumber: number; pageSize: number; requestId?: string }> {
  const pageNumber = Math.max(1, Math.floor(Number(input?.pageNumber || 1)));
  const pageSize = Math.max(1, Math.min(500, Math.floor(Number(input?.pageSize || 20))));
  const keyword = String(input?.keyword || '').trim();
  const validOnly = input?.validOnly === true;

  const resp: any = await requestEsa<any>(
    auth,
    'ListCertificates',
    {
      SiteId: input.siteId,
      Keyword: keyword || undefined,
      ValidOnly: validOnly ? 'true' : undefined,
      PageNumber: pageNumber,
      PageSize: pageSize,
    },
    { region: input.region }
  );

  const items: EsaCertificate[] = Array.isArray(resp?.Result)
    ? resp.Result.map((c: any) => ({
        id: String(c?.Id || '').trim(),
        casId: c?.CasId === undefined || c?.CasId === null ? undefined : String(c.CasId),
        name: c?.Name ? String(c.Name) : undefined,
        region: c?.Region ? String(c.Region) : undefined,
        status: c?.Status ? String(c.Status) : undefined,
        type: c?.Type ? String(c.Type) : undefined,
        commonName: c?.CommonName ? String(c.CommonName) : undefined,
        notBefore: c?.NotBefore ? String(c.NotBefore) : undefined,
        notAfter: c?.NotAfter ? String(c.NotAfter) : undefined,
        issuer: c?.Issuer ? String(c.Issuer) : undefined,
        issuerCN: c?.IssuerCN ? String(c.IssuerCN) : undefined,
        san: c?.SAN ? String(c.SAN) : undefined,
        sigAlg: c?.SigAlg ? String(c.SigAlg) : undefined,
        pubAlg: c?.PubAlg ? String(c.PubAlg) : undefined,
        createTime: c?.CreateTime ? String(c.CreateTime) : undefined,
        updateTime: c?.UpdateTime ? String(c.UpdateTime) : undefined,
        serialNumber: c?.SerialNumber ? String(c.SerialNumber) : undefined,
        fingerprintSha256: c?.FingerprintSha256 ? String(c.FingerprintSha256) : undefined,
        applyCode: typeof c?.ApplyCode === 'number' ? c.ApplyCode : undefined,
        applyMessage: c?.ApplyMessage ? String(c.ApplyMessage) : undefined,
        dcv: Array.isArray(c?.DCV)
          ? c.DCV.map((d: any) => ({
              id: d?.Id ? String(d.Id) : undefined,
              type: d?.Type ? String(d.Type) : undefined,
              key: d?.Key ? String(d.Key) : undefined,
              value: d?.Value ? String(d.Value) : undefined,
              status: d?.Status ? String(d.Status) : undefined,
            }))
          : undefined,
      }))
    : [];

  const certificates = items.filter((c) => c.id);
  const total = typeof resp?.TotalCount === 'number' ? resp.TotalCount : certificates.length;
  const pn = typeof resp?.PageNumber === 'number' ? resp.PageNumber : pageNumber;
  const ps = typeof resp?.PageSize === 'number' ? resp.PageSize : pageSize;

  return {
    certificates,
    total,
    pageNumber: pn,
    pageSize: ps,
    requestId: resp?.RequestId ? String(resp.RequestId) : undefined,
  };
}

export async function listEsaCertificatesByRecord(
  auth: AliyunAuth,
  input: {
    region?: string;
    siteId: string;
    recordNames: string[];
    validOnly?: boolean;
    detail?: boolean;
  }
): Promise<{ records: EsaRecordCertificateStatus[]; total: number; siteId: string; siteName?: string; requestId?: string }> {
  const recordNames = Array.from(
    new Set(
      (input.recordNames || [])
        .map((r) => String(r || '').trim())
        .filter(Boolean)
    )
  );
  const validOnly = input.validOnly === true;
  const detail = input.detail === true;

  const resp: any = await requestEsa<any>(
    auth,
    'ListCertificatesByRecord',
    {
      SiteId: input.siteId,
      RecordName: recordNames.join(','),
      ValidOnly: validOnly ? 'true' : undefined,
      Detail: detail ? 'true' : undefined,
    },
    { region: input.region }
  );

  const records: EsaRecordCertificateStatus[] = Array.isArray(resp?.Result)
    ? resp.Result.map((r: any) => ({
        recordName: String(r?.RecordName || '').trim(),
        count: typeof r?.Count === 'number' ? r.Count : (typeof r?.Count === 'string' ? parseInt(r.Count, 10) : undefined),
        applyingCount:
          typeof r?.ApplylingCount === 'number'
            ? r.ApplylingCount
            : (typeof r?.ApplyingCount === 'number'
                ? r.ApplyingCount
                : (typeof r?.ApplylingCount === 'string'
                    ? parseInt(r.ApplylingCount, 10)
                    : (typeof r?.ApplyingCount === 'string' ? parseInt(r.ApplyingCount, 10) : undefined))),
        status: r?.Status ? String(r.Status) : undefined,
        certificates: Array.isArray(r?.Certificates)
          ? r.Certificates.map((c: any) => ({
              id: String(c?.Id || '').trim(),
              casId: c?.CasId === undefined || c?.CasId === null ? undefined : String(c.CasId),
              name: c?.Name ? String(c.Name) : undefined,
              region: c?.Region ? String(c.Region) : undefined,
              status: c?.Status ? String(c.Status) : undefined,
              type: c?.Type ? String(c.Type) : undefined,
              commonName: c?.CommonName ? String(c.CommonName) : undefined,
              notBefore: c?.NotBefore ? String(c.NotBefore) : undefined,
              notAfter: c?.NotAfter ? String(c.NotAfter) : undefined,
              issuer: c?.Issuer ? String(c.Issuer) : undefined,
              issuerCN: c?.IssuerCN ? String(c.IssuerCN) : undefined,
              san: c?.SAN ? String(c.SAN) : undefined,
              sigAlg: c?.SigAlg ? String(c.SigAlg) : undefined,
              pubAlg: c?.PubAlg ? String(c.PubAlg) : undefined,
              createTime: c?.CreateTime ? String(c.CreateTime) : undefined,
              updateTime: c?.UpdateTime ? String(c.UpdateTime) : undefined,
              serialNumber: c?.SerialNumber ? String(c.SerialNumber) : undefined,
              fingerprintSha256: c?.FingerprintSha256 ? String(c.FingerprintSha256) : undefined,
            }))
          : undefined,
      }))
    : [];

  const total = typeof resp?.TotalCount === 'number' ? resp.TotalCount : records.length;
  const siteId = resp?.SiteId === undefined || resp?.SiteId === null ? String(input.siteId) : String(resp.SiteId);
  const siteName = resp?.SiteName ? String(resp.SiteName).trim() : undefined;

  return {
    records: records.filter((r) => r.recordName),
    total,
    siteId,
    siteName,
    requestId: resp?.RequestId ? String(resp.RequestId) : undefined,
  };
}

export async function applyEsaCertificate(
  auth: AliyunAuth,
  input: { region?: string; siteId: string; domains: string[]; type?: string }
): Promise<{ results: EsaCertificateApplyResult[]; requestId?: string }> {
  const domains = Array.from(
    new Set((input.domains || []).map((d) => String(d || '').trim()).filter(Boolean))
  );
  if (domains.length === 0) {
    return { results: [] };
  }

  const type = String(input.type || 'lets_encrypt').trim() || 'lets_encrypt';

  const resp: any = await requestEsa<any>(
    auth,
    'ApplyCertificate',
    {
      SiteId: input.siteId,
      Domains: domains.join(','),
      Type: type,
    },
    { region: input.region }
  );

  const results: EsaCertificateApplyResult[] = Array.isArray(resp?.Result)
    ? resp.Result.map((r: any) => ({
        domain: String(r?.Domain || '').trim(),
        status: r?.Status ? String(r.Status) : undefined,
        certificateId: r?.Id === undefined || r?.Id === null ? undefined : String(r.Id),
      }))
    : [];

  return {
    results: results.filter((r) => r.domain),
    requestId: resp?.RequestId ? String(resp.RequestId) : undefined,
  };
}

export async function getEsaCertificate(
  auth: AliyunAuth,
  input: { region?: string; siteId: string; certificateId: string }
): Promise<{ certificate: EsaCertificate; requestId?: string }> {
  const resp: any = await requestEsa<any>(
    auth,
    'GetCertificate',
    { SiteId: input.siteId, Id: input.certificateId },
    { region: input.region }
  );

  const c = resp?.Result || {};
  const certificate: EsaCertificate = {
    id: String(c?.Id || input.certificateId || '').trim(),
    casId: c?.CasId === undefined || c?.CasId === null ? undefined : String(c.CasId),
    name: c?.Name ? String(c.Name) : undefined,
    region: c?.Region ? String(c.Region) : undefined,
    status: c?.Status ? String(c.Status) : undefined,
    type: c?.Type ? String(c.Type) : undefined,
    commonName: c?.CommonName ? String(c.CommonName) : undefined,
    notBefore: c?.NotBefore ? String(c.NotBefore) : undefined,
    notAfter: c?.NotAfter ? String(c.NotAfter) : undefined,
    issuer: c?.Issuer ? String(c.Issuer) : undefined,
    issuerCN: c?.IssuerCN ? String(c.IssuerCN) : undefined,
    san: c?.SAN ? String(c.SAN) : undefined,
    sigAlg: c?.SigAlg ? String(c.SigAlg) : undefined,
    pubAlg: c?.PubAlg ? String(c.PubAlg) : undefined,
    createTime: c?.CreateTime ? String(c.CreateTime) : undefined,
    updateTime: c?.UpdateTime ? String(c.UpdateTime) : undefined,
    serialNumber: c?.SerialNumber ? String(c.SerialNumber) : undefined,
    fingerprintSha256: c?.FingerprintSha256 ? String(c.FingerprintSha256) : undefined,
    applyCode: typeof c?.ApplyCode === 'number' ? c.ApplyCode : undefined,
    applyMessage: c?.ApplyMessage ? String(c.ApplyMessage) : undefined,
    dcv: Array.isArray(c?.DCV)
      ? c.DCV.map((d: any) => ({
          id: d?.Id ? String(d.Id) : undefined,
          type: d?.Type ? String(d.Type) : undefined,
          key: d?.Key ? String(d.Key) : undefined,
          value: d?.Value ? String(d.Value) : undefined,
          status: d?.Status ? String(d.Status) : undefined,
        }))
      : undefined,
  };

  return {
    certificate,
    requestId: resp?.RequestId ? String(resp.RequestId) : undefined,
  };
}
