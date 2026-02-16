/**
 * DNSPod (腾讯云) DNS Provider
 * - Endpoint: dnspod.tencentcloudapi.com
 * - Service: dnspod
 * - Version: 2021-03-23
 * - Auth: TC3-HMAC-SHA256
 */

import https from 'https';
import { BaseProvider, DnsProviderError } from '../base/BaseProvider';
import {
  CreateRecordParams,
  DnsLine,
  DnsRecord,
  LineListResult,
  ProviderCapabilities,
  ProviderCredentials,
  ProviderType,
  RecordListResult,
  RecordQueryParams,
  UpdateRecordParams,
  Zone,
  ZoneListResult,
} from '../base/types';
import { buildTc3Headers, Tc3Credentials } from './auth';
import { defaultLines, fromDnspodLine, toDnspodLine } from './lines';
import { DnspodTokenProvider, DNSPOD_TOKEN_CAPABILITIES } from '../dnspod_token';

function toDnspodRecordType(type: string): string {
  const t = String(type || '').trim();
  if (t === 'REDIRECT_URL') return '显性URL';
  if (t === 'FORWARD_URL') return '隐性URL';
  return t;
}

function parseDnspodSrvValue(raw: string): { priority?: number; weight?: number; port?: number; target?: string } {
  const tokens = String(raw || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  const toNum = (v: string | undefined): number | undefined => {
    if (v === undefined) return undefined;
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  };

  const n0 = toNum(tokens[0]);
  const n1 = toNum(tokens[1]);
  const n2 = toNum(tokens[2]);

  if (tokens.length >= 4 && n0 !== undefined && n1 !== undefined && n2 !== undefined) {
    return { priority: n0, weight: n1, port: n2, target: tokens.slice(3).join(' ') };
  }

  if (tokens.length >= 3 && n0 !== undefined && n1 !== undefined) {
    const target = tokens.slice(2).join(' ');
    if (toNum(target) !== undefined) return {};
    return { weight: n0, port: n1, target };
  }

  if (tokens.length >= 2 && n0 !== undefined) {
    const target = tokens.slice(1).join(' ');
    if (toNum(target) !== undefined) return {};
    return { port: n0, target };
  }

  return {};
}

function fromDnspodRecordType(type?: string): string | undefined {
  const t = String(type || '').trim();
  if (!t) return undefined;
  if (t === '显性URL') return 'REDIRECT_URL';
  if (t === '隐性URL') return 'FORWARD_URL';
  return t;
}

function fromDnspodLineId(lineId?: string): string | undefined {
  const id = String(lineId || '').trim();
  if (!id) return undefined;

  const convert: Record<string, string> = {
    '0': 'default',
    '10=0': 'telecom',
    '10=1': 'unicom',
    '10=3': 'mobile',
    '10=2': 'edu',
    '3=0': 'oversea',
    '10=22': 'btvn',
    '80=0': 'search',
    '7=0': 'internal',
  };

  return convert[id] || id;
}

function toDnspodLineId(line?: string): string | undefined {
  const input = String(line || '').trim();
  if (!input) return undefined;

  const l = fromDnspodLine(input) || input;

  const convert: Record<string, string> = {
    default: '0',
    telecom: '10=0',
    unicom: '10=1',
    mobile: '10=3',
    edu: '10=2',
    oversea: '3=0',
    btvn: '10=22',
    search: '80=0',
    internal: '7=0',
  };

  return convert[l] || l;
}

// ========== API 响应类型 ==========

type TcResponse<T> = {
  Response: T & {
    RequestId?: string;
    Error?: { Code: string; Message: string };
  };
};

type DescribeDomainListResponse = TcResponse<{
  DomainList?: Array<{
    DomainId: number;
    Name: string;
    Status?: string;
    RecordCount?: number;
    UpdatedOn?: string;
  }>;
  DomainCountInfo?: { AllTotal?: number };
}>;

type DescribeRecordListResponse = TcResponse<{
  RecordList?: Array<{
    RecordId: number;
    Name: string;
    Type: string;
    Value: string;
    TTL: number;
    MX?: number;
    Weight?: number;
    Status?: 'ENABLE' | 'DISABLE';
    Line?: string;
    LineId?: string;
    Remark?: string;
    UpdatedOn?: string;
  }>;
  RecordCountInfo?: { TotalCount?: number };
}>;

type DescribeRecordResponse = TcResponse<{
  RecordInfo?: {
    RecordId?: number;
    Name?: string;
    Type?: string;
    Line?: string;
    LineId?: string;
    Status?: 'ENABLE' | 'DISABLE';
    Id?: number;
    SubDomain?: string;
    RecordType?: string;
    RecordLine?: string;
    RecordLineId?: string;
    Enabled?: number;
    Value?: string;
    TTL?: number;
    MX?: number;
    Weight?: number;
    Remark?: string;
    UpdatedOn?: string;
  };
}>;

type CreateRecordResponse = TcResponse<{ RecordId?: number }>;
type CommonOkResponse = TcResponse<Record<string, unknown>>;

type DescribeRecordLineCategoryListResponse = TcResponse<{
  LineList?: Array<{
    LineId: string;
    LineName: string;
    Useful?: boolean;
    SubGroup?: Array<{ LineId: string; LineName: string; Useful?: boolean }>;
  }>;
}>;

type DescribeDomainPurviewResponse = TcResponse<{
  PurviewList?: Array<{
    Name?: string;
    Value?: string;
  }>;
}>;

// ========== 能力配置 ==========

export const DNSPOD_CAPABILITIES: ProviderCapabilities = {
  provider: ProviderType.DNSPOD,
  name: '腾讯云',

  supportsWeight: true,
  supportsLine: true,
  supportsStatus: true,
  supportsRemark: true,
  supportsUrlForward: true,
  supportsLogs: true,

  remarkMode: 'separate',
  paging: 'server',
  requiresDomainId: true,

  recordTypes: ['A', 'AAAA', 'CNAME', 'MX', 'TXT', 'SRV', 'CAA', 'NS', 'PTR', 'REDIRECT_URL', 'FORWARD_URL'],

  authFields: [
    { name: 'secretId', label: 'SecretId', type: 'text', required: false, placeholder: '输入 SecretId（方式一）' },
    { name: 'secretKey', label: 'SecretKey', type: 'password', required: false, placeholder: '输入 SecretKey（方式一）' },
    { name: 'tokenId', label: 'ID', type: 'text', required: false, placeholder: '输入 ID（方式二）' },
    { name: 'token', label: 'Token', type: 'password', required: false, placeholder: '输入 Token（方式二）', helpText: '两种方式二选一：SecretId/SecretKey 或 DNSPod Token（ID + Token）' },
  ],

  domainCacheTtl: 300,
  recordCacheTtl: 120,

  retryableErrors: ['RequestLimitExceeded', 'InternalError', 'ResourceUnavailable', 'ServerBusy'],
  maxRetries: 3,
};

// ========== Provider 实现 ==========

export class DnspodProvider extends BaseProvider {
  private readonly host = 'dnspod.tencentcloudapi.com';
  private readonly service = 'dnspod';
  private readonly version = '2021-03-23';
  private readonly creds?: Tc3Credentials;
  private readonly legacyProvider?: DnspodTokenProvider;
  private readonly lineNameMapByZone = new Map<string, Map<string, string>>();

  constructor(credentials: ProviderCredentials) {
    const { secretId, secretKey, tokenId, token } = credentials.secrets || {};
    const hasLegacyPair = Boolean(tokenId && token);
    const hasLegacyCombined = Boolean(!hasLegacyPair && token && String(token).includes(','));
    const useLegacy = hasLegacyPair || hasLegacyCombined;
    const hasTc3 = Boolean(secretId && secretKey);

    super(credentials, useLegacy ? { ...DNSPOD_CAPABILITIES, recordTypes: [...DNSPOD_TOKEN_CAPABILITIES.recordTypes] } : DNSPOD_CAPABILITIES);

    if (useLegacy) {
      this.legacyProvider = new DnspodTokenProvider({
        provider: ProviderType.DNSPOD_TOKEN,
        secrets: hasLegacyPair
          ? { tokenId: String(tokenId || '').trim(), token: String(token || '').trim() }
          : { login_token: String(token || '').trim() },
        accountId: credentials.accountId,
      });
      return;
    }

    if (!hasTc3) {
      throw this.createError('MISSING_CREDENTIALS', '缺少 DNSPod SecretId/SecretKey 或 DNSPod Token（Token ID + Token）');
    }

    this.creds = { secretId: String(secretId).trim(), secretKey: String(secretKey).trim() };
  }

  private wrapError(err: unknown, code = 'DNSPOD_ERROR'): DnsProviderError {
    if (err instanceof DnsProviderError) return err;
    const message = (err as any)?.message ? String((err as any).message) : String(err);
    return this.createError(code, message, { cause: err });
  }

  private async request<T>(action: string, payload: Record<string, unknown>): Promise<T> {
    if (!this.creds) {
      throw this.createError('MISSING_CREDENTIALS', '缺少 DNSPod SecretId/SecretKey');
    }

    const body = JSON.stringify(payload || {});
    const timestamp = Math.floor(Date.now() / 1000);

    const headers = buildTc3Headers(this.creds, {
      host: this.host,
      service: this.service,
      action,
      version: this.version,
      timestamp,
      payload: body,
    });
    headers['Content-Length'] = String(Buffer.byteLength(body));

    return await this.withRetry<T>(() =>
      new Promise<T>((resolve, reject) => {
        const req = https.request(
          { hostname: this.host, method: 'POST', path: '/', headers },
          res => {
            const chunks: Buffer[] = [];
            res.on('data', d => chunks.push(Buffer.isBuffer(d) ? d : Buffer.from(d)));
            res.on('end', () => {
              const raw = Buffer.concat(chunks).toString('utf8');
              let json: any;

              try {
                json = raw ? JSON.parse(raw) : {};
              } catch (e) {
                reject(this.createError('INVALID_RESPONSE', 'DNSPod 返回非 JSON 响应', { meta: { raw }, cause: e }));
                return;
              }

              const httpStatus = res.statusCode;
              const errObj = json?.Response?.Error;
              if (errObj?.Code) {
                reject(this.createError(String(errObj.Code), String(errObj.Message || 'DNSPod API Error'), {
                  httpStatus,
                  meta: { requestId: json?.Response?.RequestId, action },
                }));
                return;
              }

              if (httpStatus && httpStatus >= 400) {
                reject(
                  this.createError('HTTP_ERROR', `HTTP 错误: ${httpStatus}`, {
                    httpStatus,
                    meta: { body: json, action },
                  })
                );
                return;
              }

              resolve(json as T);
            });
          }
        );

        req.on('error', e => {
          reject(this.createError('NETWORK_ERROR', (e as any)?.message || '网络错误', { cause: e }));
        });
        req.write(body);
        req.end();
      })
    );
  }

  private toFqdn(rr: string, domain: string): string {
    if (!rr || rr === '@') return domain;
    if (rr.endsWith(`.${domain}`)) return rr;
    return `${rr}.${domain}`;
  }

  private toRR(name: string, domain: string): string {
    const n = (name || '').trim();
    if (!n || n === '@' || n === domain) return '@';
    if (n.endsWith(`.${domain}`)) {
      return n.slice(0, -(`.${domain}`.length)) || '@';
    }
    return n;
  }

  private fromStatus(status?: 'ENABLE' | 'DISABLE'): '0' | '1' | undefined {
    if (!status) return undefined;
    return status === 'ENABLE' ? '1' : '0';
  }

  private toStatus(enabled: boolean): 'ENABLE' | 'DISABLE' {
    return enabled ? 'ENABLE' : 'DISABLE';
  }

  private fromEnabled(enabled?: number): '0' | '1' | undefined {
    if (typeof enabled !== 'number') return undefined;
    return enabled === 1 ? '1' : '0';
  }

  private async buildLineData(zone: Zone): Promise<{ lines: DnsLine[]; lineNameMap: Map<string, string> }> {
    const resp = await this.request<DescribeRecordLineCategoryListResponse>('DescribeRecordLineCategoryList', {
      Domain: zone.name,
      DomainId: Number(zone.id),
    });

    const defaults = defaultLines();
    const byCode = new Map<string, DnsLine>();
    const lineNameMap = new Map<string, string>();

    const baseGroup = '基础';
    const addLine = (dnspodLineId?: string, dnspodLineName?: string, parentCode?: string) => {
      const id = String(dnspodLineId || '').trim();
      const n = String(dnspodLineName || '').trim();
      if (!id && !n) return;

      const code = fromDnspodLineId(id) || fromDnspodLine(n) || id || n;
      if (!code) return;

      const base = defaults.find(d => d.code === code);
      const displayName = base?.name || n || code;

      if (!byCode.has(code)) {
        byCode.set(code, {
          code,
          name: displayName,
          parentCode,
        });
      }

      const apiLineName = n || toDnspodLine(code) || displayName;
      if (apiLineName && !lineNameMap.has(code)) {
        lineNameMap.set(code, apiLineName);
      }
    };

    for (const item of resp.Response?.LineList || []) {
      const topName = item?.LineName ? String(item.LineName) : '';
      const topId = item?.LineId ? String(item.LineId) : '';
      if (!topName && !topId) continue;

      if (item?.Useful !== false) {
        addLine(topId, topName, baseGroup);
      }

      for (const sub of item?.SubGroup || []) {
        const subName = sub?.LineName ? String(sub.LineName) : '';
        const subId = sub?.LineId ? String(sub.LineId) : '';
        if (!subName && !subId) continue;
        if ((sub as any)?.Useful === false) continue;
        addLine(subId, subName, topName);
      }
    }

    for (const row of defaults) {
      if (!lineNameMap.has(row.code)) {
        const v = toDnspodLine(row.code) || row.name || row.code;
        lineNameMap.set(row.code, v);
      }
    }

    const lines = Array.from(byCode.values());
    return { lines: lines.length > 0 ? lines : defaults, lineNameMap };
  }

  private async resolveRecordLine(zone: Zone, line?: string): Promise<{ recordLine: string; recordLineId: string }> {
    const input = String(line || '').trim();
    if (!input) return { recordLine: '默认', recordLineId: '0' };

    const code = fromDnspodLineId(input) || fromDnspodLine(input) || input;

    let map = this.lineNameMapByZone.get(zone.id);
    if (!map) {
      const built = await this.buildLineData(zone);
      this.lineNameMapByZone.set(zone.id, built.lineNameMap);
      map = built.lineNameMap;
    }

    const recordLineId = toDnspodLineId(code) || '0';
    const recordLine = map.get(code) || toDnspodLine(code) || '默认';
    return { recordLine, recordLineId };
  }

  // ========== IDnsProvider 实现 ==========

  async checkAuth(): Promise<boolean> {
    try {
      if (this.legacyProvider) return await this.legacyProvider.checkAuth();
      await this.request<DescribeDomainListResponse>('DescribeDomainList', { Offset: 0, Limit: 1 });
      return true;
    } catch {
      return false;
    }
  }

  async getZones(page?: number, pageSize?: number, keyword?: string): Promise<ZoneListResult> {
    try {
      if (this.legacyProvider) return await this.legacyProvider.getZones(page, pageSize, keyword);
      const p = Math.max(1, page || 1);
      const ps = Math.max(1, pageSize || 20);
      const offset = (p - 1) * ps;

      const resp = await this.request<DescribeDomainListResponse>('DescribeDomainList', {
        Offset: offset,
        Limit: ps,
        Keyword: keyword,
      });

      const zones: Zone[] = (resp.Response?.DomainList || []).map(d =>
        this.normalizeZone({
          id: String(d.DomainId),
          name: d.Name,
          status: d.Status || 'unknown',
          recordCount: d.RecordCount,
          updatedAt: d.UpdatedOn,
          meta: { raw: d },
        })
      );

      return { total: resp.Response?.DomainCountInfo?.AllTotal || zones.length, zones };
    } catch (err) {
      throw this.wrapError(err);
    }
  }

  async getZone(zoneId: string): Promise<Zone> {
    try {
      if (this.legacyProvider) return await this.legacyProvider.getZone(zoneId);
      const idNum = Number(zoneId);
      if (!Number.isFinite(idNum)) {
        throw this.createError('INVALID_ZONE_ID', `DomainId 必须为数字: ${zoneId}`, { httpStatus: 400 });
      }

      // DNSPod 没有单独的 DescribeDomain API，需要遍历查找
      for (let page = 1; page <= 50; page++) {
        const resp = await this.getZones(page, 100);
        const found = resp.zones.find(z => Number(z.id) === idNum);
        if (found) return found;
        if (page * 100 >= resp.total) break;
      }

      throw this.createError('ZONE_NOT_FOUND', `域名不存在: ${zoneId}`, { httpStatus: 404 });
    } catch (err) {
      throw this.wrapError(err);
    }
  }

  async getRecords(zoneId: string, params?: RecordQueryParams): Promise<RecordListResult> {
    try {
      if (this.legacyProvider) return await this.legacyProvider.getRecords(zoneId, params);
      const zone = await this.getZone(zoneId);
      const domainId = Number(zone.id);

      const p = Math.max(1, params?.page || 1);
      const ps = Math.max(1, params?.pageSize || 20);
      const offset = (p - 1) * ps;

      const needFilterList = Boolean(params?.value || params?.status);
      const action = needFilterList ? 'DescribeRecordFilterList' : 'DescribeRecordList';

      const payload: Record<string, unknown> = {
        Domain: zone.name,
        DomainId: domainId,
        Offset: offset,
        Limit: ps,
      };

      const resolvedLine = params?.line ? await this.resolveRecordLine(zone, params.line) : undefined;

      if (needFilterList) {
        if (params?.keyword) payload.Keyword = params.keyword;
        if (params?.subDomain) payload.SubDomain = this.toRR(params.subDomain, zone.name);
        if (params?.type) payload.RecordType = [toDnspodRecordType(params.type)];
        if (params?.value) payload.RecordValue = params.value;
        if (resolvedLine) payload.RecordLine = [resolvedLine.recordLine];
        if (params?.status) payload.RecordStatus = [params.status === '1' ? 'ENABLE' : 'DISABLE'];
      } else {
        if (params?.keyword) payload.Keyword = params.keyword;
        if (params?.subDomain) payload.Subdomain = this.toRR(params.subDomain, zone.name);
        if (params?.type) payload.RecordType = toDnspodRecordType(params.type);
        if (resolvedLine) {
          payload.RecordLine = resolvedLine.recordLine;
          payload.RecordLineId = resolvedLine.recordLineId;
        }
      }

      const resp = await this.request<DescribeRecordListResponse>(action, payload);

      const records: DnsRecord[] = (resp.Response?.RecordList || []).map(r =>
        (() => {
          const type = fromDnspodRecordType(r.Type);
          const srv = type === 'SRV' ? parseDnspodSrvValue(r.Value) : undefined;

          return this.normalizeRecord({
          id: String(r.RecordId),
          zoneId: zone.id,
          zoneName: zone.name,
          name: this.toFqdn(r.Name, zone.name),
          type,
          value: r.Value,
          ttl: r.TTL,
          line: fromDnspodLineId(r.LineId) || fromDnspodLine(r.Line),
          weight: typeof srv?.weight === 'number' ? srv.weight : r.Weight,
          priority: typeof srv?.priority === 'number' ? srv.priority : type === 'MX' ? r.MX : undefined,
          status: this.fromStatus(r.Status),
          remark: r.Remark,
          updatedAt: r.UpdatedOn,
          meta: { raw: r },
          });
        })()
      );

      return { total: resp.Response?.RecordCountInfo?.TotalCount || records.length, records };
    } catch (err) {
      throw this.wrapError(err);
    }
  }

  async getRecord(zoneId: string, recordId: string): Promise<DnsRecord> {
    try {
      if (this.legacyProvider) return await this.legacyProvider.getRecord(zoneId, recordId);
      const zone = await this.getZone(zoneId);
      const rid = Number(recordId);
      if (!Number.isFinite(rid)) {
        throw this.createError('INVALID_RECORD_ID', `RecordId 必须为数字: ${recordId}`, { httpStatus: 400 });
      }

      const resp = await this.request<DescribeRecordResponse>('DescribeRecord', {
        Domain: zone.name,
        DomainId: Number(zone.id),
        RecordId: rid,
      });

      const info = resp.Response?.RecordInfo;
      if (!info) throw this.createError('NOT_FOUND', `记录不存在: ${recordId}`, { httpStatus: 404 });

      const actualId = (info as any).RecordId ?? (info as any).Id;
      if (actualId === undefined || actualId === null) {
        throw this.createError('INVALID_RESPONSE', 'DNSPod 返回的 RecordInfo 缺少 Id/RecordId', {
          httpStatus: 502,
          meta: { recordId, recordInfo: info },
        });
      }

      const rr = (info as any).Name ?? (info as any).SubDomain;
      const rrStr = String(rr || '').trim() || '@';
      const recordType = (info as any).Type ?? (info as any).RecordType;
      const recordTypeStr = String(recordType || '').trim();

      const recordLineIdRaw = (info as any).RecordLineId ?? (info as any).LineId;
      const recordLineRaw = (info as any).RecordLine ?? (info as any).Line;
      const line =
        fromDnspodLineId(String(recordLineIdRaw || '').trim()) ||
        fromDnspodLine(String(recordLineRaw || '').trim());

      const normalizedType = fromDnspodRecordType(recordTypeStr);
      const srv = normalizedType === 'SRV' ? parseDnspodSrvValue(String((info as any).Value || '')) : undefined;

      return this.normalizeRecord({
        id: String(actualId),
        zoneId: zone.id,
        zoneName: zone.name,
        name: this.toFqdn(rrStr, zone.name),
        type: normalizedType,
        value: (info as any).Value,
        ttl: (info as any).TTL,
        line,
        weight: typeof srv?.weight === 'number' ? srv.weight : (info as any).Weight,
        priority: typeof srv?.priority === 'number' ? srv.priority : normalizedType === 'MX' ? (info as any).MX : undefined,
        status: this.fromStatus((info as any).Status) || this.fromEnabled((info as any).Enabled),
        remark: (info as any).Remark,
        updatedAt: (info as any).UpdatedOn,
        meta: { raw: info },
      });
    } catch (err) {
      throw this.wrapError(err);
    }
  }

  async createRecord(zoneId: string, params: CreateRecordParams): Promise<DnsRecord> {
    try {
      if (this.legacyProvider) return await this.legacyProvider.createRecord(zoneId, params);
      const zone = await this.getZone(zoneId);
      const domainId = Number(zone.id);

      const rawTtl = typeof params.ttl === 'number' ? params.ttl : undefined;
      const ttl = rawTtl && rawTtl > 1 ? rawTtl : 600;

      const resolvedLine = await this.resolveRecordLine(zone, params.line);

      const recordType = toDnspodRecordType(params.type);
      let value = params.value;
      let srvWeight: number | undefined;
      let srvPriority: number | undefined;

      if (recordType === 'SRV') {
        const parsed = parseDnspodSrvValue(params.value);
        const port = parsed.port;
        const target = parsed.target;

        if (typeof port !== 'number' || !Number.isFinite(port) || !target) {
          throw this.createError(
            'INVALID_SRV_VALUE',
            'SRV 记录值格式应为: 端口 主机名 或 优先级 权重 端口 主机名',
            { httpStatus: 400, meta: { value: params.value } }
          );
        }

        srvPriority = typeof params.priority === 'number' ? params.priority : parsed.priority;
        srvWeight = typeof params.weight === 'number' ? params.weight : parsed.weight;

        const finalPriority = typeof srvPriority === 'number' && Number.isFinite(srvPriority) ? srvPriority : 0;
        const finalWeight = typeof srvWeight === 'number' && Number.isFinite(srvWeight) ? srvWeight : 0;
        value = `${finalPriority} ${finalWeight} ${port} ${target}`;
      }

      const payload: Record<string, unknown> = {
        Domain: zone.name,
        DomainId: domainId,
        SubDomain: this.toRR(params.name, zone.name),
        RecordType: recordType,
        RecordLine: resolvedLine.recordLine,
        RecordLineId: resolvedLine.recordLineId,
        Value: value,
        TTL: ttl,
      };

      if (recordType === 'MX' && typeof params.priority === 'number') payload.MX = params.priority;
      if (recordType !== 'SRV' && typeof params.weight === 'number') payload.Weight = params.weight;

      const resp = await this.request<CreateRecordResponse>('CreateRecord', payload);
      const newId = resp.Response?.RecordId;
      if (!newId && newId !== 0) {
        throw this.createError('CREATE_FAILED', '创建记录失败');
      }

      if (params.remark !== undefined) {
        await this.request<CommonOkResponse>('ModifyRecordRemark', {
          DomainId: domainId,
          RecordId: newId,
          Remark: params.remark || '',
        });
      }

      return await this.getRecord(zoneId, String(newId));
    } catch (err) {
      throw this.wrapError(err);
    }
  }

  async updateRecord(zoneId: string, recordId: string, params: UpdateRecordParams): Promise<DnsRecord> {
    try {
      if (this.legacyProvider) return await this.legacyProvider.updateRecord(zoneId, recordId, params);
      const zone = await this.getZone(zoneId);
      const domainId = Number(zone.id);
      const rid = Number(recordId);
      if (!Number.isFinite(rid)) {
        throw this.createError('INVALID_RECORD_ID', `RecordId 必须为数字: ${recordId}`, { httpStatus: 400 });
      }

      const rawTtl = typeof params.ttl === 'number' ? params.ttl : undefined;
      const ttl = rawTtl && rawTtl > 1 ? rawTtl : 600;

      const resolvedLine = await this.resolveRecordLine(zone, params.line);

      const recordType = toDnspodRecordType(params.type);
      let value = params.value;
      let srvWeight: number | undefined;
      let srvPriority: number | undefined;

      if (recordType === 'SRV') {
        const parsed = parseDnspodSrvValue(params.value);
        const port = parsed.port;
        const target = parsed.target;

        if (typeof port !== 'number' || !Number.isFinite(port) || !target) {
          throw this.createError(
            'INVALID_SRV_VALUE',
            'SRV 记录值格式应为: 端口 主机名 或 优先级 权重 端口 主机名',
            { httpStatus: 400, meta: { value: params.value } }
          );
        }

        srvPriority = typeof params.priority === 'number' ? params.priority : parsed.priority;
        srvWeight = typeof params.weight === 'number' ? params.weight : parsed.weight;

        const finalPriority = typeof srvPriority === 'number' && Number.isFinite(srvPriority) ? srvPriority : 0;
        const finalWeight = typeof srvWeight === 'number' && Number.isFinite(srvWeight) ? srvWeight : 0;
        value = `${finalPriority} ${finalWeight} ${port} ${target}`;
      }

      const payload: Record<string, unknown> = {
        Domain: zone.name,
        DomainId: domainId,
        RecordId: rid,
        SubDomain: this.toRR(params.name, zone.name),
        RecordType: recordType,
        RecordLine: resolvedLine.recordLine,
        RecordLineId: resolvedLine.recordLineId,
        Value: value,
        TTL: ttl,
      };

      if (recordType === 'MX' && typeof params.priority === 'number') payload.MX = params.priority;
      if (recordType !== 'SRV' && typeof params.weight === 'number') payload.Weight = params.weight;

      await this.request<CommonOkResponse>('ModifyRecord', payload);

      if (params.remark !== undefined) {
        await this.request<CommonOkResponse>('ModifyRecordRemark', {
          DomainId: domainId,
          RecordId: rid,
          Remark: params.remark || '',
        });
      }

      return await this.getRecord(zoneId, recordId);
    } catch (err) {
      throw this.wrapError(err);
    }
  }

  async deleteRecord(zoneId: string, recordId: string): Promise<boolean> {
    try {
      if (this.legacyProvider) return await this.legacyProvider.deleteRecord(zoneId, recordId);
      const zone = await this.getZone(zoneId);
      await this.request<CommonOkResponse>('DeleteRecord', {
        Domain: zone.name,
        DomainId: Number(zone.id),
        RecordId: Number(recordId),
      });
      return true;
    } catch (err) {
      throw this.wrapError(err);
    }
  }

  async setRecordStatus(zoneId: string, recordId: string, enabled: boolean): Promise<boolean> {
    try {
      if (this.legacyProvider) return await this.legacyProvider.setRecordStatus(zoneId, recordId, enabled);
      const zone = await this.getZone(zoneId);
      await this.request<CommonOkResponse>('ModifyRecordStatus', {
        Domain: zone.name,
        DomainId: Number(zone.id),
        RecordId: Number(recordId),
        Status: this.toStatus(enabled),
      });
      return true;
    } catch (err) {
      throw this.wrapError(err);
    }
  }

  async getLines(zoneId?: string): Promise<LineListResult> {
    try {
      if (this.legacyProvider) return await this.legacyProvider.getLines(zoneId);
      if (!zoneId) return { lines: defaultLines() };

      const zone = await this.getZone(zoneId);
      const built = await this.buildLineData(zone);
      this.lineNameMapByZone.set(zone.id, built.lineNameMap);
      return { lines: built.lines };
    } catch (err) {
      throw this.wrapError(err);
    }
  }

  async getMinTTL(_zoneId?: string): Promise<number> {
    try {
      if (this.legacyProvider) return await this.legacyProvider.getMinTTL(_zoneId);
      if (!_zoneId) return 600;

      const zone = await this.getZone(_zoneId);
      const resp = await this.request<DescribeDomainPurviewResponse>('DescribeDomainPurview', {
        Domain: zone.name,
        DomainId: Number(zone.id),
      });

      for (const row of resp.Response?.PurviewList || []) {
        const name = String(row?.Name || '').trim();
        if (!name) continue;
        if (name === '记录 TTL 最低' || name === 'Min TTL value') {
          const v = Number(String(row?.Value || '').trim());
          if (Number.isFinite(v) && v > 0) return v;
        }
      }

      return 600;
    } catch {
      return 600;
    }
  }

  async addZone(domain: string): Promise<Zone> {
    try {
      if (this.legacyProvider && this.legacyProvider.addZone) return await this.legacyProvider.addZone(domain);
      await this.request<CommonOkResponse>('CreateDomain', { Domain: domain });
      const list = await this.getZones(1, 50, domain);
      const found = list.zones.find(z => z.name.toLowerCase() === domain.toLowerCase());
      if (found) return found;
      throw this.createError('CREATE_DOMAIN_FAILED', '创建域名成功但未能查询到');
    } catch (err) {
      throw this.wrapError(err);
    }
  }

  async deleteZone(zoneId: string): Promise<boolean> {
    const id = String(zoneId || '').trim();
    if (!id) {
      throw this.createError('INVALID_ZONE_ID', 'Zone ID 不能为空', { httpStatus: 400 });
    }

    try {
      if (this.legacyProvider && this.legacyProvider.deleteZone) {
        return await this.legacyProvider.deleteZone(id);
      }

      if (/^\d+$/.test(id)) {
        try {
          await this.request<CommonOkResponse>('DeleteDomain', { DomainId: Number(id) });
          return true;
        } catch (err) {
          try {
            const zone = await this.getZone(id);
            await this.request<CommonOkResponse>('DeleteDomain', { Domain: zone.name });
            return true;
          } catch {
            throw err;
          }
        }
      }

      await this.request<CommonOkResponse>('DeleteDomain', { Domain: id });
      return true;
    } catch (err) {
      throw this.wrapError(err);
    }
  }
}
