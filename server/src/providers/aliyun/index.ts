/**
 * 阿里云 DNS Provider (AliDNS)
 * - Endpoint: alidns.aliyuncs.com
 * - Version: 2015-01-09
 * - Auth: HMAC-SHA1 签名
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
import { buildCanonicalizedQuery, buildSignedQuery } from './auth';
import { fromAliyunLine, getDefaultLines, toAliyunLine } from './lines';

// ========== 阿里云 API 响应类型 ==========

interface AliyunErrorResponse {
  Code?: string;
  Message?: string;
  RequestId?: string;
}

interface AliyunDomain {
  DomainId: string;
  DomainName: string;
  RecordCount?: number;
  Status?: string;
  UpdateTime?: string;
}

interface AliyunDescribeDomainsResponse extends AliyunErrorResponse {
  TotalCount?: number;
  Domains?: { Domain?: AliyunDomain[] };
}

interface AliyunRecord {
  RecordId: string;
  RR: string;
  Type: string;
  Value: string;
  TTL: number;
  Line?: string;
  Status?: string;
  Priority?: number;
  Weight?: number;
  UpdateTimestamp?: number;
  Remark?: string;
}

interface AliyunDescribeDomainRecordsResponse extends AliyunErrorResponse {
  TotalCount?: number;
  DomainRecords?: { Record?: AliyunRecord[] };
}

interface AliyunDescribeDomainRecordInfoResponse extends AliyunErrorResponse, AliyunRecord {}

interface AliyunAddDomainRecordResponse extends AliyunErrorResponse {
  RecordId?: string;
}

interface AliyunAddDomainResponse extends AliyunErrorResponse {
  DomainId?: string;
  DomainName?: string;
  DnsServers?: { DnsServer?: string[] };
}

interface AliyunDescribeDomainInfoResponse extends AliyunErrorResponse {
  DomainId?: string;
  DomainName?: string;
  DnsServers?: { DnsServer?: string[] };
  RecordLines?: {
    RecordLine?: Array<
      | string
      | {
          LineCode?: string;
          LineName?: string;
          LineDisplayName?: string;
          FatherCode?: string;
          FatherName?: string;
          FatherDisplayName?: string;
        }
    >;
  };
  MinTtl?: number;
}

// ========== 能力配置 ==========

export const ALIYUN_CAPABILITIES: ProviderCapabilities = {
  provider: ProviderType.ALIYUN,
  name: '阿里云 DNS',

  supportsWeight: false,
  supportsLine: true,
  supportsStatus: true,
  supportsRemark: true,
  supportsUrlForward: false,
  supportsLogs: true,

  remarkMode: 'separate',
  paging: 'server',
  requiresDomainId: false,

  recordTypes: ['A', 'AAAA', 'CNAME', 'MX', 'TXT', 'SRV', 'CAA', 'NS', 'PTR'],

  authFields: [
    {
      name: 'accessKeyId',
      label: 'AccessKey ID',
      type: 'text',
      required: true,
      placeholder: '输入 AccessKey ID',
      helpText: '在阿里云控制台获取',
    },
    {
      name: 'accessKeySecret',
      label: 'AccessKey Secret',
      type: 'password',
      required: true,
      placeholder: '输入 AccessKey Secret',
    },
  ],

  domainCacheTtl: 300,
  recordCacheTtl: 120,

  retryableErrors: ['Throttling', 'ServiceUnavailable', 'InternalError', 'RequestTimeout'],
  maxRetries: 3,
};

// ========== Provider 实现 ==========

export class AliyunProvider extends BaseProvider {
  private readonly endpoint = 'alidns.aliyuncs.com';
  private readonly accessKeyId: string;
  private readonly accessKeySecret: string;

  // 域名 ID/名称 缓存
  private readonly domainIdToName = new Map<string, string>();
  private readonly domainNameToId = new Map<string, string>();

  constructor(credentials: ProviderCredentials) {
    super(credentials, ALIYUN_CAPABILITIES);

    const { accessKeyId, accessKeySecret } = credentials.secrets || {};
    if (!accessKeyId || !accessKeySecret) {
      throw this.createError('MISSING_CREDENTIALS', '缺少阿里云 AccessKey');
    }

    this.accessKeyId = accessKeyId;
    this.accessKeySecret = accessKeySecret;
  }

  private wrapError(err: unknown, code = 'ALIYUN_ERROR'): DnsProviderError {
    if (err instanceof DnsProviderError) return err;
    const message = (err as any)?.message ? String((err as any).message) : String(err);
    return this.createError(code, message, { cause: err });
  }

  /**
   * 发送 API 请求
   */
  private async request<T extends AliyunErrorResponse>(
    action: string,
    extraParams: Record<string, string | number | undefined>
  ): Promise<T> {
    const params = buildSignedQuery(
      { accessKeyId: this.accessKeyId, accessKeySecret: this.accessKeySecret },
      action,
      extraParams
    );
    const query = buildCanonicalizedQuery(params);
    const url = `https://${this.endpoint}/?${query}`;

    return await this.withRetry<T>(() =>
      new Promise<T>((resolve, reject) => {
        const req = https.request(url, { method: 'GET' }, res => {
          const chunks: Buffer[] = [];
          res.on('data', d => chunks.push(Buffer.isBuffer(d) ? d : Buffer.from(d)));
          res.on('end', () => {
            const raw = Buffer.concat(chunks).toString('utf8');
            let json: any;

            try {
              json = raw ? JSON.parse(raw) : {};
            } catch (e) {
              reject(this.createError('INVALID_RESPONSE', '阿里云返回非 JSON 响应', { meta: { raw }, cause: e }));
              return;
            }

            const httpStatus = res.statusCode;
            if (httpStatus && httpStatus >= 400) {
              reject(this.createError('HTTP_ERROR', `HTTP 错误: ${httpStatus}`, { httpStatus, meta: { body: json } }));
              return;
            }

            if (json?.Code && json?.Message) {
              reject(this.createError(String(json.Code), String(json.Message), {
                httpStatus,
                meta: { requestId: json.RequestId, action },
              }));
              return;
            }

            resolve(json as T);
          });
        });

        req.on('error', e => {
          reject(this.createError('NETWORK_ERROR', (e as any)?.message || '网络错误', { cause: e }));
        });
        req.end();
      })
    );
  }

  private rememberZone(zone: { id: string; name: string }) {
    this.domainIdToName.set(zone.id, zone.name);
    this.domainNameToId.set(zone.name, zone.id);
  }

  private isDomainName(input: string): boolean {
    return input.includes('.');
  }

  private async resolveDomain(zoneIdOrName: string): Promise<{ domainId?: string; domainName: string }> {
    if (this.isDomainName(zoneIdOrName)) {
      const cachedId = this.domainNameToId.get(zoneIdOrName);
      return { domainName: zoneIdOrName, domainId: cachedId };
    }

    const cachedName = this.domainIdToName.get(zoneIdOrName);
    if (cachedName) return { domainId: zoneIdOrName, domainName: cachedName };

    // 遍历查找
    let page = 1;
    while (page <= 50) {
      const resp = await this.request<AliyunDescribeDomainsResponse>('DescribeDomains', {
        PageNumber: page,
        PageSize: 200,
      });

      for (const d of resp.Domains?.Domain || []) {
        this.rememberZone({ id: d.DomainId, name: d.DomainName });
        if (d.DomainId === zoneIdOrName) {
          return { domainId: d.DomainId, domainName: d.DomainName };
        }
      }

      if ((page * 200) >= (resp.TotalCount || 0)) break;
      page++;
    }

    throw this.createError('ZONE_NOT_FOUND', `域名不存在: ${zoneIdOrName}`, { httpStatus: 404 });
  }

  private toRR(name: string, domainName: string): string {
    const n = (name || '').trim();
    if (!n || n === '@' || n === domainName) return '@';
    if (n.endsWith(`.${domainName}`)) {
      return n.slice(0, -(`.${domainName}`.length)) || '@';
    }
    return n;
  }

  private toFqdn(rr: string, domainName: string): string {
    if (!rr || rr === '@') return domainName;
    return `${rr}.${domainName}`;
  }

  private fromAliyunStatus(status?: string): '0' | '1' | undefined {
    if (!status) return undefined;
    const s = String(status).trim().toLowerCase();
    if (s === 'enable' || s === 'enabled') return '1';
    if (s === 'disable' || s === 'disabled') return '0';
    if (s === '1') return '1';
    if (s === '0') return '0';
    return undefined;
  }

  private toAliyunStatus(enabled: boolean): 'Enable' | 'Disable' {
    return enabled ? 'Enable' : 'Disable';
  }

  // ========== IDnsProvider 实现 ==========

  async checkAuth(): Promise<boolean> {
    try {
      await this.request<AliyunDescribeDomainsResponse>('DescribeDomains', { PageNumber: 1, PageSize: 1 });
      return true;
    } catch {
      return false;
    }
  }

  async getZones(page?: number, pageSize?: number, keyword?: string): Promise<ZoneListResult> {
    try {
      const resp = await this.request<AliyunDescribeDomainsResponse>('DescribeDomains', {
        PageNumber: page || 1,
        PageSize: pageSize || 20,
        KeyWord: keyword,
      });

      const zones: Zone[] = (resp.Domains?.Domain || []).map(d => {
        const z = this.normalizeZone({
          id: d.DomainId,
          name: d.DomainName,
          status: d.Status || 'unknown',
          recordCount: d.RecordCount,
          updatedAt: d.UpdateTime,
          meta: { raw: d },
        });
        this.rememberZone({ id: z.id, name: z.name });
        return z;
      });

      return { total: resp.TotalCount || zones.length, zones };
    } catch (err) {
      throw this.wrapError(err);
    }
  }

  async getZone(zoneIdOrName: string): Promise<Zone> {
    try {
      const resolved = await this.resolveDomain(zoneIdOrName);
      const info = await this.request<AliyunDescribeDomainInfoResponse>('DescribeDomainInfo', {
        DomainName: resolved.domainName,
      });

      const nameServers = Array.isArray(info.DnsServers?.DnsServer)
        ? info.DnsServers!.DnsServer!.filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
        : [];

      const zone = this.normalizeZone({
        id: info.DomainId || resolved.domainId || zoneIdOrName,
        name: info.DomainName || resolved.domainName,
        status: 'active',
        meta: { raw: info, nameServers },
      });
      this.rememberZone({ id: zone.id, name: zone.name });
      return zone;
    } catch (err) {
      throw this.wrapError(err);
    }
  }

  async getRecords(zoneIdOrName: string, params?: RecordQueryParams): Promise<RecordListResult> {
    try {
      const zone = await this.getZone(zoneIdOrName);
      const domainName = zone.name;

      const line = toAliyunLine(params?.line);
      const status = params?.status ? (params.status === '1' ? 'Enable' : 'Disable') : undefined;

      const hasAdvancedFilters = Boolean(
        params?.subDomain || params?.type || params?.value || params?.line || params?.status
      );

      const query: Record<string, string | number | undefined> = {
        DomainName: domainName,
        PageNumber: params?.page || 1,
        PageSize: params?.pageSize || 20,
      };

      if (hasAdvancedFilters) {
        query.SearchMode = 'ADVANCED';
        query.RRKeyWord = params?.subDomain || params?.keyword;
        query.ValueKeyWord = params?.value;
        query.Type = params?.type;
        query.Line = line;
        query.Status = status;
      } else if (params?.keyword) {
        query.KeyWord = params.keyword;
      }

      const resp = await this.request<AliyunDescribeDomainRecordsResponse>('DescribeDomainRecords', query);

      const records: DnsRecord[] = (resp.DomainRecords?.Record || []).map(r =>
        this.normalizeRecord({
          id: r.RecordId,
          zoneId: zone.id,
          zoneName: zone.name,
          name: this.toFqdn(r.RR, domainName),
          type: r.Type,
          value: r.Value,
          ttl: r.TTL,
          line: fromAliyunLine(r.Line),
          priority: r.Priority,
          status: this.fromAliyunStatus(r.Status),
          remark: r.Remark,
          updatedAt: r.UpdateTimestamp ? new Date(Number(r.UpdateTimestamp)).toISOString() : undefined,
          meta: { raw: r },
        })
      );

      return { total: resp.TotalCount || records.length, records };
    } catch (err) {
      throw this.wrapError(err);
    }
  }

  async getRecord(zoneIdOrName: string, recordId: string): Promise<DnsRecord> {
    try {
      const zone = await this.getZone(zoneIdOrName);
      const resp = await this.request<AliyunDescribeDomainRecordInfoResponse>('DescribeDomainRecordInfo', {
        RecordId: recordId,
      });

      return this.normalizeRecord({
        id: resp.RecordId,
        zoneId: zone.id,
        zoneName: zone.name,
        name: this.toFqdn(resp.RR, zone.name),
        type: resp.Type,
        value: resp.Value,
        ttl: resp.TTL,
        line: fromAliyunLine(resp.Line),
        priority: resp.Priority,
        status: this.fromAliyunStatus(resp.Status),
        remark: resp.Remark,
        meta: { raw: resp },
      });
    } catch (err) {
      throw this.wrapError(err);
    }
  }

  async createRecord(zoneIdOrName: string, params: CreateRecordParams): Promise<DnsRecord> {
    try {
      const zone = await this.getZone(zoneIdOrName);
      const rr = this.toRR(params.name, zone.name);

      const created = await this.request<AliyunAddDomainRecordResponse>('AddDomainRecord', {
        DomainName: zone.name,
        RR: rr,
        Type: params.type,
        Value: params.value,
        TTL: params.ttl || 600,
        Line: toAliyunLine(params.line),
        Priority: params.priority,
      });

      if (!created.RecordId) {
        throw this.createError('CREATE_FAILED', '创建记录失败');
      }

      // 设置备注（单独 API）
      if (params.remark) {
        await this.request<AliyunErrorResponse>('UpdateDomainRecordRemark', {
          RecordId: created.RecordId,
          Remark: params.remark,
        });
      }

      return await this.getRecord(zoneIdOrName, created.RecordId);
    } catch (err) {
      throw this.wrapError(err);
    }
  }

  async updateRecord(zoneIdOrName: string, recordId: string, params: UpdateRecordParams): Promise<DnsRecord> {
    try {
      const zone = await this.getZone(zoneIdOrName);
      const rr = this.toRR(params.name, zone.name);

      await this.request<AliyunErrorResponse>('UpdateDomainRecord', {
        RecordId: recordId,
        RR: rr,
        Type: params.type,
        Value: params.value,
        TTL: params.ttl || 600,
        Line: toAliyunLine(params.line),
        Priority: params.priority,
      });

      if (params.remark !== undefined) {
        await this.request<AliyunErrorResponse>('UpdateDomainRecordRemark', {
          RecordId: recordId,
          Remark: params.remark || '',
        });
      }

      return await this.getRecord(zoneIdOrName, recordId);
    } catch (err) {
      throw this.wrapError(err);
    }
  }

  async deleteRecord(_zoneIdOrName: string, recordId: string): Promise<boolean> {
    try {
      await this.request<AliyunErrorResponse>('DeleteDomainRecord', { RecordId: recordId });
      return true;
    } catch (err) {
      throw this.wrapError(err);
    }
  }

  async setRecordStatus(_zoneIdOrName: string, recordId: string, enabled: boolean): Promise<boolean> {
    try {
      await this.request<AliyunErrorResponse>('SetDomainRecordStatus', {
        RecordId: recordId,
        Status: this.toAliyunStatus(enabled),
      });
      return true;
    } catch (err) {
      throw this.wrapError(err);
    }
  }

  async getLines(zoneIdOrName?: string): Promise<LineListResult> {
    try {
      if (!zoneIdOrName) {
        return { lines: getDefaultLines() };
      }

      const zone = await this.getZone(zoneIdOrName);
      const info = await this.request<AliyunDescribeDomainInfoResponse>('DescribeDomainInfo', {
        DomainName: zone.name,
        NeedDetailAttributes: 'true',
      });

      const aliyunLines = info.RecordLines?.RecordLine || [];
      if (aliyunLines.length === 0) {
        return { lines: getDefaultLines() };
      }

      const defaultLines = getDefaultLines();
      const lines: DnsLine[] = aliyunLines.map(a => {
        if (typeof a === 'string') {
          const generic = fromAliyunLine(a) || a;
          const found = defaultLines.find(d => d.code === generic);
          return found || { code: generic, name: generic };
        }

        const rawCode = a.LineCode ? String(a.LineCode) : '';
        const rawParent = a.FatherCode ? String(a.FatherCode) : undefined;

        const code = fromAliyunLine(rawCode) || rawCode;
        const parentCode = rawParent ? fromAliyunLine(rawParent) || rawParent : undefined;
        const name =
          (a.LineDisplayName ? String(a.LineDisplayName) : '') ||
          (a.LineName ? String(a.LineName) : '') ||
          defaultLines.find(d => d.code === code)?.name ||
          code;

        return { code, name, parentCode };
      });

      return { lines };
    } catch (err) {
      throw this.wrapError(err);
    }
  }

  async getMinTTL(_zoneId?: string): Promise<number> {
    try {
      if (!_zoneId) return 600;
      const zone = await this.getZone(_zoneId);
      const info = await this.request<AliyunDescribeDomainInfoResponse>('DescribeDomainInfo', {
        DomainName: zone.name,
        NeedDetailAttributes: 'true',
      });

      const min = info.MinTtl;
      if (typeof min === 'number' && Number.isFinite(min) && min > 0) return min;
      return 600;
    } catch {
      return 600;
    }
  }

  async addZone(domain: string): Promise<Zone> {
    const name = String(domain || '').trim();
    if (!name) {
      throw this.createError('INVALID_DOMAIN', '域名不能为空', { httpStatus: 400 });
    }

    try {
      const resp = await this.request<AliyunAddDomainResponse>('AddDomain', {
        DomainName: name,
      });

      const nameServers = Array.isArray(resp.DnsServers?.DnsServer)
        ? resp.DnsServers!.DnsServer!.filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
        : [];

      const zone = this.normalizeZone({
        id: resp.DomainId || name,
        name: resp.DomainName || name,
        status: 'active',
        meta: { raw: resp, nameServers },
      });

      this.rememberZone({ id: zone.id, name: zone.name });
      return zone;
    } catch (err: any) {
      const code = String((err as any)?.details?.code || (err as any)?.code || '');
      if (code === 'DomainAlreadyExist' || code.includes('AlreadyExist')) {
        try {
          const existing = await this.getZone(name);
          return {
            ...existing,
            meta: { ...existing.meta, existed: true },
          };
        } catch {
          // 忽略，抛出原始错误
        }
      }
      throw this.wrapError(err);
    }
  }

  async deleteZone(zoneIdOrName: string): Promise<boolean> {
    const input = String(zoneIdOrName || '').trim();
    if (!input) {
      throw this.createError('INVALID_ZONE', 'Zone ID 或域名不能为空', { httpStatus: 400 });
    }

    try {
      const resolved = await this.resolveDomain(input);
      await this.request<AliyunErrorResponse>('DeleteDomain', {
        DomainName: resolved.domainName,
      });

      this.domainIdToName.delete(resolved.domainId || input);
      this.domainNameToId.delete(resolved.domainName);
      return true;
    } catch (err) {
      throw this.wrapError(err);
    }
  }
}
