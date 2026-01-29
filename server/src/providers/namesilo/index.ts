/**
 * NameSilo DNS Provider
 * - Base URL: https://www.namesilo.com/api/
 * - Auth: API Key in query params
 * - Paging: client-side
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

interface NamesiloResponse {
  reply?: {
    code?: number;
    detail?: string;
    domains?: { domain?: string[] };
    resource_record?: NamesiloRecord[] | NamesiloRecord;
    record_id?: string;
  };
}

interface NamesiloRecord {
  record_id: string;
  type: string;
  host: string;
  value: string;
  ttl: number;
  distance?: number;
}

function toRelativeName(host: string, zoneName: string): string {
  const h = String(host || '').trim();
  const z = String(zoneName || '').trim();
  if (!h) return '@';
  if (!z) return h;
  if (h === z) return '@';
  if (h.endsWith(`.${z}`)) return h.slice(0, -(z.length + 1)) || '@';
  return h;
}

export const NAMESILO_CAPABILITIES: ProviderCapabilities = {
  provider: ProviderType.NAMESILO,
  name: 'NameSilo',

  supportsWeight: false,
  supportsLine: false,
  supportsStatus: false,
  supportsRemark: false,
  supportsUrlForward: false,
  supportsLogs: false,

  remarkMode: 'unsupported',
  paging: 'client',
  requiresDomainId: false,

  recordTypes: ['A', 'AAAA', 'CNAME', 'MX', 'TXT', 'SRV', 'CAA', 'NS'],

  authFields: [
    { name: 'apiKey', label: 'API Key', type: 'password', required: true, placeholder: 'NameSilo API Key' },
  ],

  domainCacheTtl: 300,
  recordCacheTtl: 120,

  retryableErrors: ['RATE_LIMIT', 'TIMEOUT'],
  maxRetries: 3,
};

export class NamesiloProvider extends BaseProvider {
  private readonly host = 'www.namesilo.com';
  private readonly basePath = '/api';
  private readonly apiKey: string;

  constructor(credentials: ProviderCredentials) {
    super(credentials, NAMESILO_CAPABILITIES);
    const { apiKey } = credentials.secrets || {};
    if (!apiKey) throw this.createError('MISSING_CREDENTIALS', '缺少 NameSilo API Key');
    this.apiKey = apiKey;
  }

  private wrapError(err: unknown, code = 'NAMESILO_ERROR'): DnsProviderError {
    if (err instanceof DnsProviderError) return err;
    const message = (err as any)?.message ? String((err as any).message) : String(err);
    return this.createError(code, message, { cause: err });
  }

  private async request<T = NamesiloResponse>(operation: string, query?: Record<string, any>): Promise<T> {
    const q = { version: '1', type: 'json', key: this.apiKey, ...(query || {}) };
    const qs =
      '?' +
      Object.entries(q)
        .filter(([, v]) => v !== undefined && v !== null)
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
        .join('&');

    return await this.withRetry<T>(
      () =>
        new Promise<T>((resolve, reject) => {
          const req = https.request(
            { hostname: this.host, method: 'GET', path: `${this.basePath}/${operation}${qs}` },
            res => {
              const chunks: Buffer[] = [];
              res.on('data', d => chunks.push(Buffer.isBuffer(d) ? d : Buffer.from(d)));
              res.on('end', () => {
                const raw = Buffer.concat(chunks).toString('utf8');
                try {
                  const json = raw ? JSON.parse(raw) : {};
                  // code=300 表示成功
                  const codeRaw = (json as any)?.reply?.code;
                  if (codeRaw !== undefined && codeRaw !== null && Number(codeRaw) !== 300) {
                    reject(
                      this.createError(
                        String(codeRaw),
                        (json as any)?.reply?.detail || `NameSilo 错误: ${codeRaw}`,
                        { meta: { raw: json } }
                      )
                    );
                    return;
                  }
                  resolve(json as T);
                } catch (e) {
                  reject(this.createError('INVALID_RESPONSE', 'NameSilo 返回非 JSON 响应', { meta: { raw }, cause: e }));
                }
              });
            }
          );
          req.on('error', e => reject(this.createError('NETWORK_ERROR', 'NameSilo 请求失败', { cause: e })));
          req.end();
        })
    );
  }

  async checkAuth(): Promise<boolean> {
    try {
      await this.request('listDomains', { page: 1, pageSize: 1 });
      return true;
    } catch {
      return false;
    }
  }

  async getZones(page?: number, pageSize?: number, keyword?: string): Promise<ZoneListResult> {
    try {
      const fetchPageSize = 100;
      const domains: string[] = [];
      let fetchPage = 1;

      while (true) {
        const resp = await this.request<NamesiloResponse>('listDomains', { page: fetchPage, pageSize: fetchPageSize });
        const domainList = resp.reply?.domains?.domain || [];
        const batch = Array.isArray(domainList) ? domainList : [domainList];

        const cleaned = batch.map(d => String(d)).filter(Boolean);
        if (cleaned.length === 0) break;
        domains.push(...cleaned);

        if (cleaned.length < fetchPageSize) break;
        fetchPage += 1;
        if (fetchPage > 2000) break;
      }

      const zones: Zone[] = domains.map(d =>
        this.normalizeZone({
          id: d,
          name: d,
          status: 'active',
        })
      );

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
      const resp = await this.request<NamesiloResponse>('dnsListRecords', { domain: zoneId });
      const recordList = resp.reply?.resource_record || [];
      const rawRecords = Array.isArray(recordList) ? recordList : [recordList];

      const records: DnsRecord[] = rawRecords.map(r =>
        this.normalizeRecord({
          id: r.record_id,
          zoneId: zoneId,
          zoneName: zoneId,
          name: toRelativeName(r.host, zoneId),
          type: r.type,
          value: r.value,
          ttl: r.ttl || 7200,
          priority: r.distance,
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
      const query: Record<string, any> = {
        domain: zoneId,
        rrtype: params.type,
        rrhost: params.name === '@' ? '' : params.name,
        rrvalue: params.value,
        rrttl: params.ttl || 7200,
      };
      if (params.priority !== undefined) query.rrdistance = params.priority;

      const resp = await this.request<NamesiloResponse>('dnsAddRecord', query);
      const recordId = resp.reply?.record_id;
      if (!recordId) throw this.createError('CREATE_FAILED', '创建记录失败');

      return await this.getRecord(zoneId, recordId);
    } catch (err) {
      throw this.wrapError(err);
    }
  }

  async updateRecord(zoneId: string, recordId: string, params: UpdateRecordParams): Promise<DnsRecord> {
    try {
      const query: Record<string, any> = {
        domain: zoneId,
        rrid: recordId,
        rrtype: params.type,
        rrhost: params.name === '@' ? '' : params.name,
        rrvalue: params.value,
        rrttl: params.ttl || 7200,
      };
      if (params.priority !== undefined) query.rrdistance = params.priority;

      await this.request('dnsUpdateRecord', query);
      return await this.getRecord(zoneId, recordId);
    } catch (err) {
      throw this.wrapError(err);
    }
  }

  async deleteRecord(zoneId: string, recordId: string): Promise<boolean> {
    try {
      await this.request('dnsDeleteRecord', { domain: zoneId, rrid: recordId });
      return true;
    } catch (err) {
      throw this.wrapError(err);
    }
  }

  async setRecordStatus(_zoneId: string, _recordId: string, _enabled: boolean): Promise<boolean> {
    throw this.createError('UNSUPPORTED', 'NameSilo 不支持启用/禁用记录');
  }

  async getLines(_zoneId?: string): Promise<LineListResult> {
    const lines: DnsLine[] = [{ code: 'default', name: '默认' }];
    return { lines };
  }

  async getMinTTL(_zoneId?: string): Promise<number> {
    return 7200;
  }
}
