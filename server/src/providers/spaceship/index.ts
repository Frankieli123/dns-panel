/**
 * Spaceship DNS Provider
 * - Base URL: https://spaceship.dev/api/v1
 * - Auth: X-API-Key + X-API-Secret headers
 * - Record ID format: {type}|{name}|{address}|{mx}
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

interface SpaceshipDomain {
  name: string;
  status?: string;
}

interface SpaceshipRecord {
  type: string;
  name: string;
  address?: string;
  content?: string;
  exchange?: string;
  preference?: number;
  cname?: string;
  value?: string;
  pointer?: string;
  nameserver?: string;
  targetName?: string;
  svcParams?: string;
  svcPriority?: number;
  associationData?: string;
  aliasName?: string;
  ttl: number;
  priority?: number;
}

function resolveRecordValue(r: SpaceshipRecord): { value: string; priority?: number; idValue: string; idMx: number } {
  const type = String(r.type || '').toUpperCase();
  if (type === 'MX') {
    const exchange = String(r.exchange ?? r.address ?? r.content ?? '').trim();
    const mx = typeof r.preference === 'number' ? r.preference : (typeof r.priority === 'number' ? r.priority : 0);
    return { value: exchange, priority: mx, idValue: exchange, idMx: mx };
  }
  if (type === 'CNAME') {
    const v = String(r.cname ?? r.address ?? r.content ?? '').trim();
    return { value: v, idValue: v, idMx: 0 };
  }
  if (type === 'TXT') {
    const v = String(r.value ?? r.address ?? r.content ?? '').trim();
    return { value: v, idValue: v, idMx: 0 };
  }
  if (type === 'PTR') {
    const v = String(r.pointer ?? r.address ?? r.content ?? '').trim();
    return { value: v, idValue: v, idMx: 0 };
  }
  if (type === 'NS') {
    const v = String(r.nameserver ?? r.address ?? r.content ?? '').trim();
    return { value: v, idValue: v, idMx: 0 };
  }
  if (type === 'HTTPS' || type === 'SVRB') {
    const v = `${String(r.targetName ?? '')}${String(r.svcParams ?? '')}|${String(r.svcPriority ?? 0)}`;
    return { value: v, idValue: v, idMx: 0 };
  }
  if (type === 'CAA') {
    const v = String(r.value ?? r.address ?? r.content ?? '').trim();
    return { value: v, idValue: v, idMx: 0 };
  }
  if (type === 'TLSA') {
    const v = String(r.associationData ?? r.address ?? r.content ?? '').trim();
    return { value: v, idValue: v, idMx: 0 };
  }
  if (type === 'ALIAS') {
    const v = String(r.aliasName ?? r.address ?? r.content ?? '').trim();
    return { value: v, idValue: v, idMx: 0 };
  }

  const v = String(r.address ?? r.content ?? '').trim();
  return { value: v, idValue: v, idMx: 0 };
}

function buildRecordItem(type: string, name: string, value: string, ttl: number, priority?: number): Record<string, any> {
  const t = String(type).toUpperCase();
  const item: Record<string, any> = { type, name, ttl, address: value };
  if (t === 'MX') {
    item.exchange = value;
    if (priority !== undefined) item.preference = priority;
    return item;
  }
  if (t === 'CNAME') {
    item.cname = value;
    return item;
  }
  if (t === 'TXT') {
    item.value = value;
    return item;
  }
  if (t === 'PTR') {
    item.pointer = value;
    return item;
  }
  if (t === 'NS') {
    item.nameserver = value;
    return item;
  }
  if (t === 'ALIAS') {
    item.aliasName = value;
    return item;
  }
  if (t === 'TLSA') {
    item.associationData = value;
    return item;
  }
  return item;
}

export const SPACESHIP_CAPABILITIES: ProviderCapabilities = {
  provider: ProviderType.SPACESHIP,
  name: 'Spaceship',

  supportsWeight: false,
  supportsLine: false,
  supportsStatus: false,
  supportsRemark: false,
  supportsUrlForward: true,
  supportsLogs: false,

  remarkMode: 'unsupported',
  paging: 'server',
  requiresDomainId: false,

  recordTypes: ['A', 'AAAA', 'CNAME', 'MX', 'TXT', 'PTR', 'NS', 'HTTPS', 'CAA', 'TLSA', 'ALIAS'],

  authFields: [
    { name: 'apiKey', label: 'API Key', type: 'password', required: true, placeholder: 'Spaceship API Key' },
    { name: 'apiSecret', label: 'API Secret', type: 'password', required: true, placeholder: 'Spaceship API Secret' },
  ],

  domainCacheTtl: 300,
  recordCacheTtl: 60,

  retryableErrors: ['RATE_LIMIT', 'TIMEOUT'],
  maxRetries: 3,
};

export class SpaceshipProvider extends BaseProvider {
  private readonly host = 'spaceship.dev';
  private readonly basePath = '/api/v1';
  private readonly apiKey: string;
  private readonly apiSecret: string;

  constructor(credentials: ProviderCredentials) {
    super(credentials, SPACESHIP_CAPABILITIES);
    const { apiKey, apiSecret } = credentials.secrets || {};
    if (!apiKey || !apiSecret) throw this.createError('MISSING_CREDENTIALS', '缺少 Spaceship API Key/Secret');
    this.apiKey = apiKey;
    this.apiSecret = apiSecret;
  }

  private wrapError(err: unknown, code = 'SPACESHIP_ERROR'): DnsProviderError {
    if (err instanceof DnsProviderError) return err;
    const message = (err as any)?.message ? String((err as any).message) : String(err);
    return this.createError(code, message, { cause: err });
  }

  private headers(): Record<string, string> {
    return {
      'X-API-Key': this.apiKey,
      'X-API-Secret': this.apiSecret,
    };
  }

  private async request<T>(
    method: 'GET' | 'PUT' | 'DELETE',
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
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const headers = this.headers();
    if (payload !== undefined) {
      headers['Content-Type'] = 'application/json; charset=utf-8';
      headers['Content-Length'] = String(Buffer.byteLength(payload));
    }

    return await this.withRetry<T>(
      () =>
        new Promise<T>((resolve, reject) => {
          const req = https.request(
            { hostname: this.host, method, path: `${this.basePath}${path}${qs}`, headers },
            res => {
              const chunks: Buffer[] = [];
              res.on('data', d => chunks.push(Buffer.isBuffer(d) ? d : Buffer.from(d)));
              res.on('end', () => {
                const raw = Buffer.concat(chunks).toString('utf8');
                try {
                  const json = raw ? JSON.parse(raw) : {};
                  if (res.statusCode && res.statusCode >= 400) {
                    reject(
                      this.createError(
                        String(res.statusCode),
                        json.message || json.error || json.detail || `Spaceship 错误: ${res.statusCode}`,
                        { httpStatus: res.statusCode, meta: json }
                      )
                    );
                    return;
                  }
                  resolve(json as T);
                } catch (e) {
                  reject(this.createError('INVALID_RESPONSE', 'Spaceship 返回非 JSON 响应', { meta: { raw }, cause: e }));
                }
              });
            }
          );
          req.on('error', e => reject(this.createError('NETWORK_ERROR', 'Spaceship 请求失败', { cause: e })));
          if (payload !== undefined) req.write(payload);
          req.end();
        })
    );
  }

  private recordId(type: string, name: string, address: string, mx?: number): string {
    return `${type}|${name}|${address}|${mx ?? ''}`;
  }

  private parseRecordId(id: string): { type: string; name: string; address: string; mx?: number } {
    const [type, name, address, mxStr] = id.split('|');
    return { type, name, address, mx: mxStr ? parseInt(mxStr, 10) : undefined };
  }

  async checkAuth(): Promise<boolean> {
    try {
      await this.request('GET', '/domains', { take: 1, skip: 0 });
      return true;
    } catch {
      return false;
    }
  }

  async getZones(page?: number, pageSize?: number, _keyword?: string): Promise<ZoneListResult> {
    try {
      const take = pageSize || 20;
      const skip = ((page || 1) - 1) * take;

      const resp = await this.request<{ items?: SpaceshipDomain[]; totalCount?: number }>('GET', '/domains', {
        take,
        skip,
      });
      const list = resp.items || [];
      const total = (resp as any).totalCount || (resp as any).total || list.length;

      const zones: Zone[] = list.map(d =>
        this.normalizeZone({
          id: d.name,
          name: d.name,
          status: d.status || 'active',
        })
      );

      return { total, zones };
    } catch (err) {
      throw this.wrapError(err);
    }
  }

  async getZone(zoneId: string): Promise<Zone> {
    return this.normalizeZone({ id: zoneId, name: zoneId, status: 'active' });
  }

  async getRecords(zoneId: string, params?: RecordQueryParams): Promise<RecordListResult> {
    try {
      const take = params?.pageSize || 20;
      const skip = ((params?.page || 1) - 1) * take;
      const query: Record<string, any> = { take, skip };
      if (params?.subDomain) query.host = params.subDomain;

      const resp = await this.request<{ items?: SpaceshipRecord[]; totalCount?: number }>(
        'GET',
        `/dns/records/${zoneId}`,
        query
      );
      const list = resp.items || [];
      const total = (resp as any).totalCount || (resp as any).total || list.length;

      const records: DnsRecord[] = list.map(r => {
        const resolved = resolveRecordValue(r);
        return this.normalizeRecord({
          id: this.recordId(r.type, r.name, resolved.idValue, resolved.idMx),
          zoneId: zoneId,
          zoneName: zoneId,
          name: r.name || '@',  // Display as @ for root
          type: r.type,
          value: resolved.value,
          ttl: r.ttl || 3600,
          priority: resolved.priority,
        });
      });

      return { total, records };
    } catch (err) {
      throw this.wrapError(err);
    }
  }

  async getRecord(zoneId: string, recordId: string): Promise<DnsRecord> {
    try {
      const parsed = this.parseRecordId(recordId);
      const result = await this.getRecords(zoneId, { pageSize: 500 });
      // Compare with normalized display name (@ or actual name)
      const displayName = parsed.name || '@';
      const record = result.records.find(
        r => r.type === parsed.type && r.name === displayName && r.value === parsed.address
      );
      if (!record) throw this.createError('NOT_FOUND', `记录不存在: ${recordId}`, { httpStatus: 404 });
      return record;
    } catch (err) {
      throw this.wrapError(err);
    }
  }

  async createRecord(zoneId: string, params: CreateRecordParams): Promise<DnsRecord> {
    try {
      const recordName = params.name === '@' ? '' : params.name;
      const item = buildRecordItem(params.type, recordName, params.value, params.ttl || 3600, params.priority);

      await this.request('PUT', `/dns/records/${zoneId}`, undefined, {
        force: true,
        items: [item],
      });

      // Use the actual API name (empty string for root) in record ID
      const recordId = this.recordId(params.type, recordName, params.value, params.priority);
      return await this.getRecord(zoneId, recordId);
    } catch (err) {
      throw this.wrapError(err);
    }
  }

  async updateRecord(zoneId: string, recordId: string, params: UpdateRecordParams): Promise<DnsRecord> {
    try {
      // Spaceship 使用 PUT force=true 来更新，需要先删除旧的再添加新的
      await this.deleteRecord(zoneId, recordId);
      return await this.createRecord(zoneId, params);
    } catch (err) {
      throw this.wrapError(err);
    }
  }

  async deleteRecord(zoneId: string, recordId: string): Promise<boolean> {
    try {
      const parsed = this.parseRecordId(recordId);

      const t = String(parsed.type).toUpperCase();
      let body: any;
      if (t === 'MX') {
        body = [{ type: parsed.type, name: parsed.name, exchange: parsed.address, preference: parsed.mx ?? 0 }];
      } else if (t === 'TXT') {
        body = [{ type: parsed.type, name: parsed.name, value: parsed.address }];
      } else if (t === 'CNAME') {
        body = [{ type: parsed.type, name: parsed.name, cname: parsed.address }];
      } else if (t === 'ALIAS') {
        body = [{ type: parsed.type, name: parsed.name, aliasName: parsed.address }];
      } else if (t === 'PTR') {
        body = [{ type: parsed.type, name: parsed.name, pointer: parsed.address }];
      } else if (t === 'NS') {
        body = [{ type: parsed.type, name: parsed.name, nameserver: parsed.address }];
      } else {
        body = [{ type: parsed.type, name: parsed.name, address: parsed.address }];
      }

      await this.request('DELETE', `/dns/records/${zoneId}`, undefined, body);
      return true;
    } catch (err) {
      throw this.wrapError(err);
    }
  }

  async setRecordStatus(_zoneId: string, _recordId: string, _enabled: boolean): Promise<boolean> {
    throw this.createError('UNSUPPORTED', 'Spaceship 不支持启用/禁用记录');
  }

  async getLines(_zoneId?: string): Promise<LineListResult> {
    const lines: DnsLine[] = [{ code: 'default', name: '默认' }];
    return { lines };
  }

  async getMinTTL(_zoneId?: string): Promise<number> {
    return 600;
  }

  async addZone(domain: string): Promise<Zone> {
    throw this.createError('UNSUPPORTED', 'Spaceship 不支持通过 API 添加域名');
  }
}
