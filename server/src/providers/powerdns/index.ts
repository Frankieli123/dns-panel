/**
 * PowerDNS Provider
 * - Base URL: http://{ip}:{port}/api/v1
 * - Auth: X-API-Key header
 * - Uses RRSet model with PATCH changetype
 */

import http from 'http';
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

interface PowerDnsZone {
  id: string;
  name: string;
  kind?: string;
  serial?: number;
  rrsets?: PowerDnsRRSet[];
}

interface PowerDnsRRSet {
  name: string;
  type: string;
  ttl: number;
  changetype?: string;
  records: PowerDnsRRSetRecord[];
  comments?: PowerDnsComment[];
}

interface PowerDnsComment {
  content: string;
  account?: string;
  modified_at?: number;
}

interface PowerDnsRRSetPatch {
  name: string;
  type: string;
  changetype: 'DELETE' | 'REPLACE' | 'EXTEND' | 'PRUNE';
  ttl?: number;
  records?: PowerDnsRRSetRecord[];
  comments?: PowerDnsComment[];
}

interface PowerDnsRRSetRecord {
  content: string;
  disabled: boolean;
}

function toRelativeName(fqdn: string, zoneName: string): string {
  const name = fqdn.endsWith('.') ? fqdn.slice(0, -1) : fqdn;
  const zone = zoneName.endsWith('.') ? zoneName.slice(0, -1) : zoneName;
  if (name === zone) return '@';
  if (name.endsWith(`.${zone}`)) return name.slice(0, -(zone.length + 1)) || '@';
  return name;
}

export const POWERDNS_CAPABILITIES: ProviderCapabilities = {
  provider: ProviderType.POWERDNS,
  name: 'PowerDNS',

  supportsWeight: false,
  supportsLine: false,
  supportsStatus: true,
  supportsRemark: true,
  supportsUrlForward: false,
  supportsLogs: false,

  remarkMode: 'inline',
  paging: 'client',
  requiresDomainId: false,

  recordTypes: ['A', 'AAAA', 'CNAME', 'MX', 'TXT', 'SRV', 'CAA', 'NS', 'PTR', 'SOA'],

  authFields: [
    {
      name: 'serverAddress',
      label: '服务器地址',
      type: 'text',
      required: true,
      placeholder: '192.168.1.1:8081',
      helpText: 'PowerDNS API 地址 (IP:端口)',
    },
    { name: 'apiKey', label: 'API Key', type: 'password', required: true, placeholder: 'PowerDNS API Key' },
  ],

  domainCacheTtl: 60,
  recordCacheTtl: 30,

  retryableErrors: ['TIMEOUT', 'ECONNRESET'],
  maxRetries: 2,
};

export class PowerdnsProvider extends BaseProvider {
  private readonly serverAddress: string;
  private readonly apiKey: string;
  private readonly serverId = 'localhost';

  constructor(credentials: ProviderCredentials) {
    super(credentials, POWERDNS_CAPABILITIES);
    const { serverAddress, apiKey } = credentials.secrets || {};
    if (!serverAddress || !apiKey) throw this.createError('MISSING_CREDENTIALS', '缺少 PowerDNS 服务器地址/API Key');
    this.serverAddress = serverAddress;
    this.apiKey = apiKey;
  }

  private wrapError(err: unknown, code = 'POWERDNS_ERROR'): DnsProviderError {
    if (err instanceof DnsProviderError) return err;
    const message = (err as any)?.message ? String((err as any).message) : String(err);
    return this.createError(code, message, { cause: err });
  }

  private async request<T>(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', path: string, body?: any): Promise<T> {
    const payload = body === undefined ? '' : JSON.stringify(body);
    const headers: Record<string, string> = {
      'X-API-Key': this.apiKey,
      'Content-Type': 'application/json; charset=utf-8',
    };
    if (payload) headers['Content-Length'] = String(Buffer.byteLength(payload));

    const [hostname, portStr] = this.serverAddress.split(':');
    const port = Number(portStr || '8081');

    return await this.withRetry<T>(
      () =>
        new Promise<T>((resolve, reject) => {
          const req = http.request({ hostname, port, method, path, headers }, res => {
            const chunks: Buffer[] = [];
            res.on('data', d => chunks.push(Buffer.isBuffer(d) ? d : Buffer.from(d)));
            res.on('end', () => {
              const raw = Buffer.concat(chunks).toString('utf8');
              // 204 No Content
              if (res.statusCode === 204) {
                resolve({} as T);
                return;
              }
              try {
                const json = raw ? JSON.parse(raw) : {};
                if (res.statusCode && res.statusCode >= 400) {
                  reject(
                    this.createError(
                      String(res.statusCode),
                      json.error || `PowerDNS 错误: ${res.statusCode}`,
                      { httpStatus: res.statusCode, meta: json }
                    )
                  );
                  return;
                }
                resolve(json as T);
              } catch (e) {
                reject(this.createError('INVALID_RESPONSE', 'PowerDNS 返回非 JSON 响应', { meta: { raw }, cause: e }));
              }
            });
          });
          req.on('error', e => reject(this.createError('NETWORK_ERROR', 'PowerDNS 请求失败', { cause: e })));
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

  private recordIdEncode(rrsetName: string, rrsetType: string, recordIndex: number): string {
    return `${rrsetName}|${rrsetType}|${recordIndex}`;
  }

  private recordIdDecode(id: string): { rrsetName: string; rrsetType: string; recordIndex: number } {
    const [rrsetName, rrsetType, indexStr] = id.split('|');
    return { rrsetName, rrsetType, recordIndex: parseInt(indexStr, 10) };
  }

  async checkAuth(): Promise<boolean> {
    try {
      await this.request('GET', `/api/v1/servers/${this.serverId}/zones`);
      return true;
    } catch {
      return false;
    }
  }

  async getZones(page?: number, pageSize?: number, keyword?: string): Promise<ZoneListResult> {
    try {
      const list = await this.request<PowerDnsZone[]>('GET', `/api/v1/servers/${this.serverId}/zones`);

      const zones: Zone[] = list.map(z =>
        this.normalizeZone({
          id: z.id,
          name: this.removeTrailingDot(z.name),
          status: 'active',
        })
      );

      return this.applyZoneQuery(zones, page, pageSize, keyword);
    } catch (err) {
      throw this.wrapError(err);
    }
  }

  async getZone(zoneId: string): Promise<Zone> {
    try {
      const zoneIdWithDot = this.ensureTrailingDot(zoneId);
      const z = await this.request<PowerDnsZone>('GET', `/api/v1/servers/${this.serverId}/zones/${zoneIdWithDot}`);
      return this.normalizeZone({
        id: z.id,
        name: this.removeTrailingDot(z.name),
        status: 'active',
      });
    } catch (err) {
      throw this.wrapError(err);
    }
  }

  async getRecords(zoneId: string, params?: RecordQueryParams): Promise<RecordListResult> {
    try {
      const zoneIdWithDot = this.ensureTrailingDot(zoneId);
      const z = await this.request<PowerDnsZone>('GET', `/api/v1/servers/${this.serverId}/zones/${zoneIdWithDot}`);
      const zoneName = this.removeTrailingDot(z.name);

      const records: DnsRecord[] = [];
      for (const rrset of z.rrsets || []) {
        // 跳过 SOA 记录
        if (rrset.type === 'SOA') continue;

        rrset.records.forEach((r, idx) => {
          let value = r.content;
          let priority: number | undefined;
          // TXT 记录去除引号
          if (rrset.type === 'TXT' && value.startsWith('"') && value.endsWith('"')) {
            value = value.slice(1, -1);
          }
          if (rrset.type === 'MX') {
            const parts = String(value).trim().split(/\s+/);
            if (parts.length >= 2) {
              const p = Number(parts[0]);
              if (Number.isFinite(p)) {
                priority = p;
                value = parts.slice(1).join(' ');
              }
            }
          }

          records.push(
            this.normalizeRecord({
              id: this.recordIdEncode(rrset.name, rrset.type, idx),
              zoneId: z.id,
              zoneName: zoneName,
              name: toRelativeName(rrset.name, z.name),
              type: rrset.type,
              value: value,
              ttl: rrset.ttl,
              priority,
              status: r.disabled ? '0' : '1',
              remark: rrset.comments?.[0]?.content,
            })
          );
        });
      }

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
      const zoneIdWithDot = this.ensureTrailingDot(zoneId);
      const zone = await this.getZone(zoneId);
      const zoneName = zone.name;
      const rrsetName = this.ensureTrailingDot(
        params.name === '@' ? zoneName : `${params.name}.${zoneName}`
      );

      let content = params.value;
      const isMx = params.type === 'MX';
      const mxPriority = isMx ? (params.priority ?? 1) : undefined;
      // TXT 记录添加引号
      if (params.type === 'TXT' && !content.startsWith('"')) {
        content = `"${content}"`;
      }
      // CNAME/MX 添加点
      if ((params.type === 'CNAME' || params.type === 'MX' || params.type === 'NS') && !content.endsWith('.')) {
        content = `${content}.`;
      }
      // MX 记录格式: priority content
      if (isMx) {
        content = `${mxPriority} ${content}`;
      }

      const current = await this.request<PowerDnsZone>('GET', `/api/v1/servers/${this.serverId}/zones/${zoneIdWithDot}`);
      const existing = (current.rrsets || []).find(r => r.name === rrsetName && r.type === params.type);

      if (existing?.records?.some(r => r.content === content)) {
        throw this.createError('ALREADY_EXISTS', '已存在相同记录');
      }

      const rrset: PowerDnsRRSetPatch = {
        name: rrsetName,
        type: params.type,
        ttl: params.ttl || existing?.ttl || 3600,
        changetype: 'REPLACE',
        records: [...(existing?.records || []), { content, disabled: false }],
      };
      if (params.remark) {
        rrset.comments = [{ content: params.remark, account: '' }];
      }

      await this.request('PATCH', `/api/v1/servers/${this.serverId}/zones/${zoneIdWithDot}`, { rrsets: [rrset] });

      // 返回新创建的记录
      const result = await this.getRecords(zoneId);

      let expectedValue = params.value;
      if ((params.type === 'CNAME' || params.type === 'MX' || params.type === 'NS') && !expectedValue.endsWith('.')) {
        expectedValue = `${expectedValue}.`;
      }
      const created = result.records.find(
        r =>
          r.name === (params.name === '@' ? '@' : params.name) &&
          r.type === params.type &&
          r.value === expectedValue &&
          (!isMx || r.priority === mxPriority)
      );
      if (!created) throw this.createError('CREATE_FAILED', '创建记录失败');
      return created;
    } catch (err) {
      throw this.wrapError(err);
    }
  }

  async updateRecord(zoneId: string, recordId: string, params: UpdateRecordParams): Promise<DnsRecord> {
    try {
      const decoded = this.recordIdDecode(recordId);
      const zone = await this.getZone(zoneId);
      const zoneIdWithDot = this.ensureTrailingDot(zoneId);
      const zoneFetch = await this.request<PowerDnsZone>('GET', `/api/v1/servers/${this.serverId}/zones/${zoneIdWithDot}`);

      const targetName = this.ensureTrailingDot(
        params.name === '@' ? zone.name : `${params.name}.${zone.name}`
      );
      const targetType = params.type;

      if (targetName !== decoded.rrsetName || targetType !== decoded.rrsetType) {
        await this.deleteRecord(zoneId, recordId);
        return await this.createRecord(zoneId, params);
      }

      const rrset = (zoneFetch.rrsets || []).find(r => r.name === decoded.rrsetName && r.type === decoded.rrsetType);
      if (!rrset) throw this.createError('NOT_FOUND', 'RRSet 不存在，请刷新后重试', { httpStatus: 404 });
      if (!rrset.records || decoded.recordIndex < 0 || decoded.recordIndex >= rrset.records.length) {
        throw this.createError('NOT_FOUND', '记录不存在，请刷新后重试', { httpStatus: 404 });
      }

      let content = params.value;
      const isMx = params.type === 'MX';
      let mxPriority: number | undefined = params.priority;
      if (isMx && mxPriority === undefined) {
        const cur = rrset.records[decoded.recordIndex]?.content;
        const first = String(cur || '').trim().split(/\s+/)[0];
        const p = Number(first);
        mxPriority = Number.isFinite(p) ? p : 1;
      }
      if (params.type === 'TXT' && !content.startsWith('"')) {
        content = `"${content}"`;
      }
      if ((params.type === 'CNAME' || params.type === 'MX' || params.type === 'NS') && !content.endsWith('.')) {
        content = `${content}.`;
      }
      if (isMx) {
        content = `${mxPriority} ${content}`;
      }

      const newRecords = rrset.records.map((r, idx) =>
        idx === decoded.recordIndex ? { ...r, content } : r
      );

      const patch: PowerDnsRRSetPatch = {
        name: rrset.name,
        type: rrset.type,
        ttl: params.ttl || rrset.ttl || 3600,
        changetype: 'REPLACE',
        records: newRecords,
      };
      if (params.remark !== undefined) {
        patch.comments = params.remark ? [{ content: params.remark, account: '' }] : [];
      } else if (rrset.comments) {
        patch.comments = rrset.comments;
      }

      await this.request('PATCH', `/api/v1/servers/${this.serverId}/zones/${zoneIdWithDot}`, { rrsets: [patch] });
      return await this.getRecord(zoneId, recordId);
    } catch (err) {
      throw this.wrapError(err);
    }
  }

  async deleteRecord(zoneId: string, recordId: string): Promise<boolean> {
    try {
      const decoded = this.recordIdDecode(recordId);
      const zoneIdWithDot = this.ensureTrailingDot(zoneId);
      const zoneFetch = await this.request<PowerDnsZone>('GET', `/api/v1/servers/${this.serverId}/zones/${zoneIdWithDot}`);
      const rrset = (zoneFetch.rrsets || []).find(r => r.name === decoded.rrsetName && r.type === decoded.rrsetType);
      if (!rrset) throw this.createError('NOT_FOUND', 'RRSet 不存在，请刷新后重试', { httpStatus: 404 });
      if (!rrset.records || decoded.recordIndex < 0 || decoded.recordIndex >= rrset.records.length) {
        throw this.createError('NOT_FOUND', '记录不存在，请刷新后重试', { httpStatus: 404 });
      }

      const remaining = rrset.records.filter((_, idx) => idx !== decoded.recordIndex);
      const rrsets: PowerDnsRRSetPatch[] = [];

      if (remaining.length === 0) {
        // PowerDNS API: changetype=DELETE 时不能包含 ttl
        rrsets.push({ name: rrset.name, type: rrset.type, changetype: 'DELETE' });
      } else {
        rrsets.push({
          name: rrset.name,
          type: rrset.type,
          ttl: rrset.ttl,
          changetype: 'REPLACE',
          records: remaining,
          comments: rrset.comments,
        });
      }

      await this.request('PATCH', `/api/v1/servers/${this.serverId}/zones/${zoneIdWithDot}`, { rrsets });
      return true;
    } catch (err) {
      throw this.wrapError(err);
    }
  }

  async setRecordStatus(zoneId: string, recordId: string, enabled: boolean): Promise<boolean> {
    try {
      const decoded = this.recordIdDecode(recordId);
      const zoneIdWithDot = this.ensureTrailingDot(zoneId);
      const zoneFetch = await this.request<PowerDnsZone>('GET', `/api/v1/servers/${this.serverId}/zones/${zoneIdWithDot}`);
      const rrset = (zoneFetch.rrsets || []).find(r => r.name === decoded.rrsetName && r.type === decoded.rrsetType);
      if (!rrset) throw this.createError('NOT_FOUND', 'RRSet 不存在，请刷新后重试', { httpStatus: 404 });
      if (!rrset.records || decoded.recordIndex < 0 || decoded.recordIndex >= rrset.records.length) {
        throw this.createError('NOT_FOUND', '记录不存在，请刷新后重试', { httpStatus: 404 });
      }

      const newRecords = rrset.records.map((r, idx) =>
        idx === decoded.recordIndex ? { ...r, disabled: !enabled } : r
      );

      const patch: PowerDnsRRSetPatch = {
        name: rrset.name,
        type: rrset.type,
        ttl: rrset.ttl,
        changetype: 'REPLACE',
        records: newRecords,
        comments: rrset.comments,
      };

      await this.request('PATCH', `/api/v1/servers/${this.serverId}/zones/${zoneIdWithDot}`, { rrsets: [patch] });
      return true;
    } catch (err) {
      throw this.wrapError(err);
    }
  }

  async getLines(_zoneId?: string): Promise<LineListResult> {
    const lines: DnsLine[] = [{ code: 'default', name: '默认' }];
    return { lines };
  }

  async getMinTTL(_zoneId?: string): Promise<number> {
    return 60;
  }

  async addZone(domain: string): Promise<Zone> {
    try {
      const domainWithDot = this.ensureTrailingDot(domain);
      const resp = await this.request<PowerDnsZone>('POST', `/api/v1/servers/${this.serverId}/zones`, {
        name: domainWithDot,
        kind: 'Native',
        nameservers: [],
      });
      return this.normalizeZone({
        id: resp.id || domainWithDot,
        name: domain,
        status: 'active',
      });
    } catch (err) {
      throw this.wrapError(err);
    }
  }
}
