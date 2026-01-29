/**
 * Cloudflare DNS Provider 适配器
 * 将现有 CloudflareService 封装为统一的 IDnsProvider 接口
 */

import { CloudflareService } from '../../services/cloudflare';
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

/**
 * Cloudflare 能力配置
 */
export const CLOUDFLARE_CAPABILITIES: ProviderCapabilities = {
  provider: ProviderType.CLOUDFLARE,
  name: 'Cloudflare',

  // 功能支持
  supportsWeight: false,
  supportsLine: false,
  supportsStatus: false,       // Cloudflare 不支持禁用单条记录
  supportsRemark: true,        // 通过 comment 字段
  supportsUrlForward: false,
  supportsLogs: false,

  remarkMode: 'inline',
  paging: 'client',            // Cloudflare SDK 返回全部数据，客户端分页
  requiresDomainId: false,     // 直接使用 zone_id

  recordTypes: ['A', 'AAAA', 'CNAME', 'MX', 'TXT', 'SRV', 'CAA', 'NS', 'PTR'],

  authFields: [
    {
      name: 'apiToken',
      label: 'API Token',
      type: 'password',
      required: true,
      placeholder: '输入 Cloudflare API Token',
      helpText: '需要 Zone:Read 和 DNS:Edit 权限',
    },
  ],

  domainCacheTtl: 300,
  recordCacheTtl: 120,

  retryableErrors: ['RATE_LIMIT', 'TIMEOUT', 'ECONNRESET'],
  maxRetries: 3,
};

/**
 * Cloudflare Provider 实现
 */
export class CloudflareProvider extends BaseProvider {
  private readonly service: CloudflareService;

  constructor(credentials: ProviderCredentials) {
    super(credentials, CLOUDFLARE_CAPABILITIES);

    const apiToken = credentials.secrets?.apiToken;
    if (!apiToken) {
      throw this.createError('MISSING_CREDENTIALS', '缺少 Cloudflare API Token');
    }

    this.service = new CloudflareService(apiToken);
  }

  /**
   * 包装错误为统一格式
   */
  private wrapError(err: unknown, code = 'CLOUDFLARE_ERROR'): DnsProviderError {
    if (err instanceof DnsProviderError) return err;
    const message = (err as any)?.message ? String((err as any).message) : String(err);
    return this.createError(code, message, { cause: err });
  }

  private normalizeTxtValueForWrite(type: string, value: string): string {
    if (String(type).toUpperCase() !== 'TXT') return value;
    const raw = String(value ?? '');
    const trimmed = raw.trim();
    if (!trimmed) return raw;
    if (trimmed.startsWith('"') && trimmed.endsWith('"')) return trimmed;
    if (trimmed.includes('"')) return trimmed;
    return `"${trimmed}"`;
  }

  /**
   * 验证认证信息（使用轻量级 Token 验证，不需要 Zone:Read 权限）
   */
  async checkAuth(): Promise<boolean> {
    try {
      return await this.withRetry(() => this.service.verifyToken(), { maxRetries: 0 });
    } catch {
      return false;
    }
  }

  /**
   * 获取域名列表
   */
  async getZones(page?: number, pageSize?: number, keyword?: string): Promise<ZoneListResult> {
    try {
      const domains = await this.withRetry(() => this.service.getDomains());

      const zones: Zone[] = domains.map((d: any) =>
        this.normalizeZone({
          id: d.id,
          name: d.name,
          status: d.status,
          recordCount: d.recordCount,
          updatedAt: d.updatedAt,
          meta: { raw: d },
        })
      );

      return this.applyZoneQuery(zones, page, pageSize, keyword);
    } catch (err) {
      throw this.wrapError(err);
    }
  }

  /**
   * 获取域名详情
   */
  async getZone(zoneId: string): Promise<Zone> {
    try {
      const resp = await this.withRetry(() => this.service.getDomainById(zoneId));
      const raw = (resp as any)?.result ?? resp;

      return this.normalizeZone({
        id: raw?.id || zoneId,
        name: raw?.name || zoneId,
        status: raw?.status || 'unknown',
        recordCount: raw?.record_count,
        updatedAt: raw?.modified_on,
        meta: { raw },
      });
    } catch (err) {
      throw this.wrapError(err);
    }
  }

  /**
   * 获取 DNS 记录列表
   */
  async getRecords(zoneId: string, params?: RecordQueryParams): Promise<RecordListResult> {
    try {
      const zone = await this.getZone(zoneId);
      const records = await this.withRetry(() => this.service.getDNSRecords(zoneId));

      const normalized: DnsRecord[] = records.map((r: any) =>
        this.normalizeRecord({
          id: r.id,
          zoneId,
          zoneName: zone.name,
          name: r.name,
          type: r.type,
          value: r.content,
          ttl: r.ttl,
          priority: r.priority,
          proxied: !!r.proxied,
          remark: r.comment,
          meta: { raw: r },
        })
      );

      return this.applyRecordQuery(normalized, params);
    } catch (err) {
      throw this.wrapError(err);
    }
  }

  /**
   * 获取单条 DNS 记录
   */
  async getRecord(zoneId: string, recordId: string): Promise<DnsRecord> {
    try {
      const list = await this.getRecords(zoneId);
      const found = list.records.find(r => r.id === recordId);

      if (!found) {
        throw this.createError('NOT_FOUND', `记录不存在: ${recordId}`, { httpStatus: 404 });
      }

      return found;
    } catch (err) {
      throw this.wrapError(err);
    }
  }

  /**
   * 创建 DNS 记录
   */
  async createRecord(zoneId: string, params: CreateRecordParams): Promise<DnsRecord> {
    try {
      const zone = await this.getZone(zoneId);

      // 只有 A/AAAA/CNAME 支持代理
      const supportsProxied = ['A', 'AAAA', 'CNAME'].includes(params.type.toUpperCase());
      const proxied = supportsProxied ? params.proxied : undefined;
      const normalizedValue = this.normalizeTxtValueForWrite(params.type, params.value);

      const created = await this.withRetry(() =>
        this.service.createDNSRecord(zoneId, {
          type: params.type,
          name: params.name,
          content: normalizedValue,
          ttl: params.ttl,
          proxied,
          priority: params.priority,
        })
      );

      return this.normalizeRecord({
        id: created.id,
        zoneId,
        zoneName: zone.name,
        name: created.name,
        type: created.type,
        value: created.content,
        ttl: created.ttl,
        priority: created.priority,
        proxied: !!created.proxied,
        meta: { raw: created },
      });
    } catch (err) {
      throw this.wrapError(err);
    }
  }

  /**
   * 更新 DNS 记录
   */
  async updateRecord(zoneId: string, recordId: string, params: UpdateRecordParams): Promise<DnsRecord> {
    try {
      const zone = await this.getZone(zoneId);

      const supportsProxied = ['A', 'AAAA', 'CNAME'].includes(params.type.toUpperCase());
      const proxied = supportsProxied ? params.proxied : undefined;
      const normalizedValue = this.normalizeTxtValueForWrite(params.type, params.value);

      const updated = await this.withRetry(() =>
        this.service.updateDNSRecord(zoneId, recordId, {
          type: params.type,
          name: params.name,
          content: normalizedValue,
          ttl: params.ttl,
          proxied,
          priority: params.priority,
        })
      );

      return this.normalizeRecord({
        id: updated.id,
        zoneId,
        zoneName: zone.name,
        name: updated.name,
        type: updated.type,
        value: updated.content,
        ttl: updated.ttl,
        priority: updated.priority,
        proxied: !!updated.proxied,
        meta: { raw: updated },
      });
    } catch (err) {
      throw this.wrapError(err);
    }
  }

  /**
   * 删除 DNS 记录
   */
  async deleteRecord(zoneId: string, recordId: string): Promise<boolean> {
    try {
      await this.withRetry(() => this.service.deleteDNSRecord(zoneId, recordId));
      return true;
    } catch (err) {
      throw this.wrapError(err);
    }
  }

  /**
   * 设置记录状态（Cloudflare 不支持）
   */
  async setRecordStatus(_zoneId: string, _recordId: string, _enabled: boolean): Promise<boolean> {
    throw this.createError('UNSUPPORTED', 'Cloudflare 不支持启用/禁用单条 DNS 记录');
  }

  /**
   * 获取解析线路（Cloudflare 仅支持默认）
   */
  async getLines(_zoneId?: string): Promise<LineListResult> {
    const lines: DnsLine[] = [{ code: 'default', name: '默认' }];
    return { lines };
  }

  /**
   * 获取最低 TTL
   */
  async getMinTTL(_zoneId?: string): Promise<number> {
    // Cloudflare 支持 Auto TTL (值为1)
    return 1;
  }

  // ========== Cloudflare 特有功能 ==========

  /**
   * 获取自定义主机名列表
   */
  async getCustomHostnames(zoneId: string): Promise<any[]> {
    try {
      return await this.withRetry(() => this.service.getCustomHostnames(zoneId));
    } catch (err) {
      throw this.wrapError(err);
    }
  }

  /**
   * 创建自定义主机名
   */
  async createCustomHostname(zoneId: string, hostname: string): Promise<any> {
    try {
      return await this.withRetry(() => this.service.createCustomHostname(zoneId, hostname));
    } catch (err) {
      throw this.wrapError(err);
    }
  }

  /**
   * 删除自定义主机名
   */
  async deleteCustomHostname(zoneId: string, hostnameId: string): Promise<void> {
    try {
      await this.withRetry(() => this.service.deleteCustomHostname(zoneId, hostnameId));
    } catch (err) {
      throw this.wrapError(err);
    }
  }

  /**
   * 获取回退源
   */
  async getFallbackOrigin(zoneId: string): Promise<string> {
    try {
      return await this.withRetry(() => this.service.getFallbackOrigin(zoneId));
    } catch (err) {
      throw this.wrapError(err);
    }
  }

  /**
   * 更新回退源
   */
  async updateFallbackOrigin(zoneId: string, origin: string): Promise<string> {
    try {
      return await this.withRetry(() => this.service.updateFallbackOrigin(zoneId, origin));
    } catch (err) {
      throw this.wrapError(err);
    }
  }

  /**
   * 清除缓存
   */
  clearCache(key?: string): void {
    this.service.clearCache(key);
  }
}
