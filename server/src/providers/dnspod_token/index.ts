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
import { defaultLines, fromLineId, toLineId } from './lines';

type DnspodLegacyStatus = {
  code?: string;
  message?: string;
  created_at?: string;
};

type DnspodLegacyResponse<T extends Record<string, unknown>> = T & {
  status?: DnspodLegacyStatus;
};

type DomainListResponse = DnspodLegacyResponse<{
  info?: { domain_total?: number };
  domains?: Array<{ id: number | string; name: string; status?: string; records?: string; updated_on?: string }>; 
}>;

type DomainInfoResponse = DnspodLegacyResponse<{
  domain?: {
    id: string | number;
    name: string;
    status?: string;
    grade?: string;
    records?: string;
    updated_on?: string;
    ttl?: string;
  };
}>;

type RecordListResponse = DnspodLegacyResponse<{
  domain?: { id?: string | number; name?: string; grade?: string; ttl?: number };
  info?: { record_total?: string | number; records_num?: string | number };
  records?: Array<{
    id: string | number;
    name: string;
    line?: string;
    line_id?: string | number;
    type: string;
    ttl?: string | number;
    value: string;
    weight?: string | number | null;
    mx?: string | number;
    enabled?: string | number;
    remark?: string;
    updated_on?: string;
  }>;
}>;

type RecordInfoResponse = DnspodLegacyResponse<{
  domain?: { id?: string | number; domain?: string; domain_grade?: string };
  record?: {
    id: string | number;
    sub_domain?: string;
    record_type?: string;
    record_line?: string;
    record_line_id?: string | number;
    value?: string;
    weight?: string | number | null;
    mx?: string | number;
    ttl?: string | number;
    enabled?: string | number;
    remark?: string;
    updated_on?: string;
    domain_id?: string | number;
  };
}>;

type RecordCreateResponse = DnspodLegacyResponse<{
  record?: { id?: string | number };
}>;

type RecordModifyResponse = DnspodLegacyResponse<{
  record?: { id?: string | number };
}>;

type CommonOkResponse = DnspodLegacyResponse<Record<string, unknown>>;

type RecordLineResponse = DnspodLegacyResponse<{
  line_ids?: Record<string, string | number>;
  lines?: string[];
}>;

export const DNSPOD_TOKEN_CAPABILITIES: ProviderCapabilities = {
  provider: ProviderType.DNSPOD_TOKEN,
  name: '腾讯云',

  supportsWeight: true,
  supportsLine: true,
  supportsStatus: true,
  supportsRemark: true,
  supportsUrlForward: true,
  supportsLogs: true,

  remarkMode: 'separate',
  paging: 'server',
  requiresDomainId: true,

  recordTypes: ['A', 'AAAA', 'CNAME', 'MX', 'TXT', 'SRV', 'NS', 'REDIRECT_URL'],

  authFields: [
    { name: 'tokenId', label: 'Token ID', type: 'text', required: true, placeholder: '输入 DNSPod Token ID' },
    { name: 'token', label: 'Token', type: 'password', required: true, placeholder: '输入 DNSPod Token' },
  ],

  domainCacheTtl: 300,
  recordCacheTtl: 120,

  retryableErrors: [],
  maxRetries: 2,
};

export class DnspodTokenProvider extends BaseProvider {
  private readonly host = 'dnsapi.cn';
  private readonly loginToken: string;
  private readonly domainIdToName = new Map<string, string>();
  private readonly domainNameToId = new Map<string, string>();
  private readonly lineIdByZoneAndCode = new Map<string, Map<string, string>>();
  private readonly lineIdByZoneAndName = new Map<string, Map<string, string>>();

  constructor(credentials: ProviderCredentials) {
    super(credentials, DNSPOD_TOKEN_CAPABILITIES);

    const { tokenId, token, login_token } = credentials.secrets || {};
    const computed = tokenId && token ? `${tokenId},${token}` : undefined;
    const finalLoginToken = String(login_token || computed || '').trim();

    if (!finalLoginToken) {
      throw this.createError('MISSING_CREDENTIALS', '缺少 DNSPod Token（tokenId/token）');
    }

    this.loginToken = finalLoginToken;
  }

  private wrapError(err: unknown, code = 'DNSPOD_TOKEN_ERROR'): DnsProviderError {
    if (err instanceof DnsProviderError) return err;
    const message = (err as any)?.message ? String((err as any).message) : String(err);
    return this.createError(code, message, { cause: err });
  }

  private async request<T extends Record<string, unknown>>(
    action: string,
    params: Record<string, string | number | undefined | null>
  ): Promise<DnspodLegacyResponse<T>> {
    const form = new URLSearchParams();

    form.set('login_token', this.loginToken);
    form.set('format', 'json');

    for (const [k, v] of Object.entries(params || {})) {
      if (v === undefined || v === null) continue;
      form.set(k, String(v));
    }

    const body = form.toString();

    return await this.withRetry(() =>
      new Promise((resolve, reject) => {
        const req = https.request(
          {
            hostname: this.host,
            method: 'POST',
            path: `/${action}`,
            headers: {
              Host: this.host,
              'Content-Type': 'application/x-www-form-urlencoded',
              'Content-Length': String(Buffer.byteLength(body)),
            },
          },
          res => {
            const chunks: Buffer[] = [];
            res.on('data', d => chunks.push(Buffer.isBuffer(d) ? d : Buffer.from(String(d))));
            res.on('end', () => {
              const text = Buffer.concat(chunks).toString('utf8');

              if (res.statusCode && res.statusCode >= 400) {
                return reject(this.createError('HTTP_ERROR', `HTTP ${res.statusCode}: ${text}`, { httpStatus: res.statusCode }));
              }

              try {
                const json = JSON.parse(text);
                const status = (json as any)?.status;
                const statusCode = status?.code !== undefined ? String(status.code) : undefined;

                if (statusCode && statusCode !== '1') {
                  return reject(
                    this.createError(statusCode, status?.message ? String(status.message) : 'DNSPod API 调用失败', {
                      httpStatus: 400,
                      meta: { action, status, response: json },
                    })
                  );
                }

                return resolve(json);
              } catch (e) {
                return reject(this.createError('INVALID_RESPONSE', 'DNSPod 返回非 JSON 响应', { httpStatus: 502, meta: { action, text }, cause: e }));
              }
            });
          }
        );

        req.on('error', e => reject(e));
        req.write(body);
        req.end();
      })
    );
  }

  private rememberZone(zone: { id: string; name: string }) {
    this.domainIdToName.set(zone.id, zone.name);
    this.domainNameToId.set(zone.name, zone.id);
  }

  private toFqdn(rr: string, domain: string): string {
    if (!rr || rr === '@') return domain;
    if (rr.endsWith(`.${domain}`)) return rr;
    return `${rr}.${domain}`;
  }

  private toRR(name: string, domain: string): string {
    const n = String(name || '').trim();
    if (!n) return '@';
    if (n === domain) return '@';
    if (n.endsWith(`.${domain}`)) {
      const rr = n.slice(0, -(domain.length + 1));
      return rr || '@';
    }
    return n;
  }

  private toRecordType(type: string): string {
    const t = String(type || '').trim();
    if (t === 'REDIRECT_URL' || t === 'FORWARD_URL') return 'URL';
    return t;
  }

  private fromRecordType(type: string): string {
    const t = String(type || '').trim();
    if (t === 'URL') return 'REDIRECT_URL';
    return t;
  }

  private async resolveLineId(zone: Zone, input?: string): Promise<string> {
    const raw = String(input || '').trim();
    if (!raw || raw === 'default') return '0';

    const direct = toLineId(raw);
    if (direct) return direct;

    const byCode = this.lineIdByZoneAndCode.get(zone.id);
    if (byCode?.has(raw)) return String(byCode.get(raw));

    const byName = this.lineIdByZoneAndName.get(zone.id);
    if (byName?.has(raw)) return String(byName.get(raw));

    return '0';
  }

  async checkAuth(): Promise<boolean> {
    try {
      await this.request<DomainListResponse>('Domain.List', { length: 1 });
      return true;
    } catch {
      return false;
    }
  }

  async getZones(page?: number, pageSize?: number, keyword?: string): Promise<ZoneListResult> {
    try {
      const kw = keyword ? String(keyword).trim().toLowerCase() : '';

      // keyword 查询时改用全量拉取+本地过滤
      if (kw) {
        const all = await this.fetchAllZones();
        return this.applyZoneQuery(all, page, pageSize, keyword);
      }

      const p = Math.max(1, page || 1);
      const ps = Math.max(1, pageSize || 20);
      const offset = (p - 1) * ps;

      const resp = await this.request<DomainListResponse>('Domain.List', { offset, length: ps });

      const zones: Zone[] = (resp.domains || []).map(d => {
        const z = this.normalizeZone({
          id: String(d.id),
          name: String(d.name),
          status: d.status ? String(d.status) : 'unknown',
          recordCount: d.records !== undefined ? Number(d.records) : undefined,
          updatedAt: d.updated_on ? String(d.updated_on) : undefined,
          meta: { raw: d },
        });
        this.rememberZone({ id: z.id, name: z.name });
        return z;
      });

      const total = resp.info?.domain_total ? Number(resp.info.domain_total) : zones.length;
      return { total, zones };
    } catch (err) {
      throw this.wrapError(err);
    }
  }

  private async fetchAllZones(): Promise<Zone[]> {
    const batchSize = 300;
    const zones: Zone[] = [];

    for (let page = 1; page <= 20; page++) {
      const offset = (page - 1) * batchSize;
      const resp = await this.request<DomainListResponse>('Domain.List', { offset, length: batchSize });
      const batch = (resp.domains || []).map(d => {
        const z = this.normalizeZone({
          id: String(d.id),
          name: String(d.name),
          status: d.status ? String(d.status) : 'unknown',
          recordCount: d.records !== undefined ? Number(d.records) : undefined,
          updatedAt: d.updated_on ? String(d.updated_on) : undefined,
          meta: { raw: d },
        });
        this.rememberZone({ id: z.id, name: z.name });
        return z;
      });

      zones.push(...batch);

      const total = resp.info?.domain_total ? Number(resp.info.domain_total) : zones.length;
      if (batch.length === 0) break;
      if (zones.length >= total) break;
    }

    return zones;
  }

  async getZone(zoneId: string): Promise<Zone> {
    try {
      const trimmed = String(zoneId || '').trim();
      const params: Record<string, string> = /^\d+$/.test(trimmed) ? { domain_id: trimmed } : { domain: trimmed };

      const resp = await this.request<DomainInfoResponse>('Domain.Info', params);
      const d = resp.domain;
      if (!d?.id || !d?.name) {
        throw this.createError('INVALID_RESPONSE', 'Domain.Info 返回缺少 domain 信息', { httpStatus: 502, meta: { zoneId, response: resp } });
      }

      const zone = this.normalizeZone({
        id: String(d.id),
        name: String(d.name),
        status: d.status ? String(d.status) : 'unknown',
        recordCount: d.records !== undefined ? Number(d.records) : undefined,
        updatedAt: d.updated_on ? String(d.updated_on) : undefined,
        meta: { raw: d, grade: d.grade, ttl: d.ttl },
      });

      this.rememberZone({ id: zone.id, name: zone.name });
      return zone;
    } catch (err) {
      throw this.wrapError(err);
    }
  }

  async getRecords(zoneId: string, params?: RecordQueryParams): Promise<RecordListResult> {
    try {
      const zone = await this.getZone(zoneId);

      const needClientFilter = Boolean(params?.keyword || params?.value || params?.status || params?.line);

      if (needClientFilter) {
        const all = await this.fetchAllRecords(zone);
        return this.applyRecordQuery(all, params);
      }

      const p = Math.max(1, params?.page || 1);
      const ps = Math.min(100, Math.max(1, params?.pageSize || 20));
      const offset = (p - 1) * ps;

      const reqParams: Record<string, string | number | undefined> = {
        domain_id: zone.id,
        offset,
        length: ps,
        sub_domain: params?.subDomain ? this.toRR(params.subDomain, zone.name) : undefined,
        record_type: params?.type ? this.toRecordType(params.type) : undefined,
      };

      const resp = await this.request<RecordListResponse>('Record.List', reqParams);

      const domainName = resp.domain?.name ? String(resp.domain.name) : zone.name;
      const records: DnsRecord[] = (resp.records || []).map(r =>
        this.normalizeRecord({
          id: String(r.id),
          zoneId: zone.id,
          zoneName: domainName,
          name: this.toFqdn(String(r.name || '@'), domainName),
          type: this.fromRecordType(String(r.type || 'A')),
          value: String(r.value || ''),
          ttl: Number(r.ttl || 600),
          line: fromLineId(String(r.line_id ?? '')),
          weight: r.weight === null ? undefined : (r.weight !== undefined ? Number(r.weight) : undefined),
          priority: r.mx !== undefined ? Number(r.mx) : undefined,
          status: String(r.enabled ?? '') === '1' ? '1' : String(r.enabled ?? '') === '0' ? '0' : undefined,
          remark: r.remark ? String(r.remark) : undefined,
          updatedAt: r.updated_on ? String(r.updated_on) : undefined,
          meta: { raw: r },
        })
      );

      const totalRaw = resp.info?.record_total;
      const total = totalRaw !== undefined ? Number(totalRaw) : records.length;
      return { total, records };
    } catch (err) {
      throw this.wrapError(err);
    }
  }

  private async fetchAllRecords(zone: Zone): Promise<DnsRecord[]> {
    const batchSize = 100;
    const records: DnsRecord[] = [];

    for (let page = 1; page <= 200; page++) {
      const offset = (page - 1) * batchSize;
      const resp = await this.request<RecordListResponse>('Record.List', {
        domain_id: zone.id,
        offset,
        length: batchSize,
      });

      const domainName = resp.domain?.name ? String(resp.domain.name) : zone.name;
      const batch = (resp.records || []).map(r =>
        this.normalizeRecord({
          id: String(r.id),
          zoneId: zone.id,
          zoneName: domainName,
          name: this.toFqdn(String(r.name || '@'), domainName),
          type: this.fromRecordType(String(r.type || 'A')),
          value: String(r.value || ''),
          ttl: Number(r.ttl || 600),
          line: fromLineId(String(r.line_id ?? '')),
          weight: r.weight === null ? undefined : (r.weight !== undefined ? Number(r.weight) : undefined),
          priority: r.mx !== undefined ? Number(r.mx) : undefined,
          status: String(r.enabled ?? '') === '1' ? '1' : String(r.enabled ?? '') === '0' ? '0' : undefined,
          remark: r.remark ? String(r.remark) : undefined,
          updatedAt: r.updated_on ? String(r.updated_on) : undefined,
          meta: { raw: r },
        })
      );

      records.push(...batch);

      const totalRaw = resp.info?.record_total;
      const total = totalRaw !== undefined ? Number(totalRaw) : records.length;

      if (batch.length === 0) break;
      if (records.length >= total) break;
    }

    return records;
  }

  async getRecord(zoneId: string, recordId: string): Promise<DnsRecord> {
    try {
      const zone = await this.getZone(zoneId);

      const resp = await this.request<RecordInfoResponse>('Record.Info', {
        domain_id: zone.id,
        record_id: recordId,
      });

      const r = resp.record;
      if (!r) {
        throw this.createError('NOT_FOUND', `记录不存在: ${recordId}`, { httpStatus: 404, meta: { zoneId, recordId } });
      }

      const domainName = resp.domain?.domain ? String(resp.domain.domain) : zone.name;

      return this.normalizeRecord({
        id: String(r.id),
        zoneId: zone.id,
        zoneName: domainName,
        name: this.toFqdn(String(r.sub_domain || '@'), domainName),
        type: this.fromRecordType(String(r.record_type || 'A')),
        value: String(r.value || ''),
        ttl: Number(r.ttl || 600),
        line: fromLineId(String(r.record_line_id ?? '')),
        weight: r.weight === null ? undefined : (r.weight !== undefined ? Number(r.weight) : undefined),
        priority: r.mx !== undefined ? Number(r.mx) : undefined,
        status: String(r.enabled ?? '') === '1' ? '1' : String(r.enabled ?? '') === '0' ? '0' : undefined,
        remark: r.remark ? String(r.remark) : undefined,
        updatedAt: r.updated_on ? String(r.updated_on) : undefined,
        meta: { raw: r },
      });
    } catch (err) {
      throw this.wrapError(err);
    }
  }

  async createRecord(zoneId: string, params: CreateRecordParams): Promise<DnsRecord> {
    try {
      const zone = await this.getZone(zoneId);
      const lineId = await this.resolveLineId(zone, params.line);
      const recordType = this.toRecordType(params.type);

      const payload: Record<string, string | number | undefined> = {
        domain_id: zone.id,
        sub_domain: this.toRR(params.name, zone.name),
        record_type: recordType,
        record_line_id: lineId,
        value: params.value,
        ttl: typeof params.ttl === 'number' ? params.ttl : undefined,
        mx: recordType === 'MX' && typeof params.priority === 'number' ? params.priority : undefined,
        weight: typeof params.weight === 'number' ? params.weight : undefined,
      };

      const created = await this.request<RecordCreateResponse>('Record.Create', payload);
      const recordId = created.record?.id;
      if (!recordId) {
        throw this.createError('CREATE_FAILED', '创建记录成功但未返回 record_id', { httpStatus: 502, meta: { response: created } });
      }

      if (params.remark) {
        await this.request<CommonOkResponse>('Record.Remark', {
          domain_id: zone.id,
          record_id: String(recordId),
          remark: params.remark,
        });
      }

      return await this.getRecord(zone.id, String(recordId));
    } catch (err) {
      throw this.wrapError(err);
    }
  }

  async updateRecord(zoneId: string, recordId: string, params: UpdateRecordParams): Promise<DnsRecord> {
    try {
      const zone = await this.getZone(zoneId);
      const lineId = await this.resolveLineId(zone, params.line);
      const recordType = this.toRecordType(params.type);

      const payload: Record<string, string | number | undefined> = {
        domain_id: zone.id,
        record_id: recordId,
        sub_domain: this.toRR(params.name, zone.name),
        record_type: recordType,
        record_line_id: lineId,
        value: params.value,
        ttl: typeof params.ttl === 'number' ? params.ttl : undefined,
        mx: recordType === 'MX' && typeof params.priority === 'number' ? params.priority : undefined,
        weight: typeof params.weight === 'number' ? params.weight : undefined,
      };

      await this.request<RecordModifyResponse>('Record.Modify', payload);

      if (params.remark !== undefined) {
        await this.request<CommonOkResponse>('Record.Remark', {
          domain_id: zone.id,
          record_id: recordId,
          remark: params.remark || '',
        });
      }

      return await this.getRecord(zone.id, recordId);
    } catch (err) {
      throw this.wrapError(err);
    }
  }

  async deleteRecord(zoneId: string, recordId: string): Promise<boolean> {
    try {
      const zone = await this.getZone(zoneId);
      await this.request<CommonOkResponse>('Record.Remove', { domain_id: zone.id, record_id: recordId });
      return true;
    } catch (err) {
      throw this.wrapError(err);
    }
  }

  async setRecordStatus(zoneId: string, recordId: string, enabled: boolean): Promise<boolean> {
    try {
      const zone = await this.getZone(zoneId);
      await this.request<CommonOkResponse>('Record.Status', {
        domain_id: zone.id,
        record_id: recordId,
        status: enabled ? 'enable' : 'disable',
      });
      return true;
    } catch (err) {
      throw this.wrapError(err);
    }
  }

  async getLines(zoneId?: string): Promise<LineListResult> {
    try {
      if (!zoneId) return { lines: defaultLines() };

      const zone = await this.getZone(zoneId);
      const grade = (zone.meta as any)?.grade ? String((zone.meta as any).grade) : undefined;

      // 线路接口需要 domain_grade
      const resp = await this.request<RecordLineResponse>('Record.Line', {
        domain_id: zone.id,
        domain_grade: grade || 'DP_Free',
      });

      const lineIds = resp.line_ids || {};
      const list = resp.lines || [];

      const mapByName = new Map<string, string>();
      const mapByCode = new Map<string, string>();

      for (const name of list) {
        const id = lineIds[name];
        const idStr = id === undefined ? '' : String(id);
        mapByName.set(name, idStr);

        const code = fromLineId(idStr) || idStr || name;
        if (idStr) mapByCode.set(code, idStr);
      }

      this.lineIdByZoneAndName.set(zone.id, mapByName);
      this.lineIdByZoneAndCode.set(zone.id, mapByCode);

      const uniq = new Map<string, DnsLine>();
      for (const name of list) {
        const id = lineIds[name];
        const idStr = id === undefined ? '' : String(id);
        const code = fromLineId(idStr) || idStr || name;
        uniq.set(code, { code, name });
      }

      if (!uniq.has('default')) {
        uniq.set('default', { code: 'default', name: '默认' });
      }

      return { lines: Array.from(uniq.values()) };
    } catch (err) {
      throw this.wrapError(err);
    }
  }

  async getMinTTL(zoneId?: string): Promise<number> {
    try {
      if (!zoneId) return 600;
      const zone = await this.getZone(zoneId);
      const ttl = (zone.meta as any)?.ttl;
      const n = Number(ttl);
      return Number.isFinite(n) && n > 0 ? n : 600;
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
      const resp = await this.request<DomainInfoResponse>('Domain.Create', { domain: name });
      const d = resp.domain;
      if (!d?.id) {
        throw this.createError('CREATE_DOMAIN_FAILED', '创建域名失败', { meta: { response: resp } });
      }

      const zone = this.normalizeZone({
        id: String(d.id),
        name: d.name || name,
        status: d.status || 'active',
        updatedAt: d.updated_on,
        meta: { raw: d, grade: d.grade, ttl: d.ttl },
      });

      this.rememberZone(zone);
      return zone;
    } catch (err: any) {
      const code = String((err as any)?.details?.code || '');
      if (code === '34' || code === 'DomainAlreadyExist') {
        try {
          const existing = await this.getZone(name);
          return { ...existing, meta: { ...existing.meta, existed: true } };
        } catch {
          // 忽略
        }
      }
      throw this.wrapError(err);
    }
  }

  async deleteZone(zoneId: string): Promise<boolean> {
    const input = String(zoneId || '').trim();
    if (!input) {
      throw this.createError('INVALID_ZONE_ID', 'Zone ID 不能为空', { httpStatus: 400 });
    }

    try {
      if (/^\d+$/.test(input)) {
        const cachedName = this.domainIdToName.get(input);
        await this.request<CommonOkResponse>('Domain.Remove', { domain_id: input });
        this.domainIdToName.delete(input);
        if (cachedName) {
          this.domainNameToId.delete(cachedName);
        } else {
          for (const [name, id] of this.domainNameToId.entries()) {
            if (id === input) this.domainNameToId.delete(name);
          }
        }
        return true;
      }

      await this.request<CommonOkResponse>('Domain.Remove', { domain: input });
      const existingId = this.domainNameToId.get(input);
      if (existingId) this.domainIdToName.delete(existingId);
      this.domainNameToId.delete(input);
      return true;
    } catch (err) {
      throw this.wrapError(err);
    }
  }
}
