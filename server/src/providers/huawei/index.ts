/**
 * Huawei Cloud DNS Provider (华为云)
 * - Endpoint: dns.myhuaweicloud.com
 * - Auth: SDK-HMAC-SHA256 签名
 * - Requires zone_id for record operations
 */

import https from 'https';
import fs from 'fs';
import path from 'path';
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
import { buildHuaweiHeaders, HuaweiCredentials } from './auth';

interface HuaweiZone {
  id: string;
  name: string;
  status?: string;
  record_num?: number;
  updated_at?: string;
}

interface HuaweiZonesResponse {
  zones?: HuaweiZone[];
  metadata?: { total_count?: number };
}

interface HuaweiRecordSet {
  id: string;
  name: string;
  type: string;
  records: string[];
  ttl: number;
  line?: string;
  weight?: number;
  status?: string;
  description?: string;
}

interface HuaweiRecordSetsResponse {
  recordsets?: HuaweiRecordSet[];
  metadata?: { total_count?: number };
}

// 华为云线路数据文件路径
const HUAWEI_LINES_FILE = path.join(__dirname, 'data', 'huawei_line.json');

// 线路数据缓存
let huaweiLinesCache: DnsLine[] | null = null;

function rfc3986Encode(input: string): string {
  return encodeURIComponent(input).replace(/[!'()*]/g, ch => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`);
}

/**
 * 从JSON文件加载华为云线路数据
 */
function loadHuaweiLines(): DnsLine[] {
  if (huaweiLinesCache) {
    return huaweiLinesCache;
  }

  try {
    const fileContent = fs.readFileSync(HUAWEI_LINES_FILE, 'utf-8');
    const jsonData: Record<string, { name: string; parent: string | null }> = JSON.parse(fileContent);

    // 转换为 DnsLine[] 格式
    const lines: DnsLine[] = [];
    for (const [code, data] of Object.entries(jsonData)) {
      lines.push({
        code,
        name: data.name,
        parentCode: data.parent || undefined,
      });
    }

    // 按代码排序，确保默认线路在前
    lines.sort((a, b) => {
      if (a.code === 'default_view') return -1;
      if (b.code === 'default_view') return 1;
      return a.code.localeCompare(b.code);
    });

    huaweiLinesCache = lines;
    return lines;
  } catch (error) {
    // 如果文件读取失败，返回默认的6个基本线路作为降级方案
    console.warn('Failed to load huawei_line.json, using fallback lines:', error);
    return [
      { code: 'default_view', name: '默认' },
      { code: 'Dianxin', name: '电信' },
      { code: 'Liantong', name: '联通' },
      { code: 'Yidong', name: '移动' },
      { code: 'Jiaoyuwang', name: '教育网' },
      { code: 'Abroad', name: '海外' },
    ];
  }
}

export const HUAWEI_CAPABILITIES: ProviderCapabilities = {
  provider: ProviderType.HUAWEI,
  name: '华为云 DNS',

  supportsWeight: true,
  supportsLine: true,
  supportsStatus: true,
  supportsRemark: true,
  supportsUrlForward: false,
  supportsLogs: false,

  remarkMode: 'inline',
  paging: 'server',
  requiresDomainId: true,

  recordTypes: ['A', 'AAAA', 'CNAME', 'MX', 'TXT', 'SRV', 'CAA', 'NS', 'PTR'],

  authFields: [
    { name: 'accessKeyId', label: 'AccessKey ID', type: 'text', required: true, placeholder: '华为云 AccessKey ID' },
    { name: 'secretAccessKey', label: 'SecretAccessKey', type: 'password', required: true, placeholder: '华为云 SecretAccessKey' },
  ],

  domainCacheTtl: 300,
  recordCacheTtl: 120,

  retryableErrors: ['SYSTEM_BUSY', 'InternalError', 'TIMEOUT'],
  maxRetries: 3,
};

export class HuaweiProvider extends BaseProvider {
  private readonly host = 'dns.myhuaweicloud.com';
  private readonly creds: HuaweiCredentials;

  constructor(credentials: ProviderCredentials) {
    super(credentials, HUAWEI_CAPABILITIES);
    const { accessKeyId, secretAccessKey } = credentials.secrets || {};
    if (!accessKeyId || !secretAccessKey) throw this.createError('MISSING_CREDENTIALS', '缺少华为云 AccessKey');
    this.creds = { accessKeyId, secretAccessKey };
  }

  private wrapError(err: unknown, code = 'HUAWEI_ERROR'): DnsProviderError {
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

    const headers = buildHuaweiHeaders(this.creds, {
      method,
      host: this.host,
      path,
      query: queryParams,
      body: payload,
      headers: contentType ? { 'Content-Type': contentType } : undefined,
    });

    if (payload) headers['Content-Length'] = String(Buffer.byteLength(payload));

    const qs = Object.entries(queryParams)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([k, v]) => `${rfc3986Encode(k)}=${rfc3986Encode(v)}`)
      .join('&');
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
                  const errCode = json.error_code || json.code || String(res.statusCode);
                  const errMsg = json.error_msg || json.message || `华为云错误: ${res.statusCode}`;
                  reject(this.createError(errCode, errMsg, { httpStatus: res.statusCode, meta: json }));
                  return;
                }
                resolve(json as T);
              } catch (e) {
                reject(this.createError('INVALID_RESPONSE', '华为云返回非 JSON 响应', { meta: { raw }, cause: e }));
              }
            });
          });
          req.on('error', e => reject(this.createError('NETWORK_ERROR', '华为云请求失败', { cause: e })));
          if (payload) req.write(payload);
          req.end();
        })
    );
  }

  private ensureTrailingDot(name: string): string {
    return name.endsWith('.') ? name : `${name}.`;
  }

  private removeTrailingDot(name: string): string {
    return name.endsWith('.') ? name.slice(0, -1) : name;
  }

  private toLine(line?: string): string {
    if (!line || line === 'default') return 'default_view';
    return line;
  }

  private fromLine(line?: string): string {
    if (!line || line === 'default_view') return 'default';
    return line;
  }

  async checkAuth(): Promise<boolean> {
    try {
      await this.request<HuaweiZonesResponse>('GET', '/v2/zones', { limit: 1 });
      return true;
    } catch {
      return false;
    }
  }

  async getZones(page?: number, pageSize?: number, keyword?: string): Promise<ZoneListResult> {
    try {
      const limit = pageSize || 20;
      const offset = ((page || 1) - 1) * limit;
      const query: Record<string, any> = { limit, offset, zone_type: 'public' };
      if (keyword) query.name = keyword;

      const resp = await this.request<HuaweiZonesResponse>('GET', '/v2/zones', query);
      const zones: Zone[] = (resp.zones || []).map(z =>
        this.normalizeZone({
          id: z.id,
          name: this.removeTrailingDot(z.name),
          status: z.status || 'active',
          recordCount: z.record_num,
          updatedAt: z.updated_at,
        })
      );

      return { total: resp.metadata?.total_count || zones.length, zones };
    } catch (err) {
      throw this.wrapError(err);
    }
  }

  async getZone(zoneId: string): Promise<Zone> {
    try {
      const z = await this.request<HuaweiZone>('GET', `/v2/zones/${zoneId}`);
      return this.normalizeZone({
        id: z.id,
        name: this.removeTrailingDot(z.name),
        status: z.status || 'active',
        recordCount: z.record_num,
        updatedAt: z.updated_at,
      });
    } catch (err) {
      throw this.wrapError(err);
    }
  }

  async getRecords(zoneId: string, params?: RecordQueryParams): Promise<RecordListResult> {
    try {
      const zone = await this.getZone(zoneId);
      const limit = params?.pageSize || 20;
      const offset = ((params?.page || 1) - 1) * limit;

      const query: Record<string, any> = { limit, offset };
      if (params?.type) query.type = params.type;
      if (params?.keyword) query.name = params.keyword;
      if (params?.subDomain) {
        const rr = params.subDomain === '@' ? zone.name : `${params.subDomain}.${zone.name}`;
        query.name = this.ensureTrailingDot(rr);
        query.search_mode = 'equal';
      }
      if (params?.line) query.line_id = this.toLine(params.line);
      if (params?.status) query.status = params.status === '1' ? 'ACTIVE' : 'DISABLE';

      const resp = await this.request<HuaweiRecordSetsResponse>('GET', `/v2.1/zones/${zoneId}/recordsets`, query);

      const records: DnsRecord[] = [];
      for (const rs of resp.recordsets || []) {
        if (rs.type === 'SOA' || rs.type === 'NS') continue;

        rs.records.forEach((value, idx) => {
          let priority: number | undefined;
          let actualValue = value;

          // MX 记录格式: "priority value"
          if (rs.type === 'MX') {
            const parts = value.split(/\s+/);
            if (parts.length >= 2) {
              priority = parseInt(parts[0], 10);
              actualValue = parts.slice(1).join(' ');
            }
          }

          // TXT 记录去引号
          if (rs.type === 'TXT' && actualValue.startsWith('"') && actualValue.endsWith('"')) {
            actualValue = actualValue.slice(1, -1);
          }

          records.push(
            this.normalizeRecord({
              id: rs.records.length > 1 ? `${rs.id}|${idx}` : rs.id,
              zoneId: zoneId,
              zoneName: zone.name,
              name: this.removeTrailingDot(rs.name),
              type: rs.type,
              value: actualValue,
              ttl: rs.ttl,
              line: this.fromLine(rs.line),
              weight: rs.weight,
              priority,
              status: rs.status === 'DISABLE' ? '0' : '1',
              remark: rs.description,
            })
          );
        });
      }

      return { total: resp.metadata?.total_count || records.length, records };
    } catch (err) {
      throw this.wrapError(err);
    }
  }

  async getRecord(zoneId: string, recordId: string): Promise<DnsRecord> {
    try {
      const actualId = recordId.includes('|') ? recordId.split('|')[0] : recordId;
      const zone = await this.getZone(zoneId);
      const rs = await this.request<HuaweiRecordSet>('GET', `/v2.1/zones/${zoneId}/recordsets/${actualId}`);

      const idx = recordId.includes('|') ? parseInt(recordId.split('|')[1], 10) : 0;
      const value = rs.records[idx] || rs.records[0];

      let priority: number | undefined;
      let actualValue = value;

      if (rs.type === 'MX') {
        const parts = value.split(/\s+/);
        if (parts.length >= 2) {
          priority = parseInt(parts[0], 10);
          actualValue = parts.slice(1).join(' ');
        }
      }

      if (rs.type === 'TXT' && actualValue.startsWith('"') && actualValue.endsWith('"')) {
        actualValue = actualValue.slice(1, -1);
      }

      return this.normalizeRecord({
        id: recordId,
        zoneId: zoneId,
        zoneName: zone.name,
        name: this.removeTrailingDot(rs.name),
        type: rs.type,
        value: actualValue,
        ttl: rs.ttl,
        line: this.fromLine(rs.line),
        weight: rs.weight,
        priority,
        status: rs.status === 'DISABLE' ? '0' : '1',
        remark: rs.description,
      });
    } catch (err) {
      throw this.wrapError(err);
    }
  }

  async createRecord(zoneId: string, params: CreateRecordParams): Promise<DnsRecord> {
    try {
      const zone = await this.getZone(zoneId);
      const name = params.name === '@' ? zone.name : `${params.name}.${zone.name}`;

      let value = params.value;
      if (params.type === 'TXT' && !value.startsWith('"')) {
        value = `"${value}"`;
      }
      if (params.type === 'MX' && params.priority !== undefined) {
        value = `${params.priority} ${value}`;
      }
      if ((params.type === 'CNAME' || params.type === 'MX' || params.type === 'NS') && !value.endsWith('.')) {
        value = `${value}.`;
      }

      const body: Record<string, any> = {
        name: this.ensureTrailingDot(name),
        type: params.type,
        records: [value],
        ttl: params.ttl || 300,
      };
      if (params.line) body.line = this.toLine(params.line);
      if (params.weight !== undefined) body.weight = params.weight;
      if (params.remark) body.description = params.remark;

      const rs = await this.request<HuaweiRecordSet>('POST', `/v2.1/zones/${zoneId}/recordsets`, undefined, body);
      return await this.getRecord(zoneId, rs.id);
    } catch (err) {
      throw this.wrapError(err);
    }
  }

  async updateRecord(zoneId: string, recordId: string, params: UpdateRecordParams): Promise<DnsRecord> {
    try {
      const actualId = recordId.includes('|') ? recordId.split('|')[0] : recordId;
      const zone = await this.getZone(zoneId);
      const name = params.name === '@' ? zone.name : `${params.name}.${zone.name}`;

      let value = params.value;
      if (params.type === 'TXT' && !value.startsWith('"')) {
        value = `"${value}"`;
      }
      if (params.type === 'MX' && params.priority !== undefined) {
        value = `${params.priority} ${value}`;
      }
      if ((params.type === 'CNAME' || params.type === 'MX' || params.type === 'NS') && !value.endsWith('.')) {
        value = `${value}.`;
      }

      const body: Record<string, any> = {
        name: this.ensureTrailingDot(name),
        type: params.type,
        records: [value],
        ttl: params.ttl || 300,
      };
      if (params.line) body.line = this.toLine(params.line);
      if (params.weight !== undefined) body.weight = params.weight;
      if (params.remark !== undefined) body.description = params.remark;

      await this.request<HuaweiRecordSet>('PUT', `/v2.1/zones/${zoneId}/recordsets/${actualId}`, undefined, body);
      return await this.getRecord(zoneId, recordId);
    } catch (err) {
      throw this.wrapError(err);
    }
  }

  async deleteRecord(zoneId: string, recordId: string): Promise<boolean> {
    try {
      const actualId = recordId.includes('|') ? recordId.split('|')[0] : recordId;
      await this.request('DELETE', `/v2.1/zones/${zoneId}/recordsets/${actualId}`);
      return true;
    } catch (err) {
      throw this.wrapError(err);
    }
  }

  async setRecordStatus(zoneId: string, recordId: string, enabled: boolean): Promise<boolean> {
    try {
      const actualId = recordId.includes('|') ? recordId.split('|')[0] : recordId;
      await this.request('PUT', `/v2.1/recordsets/${actualId}/statuses/set`, undefined, {
        status: enabled ? 'ENABLE' : 'DISABLE',
      });
      return true;
    } catch (err) {
      throw this.wrapError(err);
    }
  }

  async getLines(_zoneId?: string): Promise<LineListResult> {
    const lines = loadHuaweiLines();
    return { lines };
  }

  async getMinTTL(_zoneId?: string): Promise<number> {
    return 300;
  }

  async addZone(domain: string): Promise<Zone> {
    try {
      const body = {
        name: this.ensureTrailingDot(domain),
        zone_type: 'public',
      };
      const z = await this.request<HuaweiZone>('POST', '/v2/zones', undefined, body);
      return this.normalizeZone({
        id: z.id,
        name: this.removeTrailingDot(z.name),
        status: z.status || 'active',
      });
    } catch (err) {
      throw this.wrapError(err);
    }
  }
}
