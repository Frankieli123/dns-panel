/**
 * DNS Service - 统一门面
 * 为路由层提供统一的 DNS 操作接口，处理缓存、错误标准化和 domainId 预取
 */

import crypto from 'crypto';
import NodeCache from 'node-cache';
import { config } from '../../config';
import { ProviderRegistry, ProviderInit } from '../../providers/ProviderRegistry';
import { DnsProviderError } from '../../providers/base/BaseProvider';
import {
  CreateRecordParams,
  DnsRecord,
  IDnsProvider,
  LineListResult,
  ProviderCapabilities,
  ProviderType,
  RecordListResult,
  RecordQueryParams,
  UpdateRecordParams,
  Zone,
  ZoneListResult,
} from '../../providers/base/types';

/**
 * DNS Service 上下文
 */
export interface DnsServiceContext extends ProviderInit {
  credentialKey?: string; // 稳定的缓存命名空间标识（推荐使用凭证ID）
}

type CacheScope = 'zones' | 'records' | 'all';

/**
 * DNS Service 单例
 */
export class DnsService {
  private readonly cache: NodeCache;
  private readonly providerInstances = new Map<string, IDnsProvider>();
  private readonly cacheIndex = new Map<string, Set<string>>();

  constructor(cache?: NodeCache) {
    this.cache = cache || new NodeCache();
  }

  /**
   * 生成上下文唯一标识
   */
  private ctxKey(ctx: DnsServiceContext): string {
    if (ctx.credentialKey) {
      return `${ctx.provider}:${ctx.credentialKey}`;
    }

    // 基于 secrets 生成哈希
    const hash = crypto
      .createHash('sha1')
      .update(JSON.stringify({
        provider: ctx.provider,
        secrets: ctx.secrets,
        accountId: ctx.accountId,
      }))
      .digest('hex')
      .slice(0, 12);

    return `${ctx.provider}:${hash}`;
  }

  /**
   * 获取或创建 Provider 实例
   */
  private getProvider(ctx: DnsServiceContext): IDnsProvider {
    const key = this.ctxKey(ctx);
    const existing = this.providerInstances.get(key);

    if (existing) return existing;

    const provider = ProviderRegistry.createProvider(ctx);
    this.providerInstances.set(key, provider);
    return provider;
  }

  /**
   * 标准化错误
   */
  private normalizeError(provider: ProviderType, err: unknown): DnsProviderError {
    if (err instanceof DnsProviderError) return err;

    const message = (err as any)?.message ? String((err as any).message) : String(err);
    return new DnsProviderError(
      {
        provider,
        code: 'UNKNOWN',
        message,
        retriable: false,
        meta: { raw: err },
      },
      err
    );
  }

  /**
   * 缓存索引键
   */
  private indexKey(ctx: DnsServiceContext, zoneId?: string): string {
    return zoneId
      ? `${this.ctxKey(ctx)}:zone:${zoneId}`
      : `${this.ctxKey(ctx)}:global`;
  }

  /**
   * 记录缓存键到索引
   */
  private rememberKey(ctx: DnsServiceContext, cacheKey: string, zoneId?: string): void {
    const idxKey = this.indexKey(ctx, zoneId);
    const set = this.cacheIndex.get(idxKey) || new Set<string>();
    set.add(cacheKey);
    this.cacheIndex.set(idxKey, set);
  }

  /**
   * 失效缓存
   */
  private invalidate(ctx: DnsServiceContext, scope: CacheScope, zoneId?: string): void {
    const globalKey = this.indexKey(ctx);
    const zoneKey = zoneId ? this.indexKey(ctx, zoneId) : undefined;

    const keysToDelete: string[] = [];

    if (scope === 'all' || scope === 'zones') {
      const s = this.cacheIndex.get(globalKey);
      if (s) keysToDelete.push(...Array.from(s));
    }

    if ((scope === 'all' || scope === 'records') && zoneKey) {
      const s = this.cacheIndex.get(zoneKey);
      if (s) keysToDelete.push(...Array.from(s));
    }

    if (keysToDelete.length > 0) {
      this.cache.del(keysToDelete);
    }

    if (scope === 'all' || scope === 'zones') {
      this.cacheIndex.delete(globalKey);
    }

    if ((scope === 'all' || scope === 'records') && zoneKey) {
      this.cacheIndex.delete(zoneKey);
    }
  }

  /**
   * 解析 zoneId（处理需要 domainId 的提供商）
   */
  private async resolveZoneId(ctx: DnsServiceContext, zoneIdOrName: string): Promise<string> {
    const provider = this.getProvider(ctx);
    const caps = provider.getCapabilities();

    if (!caps.requiresDomainId) {
      return zoneIdOrName;
    }

    // 若传入的是数字 ID（如 DNSPod DomainId），直接返回
    const trimmed = String(zoneIdOrName || '').trim();
    if (/^\d+$/.test(trimmed)) {
      return trimmed;
    }

    // 对于使用非数字 ID 的提供商（如华为云 zone_id 为 UUID），若参数不像域名（不含 .），则视为 ID 直接返回
    if (!trimmed.includes('.')) {
      return trimmed;
    }

    // 对于需要 domainId 的提供商，通过域名名称查找
    const targetName = trimmed.toLowerCase();
    const pageSize = 100;

    for (let page = 1; page <= 200; page++) {
      const result = await this.getZones(ctx, page, pageSize);
      const match = result.zones.find(z => z.name.toLowerCase() === targetName);
      if (match) return match.id;
      if (page * pageSize >= result.total) break;
    }

    throw new DnsProviderError(
      {
        provider: ctx.provider,
        code: 'ZONE_NOT_FOUND',
        message: `域名不存在: ${zoneIdOrName}`,
        httpStatus: 404,
        retriable: false,
      },
      undefined
    );
  }

  // ========== 公共 API ==========

  /**
   * 获取提供商能力配置
   */
  getCapabilities(ctx: DnsServiceContext): ProviderCapabilities {
    const provider = this.getProvider(ctx);
    return provider.getCapabilities();
  }

  /**
   * 验证凭证
   */
  async checkAuth(ctx: DnsServiceContext): Promise<boolean> {
    const provider = this.getProvider(ctx);
    try {
      return await provider.checkAuth();
    } catch {
      return false;
    }
  }

  /**
   * 获取域名列表
   */
  async getZones(
    ctx: DnsServiceContext,
    page?: number,
    pageSize?: number,
    keyword?: string
  ): Promise<ZoneListResult> {
    const provider = this.getProvider(ctx);
    const caps = provider.getCapabilities();

    const cacheKey = `dns:${this.ctxKey(ctx)}:zones:${page || ''}:${pageSize || ''}:${keyword || ''}`;
    const cached = this.cache.get<ZoneListResult>(cacheKey);
    if (cached) return cached;

    try {
      const result = await provider.getZones(page, pageSize, keyword);
      const ttl = caps.domainCacheTtl ?? config.cache.domainsTTL;
      this.cache.set(cacheKey, result, ttl);
      this.rememberKey(ctx, cacheKey);
      return result;
    } catch (err) {
      throw this.normalizeError(ctx.provider, err);
    }
  }

  /**
   * 获取域名详情
   */
  async getZone(ctx: DnsServiceContext, zoneId: string): Promise<Zone> {
    const provider = this.getProvider(ctx);
    try {
      return await provider.getZone(zoneId);
    } catch (err) {
      throw this.normalizeError(ctx.provider, err);
    }
  }

  /**
   * 获取 DNS 记录列表
   */
  async getRecords(
    ctx: DnsServiceContext,
    zoneIdOrName: string,
    params?: RecordQueryParams
  ): Promise<RecordListResult> {
    const provider = this.getProvider(ctx);
    const caps = provider.getCapabilities();
    const zoneId = await this.resolveZoneId(ctx, zoneIdOrName);

    const paramsKey = params
      ? crypto.createHash('sha1').update(JSON.stringify(params)).digest('hex').slice(0, 10)
      : 'all';
    const cacheKey = `dns:${this.ctxKey(ctx)}:records:${zoneId}:${paramsKey}`;

    const cached = this.cache.get<RecordListResult>(cacheKey);
    if (cached) return cached;

    try {
      const result = await provider.getRecords(zoneId, params);
      const ttl = caps.recordCacheTtl ?? config.cache.recordsTTL;
      this.cache.set(cacheKey, result, ttl);
      this.rememberKey(ctx, cacheKey, zoneId);
      return result;
    } catch (err) {
      throw this.normalizeError(ctx.provider, err);
    }
  }

  /**
   * 获取单条 DNS 记录
   */
  async getRecord(
    ctx: DnsServiceContext,
    zoneIdOrName: string,
    recordId: string
  ): Promise<DnsRecord> {
    const provider = this.getProvider(ctx);
    const zoneId = await this.resolveZoneId(ctx, zoneIdOrName);

    try {
      return await provider.getRecord(zoneId, recordId);
    } catch (err) {
      throw this.normalizeError(ctx.provider, err);
    }
  }

  /**
   * 创建 DNS 记录
   */
  async createRecord(
    ctx: DnsServiceContext,
    zoneIdOrName: string,
    params: CreateRecordParams
  ): Promise<DnsRecord> {
    const provider = this.getProvider(ctx);
    const zoneId = await this.resolveZoneId(ctx, zoneIdOrName);

    try {
      const created = await provider.createRecord(zoneId, params);
      this.invalidate(ctx, 'records', zoneId);
      return created;
    } catch (err) {
      throw this.normalizeError(ctx.provider, err);
    }
  }

  /**
   * 更新 DNS 记录
   */
  async updateRecord(
    ctx: DnsServiceContext,
    zoneIdOrName: string,
    recordId: string,
    params: UpdateRecordParams
  ): Promise<DnsRecord> {
    const provider = this.getProvider(ctx);
    const zoneId = await this.resolveZoneId(ctx, zoneIdOrName);

    try {
      const updated = await provider.updateRecord(zoneId, recordId, params);
      this.invalidate(ctx, 'records', zoneId);
      return updated;
    } catch (err) {
      throw this.normalizeError(ctx.provider, err);
    }
  }

  /**
   * 删除 DNS 记录
   */
  async deleteRecord(
    ctx: DnsServiceContext,
    zoneIdOrName: string,
    recordId: string
  ): Promise<boolean> {
    const provider = this.getProvider(ctx);
    const zoneId = await this.resolveZoneId(ctx, zoneIdOrName);

    try {
      const ok = await provider.deleteRecord(zoneId, recordId);
      this.invalidate(ctx, 'records', zoneId);
      return ok;
    } catch (err) {
      throw this.normalizeError(ctx.provider, err);
    }
  }

  /**
   * 设置记录状态
   */
  async setRecordStatus(
    ctx: DnsServiceContext,
    zoneIdOrName: string,
    recordId: string,
    enabled: boolean
  ): Promise<boolean> {
    const provider = this.getProvider(ctx);
    const zoneId = await this.resolveZoneId(ctx, zoneIdOrName);

    try {
      const ok = await provider.setRecordStatus(zoneId, recordId, enabled);
      this.invalidate(ctx, 'records', zoneId);
      return ok;
    } catch (err) {
      throw this.normalizeError(ctx.provider, err);
    }
  }

  /**
   * 获取解析线路
   */
  async getLines(ctx: DnsServiceContext, zoneId?: string): Promise<LineListResult> {
    const provider = this.getProvider(ctx);
    try {
      return await provider.getLines(zoneId);
    } catch (err) {
      throw this.normalizeError(ctx.provider, err);
    }
  }

  /**
   * 获取最低 TTL
   */
  async getMinTTL(ctx: DnsServiceContext, zoneId?: string): Promise<number> {
    const provider = this.getProvider(ctx);
    try {
      return await provider.getMinTTL(zoneId);
    } catch (err) {
      throw this.normalizeError(ctx.provider, err);
    }
  }

  /**
   * 添加域名（如果提供商支持）
   */
  async addZone(ctx: DnsServiceContext, domain: string): Promise<Zone> {
    const provider = this.getProvider(ctx);
    if (!provider.addZone) {
      throw new DnsProviderError(
        {
          provider: ctx.provider,
          code: 'UNSUPPORTED',
          message: '该提供商不支持添加域名',
          httpStatus: 400,
          retriable: false,
        },
        undefined
      );
    }

    try {
      const zone = await provider.addZone(domain);
      this.invalidate(ctx, 'zones');
      return zone;
    } catch (err) {
      throw this.normalizeError(ctx.provider, err);
    }
  }

  /**
   * 删除域名（如果提供商支持）
   */
  async deleteZone(ctx: DnsServiceContext, zoneIdOrName: string): Promise<boolean> {
    const provider = this.getProvider(ctx);
    if (!provider.deleteZone) {
      throw new DnsProviderError(
        {
          provider: ctx.provider,
          code: 'UNSUPPORTED',
          message: '该提供商不支持删除域名',
          httpStatus: 400,
          retriable: false,
        },
        undefined
      );
    }

    const zoneId = await this.resolveZoneId(ctx, zoneIdOrName);

    try {
      const ok = await provider.deleteZone(zoneId);
      this.invalidate(ctx, 'all', zoneId);
      return ok;
    } catch (err) {
      throw this.normalizeError(ctx.provider, err);
    }
  }

  /**
   * 清除缓存
   */
  clearCache(ctx: DnsServiceContext, scope: CacheScope = 'all', zoneId?: string): void {
    this.invalidate(ctx, scope, zoneId);
  }

  /**
   * 清除所有缓存
   */
  clearAllCache(): void {
    this.cache.flushAll();
    this.cacheIndex.clear();
    this.providerInstances.clear();
  }
}

// 导出单例
export const dnsService = new DnsService();
