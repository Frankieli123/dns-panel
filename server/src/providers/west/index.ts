/**
 * West.cn DNS Provider (西部数码)
 * - Base URL: https://api.west.cn/api/v2
 * - Auth: MD5(username + apiPassword + timestamp)
 * - Response encoding: GBK -> UTF-8
 */

import https from 'https';
import crypto from 'crypto';
import * as iconv from 'iconv-lite';
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

interface WestResponse {
  result?: number;
  msg?: string;
  data?: any;
  total?: number;
}

interface WestDomain {
  domain: string;
  domainid?: string;
}

interface WestRecord {
  id: string;
  item: string;
  value: string;
  type: string;
  ttl: number;
  level?: number;
  line?: string;
  pause?: number;
}

export const WEST_CAPABILITIES: ProviderCapabilities = {
  provider: ProviderType.WEST,
  name: '西部数码',

  supportsWeight: false,
  supportsLine: true,
  supportsStatus: true,
  supportsRemark: false,
  supportsUrlForward: false,
  supportsLogs: false,

  remarkMode: 'unsupported',
  paging: 'server',
  requiresDomainId: false,

  recordTypes: ['A', 'AAAA', 'CNAME', 'MX', 'TXT', 'SRV', 'CAA', 'NS'],

  authFields: [
    { name: 'username', label: '用户名', type: 'text', required: true, placeholder: '西部数码用户名' },
    { name: 'apiPassword', label: 'API密码', type: 'password', required: true, placeholder: '西部数码 API 密码' },
  ],

  domainCacheTtl: 300,
  recordCacheTtl: 120,

  retryableErrors: ['SYSTEM_BUSY', 'InternalError'],
  maxRetries: 3,
};

const WEST_LINE_LIST: DnsLine[] = [
  { code: 'default', name: '默认' },
  { code: 'telecom', name: '电信' },
  { code: 'unicom', name: '联通' },
  { code: 'mobile', name: '移动' },
  { code: 'edu', name: '教育网' },
  { code: 'seo', name: '搜索引擎' },
  { code: 'oversea', name: '境外' },
];

const toWestLine = (line?: string): string | undefined => {
  if (!line || line === 'default') return '';
  if (line === 'telecom') return 'LTEL';
  if (line === 'unicom') return 'LCNC';
  if (line === 'mobile') return 'LMOB';
  if (line === 'edu') return 'LEDU';
  if (line === 'seo') return 'LSEO';
  if (line === 'oversea') return 'LFOR';
  return line;
};

const fromWestLine = (line?: string): string | undefined => {
  if (line === undefined || line === null) return undefined;
  const v = String(line);
  if (v === '') return 'default';
  if (v === 'LTEL') return 'telecom';
  if (v === 'LCNC') return 'unicom';
  if (v === 'LMOB') return 'mobile';
  if (v === 'LEDU') return 'edu';
  if (v === 'LSEO') return 'seo';
  if (v === 'LFOR') return 'oversea';
  return v;
};

export class WestProvider extends BaseProvider {
  private readonly host = 'api.west.cn';
  private readonly basePath = '/api/v2';
  private readonly username: string;
  private readonly apiPassword: string;

  constructor(credentials: ProviderCredentials) {
    super(credentials, WEST_CAPABILITIES);
    const { username, apiPassword } = credentials.secrets || {};
    if (!username || !apiPassword) throw this.createError('MISSING_CREDENTIALS', '缺少西部数码用户名/API密码');
    this.username = username;
    this.apiPassword = apiPassword;
  }

  private wrapError(err: unknown, code = 'WEST_ERROR'): DnsProviderError {
    if (err instanceof DnsProviderError) return err;
    const message = (err as any)?.message ? String((err as any).message) : String(err);
    return this.createError(code, message, { cause: err });
  }

  private timeMs(): number {
    return Date.now();
  }

  private token(time: number): string {
    return crypto.createHash('md5').update(`${this.username}${this.apiPassword}${time}`, 'utf8').digest('hex');
  }

  private async request<T = WestResponse>(act: string, params: Record<string, any>): Promise<T> {
    const time = this.timeMs();
    const bodyParams = {
      ...params,
      act,
      username: this.username,
      time,
      token: this.token(time),
    };
    const encoded = Object.entries(bodyParams)
      .filter(([, v]) => v !== undefined && v !== null)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
      .join('&');

    const headers: Record<string, string> = {
      Host: this.host,
      'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8',
      'Content-Length': String(Buffer.byteLength(encoded)),
    };

    return await this.withRetry<T>(
      () =>
        new Promise<T>((resolve, reject) => {
          const req = https.request(
            { hostname: this.host, method: 'POST', path: `${this.basePath}/domain/`, headers },
            res => {
              const chunks: Buffer[] = [];
              res.on('data', d => chunks.push(Buffer.isBuffer(d) ? d : Buffer.from(d)));
              res.on('end', () => {
                const buf = Buffer.concat(chunks);
                // GBK -> UTF-8
                const raw = iconv.decode(buf, 'gbk');
                try {
                  const json = raw ? JSON.parse(raw) : {};
                  // result=200 表示成功
                  if (json.result && json.result !== 200) {
                    reject(
                      this.createError(String(json.result), json.msg || `西部数码错误: ${json.result}`, { meta: json })
                    );
                    return;
                  }
                  resolve(json as T);
                } catch (e) {
                  reject(this.createError('INVALID_RESPONSE', '西部数码返回非 JSON 响应', { meta: { raw }, cause: e }));
                }
              });
            }
          );
          req.on('error', e => reject(this.createError('NETWORK_ERROR', '西部数码请求失败', { cause: e })));
          req.write(encoded);
          req.end();
        })
    );
  }

  async checkAuth(): Promise<boolean> {
    try {
      await this.request('getdomains', { page: 1, limit: 1 });
      return true;
    } catch {
      return false;
    }
  }

  async getZones(page?: number, pageSize?: number, keyword?: string): Promise<ZoneListResult> {
    try {
      const params: Record<string, any> = {
        page: page || 1,
        limit: pageSize || 20,
      };
      if (keyword) params.domain = keyword;

      const resp = await this.request<WestResponse>('getdomains', params);
      const list: WestDomain[] = resp.data?.items || resp.data || [];
      const total = resp.total || resp.data?.total || list.length;

      const zones: Zone[] = list.map(d =>
        this.normalizeZone({
          id: d.domain,
          name: d.domain,
          status: 'active',
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
      const query: Record<string, any> = {
        domain: zoneId,
        pageno: params?.page || 1,
        limit: params?.pageSize || 20,
      };
      if (params?.subDomain) query.host = params.subDomain;
      if (params?.keyword && !params?.subDomain) query.host = params.keyword;
      if (params?.type) query.type = params.type;
      if (params?.value) query.value = params.value;
      if (params?.line) query.line = toWestLine(params.line);

      const resp = await this.request<WestResponse>('getdnsrecord', query);
      const list: WestRecord[] = resp.data?.items || resp.data || [];
      const total = resp.total || resp.data?.total || list.length;

      const records: DnsRecord[] = list.map(r =>
        this.normalizeRecord({
          id: r.id,
          zoneId: zoneId,
          zoneName: zoneId,
          name: r.item || '@',
          type: r.type,
          value: r.value,
          ttl: r.ttl || 600,
          priority: r.level,
          line: fromWestLine(r.line),
          status: r.pause === 1 ? '0' : '1',
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
      const body: Record<string, any> = {
        domain: zoneId,
        host: params.name === '@' ? '@' : params.name,
        type: params.type,
        value: params.value,
        ttl: params.ttl || 600,
      };
      if (params.priority !== undefined) body.level = params.priority;
      if (params.line !== undefined) body.line = toWestLine(params.line);

      const resp = await this.request<WestResponse>('adddnsrecord', body);
      const recordId = resp.data?.id;
      if (!recordId) throw this.createError('CREATE_FAILED', '创建记录失败');

      return await this.getRecord(zoneId, recordId);
    } catch (err) {
      throw this.wrapError(err);
    }
  }

  async updateRecord(zoneId: string, recordId: string, params: UpdateRecordParams): Promise<DnsRecord> {
    try {
      const body: Record<string, any> = {
        domain: zoneId,
        id: recordId,
        host: params.name === '@' ? '@' : params.name,
        type: params.type,
        value: params.value,
        ttl: params.ttl || 600,
      };
      if (params.priority !== undefined) body.level = params.priority;
      if (params.line !== undefined) body.line = toWestLine(params.line);

      await this.request('moddnsrecord', body);
      return await this.getRecord(zoneId, recordId);
    } catch (err) {
      throw this.wrapError(err);
    }
  }

  async deleteRecord(zoneId: string, recordId: string): Promise<boolean> {
    try {
      await this.request('deldnsrecord', { domain: zoneId, id: recordId });
      return true;
    } catch (err) {
      throw this.wrapError(err);
    }
  }

  async setRecordStatus(zoneId: string, recordId: string, enabled: boolean): Promise<boolean> {
    try {
      // val=1 表示暂停，val=0 表示启用
      await this.request('pause', {
        domain: zoneId,
        id: recordId,
        val: enabled ? 0 : 1,
      });
      return true;
    } catch (err) {
      throw this.wrapError(err);
    }
  }

  async getLines(_zoneId?: string): Promise<LineListResult> {
    return { lines: WEST_LINE_LIST };
  }

  async getMinTTL(_zoneId?: string): Promise<number> {
    return 600;
  }
}
