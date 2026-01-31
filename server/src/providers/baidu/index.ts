/**
 * Baidu Cloud DNS Provider (百度云)
 * - Endpoint: dns.baidubce.com
 * - Auth: BCE Signing (bce-auth-v1)
 * - Client-side pagination
 * - Requires clientToken for write operations
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
import { BceCredentials, buildBceHeaders, generateClientToken } from './auth';

function rfc3986Encode(input: string): string {
  return encodeURIComponent(input).replace(/[!'()*]/g, ch => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`);
}

function buildQueryString(query: Record<string, string>): string {
  return Object.entries(query)
    .sort((a, b) => (a[0] === b[0] ? a[1].localeCompare(b[1]) : a[0].localeCompare(b[0])))
    .map(([k, v]) => `${rfc3986Encode(k)}=${rfc3986Encode(v)}`)
    .join('&');
}

interface BaiduZone {
  id?: string;
  name: string;
  status?: string;
  productVersion?: string;
  createTime?: string;
  expireTime?: string;
}

interface BaiduZonesResponse {
  zones?: BaiduZone[];
  marker?: string;
  isTruncated?: boolean;
  nextMarker?: string;
  maxKeys?: number;
}

interface BaiduRecord {
  id?: string;
  rr: string;
  type: string;
  value: string;
  ttl?: number;
  line?: string;
  description?: string;
  priority?: number;
  status?: string;
}

interface BaiduRecordsResponse {
  records?: BaiduRecord[];
  marker?: string;
  isTruncated?: boolean;
  nextMarker?: string;
}

// 百度云线路
const BAIDU_LINES: DnsLine[] = [
  { code: 'default', name: '默认' },
  { code: 'ct', name: '电信' },
  { code: 'cnc', name: '联通' },
  { code: 'cmnet', name: '移动' },
  { code: 'edu', name: '教育网' },
  { code: 'search', name: '搜索引擎(百度)' },
];

export const BAIDU_CAPABILITIES: ProviderCapabilities = {
  provider: ProviderType.BAIDU,
  name: '百度云 DNS',

  supportsWeight: false,
  supportsLine: true,
  supportsStatus: true,
  supportsRemark: true,
  supportsUrlForward: false,
  supportsLogs: false,

  remarkMode: 'inline',
  paging: 'client',
  requiresDomainId: false,

  recordTypes: ['A', 'AAAA', 'CNAME', 'MX', 'TXT', 'SRV', 'CAA', 'NS'],

  authFields: [
    { name: 'accessKey', label: 'AccessKey', type: 'text', required: true, placeholder: '百度云 AccessKey' },
    { name: 'secretKey', label: 'SecretKey', type: 'password', required: true, placeholder: '百度云 SecretKey' },
  ],

  domainCacheTtl: 300,
  recordCacheTtl: 120,

  retryableErrors: ['SYSTEM_BUSY', 'InternalError', 'TIMEOUT'],
  maxRetries: 3,
};

export class BaiduProvider extends BaseProvider {
  private readonly host = 'dns.baidubce.com';
  private readonly creds: BceCredentials;

  constructor(credentials: ProviderCredentials) {
    super(credentials, BAIDU_CAPABILITIES);
    const { accessKey, secretKey } = credentials.secrets || {};
    if (!accessKey || !secretKey) throw this.createError('MISSING_CREDENTIALS', '缺少百度云 AccessKey/SecretKey');
    this.creds = { accessKey, secretKey };
  }

  private wrapError(err: unknown, code = 'BAIDU_ERROR'): DnsProviderError {
    if (err instanceof DnsProviderError) return err;
    const message = (err as any)?.message ? String((err as any).message) : String(err);
    return this.createError(code, message, { cause: err });
  }

  private async request<T>(method: string, path: string, query?: Record<string, any>, body?: any): Promise<T> {
    const queryParams: Record<string, string> = {};
    if (query) {
      for (const [k, v] of Object.entries(query)) {
        if (v !== undefined && v !== null) queryParams[k] = String(v);
      }
    }

    const payload = body ? JSON.stringify(body) : '';
    const contentType = body ? 'application/json; charset=utf-8' : undefined;

    const headers = buildBceHeaders(this.creds, {
      method,
      host: this.host,
      path,
      query: queryParams,
      headers: contentType ? { 'Content-Type': contentType } : undefined,
    });

    if (payload) headers['Content-Length'] = String(Buffer.byteLength(payload));

    const qs = buildQueryString(queryParams);
    const fullPath = qs ? `${path}?${qs}` : path;

    return await this.withRetry<T>(
      () =>
        new Promise<T>((resolve, reject) => {
          const req = https.request({ hostname: this.host, method, path: fullPath, headers }, res => {
            const chunks: Buffer[] = [];
            res.on('data', d => chunks.push(Buffer.isBuffer(d) ? d : Buffer.from(d)));
            res.on('end', () => {
              const raw = Buffer.concat(chunks).toString('utf8');
              if (res.statusCode === 204) {
                resolve({} as T);
                return;
              }
              try {
                const json = raw ? JSON.parse(raw) : {};
                if (res.statusCode && res.statusCode >= 400) {
                  const errCode = json.code || String(res.statusCode);
                  const errMsg = json.message || `百度云错误: ${res.statusCode}`;
                  reject(this.createError(errCode, errMsg, { httpStatus: res.statusCode, meta: json }));
                  return;
                }
                resolve(json as T);
              } catch (e) {
                reject(this.createError('INVALID_RESPONSE', '百度云返回非 JSON 响应', { meta: { raw }, cause: e }));
              }
            });
          });
          req.on('error', e => reject(this.createError('NETWORK_ERROR', '百度云请求失败', { cause: e })));
          if (payload) req.write(payload);
          req.end();
        })
    );
  }

  async checkAuth(): Promise<boolean> {
    try {
      await this.request<BaiduZonesResponse>('GET', '/v1/dns/zone');
      return true;
    } catch {
      return false;
    }
  }

  async getZones(page?: number, pageSize?: number, keyword?: string): Promise<ZoneListResult> {
    try {
      const resp = await this.request<BaiduZonesResponse>('GET', '/v1/dns/zone', keyword ? { name: keyword } : undefined);
      const zones: Zone[] = (resp.zones || []).map(z => {
        const rawName = String(z.name || '').trim();
        const name = rawName.endsWith('.') ? rawName.slice(0, -1) : rawName;
        return this.normalizeZone({
          id: name,
          name,
          status: z.status || 'active',
          meta: { zoneId: z.id },
        });
      });

      return this.applyZoneQuery(zones, page, pageSize, keyword);
    } catch (err) {
      throw this.wrapError(err);
    }
  }

  async getZone(zoneId: string): Promise<Zone> {
    return this.normalizeZone({ id: zoneId, name: zoneId, status: 'active' });
  }

  async getRecords(zoneId: string, params?: RecordQueryParams): Promise<RecordListResult> {
    try {
      const query: Record<string, any> = {};
      if (params?.subDomain) {
        query.rr = params.subDomain === '@' ? '@' : String(params.subDomain).toLowerCase();
      }
      const resp = await this.request<BaiduRecordsResponse>(
        'GET',
        `/v1/dns/zone/${encodeURIComponent(zoneId)}/record`,
        Object.keys(query).length > 0 ? query : undefined
      );

      const records: DnsRecord[] = (resp.records || []).map(r =>
        this.normalizeRecord({
          id: r.id || `${r.rr}|${r.type}|${r.value}`,
          zoneId: zoneId,
          zoneName: zoneId,
          name: r.rr || '@',
          type: r.type,
          value: r.value,
          ttl: r.ttl || 600,
          line: r.line || 'default',
          priority: r.priority,
          remark: r.description,
          status: r.status === 'running' ? '1' : '0',
        })
      );

      return this.applyRecordQuery(records, params);
    } catch (err) {
      throw this.wrapError(err);
    }
  }

  async getRecord(zoneId: string, recordId: string): Promise<DnsRecord> {
    try {
      const result = await this.getRecords(zoneId);
      const record = result.records.find(r => r.id === recordId);
      if (!record) throw this.createError('NOT_FOUND', `记录不存在: ${recordId}`, { httpStatus: 404 });
      return record;
    } catch (err) {
      throw this.wrapError(err);
    }
  }

  async createRecord(zoneId: string, params: CreateRecordParams): Promise<DnsRecord> {
    try {
      const body: Record<string, any> = {
        rr: params.name === '@' ? '@' : params.name,
        type: params.type,
        value: params.value,
        ttl: params.ttl || 600,
        line: params.line || 'default',
      };
      if (params.priority !== undefined) body.priority = params.priority;
      if (params.remark) body.description = params.remark;

      const resp = await this.request<{ id?: string }>('POST', `/v1/dns/zone/${encodeURIComponent(zoneId)}/record`, { clientToken: generateClientToken() }, body);

      const recordId = resp.id;
      if (!recordId) throw this.createError('CREATE_FAILED', '创建记录失败');
      return await this.getRecord(zoneId, recordId);
    } catch (err) {
      throw this.wrapError(err);
    }
  }

  async updateRecord(zoneId: string, recordId: string, params: UpdateRecordParams): Promise<DnsRecord> {
    try {
      const body: Record<string, any> = {
        rr: params.name === '@' ? '@' : params.name,
        type: params.type,
        value: params.value,
        ttl: params.ttl || 600,
        line: params.line || 'default',
      };
      if (params.priority !== undefined) body.priority = params.priority;
      if (params.remark !== undefined) body.description = params.remark;

      await this.request('PUT', `/v1/dns/zone/${encodeURIComponent(zoneId)}/record/${encodeURIComponent(recordId)}`, { clientToken: generateClientToken() }, body);
      return await this.getRecord(zoneId, recordId);
    } catch (err) {
      throw this.wrapError(err);
    }
  }

  async deleteRecord(zoneId: string, recordId: string): Promise<boolean> {
    try {
      await this.request('DELETE', `/v1/dns/zone/${encodeURIComponent(zoneId)}/record/${encodeURIComponent(recordId)}`, { clientToken: generateClientToken() });
      return true;
    } catch (err) {
      throw this.wrapError(err);
    }
  }

  async setRecordStatus(zoneId: string, recordId: string, enabled: boolean): Promise<boolean> {
    try {
      const status = enabled ? 'enable' : 'disable';
      const query: Record<string, string> = { [status]: '', clientToken: generateClientToken() };
      await this.request('PUT', `/v1/dns/zone/${encodeURIComponent(zoneId)}/record/${encodeURIComponent(recordId)}`, query);
      return true;
    } catch (err) {
      throw this.wrapError(err);
    }
  }

  async getLines(_zoneId?: string): Promise<LineListResult> {
    return { lines: BAIDU_LINES };
  }

  async getMinTTL(_zoneId?: string): Promise<number> {
    return 600;
  }

  async addZone(domain: string): Promise<Zone> {
    try {
      const query = { clientToken: generateClientToken(), name: domain };
      await this.request('POST', '/v1/dns/zone', query);
      return this.normalizeZone({ id: domain, name: domain, status: 'active' });
    } catch (err) {
      throw this.wrapError(err);
    }
  }

  async deleteZone(zoneId: string): Promise<boolean> {
    const name = String(zoneId || '').trim().replace(/\.$/, '');
    if (!name) {
      throw this.createError('INVALID_ZONE', '域名不能为空', { httpStatus: 400 });
    }

    try {
      await this.request('DELETE', `/v1/dns/zone/${encodeURIComponent(name)}`, { clientToken: generateClientToken() });
      return true;
    } catch (err) {
      throw this.wrapError(err);
    }
  }
}
