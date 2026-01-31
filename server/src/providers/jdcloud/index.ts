/**
 * JDCloud DNS Provider (京东云)
 * - Endpoint: domainservice.jdcloud-api.com
 * - Service: domainservice, Region: cn-north-1
 * - Auth: JDCLOUD2-HMAC-SHA256 签名
 * - Requires domainId for record operations
 * - pageSize max 99
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
import { buildJdcloudHeaders, JdcloudCredentials } from './auth';

function rfc3986Encode(input: string): string {
  return encodeURIComponent(input).replace(/[!'()*]/g, ch => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`);
}

interface JdcloudDomain {
  id: number;
  domainName: string;
  createTime?: string;
  expirationDate?: string;
  packId?: number;
}

interface JdcloudDomainsResponse {
  result?: {
    dataList?: JdcloudDomain[];
    totalCount?: number;
    totalPage?: number;
    currentCount?: number;
  };
}

interface JdcloudRecord {
  id: number;
  hostRecord: string;
  hostValue: string;
  recordType?: string;
  type?: string;
  ttl: number;
  viewValue?: number[];
  weight?: number;
  mxPriority?: number;
  port?: number;
  viewName?: string;
}

interface JdcloudRecordsResponse {
  result?: {
    dataList?: JdcloudRecord[];
    totalCount?: number;
    totalPage?: number;
    currentCount?: number;
  };
}

interface JdcloudViewTree {
  label: string;
  value: number;
  children?: JdcloudViewTree[];
}

interface JdcloudViewResponse {
  result?: {
    data?: JdcloudViewTree[];
  };
}

// 默认线路
const JDCLOUD_DEFAULT_LINES: DnsLine[] = [
  { code: 'default', name: '默认' },
  { code: '1', name: '电信' },
  { code: '2', name: '联通' },
  { code: '3', name: '移动' },
  { code: '4', name: '教育网' },
  { code: '5', name: '海外' },
];

const toJdcloudRecordType = (type: string): string => {
  if (type === 'REDIRECT_URL') return 'EXPLICIT_URL';
  if (type === 'FORWARD_URL') return 'IMPLICIT_URL';
  return type;
};

const fromJdcloudRecordType = (type: string): string => {
  if (type === 'EXPLICIT_URL') return 'REDIRECT_URL';
  if (type === 'IMPLICIT_URL') return 'FORWARD_URL';
  return type;
};

export const JDCLOUD_CAPABILITIES: ProviderCapabilities = {
  provider: ProviderType.JDCLOUD,
  name: '京东云 DNS',

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
    { name: 'accessKeyId', label: 'AccessKey ID', type: 'text', required: true, placeholder: '京东云 AccessKey ID' },
    { name: 'accessKeySecret', label: 'AccessKey Secret', type: 'password', required: true, placeholder: '京东云 AccessKey Secret' },
  ],

  domainCacheTtl: 300,
  recordCacheTtl: 120,

  retryableErrors: ['SYSTEM_BUSY', 'InternalError', 'TIMEOUT'],
  maxRetries: 3,
};

export class JdcloudProvider extends BaseProvider {
  private readonly host = 'domainservice.jdcloud-api.com';
  private readonly service = 'domainservice';
  private readonly region = 'cn-north-1';
  private readonly creds: JdcloudCredentials;

  constructor(credentials: ProviderCredentials) {
    super(credentials, JDCLOUD_CAPABILITIES);
    const { accessKeyId, accessKeySecret } = credentials.secrets || {};
    if (!accessKeyId || !accessKeySecret) throw this.createError('MISSING_CREDENTIALS', '缺少京东云 AccessKey');
    this.creds = { accessKeyId, accessKeySecret };
  }

  private wrapError(err: unknown, code = 'JDCLOUD_ERROR'): DnsProviderError {
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

    const headers = buildJdcloudHeaders(this.creds, {
      method,
      host: this.host,
      service: this.service,
      region: this.region,
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
                if (json.error) {
                  reject(this.createError(json.error.code || 'ERROR', json.error.message || '京东云错误', { meta: json }));
                  return;
                }
                if (res.statusCode && res.statusCode >= 400) {
                  reject(this.createError(String(res.statusCode), `京东云错误: ${res.statusCode}`, { httpStatus: res.statusCode, meta: json }));
                  return;
                }
                resolve(json as T);
              } catch (e) {
                reject(this.createError('INVALID_RESPONSE', '京东云返回非 JSON 响应', { meta: { raw }, cause: e }));
              }
            });
          });
          req.on('error', e => reject(this.createError('NETWORK_ERROR', '京东云请求失败', { cause: e })));
          if (payload) req.write(payload);
          req.end();
        })
    );
  }

  async checkAuth(): Promise<boolean> {
    try {
      await this.request<JdcloudDomainsResponse>('GET', `/v2/regions/${this.region}/domain`, { pageNumber: 1, pageSize: 1 });
      return true;
    } catch {
      return false;
    }
  }

  async getZones(page?: number, pageSize?: number, keyword?: string): Promise<ZoneListResult> {
    try {
      const query: Record<string, any> = {
        pageNumber: page || 1,
        pageSize: Math.min(pageSize || 20, 99),
      };
      if (keyword) query.domainName = keyword;

      const resp = await this.request<JdcloudDomainsResponse>('GET', `/v2/regions/${this.region}/domain`, query);
      const zones: Zone[] = (resp.result?.dataList || []).map(d =>
        this.normalizeZone({
          id: String(d.id),
          name: d.domainName,
          status: 'active',
          meta: { packId: d.packId },
        })
      );

      return { total: resp.result?.totalCount || zones.length, zones };
    } catch (err) {
      throw this.wrapError(err);
    }
  }

  async getZone(zoneId: string): Promise<Zone> {
    try {
      // 京东云没有单独获取域名的 API，通过列表查找
      let page = 1;
      while (page <= 50) {
        const resp = await this.request<JdcloudDomainsResponse>('GET', `/v2/regions/${this.region}/domain`, { pageNumber: page, pageSize: 99 });
        const found = (resp.result?.dataList || []).find(d => String(d.id) === zoneId);
        if (found) {
          return this.normalizeZone({
            id: String(found.id),
            name: found.domainName,
            status: 'active',
            meta: { packId: found.packId },
          });
        }
        if ((page * 99) >= (resp.result?.totalCount || 0)) break;
        page++;
      }
      throw this.createError('NOT_FOUND', `域名不存在: ${zoneId}`, { httpStatus: 404 });
    } catch (err) {
      throw this.wrapError(err);
    }
  }

  async getRecords(zoneId: string, params?: RecordQueryParams): Promise<RecordListResult> {
    try {
      const zone = await this.getZone(zoneId);
      const query: Record<string, any> = {
        pageNumber: params?.page || 1,
        pageSize: Math.min(params?.pageSize || 20, 99),
      };
      if (params?.keyword) query.hostRecord = params.keyword;
      if (params?.type) {
        const mappedType = toJdcloudRecordType(params.type);
        query.recordType = mappedType;
        query.type = mappedType;
      }
      if (params?.value) query.hostValue = params.value;

      const resp = await this.request<JdcloudRecordsResponse>('GET', `/v2/regions/${this.region}/domain/${zoneId}/ResourceRecord`, query);

      const records: DnsRecord[] = (resp.result?.dataList || []).map(r => {
        // viewValue 数组的最后一个值作为线路标识
        const lineCode = r.viewValue && r.viewValue.length > 0 ? String(r.viewValue[r.viewValue.length - 1]) : 'default';
        const recordTypeRaw = (r as any).recordType ?? (r as any).type;
        return this.normalizeRecord({
          id: String(r.id),
          zoneId: zoneId,
          zoneName: zone.name,
          name: r.hostRecord || '@',
          type: fromJdcloudRecordType(String(recordTypeRaw || '')),
          value: r.hostValue,
          ttl: r.ttl,
          line: lineCode,
          weight: r.weight,
          priority: r.mxPriority,
        });
      });

      return { total: resp.result?.totalCount || records.length, records };
    } catch (err) {
      throw this.wrapError(err);
    }
  }

  async getRecord(zoneId: string, recordId: string): Promise<DnsRecord> {
    try {
      // 通过列表查找
      const result = await this.getRecords(zoneId, { pageSize: 99 });
      const record = result.records.find(r => r.id === recordId);
      if (!record) throw this.createError('NOT_FOUND', `记录不存在: ${recordId}`, { httpStatus: 404 });
      return record;
    } catch (err) {
      throw this.wrapError(err);
    }
  }

  async createRecord(zoneId: string, params: CreateRecordParams): Promise<DnsRecord> {
    try {
      const mappedType = toJdcloudRecordType(params.type);
      const body: Record<string, any> = {
        hostRecord: params.name === '@' ? '@' : params.name,
        hostValue: params.value,
        recordType: mappedType,
        type: mappedType,
        ttl: params.ttl || 600,
        viewValue: params.line && params.line !== 'default' ? [parseInt(params.line, 10)] : [-1],
      };
      if (params.weight !== undefined) body.weight = params.weight;
      if (params.priority !== undefined && (params.type === 'MX' || params.type === 'SRV')) {
        body.mxPriority = params.priority;
      }

      const resp = await this.request<{ result?: { dataList?: { id: number }[] } }>('POST', `/v2/regions/${this.region}/domain/${zoneId}/ResourceRecord`, undefined, body);
      const newId = resp.result?.dataList?.[0]?.id;
      if (!newId) throw this.createError('CREATE_FAILED', '创建记录失败');
      return await this.getRecord(zoneId, String(newId));
    } catch (err) {
      throw this.wrapError(err);
    }
  }

  async updateRecord(zoneId: string, recordId: string, params: UpdateRecordParams): Promise<DnsRecord> {
    try {
      const mappedType = toJdcloudRecordType(params.type);
      const body: Record<string, any> = {
        hostRecord: params.name === '@' ? '@' : params.name,
        hostValue: params.value,
        recordType: mappedType,
        type: mappedType,
        ttl: params.ttl || 600,
        viewValue: params.line && params.line !== 'default' ? [parseInt(params.line, 10)] : [-1],
      };
      if (params.weight !== undefined) body.weight = params.weight;
      if (params.priority !== undefined && (params.type === 'MX' || params.type === 'SRV')) {
        body.mxPriority = params.priority;
      }

      await this.request('PUT', `/v2/regions/${this.region}/domain/${zoneId}/ResourceRecord/${recordId}`, undefined, body);
      return await this.getRecord(zoneId, recordId);
    } catch (err) {
      throw this.wrapError(err);
    }
  }

  async deleteRecord(zoneId: string, recordId: string): Promise<boolean> {
    try {
      await this.request('DELETE', `/v2/regions/${this.region}/domain/${zoneId}/ResourceRecord/${recordId}`);
      return true;
    } catch (err) {
      throw this.wrapError(err);
    }
  }

  async setRecordStatus(zoneId: string, recordId: string, enabled: boolean): Promise<boolean> {
    try {
      await this.request('PUT', `/v2/regions/${this.region}/domain/${zoneId}/ResourceRecord/${recordId}/status`, undefined, {
        action: enabled ? 'enable' : 'disable',
      });
      return true;
    } catch (err) {
      throw this.wrapError(err);
    }
  }

  async getLines(zoneId?: string): Promise<LineListResult> {
    try {
      if (!zoneId) return { lines: JDCLOUD_DEFAULT_LINES };

      const zone = await this.getZone(zoneId);
      const packId = zone.meta?.packId as number | undefined;
      if (!packId) return { lines: JDCLOUD_DEFAULT_LINES };

      const resp = await this.request<JdcloudViewResponse>('GET', `/v2/regions/${this.region}/domain/${zoneId}/viewTree`, { packId });

      const flattenTree = (nodes: JdcloudViewTree[], parent?: string): DnsLine[] => {
        const result: DnsLine[] = [];
        for (const node of nodes) {
          result.push({ code: String(node.value), name: node.label, parentCode: parent });
          if (node.children && node.children.length > 0) {
            result.push(...flattenTree(node.children, String(node.value)));
          }
        }
        return result;
      };

      const lines = flattenTree(resp.result?.data || []);
      return { lines: lines.length > 0 ? lines : JDCLOUD_DEFAULT_LINES };
    } catch {
      return { lines: JDCLOUD_DEFAULT_LINES };
    }
  }

  async getMinTTL(_zoneId?: string): Promise<number> {
    return 600;
  }

  async addZone(domain: string): Promise<Zone> {
    const name = String(domain || '').trim();
    if (!name) {
      throw this.createError('INVALID_DOMAIN', '域名不能为空', { httpStatus: 400 });
    }

    try {
      const resp = await this.request<{ result?: { data?: { id: number; domainName?: string; packId?: number } } }>(
        'POST',
        `/v2/regions/${this.region}/domain`,
        undefined,
        { packId: 0, domainName: name }
      );
      const id = resp.result?.data?.id;
      if (!id) throw this.createError('CREATE_FAILED', '添加域名失败');
      return this.normalizeZone({
        id: String(id),
        name: resp.result?.data?.domainName || name,
        status: 'active',
        meta: { packId: resp.result?.data?.packId ?? 0 },
      });
    } catch (err) {
      // 若可能已存在，尝试直接查询并返回
      try {
        const list = await this.getZones(1, 99, name);
        const found = list.zones.find(z => z.name.toLowerCase() === name.toLowerCase());
        if (found) {
          return { ...found, meta: { ...(found.meta || {}), existed: true } };
        }
      } catch {
        // ignore
      }
      throw this.wrapError(err);
    }
  }

  async deleteZone(zoneId: string): Promise<boolean> {
    const id = String(zoneId || '').trim();
    if (!id) {
      throw this.createError('INVALID_ZONE_ID', 'Zone ID 不能为空', { httpStatus: 400 });
    }

    try {
      await this.request('DELETE', `/v2/regions/${this.region}/domain/${id}`);
      return true;
    } catch (err) {
      throw this.wrapError(err);
    }
  }
}
