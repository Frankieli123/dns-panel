import Cloudflare from 'cloudflare';
import NodeCache from 'node-cache';
import crypto from 'crypto';
import { config } from '../config';
import { DNSRecord, Domain } from '../types';

const cache = new NodeCache();

type CfAccount = {
  id: string;
  name?: string;
};

/**
 * Cloudflare 服务
 */
export class CloudflareService {
  private client: Cloudflare;
  private readonly cachePrefix: string;

  constructor(apiToken: string) {
    // 清理 Token 中可能的空白字符
    const cleanToken = apiToken.trim().replace(/[\r\n\s]/g, '');
    this.client = new Cloudflare({ apiToken: cleanToken });
    this.cachePrefix = crypto.createHash('sha1').update(cleanToken).digest('hex').slice(0, 12);
  }

  private key(key: string): string {
    return `cf:${this.cachePrefix}:${key}`;
  }

  /**
   * 验证 Token 有效性
   */
  async verifyToken(): Promise<boolean> {
    try {
      await this.client.zones.list({ per_page: 1 });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 获取账户列表（Accounts）
   */
  async getAccounts(): Promise<CfAccount[]> {
    const cacheKey = this.key('accounts');
    const cached = cache.get<CfAccount[]>(cacheKey);
    if (cached) return cached;

    try {
      const response = await (this.client as any).accounts.list({ per_page: 50 } as any);
      const raw = (response as any)?.result ?? response ?? [];
      const list: CfAccount[] = Array.isArray(raw)
        ? raw
          .map((a: any) => ({
            id: typeof a?.id === 'string' ? a.id : '',
            name: typeof a?.name === 'string' ? a.name : undefined,
          }))
          .filter(a => !!a.id)
        : [];

      cache.set(cacheKey, list, config.cache.domainsTTL);
      return list;
    } catch (error: any) {
      const status = error?.status || error?.statusCode;
      let message = `获取账户列表失败: ${error?.message || String(error)}`;
      if (status === 401) {
        message = '获取账户列表失败: Cloudflare Token 无效或已过期';
      } else if (status === 403) {
        message = '获取账户列表失败: 权限不足，需要 Account:Read 权限';
      }
      const err = new Error(message);
      (err as any).status = status;
      throw err;
    }
  }

  /**
   * 获取默认账户 ID（无账号时返回空字符串）
   */
  async getDefaultAccountId(): Promise<string> {
    try {
      const accounts = await this.getAccounts();
      if (accounts[0]?.id) return accounts[0].id;
    } catch {
      // ignore and fallback to zone list
    }

    try {
      const response = await this.client.zones.list({ per_page: 1 } as any);
      const first = ((response as any)?.result || [])[0];
      const id = first?.account?.id;
      if (typeof id === 'string' && id.trim()) return id.trim();
    } catch {
      // ignore
    }

    return '';
  }

  /**
   * 获取所有域名（Zones）
   */
  async getDomains(): Promise<Domain[]> {
    const cacheKey = this.key('domains');
    const cached = cache.get<Domain[]>(cacheKey);

    if (cached) {
      return cached;
    }

    try {
      const perPage = 50;
      let page = 1;
      let totalPages = 1;
      const all: any[] = [];

      while (page <= totalPages && page <= 200) {
        const response = await this.client.zones.list({
          page,
          per_page: perPage,
        } as any);

        const batch = (response as any)?.result || [];
        all.push(...batch);

        const info = (response as any)?.result_info;
        const nextTotalPages = typeof info?.total_pages === 'number' ? info.total_pages : undefined;
        if (typeof nextTotalPages === 'number' && nextTotalPages > 0) {
          totalPages = nextTotalPages;
        } else {
          if (batch.length < perPage) break;
        }

        if (batch.length === 0) break;
        page += 1;
      }

      const domains: Domain[] = all.map((zone: any) => ({
        id: zone.id,
        name: zone.name,
        status: zone.status || 'active',
        updatedAt: zone.modified_on,
      }));

      cache.set(cacheKey, domains, config.cache.domainsTTL);
      return domains;
    } catch (error: any) {
      const status = error?.status || error?.statusCode;
      let message = `获取域名列表失败: ${error.message}`;
      if (status === 401) {
        message = '获取域名列表失败: Cloudflare Token 无效或已过期';
      } else if (status === 403) {
        message = '获取域名列表失败: 权限不足，需要 Zone:Read 权限';
      }
      const err = new Error(message);
      (err as any).status = status;
      throw err;
    }
  }

  /**
   * 获取域名详情
   */
  async getDomainById(zoneId: string): Promise<any> {
    try {
      const response = await this.client.zones.get({ zone_id: zoneId });
      return response;
    } catch (error: any) {
      const err = new Error(`获取域名详情失败: ${error.message}`);
      (err as any).status = error?.status || error?.statusCode;
      throw err;
    }
  }

  /**
   * 根据域名名称获取 Zone（可选按 accountId 过滤）
   */
  async getDomainByName(domain: string, accountId?: string): Promise<any | null> {
    const name = String(domain || '').trim();
    if (!name) return null;

    try {
      const response = await this.client.zones.list({
        per_page: 1,
        name,
        ...(accountId ? { account: { id: accountId } } : {}),
      } as any);

      const zones = (response as any)?.result || [];
      return zones[0] || null;
    } catch {
      return null;
    }
  }

  /**
   * 创建 Zone（域名）
   */
  async createZone(domain: string, accountId: string): Promise<any> {
    const name = String(domain || '').trim();
    const account = String(accountId || '').trim();
    if (!name) throw new Error('域名不能为空');
    if (!account) throw new Error('缺少 Cloudflare Account ID');

    try {
      const zone = await this.client.zones.create({
        account: { id: account },
        name,
        type: 'full',
      } as any);

      cache.del(this.key('domains'));
      return zone;
    } catch (error: any) {
      const status = error?.status || error?.statusCode;
      let message = `创建域名失败: ${error?.message || String(error)}`;
      if (status === 401) {
        message = '创建域名失败: Cloudflare Token 无效或已过期';
      } else if (status === 403) {
        message = '创建域名失败: 权限不足，可能需要 Zone:Edit 权限';
      }
      const err = new Error(message);
      (err as any).status = status;
      throw err;
    }
  }

  /**
   * 删除 Zone（域名）
   */
  async deleteZone(zoneId: string): Promise<boolean> {
    const id = String(zoneId || '').trim();
    if (!id) throw new Error('缺少 Zone ID');

    try {
      await (this.client.zones as any).delete({ zone_id: id } as any);
      cache.del(this.key('domains'));
      return true;
    } catch (error: any) {
      const status = error?.status || error?.statusCode;
      let message = `删除域名失败: ${error?.message || String(error)}`;
      if (status === 401) {
        message = '删除域名失败: Cloudflare Token 无效或已过期';
      } else if (status === 403) {
        message = '删除域名失败: 权限不足，可能需要 Zone:Edit 权限';
      }
      const err = new Error(message);
      (err as any).status = status;
      throw err;
    }
  }

  /**
   * 获取 DNS 记录列表
   */
  async getDNSRecords(zoneId: string): Promise<DNSRecord[]> {
    const cacheKey = this.key(`dns_records_${zoneId}`);
    const cached = cache.get<DNSRecord[]>(cacheKey);

    if (cached) {
      return cached;
    }

    try {
      const perPage = 100;
      let page = 1;
      let totalPages = 1;
      const all: any[] = [];

      while (page <= totalPages && page <= 200) {
        const response = await this.client.dns.records.list({
          zone_id: zoneId,
          page,
          per_page: perPage,
        } as any);

        const batch = (response as any)?.result || [];
        all.push(...batch);

        const info = (response as any)?.result_info;
        const nextTotalPages = typeof info?.total_pages === 'number' ? info.total_pages : undefined;
        if (typeof nextTotalPages === 'number' && nextTotalPages > 0) {
          totalPages = nextTotalPages;
        } else {
          if (batch.length < perPage) break;
        }

        if (batch.length === 0) break;
        page += 1;
      }

      const records: DNSRecord[] = all.map((record: any) => ({
        id: record.id,
        type: record.type,
        name: record.name,
        content: record.content,
        ttl: record.ttl,
        proxied: record.proxied || false,
        priority: record.priority,
      }));

      cache.set(cacheKey, records, config.cache.recordsTTL);
      return records;
    } catch (error: any) {
      const err = new Error(`获取 DNS 记录失败: ${error.message}`);
      (err as any).status = error?.status || error?.statusCode;
      throw err;
    }
  }

  /**
   * 创建 DNS 记录
   */
  async createDNSRecord(
    zoneId: string,
    params: {
      type: string;
      name: string;
      content: string;
      ttl?: number;
      proxied?: boolean;
      priority?: number;
    }
  ): Promise<DNSRecord> {
    try {
      const response = await this.client.dns.records.create({
        zone_id: zoneId,
        type: params.type as any,
        name: params.name,
        content: params.content,
        ttl: params.ttl || 1,
        proxied: params.proxied,
        priority: params.priority,
      } as any);

      // 清除缓存
      cache.del(this.key(`dns_records_${zoneId}`));

      return {
        id: response.id,
        type: response.type as any,
        name: response.name,
        content: response.content as string,
        ttl: response.ttl,
        proxied: (response as any).proxied || false,
        priority: (response as any).priority,
      };
    } catch (error: any) {
      const err = new Error(`创建 DNS 记录失败: ${error.message}`);
      (err as any).status = error?.status || error?.statusCode;
      throw err;
    }
  }

  /**
   * 更新 DNS 记录
   */
  async updateDNSRecord(
    zoneId: string,
    recordId: string,
    params: {
      type?: string;
      name?: string;
      content?: string;
      ttl?: number;
      proxied?: boolean;
      priority?: number;
    }
  ): Promise<DNSRecord> {
    try {
      const response = await this.client.dns.records.update(recordId, {
        zone_id: zoneId,
        ...params,
      } as any);

      // 清除缓存
      cache.del(this.key(`dns_records_${zoneId}`));

      return {
        id: response.id,
        type: response.type as any,
        name: response.name,
        content: response.content as string,
        ttl: response.ttl,
        proxied: (response as any).proxied || false,
        priority: (response as any).priority,
      };
    } catch (error: any) {
      const err = new Error(`更新 DNS 记录失败: ${error.message}`);
      (err as any).status = error?.status || error?.statusCode;
      throw err;
    }
  }

  /**
   * 删除 DNS 记录
   */
  async deleteDNSRecord(zoneId: string, recordId: string): Promise<void> {
    try {
      await this.client.dns.records.delete(recordId, { zone_id: zoneId });

      // 清除缓存
      cache.del(this.key(`dns_records_${zoneId}`));
    } catch (error: any) {
      const err = new Error(`删除 DNS 记录失败: ${error.message}`);
      (err as any).status = error?.status || error?.statusCode;
      throw err;
    }
  }

  /**
   * 获取自定义主机名列表
   */
  async getCustomHostnames(zoneId: string): Promise<any[]> {
    try {
      const response = await this.client.customHostnames.list({ zone_id: zoneId });
      return response.result || [];
    } catch (error: any) {
      const err = new Error(`获取自定义主机名失败: ${error.message}`);
      (err as any).status = error?.status || error?.statusCode;
      throw err;
    }
  }

  /**
   * 创建自定义主机名
   */
  async createCustomHostname(zoneId: string, hostname: string, customOriginServer?: string): Promise<any> {
    try {
      const payload: Record<string, unknown> = {
        zone_id: zoneId,
        hostname,
        ssl: { method: 'http', type: 'dv' },
      };

      const origin = typeof customOriginServer === 'string' ? customOriginServer.trim() : '';
      if (origin) {
        payload.custom_origin_server = origin;
      }

      const result = await this.client.customHostnames.create(payload as any);
      return result;
    } catch (error: any) {
      const err = new Error(`创建自定义主机名失败: ${error.message}`);
      (err as any).status = error?.status || error?.statusCode;
      throw err;
    }
  }

  /**
   * 删除自定义主机名
   */
  async deleteCustomHostname(zoneId: string, hostnameId: string): Promise<void> {
    try {
      await this.client.customHostnames.delete(hostnameId, { zone_id: zoneId });
    } catch (error: any) {
      const err = new Error(`删除自定义主机名失败: ${error.message}`);
      (err as any).status = error?.status || error?.statusCode;
      throw err;
    }
  }

  /**
   * 获取自定义主机名回退源
   */
  async getFallbackOrigin(zoneId: string): Promise<string> {
    try {
      const result = await this.client.customHostnames.fallbackOrigin.get({ zone_id: zoneId });
      return (result as any)?.origin || '';
    } catch (error: any) {
      // 某些情况下未设置返回空或404，视具体 API 表现而定
      return '';
    }
  }

  /**
   * 更新自定义主机名回退源
   */
  async updateFallbackOrigin(zoneId: string, origin: string): Promise<string> {
    try {
      const result = await this.client.customHostnames.fallbackOrigin.update({
        zone_id: zoneId,
        origin,
      });
      return (result as any)?.origin;
    } catch (error: any) {
      const err = new Error(`更新回退源失败: ${error.message}`);
      (err as any).status = error?.status || error?.statusCode;
      throw err;
    }
  }

  /**
   * 清除缓存
   */
  clearCache(key?: string) {
    if (key) {
      cache.del(this.key(key));
    } else {
      const prefix = `cf:${this.cachePrefix}:`;
      const keys = cache.keys();
      const toDelete = keys.filter(k => k.startsWith(prefix));
      if (toDelete.length > 0) {
        cache.del(toDelete);
      }
    }
  }
}
