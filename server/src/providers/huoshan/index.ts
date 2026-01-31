/**
 * Volcengine / Huoshan DNS Provider (火山引擎)
 * - Endpoint: open.volcengineapi.com
 * - Service: DNS, Region: cn-north-1
 * - Auth: HMAC-SHA256 签名
 * - Requires ZID for record operations
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
import { buildVolcengineHeaders, VolcengineCredentials } from './auth';

function rfc3986Encode(input: string): string {
  return encodeURIComponent(input).replace(/[!'()*]/g, ch => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`);
}

function buildQueryString(query: Record<string, string>): string {
  return Object.entries(query)
    .sort((a, b) => (a[0] === b[0] ? a[1].localeCompare(b[1]) : a[0].localeCompare(b[0])))
    .map(([k, v]) => `${rfc3986Encode(k)}=${rfc3986Encode(v)}`)
    .join('&');
}

interface HuoshanZone {
  ZID: number;
  ZoneName: string;
  RecordCount?: number;
  UpdatedAt?: string;
  TradeCode?: string;
}

interface HuoshanZonesResponse {
  Total?: number;
  Zones?: HuoshanZone[];
}

interface HuoshanRecord {
  RecordID: string;
  Host: string;
  Type: string;
  Value: string;
  TTL: number;
  Line?: string;
  Weight?: number;
  Enable?: boolean;
  Remark?: string;
  Preheat?: boolean;
  UpdatedAt?: string;
}

interface HuoshanRecordsResponse {
  Total?: number;
  TotalCount?: number;
  Records?: HuoshanRecord[];
}

interface HuoshanLine {
  Value: string;
  Name: string;
  Level?: number;
  FatherValue?: string;
}

interface HuoshanLinesResponse {
  TotalCount?: number;
  Lines?: HuoshanLine[];
}

interface HuoshanCustomerLine {
  Line: string;
  NameCN?: string;
  NameEN?: string;
}

interface HuoshanCustomLinesResponse {
  TotalCount?: number;
  CustomerLines?: HuoshanCustomerLine[];
}

// 默认线路
const HUOSHAN_DEFAULT_LINES: DnsLine[] = [
  { code: 'default', name: '默认' },
  { code: 'telecom', name: '电信' },
  { code: 'unicom', name: '联通' },
  { code: 'mobile', name: '移动' },
  { code: 'edu', name: '教育网' },
  { code: 'oversea', name: '海外' },
];

const TRADE_CODE_INFO: Record<string, { level: number; ttl: number }> = {
  free_inner: { level: 1, ttl: 600 },
  professional_inner: { level: 2, ttl: 300 },
  enterprise_inner: { level: 3, ttl: 60 },
  ultimate_inner: { level: 4, ttl: 1 },
  ultimate_exclusive_inner: { level: 5, ttl: 1 },
};

function getTradeInfo(tradeCode?: string): { level: number; ttl: number } {
  const key = tradeCode && TRADE_CODE_INFO[tradeCode] ? tradeCode : 'free_inner';
  return TRADE_CODE_INFO[key];
}

function splitMxValue(type: string, value: string): { value: string; priority?: number } {
  if (String(type).toUpperCase() !== 'MX') return { value };
  const raw = String(value ?? '').trim();
  const parts = raw.split(/\s+/);
  if (parts.length >= 2) {
    const p = Number(parts[0]);
    if (Number.isFinite(p)) {
      return { priority: p, value: parts.slice(1).join(' ') };
    }
  }
  return { value: raw };
}

function joinMxValue(type: string, value: string, priority?: number): string {
  if (String(type).toUpperCase() !== 'MX') return value;
  if (priority === undefined || priority === null || !Number.isFinite(Number(priority))) return value;
  return `${Number(priority)} ${value}`;
}

export const HUOSHAN_CAPABILITIES: ProviderCapabilities = {
  provider: ProviderType.HUOSHAN,
  name: '火山引擎 DNS',

  supportsWeight: true,
  supportsLine: true,
  supportsStatus: true,
  supportsRemark: true,
  supportsUrlForward: false,
  supportsLogs: false,

  remarkMode: 'inline',
  paging: 'server',
  requiresDomainId: true,

  recordTypes: ['A', 'AAAA', 'CNAME', 'MX', 'TXT', 'SRV', 'CAA', 'NS'],

  authFields: [
    { name: 'accessKeyId', label: 'AccessKey ID', type: 'text', required: true, placeholder: '火山引擎 AccessKey ID' },
    { name: 'secretAccessKey', label: 'SecretAccessKey', type: 'password', required: true, placeholder: '火山引擎 SecretAccessKey' },
  ],

  domainCacheTtl: 300,
  recordCacheTtl: 120,

  retryableErrors: ['SYSTEM_BUSY', 'InternalError', 'TIMEOUT'],
  maxRetries: 3,
};

export class HuoshanProvider extends BaseProvider {
  private readonly host = 'open.volcengineapi.com';
  private readonly service = 'DNS';
  private readonly region = 'cn-north-1';
  private readonly version = '2018-08-01';
  private readonly creds: VolcengineCredentials;

  constructor(credentials: ProviderCredentials) {
    super(credentials, HUOSHAN_CAPABILITIES);
    const { accessKeyId, secretAccessKey } = credentials.secrets || {};
    if (!accessKeyId || !secretAccessKey) throw this.createError('MISSING_CREDENTIALS', '缺少火山引擎 AccessKey');
    this.creds = { accessKeyId, secretAccessKey };
  }

  private wrapError(err: unknown, code = 'HUOSHAN_ERROR'): DnsProviderError {
    if (err instanceof DnsProviderError) return err;
    const message = (err as any)?.message ? String((err as any).message) : String(err);
    return this.createError(code, message, { cause: err });
  }

  private async request<T>(method: string, action: string, query?: Record<string, any>, body?: any): Promise<T> {
    const queryParams: Record<string, string> = {
      Action: action,
      Version: this.version,
    };
    if (query) {
      for (const [k, v] of Object.entries(query)) {
        if (v !== undefined && v !== null) queryParams[k] = String(v);
      }
    }

    const payload = body ? JSON.stringify(body) : '';
    const contentType = body ? 'application/json; charset=utf-8' : undefined;

    const headers = buildVolcengineHeaders(this.creds, {
      method,
      host: this.host,
      service: this.service,
      region: this.region,
      path: '/',
      query: queryParams,
      body: payload,
      headers: contentType ? { 'Content-Type': contentType } : undefined,
    });

    if (payload) headers['Content-Length'] = String(Buffer.byteLength(payload));

    const qs = buildQueryString(queryParams);
    const fullPath = `/?${qs}`;

    return await this.withRetry<T>(
      () =>
        new Promise<T>((resolve, reject) => {
          const req = https.request({ hostname: this.host, method, path: fullPath, headers }, res => {
            const chunks: Buffer[] = [];
            res.on('data', d => chunks.push(Buffer.isBuffer(d) ? d : Buffer.from(d)));
            res.on('end', () => {
              const raw = Buffer.concat(chunks).toString('utf8');
              try {
                const json = raw ? JSON.parse(raw) : {};
                // 火山引擎返回格式: { ResponseMetadata: {...}, Result: {...} }
                const meta = json.ResponseMetadata || {};
                const result = json.Result || json;

                if (meta.Error) {
                  reject(this.createError(meta.Error.Code || 'ERROR', meta.Error.Message || '火山引擎错误', { meta: json }));
                  return;
                }
                if (res.statusCode && res.statusCode >= 400) {
                  reject(this.createError(String(res.statusCode), `火山引擎错误: ${res.statusCode}`, { httpStatus: res.statusCode, meta: json }));
                  return;
                }
                resolve(result as T);
              } catch (e) {
                reject(this.createError('INVALID_RESPONSE', '火山引擎返回非 JSON 响应', { meta: { raw }, cause: e }));
              }
            });
          });
          req.on('error', e => reject(this.createError('NETWORK_ERROR', '火山引擎请求失败', { cause: e })));
          if (payload) req.write(payload);
          req.end();
        })
    );
  }

  async checkAuth(): Promise<boolean> {
    try {
      await this.request<HuoshanZonesResponse>('GET', 'ListZones', { PageNumber: 1, PageSize: 1 });
      return true;
    } catch {
      return false;
    }
  }

  async getZones(page?: number, pageSize?: number, keyword?: string): Promise<ZoneListResult> {
    try {
      const query: Record<string, any> = {
        PageNumber: page || 1,
        PageSize: pageSize || 20,
      };
      if (keyword) query.Key = keyword;

      const resp = await this.request<HuoshanZonesResponse>('GET', 'ListZones', query);
      const zones: Zone[] = (resp.Zones || []).map(z =>
        this.normalizeZone({
          id: String(z.ZID),
          name: z.ZoneName,
          status: 'active',
          recordCount: z.RecordCount,
          updatedAt: z.UpdatedAt,
          meta: { TradeCode: z.TradeCode },
        })
      );

      return { total: resp.Total || zones.length, zones };
    } catch (err) {
      throw this.wrapError(err);
    }
  }

  async getZone(zoneId: string): Promise<Zone> {
    try {
      const resp = await this.request<{ ZID: number; ZoneName: string; RecordCount?: number; TradeCode?: string }>('GET', 'QueryZone', { ZID: zoneId });
      return this.normalizeZone({
        id: String(resp.ZID),
        name: resp.ZoneName,
        status: 'active',
        recordCount: resp.RecordCount,
        meta: { TradeCode: resp.TradeCode },
      });
    } catch (err) {
      throw this.wrapError(err);
    }
  }

  async getRecords(zoneId: string, params?: RecordQueryParams): Promise<RecordListResult> {
    try {
      const zone = await this.getZone(zoneId);
      const query: Record<string, any> = {
        ZID: parseInt(zoneId, 10),
        PageNumber: params?.page || 1,
        PageSize: params?.pageSize || 20,
        SearchOrder: 'desc',
      };

      const useExact = Boolean(params?.subDomain || params?.type || params?.line || params?.value);
      if (useExact) {
        query.SearchMode = 'exact';
        if (params?.subDomain) query.Host = params.subDomain;
        if (params?.type) query.Type = params.type;
        if (params?.value) query.Value = params.value;
        if (params?.line) query.Line = params.line;
      } else if (params?.keyword) {
        query.Host = params.keyword;
      }

      const resp = await this.request<HuoshanRecordsResponse>('GET', 'ListRecords', query);

      const records: DnsRecord[] = (resp.Records || []).map(r =>
        (() => {
          const mx = splitMxValue(r.Type, r.Value);
          return this.normalizeRecord({
            id: r.RecordID,
            zoneId: zoneId,
            zoneName: zone.name,
            name: r.Host || '@',
            type: r.Type,
            value: mx.value,
            ttl: r.TTL,
            line: r.Line || 'default',
            weight: r.Weight,
            priority: mx.priority,
            status: r.Enable === false ? '0' : '1',
            remark: r.Remark,
            updatedAt: r.UpdatedAt,
          });
        })()
      );

      const total = (resp as any).TotalCount ?? resp.Total ?? records.length;
      return { total, records };
    } catch (err) {
      throw this.wrapError(err);
    }
  }

  async getRecord(zoneId: string, recordId: string): Promise<DnsRecord> {
    try {
      const zone = await this.getZone(zoneId);
      const resp = await this.request<HuoshanRecord>('GET', 'QueryRecord', { RecordID: recordId });

      const mx = splitMxValue(resp.Type, resp.Value);

      return this.normalizeRecord({
        id: resp.RecordID,
        zoneId: zoneId,
        zoneName: zone.name,
        name: resp.Host || '@',
        type: resp.Type,
        value: mx.value,
        ttl: resp.TTL,
        line: resp.Line || 'default',
        weight: resp.Weight,
        priority: mx.priority,
        status: resp.Enable === false ? '0' : '1',
        remark: resp.Remark,
        updatedAt: resp.UpdatedAt,
      });
    } catch (err) {
      throw this.wrapError(err);
    }
  }

  async createRecord(zoneId: string, params: CreateRecordParams): Promise<DnsRecord> {
    try {
      const value = joinMxValue(params.type, params.value, params.priority);
      const body: Record<string, any> = {
        ZID: parseInt(zoneId, 10),
        Host: params.name === '@' ? '@' : params.name,
        Type: params.type,
        Value: value,
        TTL: params.ttl || 600,
        Line: params.line || 'default',
      };
      if (params.weight !== undefined) body.Weight = params.weight;
      if (params.remark) body.Remark = params.remark;

      const resp = await this.request<{ RecordID: string }>('POST', 'CreateRecord', undefined, body);
      return await this.getRecord(zoneId, resp.RecordID);
    } catch (err) {
      throw this.wrapError(err);
    }
  }

  async updateRecord(zoneId: string, recordId: string, params: UpdateRecordParams): Promise<DnsRecord> {
    try {
      const value = joinMxValue(params.type, params.value, params.priority);
      const body: Record<string, any> = {
        RecordID: recordId,
        Host: params.name === '@' ? '@' : params.name,
        Type: params.type,
        Value: value,
        TTL: params.ttl || 600,
        Line: params.line || 'default',
      };
      if (params.weight !== undefined) body.Weight = params.weight;
      if (params.remark !== undefined) body.Remark = params.remark;

      await this.request('POST', 'UpdateRecord', undefined, body);
      return await this.getRecord(zoneId, recordId);
    } catch (err) {
      throw this.wrapError(err);
    }
  }

  async deleteRecord(_zoneId: string, recordId: string): Promise<boolean> {
    try {
      await this.request('POST', 'DeleteRecord', undefined, { RecordID: recordId });
      return true;
    } catch (err) {
      throw this.wrapError(err);
    }
  }

  async setRecordStatus(_zoneId: string, recordId: string, enabled: boolean): Promise<boolean> {
    try {
      await this.request('POST', 'UpdateRecordStatus', undefined, {
        RecordID: recordId,
        Enable: enabled,
      });
      return true;
    } catch (err) {
      throw this.wrapError(err);
    }
  }

  async getLines(zoneId?: string): Promise<LineListResult> {
    try {
      if (!zoneId) return { lines: HUOSHAN_DEFAULT_LINES };

      const zone = await this.getZone(zoneId);
      const tradeCode = zone.meta?.TradeCode as string | undefined;
      const { level } = getTradeInfo(tradeCode);

      const base = new Map<string, DnsLine>();
      base.set('default', { code: 'default', name: '默认' });

      const resp = await this.request<HuoshanLinesResponse>('GET', 'ListLines');
      for (const row of resp.Lines || []) {
        const code = String(row.Value || '').trim();
        if (!code || code === 'default') continue;
        const rowLevel = typeof row.Level === 'number' ? row.Level : undefined;
        if (rowLevel !== undefined && rowLevel > level) continue;
        base.set(code, {
          code,
          name: String(row.Name || code),
          parentCode: row.FatherValue ? String(row.FatherValue) : undefined,
        });
      }

      // 自定义线路
      try {
        const custom = await this.request<HuoshanCustomLinesResponse>('GET', 'ListCustomLines');
        if ((custom.TotalCount || 0) > 0) {
          base.set('N.customer_lines', { code: 'N.customer_lines', name: '自定义线路' });
          for (const row of custom.CustomerLines || []) {
            const code = String(row.Line || '').trim();
            if (!code) continue;
            const name = String(row.NameCN || row.NameEN || code);
            base.set(code, { code, name, parentCode: 'N.customer_lines' });
          }
        }
      } catch {
        // ignore
      }

      const lines = Array.from(base.values());
      return { lines: lines.length > 0 ? lines : HUOSHAN_DEFAULT_LINES };
    } catch {
      return { lines: HUOSHAN_DEFAULT_LINES };
    }
  }

  async getMinTTL(zoneId?: string): Promise<number> {
    // 根据套餐等级不同，最低 TTL 不同
    // 免费版: 600, 专业版: 300, 企业版: 60, 旗舰版/尊享版: 1
    if (zoneId) {
      try {
        const zone = await this.getZone(zoneId);
        const tradeCode = zone.meta?.TradeCode as string | undefined;
        return getTradeInfo(tradeCode).ttl;
      } catch {
        // ignore
      }
    }
    return 600;
  }

  async addZone(domain: string): Promise<Zone> {
    try {
      const resp = await this.request<{ ZID: number }>('POST', 'CreateZone', undefined, { ZoneName: domain });
      return this.normalizeZone({
        id: String(resp.ZID),
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
      const zid = parseInt(id, 10);
      await this.request('POST', 'DeleteZone', undefined, { ZID: Number.isFinite(zid) ? zid : id });
      return true;
    } catch (err) {
      throw this.wrapError(err);
    }
  }
}
