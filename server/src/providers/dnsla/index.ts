/**
 * DNSLA Provider
 * - Base URL: https://api.dns.la
 * - Auth: HTTP Basic (apiId:apiSecret)
 * - Record types use numeric IDs
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

const TYPE_TO_ID: Record<string, number> = {
  A: 1,
  NS: 2,
  CNAME: 5,
  MX: 15,
  TXT: 16,
  AAAA: 28,
  SRV: 33,
  CAA: 257,
  REDIRECT_URL: 256,
  FORWARD_URL: 256,
};

const ID_TO_TYPE: Record<number, string> = {
  1: 'A',
  2: 'NS',
  5: 'CNAME',
  15: 'MX',
  16: 'TXT',
  28: 'AAAA',
  33: 'SRV',
  257: 'CAA',
  256: 'URL',
};

interface DnslaResponse {
  code?: number;
  msg?: string;
  data?: any;
}

interface DnslaDomain {
  id: string;
  domain?: string;
  displayDomain?: string;
  recordCount?: number;
}

interface DnslaRecord {
  id: string;
  host: string;
  type: number;
  data: string;
  ttl: number;
  lineId?: string;
  weight?: number;
  preference?: number;
  disable?: boolean;
  dominant?: boolean;
  domaint?: boolean;
  updatedAt?: number;
  state?: number;
}

function fromDnslaRecordType(typeId: number, dominant?: boolean): string {
  if (typeId === 256) return dominant ? 'REDIRECT_URL' : 'FORWARD_URL';
  return ID_TO_TYPE[typeId] || String(typeId);
}

function toDnslaRecordType(type: string): { type: number; dominant?: boolean } {
  const t = String(type).toUpperCase();
  if (t === 'REDIRECT_URL') return { type: 256, dominant: true };
  if (t === 'FORWARD_URL') return { type: 256, dominant: false };
  const typeId = TYPE_TO_ID[t];
  if (!typeId) return { type: NaN };
  return { type: typeId };
}

function toDnslaStatus(disable?: boolean, state?: number): '0' | '1' {
  if (typeof disable === 'boolean') return disable ? '0' : '1';
  if (typeof state === 'number') return state === 1 ? '1' : '0';
  return '1';
}

function fromDnslaLineId(lineId?: string): string {
  const v = String(lineId ?? '').trim();
  if (!v || v === '0') return 'default';
  return v;
}

function toDnslaLineId(line?: string): string {
  const v = String(line ?? '').trim();
  if (!v || v === 'default') return '0';
  return v;
}

export const DNSLA_CAPABILITIES: ProviderCapabilities = {
  provider: ProviderType.DNSLA,
  name: 'DNSLA',

  supportsWeight: true,
  supportsLine: true,
  supportsStatus: true,
  supportsRemark: false,
  supportsUrlForward: true,
  supportsLogs: false,

  remarkMode: 'unsupported',
  paging: 'server',
  requiresDomainId: true,

  recordTypes: ['A', 'AAAA', 'CNAME', 'MX', 'TXT', 'SRV', 'CAA', 'NS', 'REDIRECT_URL', 'FORWARD_URL'],

  authFields: [
    { name: 'apiId', label: 'API ID', type: 'text', required: true, placeholder: 'DNSLA API ID' },
    { name: 'apiSecret', label: 'API Secret', type: 'password', required: true, placeholder: 'DNSLA API Secret' },
  ],

  domainCacheTtl: 300,
  recordCacheTtl: 120,

  retryableErrors: ['RATE_LIMIT', 'TIMEOUT', 'InternalError'],
  maxRetries: 3,
};

export class DnslaProvider extends BaseProvider {
  private readonly host = 'api.dns.la';
  private readonly apiId: string;
  private readonly apiSecret: string;

  constructor(credentials: ProviderCredentials) {
    super(credentials, DNSLA_CAPABILITIES);
    const { apiId, apiSecret } = credentials.secrets || {};
    if (!apiId || !apiSecret) throw this.createError('MISSING_CREDENTIALS', '缺少 DNSLA API ID/Secret');
    this.apiId = apiId;
    this.apiSecret = apiSecret;
  }

  private wrapError(err: unknown, code = 'DNSLA_ERROR'): DnsProviderError {
    if (err instanceof DnsProviderError) return err;
    const message = (err as any)?.message ? String((err as any).message) : String(err);
    return this.createError(code, message, { cause: err });
  }

  private authHeader(): string {
    return `Basic ${Buffer.from(`${this.apiId}:${this.apiSecret}`, 'utf8').toString('base64')}`;
  }

  private async request<T = DnslaResponse>(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    path: string,
    query?: Record<string, any>,
    body?: any
  ): Promise<T> {
    const qs = query
      ? '?' +
        Object.entries(query)
          .filter(([, v]) => v !== undefined && v !== null)
          .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
          .join('&')
      : '';
    const payload = body === undefined ? '' : JSON.stringify(body);
    const headers: Record<string, string> = {
      Host: this.host,
      Authorization: this.authHeader(),
      'Content-Type': 'application/json; charset=utf-8',
    };
    if (payload) headers['Content-Length'] = String(Buffer.byteLength(payload));

    return await this.withRetry<T>(
      () =>
        new Promise<T>((resolve, reject) => {
          const req = https.request({ hostname: this.host, method, path: `${path}${qs}`, headers }, res => {
            const chunks: Buffer[] = [];
            res.on('data', d => chunks.push(Buffer.isBuffer(d) ? d : Buffer.from(d)));
            res.on('end', () => {
              const raw = Buffer.concat(chunks).toString('utf8');
              try {
                const json = raw ? JSON.parse(raw) : {};
                if (json.code && json.code !== 200) {
                  reject(this.createError(String(json.code), json.msg || `DNSLA 错误: ${json.code}`, { meta: json }));
                  return;
                }
                resolve(json as T);
              } catch (e) {
                reject(this.createError('INVALID_RESPONSE', 'DNSLA 返回非 JSON 响应', { meta: { raw }, cause: e }));
              }
            });
          });
          req.on('error', e => reject(this.createError('NETWORK_ERROR', 'DNSLA 请求失败', { cause: e })));
          if (payload) req.write(payload);
          req.end();
        })
    );
  }

  async checkAuth(): Promise<boolean> {
    try {
      await this.request('GET', '/api/domainList', { pageIndex: 1, pageSize: 1 });
      return true;
    } catch {
      return false;
    }
  }

  async getZones(page?: number, pageSize?: number, _keyword?: string): Promise<ZoneListResult> {
    try {
      const resp = await this.request<DnslaResponse>('GET', '/api/domainList', {
        pageIndex: page || 1,
        pageSize: pageSize || 20,
      });
      const data = resp.data || {};
      const list: DnslaDomain[] = data.results || data.list || [];
      const total = data.total || list.length;

      const zones: Zone[] = list.map(d =>
        this.normalizeZone({
          id: d.id,
          name: (d.displayDomain || d.domain || d.id).replace(/\.$/, ''),
          status: 'active',
          recordCount: d.recordCount,
        })
      );

      return { total, zones };
    } catch (err) {
      throw this.wrapError(err);
    }
  }

  async getZone(zoneId: string): Promise<Zone> {
    try {
      const resp = await this.request<DnslaResponse>('GET', '/api/domain', { id: zoneId });
      const d = resp.data;
      return this.normalizeZone({
        id: d.id || zoneId,
        name: (d.displayDomain || d.domain || zoneId).replace(/\.$/, ''),
        status: 'active',
      });
    } catch (err) {
      throw this.wrapError(err);
    }
  }

  async getRecords(zoneId: string, params?: RecordQueryParams): Promise<RecordListResult> {
    try {
      const zone = await this.getZone(zoneId);
      const query: Record<string, any> = {
        domainId: zoneId,
        pageIndex: params?.page || 1,
        pageSize: params?.pageSize || 20,
      };
      if (params?.keyword) query.host = params.keyword;
      if (params?.subDomain) query.host = params.subDomain;
      if (params?.value) query.data = params.value;
      if (params?.line) query.lineId = toDnslaLineId(params.line);
      if (params?.type) {
        const mapped = toDnslaRecordType(params.type);
        if (!Number.isFinite(mapped.type)) throw this.createError('INVALID_TYPE', `不支持的记录类型: ${params.type}`);
        query.type = mapped.type;
      }

      const resp = await this.request<DnslaResponse>('GET', '/api/recordList', query);
      const data = resp.data || {};
      const list: DnslaRecord[] = data.results || data.list || [];
      const total = data.total || list.length;

      const records: DnsRecord[] = list.map(r =>
        this.normalizeRecord({
          id: r.id,
          zoneId: zoneId,
          zoneName: zone.name,
          name: r.host || '@',
          type: fromDnslaRecordType(r.type, (r as any).dominant ?? (r as any).domaint),
          value: r.data,
          ttl: r.ttl,
          line: fromDnslaLineId(r.lineId),
          weight: r.weight,
          priority: r.preference,
          status: toDnslaStatus((r as any).disable, (r as any).state),
          updatedAt: r.updatedAt ? new Date(Number(r.updatedAt) * 1000).toISOString() : undefined,
          meta: { raw: r },
        })
      );

      return { total, records };
    } catch (err) {
      throw this.wrapError(err);
    }
  }

  async getRecord(zoneId: string, recordId: string): Promise<DnsRecord> {
    try {
      const result = await this.getRecords(zoneId, { pageSize: 500 });
      const record = result.records.find(r => r.id === recordId);
      if (!record) throw this.createError('NOT_FOUND', `记录不存在: ${recordId}`, { httpStatus: 404 });
      return record;
    } catch (err) {
      throw this.wrapError(err);
    }
  }

  async createRecord(zoneId: string, params: CreateRecordParams): Promise<DnsRecord> {
    try {
      const mapped = toDnslaRecordType(params.type);
      if (!Number.isFinite(mapped.type)) throw this.createError('INVALID_TYPE', `不支持的记录类型: ${params.type}`);

      const body: Record<string, any> = {
        domainId: zoneId,
        host: params.name === '@' ? '@' : params.name,
        type: mapped.type,
        data: params.value,
        ttl: params.ttl || 600,
      };
      if (mapped.dominant !== undefined) body.dominant = mapped.dominant;
      body.lineId = toDnslaLineId(params.line);
      if (params.weight !== undefined) body.weight = params.weight;
      if (params.priority !== undefined) body.preference = params.priority;

      const resp = await this.request<DnslaResponse>('POST', '/api/record', undefined, body);
      const recordId = resp.data?.id;
      if (!recordId) throw this.createError('CREATE_FAILED', '创建记录失败');

      return await this.getRecord(zoneId, recordId);
    } catch (err) {
      throw this.wrapError(err);
    }
  }

  async updateRecord(zoneId: string, recordId: string, params: UpdateRecordParams): Promise<DnsRecord> {
    try {
      const mapped = toDnslaRecordType(params.type);
      if (!Number.isFinite(mapped.type)) throw this.createError('INVALID_TYPE', `不支持的记录类型: ${params.type}`);

      const body: Record<string, any> = {
        id: recordId,
        host: params.name === '@' ? '@' : params.name,
        type: mapped.type,
        data: params.value,
        ttl: params.ttl || 600,
      };
      if (mapped.dominant !== undefined) body.dominant = mapped.dominant;
      body.lineId = toDnslaLineId(params.line);
      if (params.weight !== undefined) body.weight = params.weight;
      if (params.priority !== undefined) body.preference = params.priority;

      await this.request('PUT', '/api/record', undefined, body);
      return await this.getRecord(zoneId, recordId);
    } catch (err) {
      throw this.wrapError(err);
    }
  }

  async deleteRecord(_zoneId: string, recordId: string): Promise<boolean> {
    try {
      await this.request('DELETE', '/api/record', { id: recordId });
      return true;
    } catch (err) {
      throw this.wrapError(err);
    }
  }

  async setRecordStatus(_zoneId: string, recordId: string, enabled: boolean): Promise<boolean> {
    try {
      await this.request('PUT', '/api/recordDisable', undefined, {
        id: recordId,
        disable: !enabled,
      });
      return true;
    } catch (err) {
      throw this.wrapError(err);
    }
  }

  async getLines(zoneId?: string): Promise<LineListResult> {
    try {
      if (!zoneId) return { lines: [{ code: 'default', name: '默认' }] };

      const zone = await this.getZone(zoneId);
      const resp = await this.request<DnslaResponse>('GET', '/api/availableLine', { domain: zone.name });
      const list = Array.isArray(resp.data) ? resp.data : [];
      const sorted = [...list].sort((a: any, b: any) => Number(a?.order || 0) - Number(b?.order || 0));
      const lines: DnsLine[] = sorted.map((l: any) => {
        const id = l.id ?? l.lineId;
        const code = fromDnslaLineId(String(id === '0' ? '' : id ?? ''));
        return {
          code,
          name: String(l.value || l.name || l.lineName || code || '默认'),
          parentCode: l.pid ? String(l.pid) : undefined,
        };
      });

      if (!lines.some(l => l.code === 'default')) {
        lines.unshift({ code: 'default', name: '默认' });
      }

      return { lines: lines.length > 0 ? lines : [{ code: 'default', name: '默认' }] };
    } catch (err) {
      return { lines: [{ code: 'default', name: '默认' }] };
    }
  }

  async getMinTTL(zoneId?: string): Promise<number> {
    try {
      if (!zoneId) return 600;
      const resp = await this.request<DnslaResponse>('GET', '/api/dnsMeasures', { id: zoneId });
      const min = resp.data?.minTTL ?? resp.data?.minTtl;
      return typeof min === 'number' && Number.isFinite(min) && min > 0 ? min : 600;
    } catch {
      return 600;
    }
  }

  async addZone(domain: string): Promise<Zone> {
    try {
      const resp = await this.request<DnslaResponse>('POST', '/api/domain', undefined, { domain });
      return this.normalizeZone({
        id: resp.data?.id || domain,
        name: domain,
        status: 'active',
      });
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
      await this.request('DELETE', '/api/domain', { id });
      return true;
    } catch (err) {
      throw this.wrapError(err);
    }
  }
}
