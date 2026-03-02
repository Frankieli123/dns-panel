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
  private readonly apiToken: string;

  constructor(apiToken: string) {
    // 清理 Token 中可能的空白字符
    const cleanToken = apiToken.trim().replace(/[\r\n\s]/g, '');
    this.client = new Cloudflare({ apiToken: cleanToken });
    this.apiToken = cleanToken;
    this.cachePrefix = crypto.createHash('sha1').update(cleanToken).digest('hex').slice(0, 12);
  }

  private key(key: string): string {
    return `cf:${this.cachePrefix}:${key}`;
  }

  private buildTunnelError(action: string, error: any): never {
    const status = typeof error?.status === 'number'
      ? error.status
      : (typeof error?.statusCode === 'number' ? error.statusCode : undefined);

    const cfErrors = Array.isArray(error?.errors)
      ? error.errors
      : (Array.isArray(error?.error?.errors) ? error.error.errors : []);

    const cfFirstMessage = cfErrors[0]?.message;
    const hasAuthError = cfErrors.some((e: any) =>
      e?.code === 10000 || /Authentication error/i.test(String(e?.message || ''))
    ) || /Authentication error/i.test(String(error?.message || ''));

    if (status === 401) {
      const err = new Error(`Cloudflare Token 无效或已过期，无法${action}。`);
      (err as any).status = status;
      throw err;
    }

    if (status === 403 && hasAuthError) {
      const err = new Error(
        `Cloudflare 权限不足，无法${action}。请在 Token 权限中添加：账户.Cloudflare Tunnel（读取/编辑）。`
      );
      (err as any).status = status;
      throw err;
    }

    if (status === 429) {
      const err = new Error(`Cloudflare API 请求过于频繁（触发限流），无法${action}。请稍后重试。`);
      (err as any).status = status;
      throw err;
    }

    if (typeof status === 'number' && status >= 500) {
      const err = new Error(`Cloudflare 服务暂时不可用，无法${action}。请稍后重试。`);
      (err as any).status = status;
      throw err;
    }

    const msg = `${action}失败: ${typeof cfFirstMessage === 'string' && cfFirstMessage.trim()
      ? cfFirstMessage
      : (error?.message || String(error))}`;
    const err = new Error(msg);
    (err as any).status = status;
    throw err;
  }

  private async requestTunnelRaw(
    action: string,
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    opts?: {
      query?: Record<string, string | number | boolean | undefined>;
      body?: any;
    }
  ): Promise<any> {
    const base = 'https://api.cloudflare.com/client/v4';
    const url = new URL(`${base}${path}`);

    const query = opts?.query || {};
    Object.entries(query).forEach(([k, v]) => {
      if (v === undefined || v === null || v === '') return;
      url.searchParams.set(k, String(v));
    });

    let response: Response;
    try {
      response = await fetch(url.toString(), {
        method,
        headers: {
          Authorization: `Bearer ${this.apiToken}`,
          'Content-Type': 'application/json',
        },
        body: opts?.body ? JSON.stringify(opts.body) : undefined,
      });
    } catch (error: any) {
      const err = new Error(error?.message || String(error) || '网络请求失败');
      (err as any).status = 503;
      throw err;
    }

    let payload: any = null;
    try {
      payload = await response.json();
    } catch {}

    if (!response.ok || payload?.success === false) {
      const err = new Error(
        payload?.errors?.[0]?.message || payload?.messages?.[0]?.message || payload?.message || response.statusText || '未知错误'
      );
      (err as any).status = response.status;
      (err as any).errors = Array.isArray(payload?.errors) ? payload.errors : [];
      throw err;
    }

    return payload?.result ?? payload;
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
      } else if (status === 429) {
        message = '获取域名列表失败: Cloudflare API 请求过于频繁（触发限流），请稍后重试';
      } else if (typeof status === 'number' && status >= 500) {
        message = '获取域名列表失败: Cloudflare 服务异常，请稍后重试';
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
   * 获取 Tunnel 列表（Account 级别）
   */
  async getTunnels(accountId: string): Promise<any[]> {
    try {
      const perPage = 50;
      let page = 1;
      let totalPages = 1;
      const all: any[] = [];

      while (page <= totalPages && page <= 200) {
        const response = await (this.client as any).zeroTrust.tunnels.list({
          account_id: accountId,
          page,
          per_page: perPage,
        });

        const batch = (response as any)?.result || [];
        all.push(...batch);

        const info = (response as any)?.result_info;
        const nextTotalPages = typeof info?.total_pages === 'number' ? info.total_pages : undefined;
        if (typeof nextTotalPages === 'number' && nextTotalPages > 0) {
          totalPages = nextTotalPages;
        } else if (batch.length < perPage) {
          break;
        }

        if (batch.length === 0) break;
        page += 1;
      }

      return all;
    } catch (error: any) {
      this.buildTunnelError('获取 Tunnel 列表', error);
    }
  }

  /**
   * 创建 Tunnel（Account 级别）
   */
  async createTunnel(accountId: string, name: string): Promise<any> {
    try {
      const tunnelSecret = crypto.randomBytes(32).toString('base64');
      const result = await (this.client as any).zeroTrust.tunnels.create({
        account_id: accountId,
        name,
        tunnel_secret: tunnelSecret,
      });
      return result;
    } catch (error: any) {
      this.buildTunnelError('创建 Tunnel', error);
    }
  }

  /**
   * 删除 Tunnel（Account 级别）
   */
  async deleteTunnel(accountId: string, tunnelId: string): Promise<any> {
    try {
      const result = await (this.client as any).zeroTrust.tunnels.delete(tunnelId, {
        account_id: accountId,
      });
      return result;
    } catch (error: any) {
      this.buildTunnelError('删除 Tunnel', error);
    }
  }

  /**
   * 获取 Tunnel Token（用于 cloudflared 绑定）
   */
  async getTunnelToken(accountId: string, tunnelId: string): Promise<string> {
    try {
      const result = await (this.client as any).zeroTrust.tunnels.token.get(tunnelId, {
        account_id: accountId,
      });

      if (typeof result === 'string') return result;
      return JSON.stringify(result);
    } catch (error: any) {
      this.buildTunnelError('获取 Tunnel Token', error);
    }
  }

  /**
   * 获取 Tunnel 配置（ingress/public hostnames）
   */
  async getTunnelConfig(accountId: string, tunnelId: string): Promise<any> {
    try {
      const result = await (this.client as any).zeroTrust.tunnels.configurations.get(tunnelId, {
        account_id: accountId,
      });
      return result;
    } catch (error: any) {
      this.buildTunnelError('获取 Tunnel 配置', error);
    }
  }

  /**
   * 更新 Tunnel 配置（ingress/public hostnames）
   */
  async updateTunnelConfig(accountId: string, tunnelId: string, config: any): Promise<any> {
    try {
      const result = await (this.client as any).zeroTrust.tunnels.configurations.update(tunnelId, {
        account_id: accountId,
        config,
      });
      return result;
    } catch (error: any) {
      this.buildTunnelError('更新 Tunnel 配置', error);
    }
  }

  /**
   * 获取 Tunnel 对应的 CIDR 路由列表（private network routes）
   */
  async listCidrRoutes(accountId: string, tunnelId?: string): Promise<any[]> {
    try {
      const perPage = 100;
      let page = 1;
      let totalPages = 1;
      const all: any[] = [];

      while (page <= totalPages && page <= 200) {
        const response = await (this.client as any).zeroTrust.networks.routes.list({
          account_id: accountId,
          tunnel_id: tunnelId,
          is_deleted: false,
          page,
          per_page: perPage,
        });

        const batch = (response as any)?.result || (Array.isArray(response) ? response : []);
        all.push(...batch);

        const info = (response as any)?.result_info;
        const nextTotalPages = typeof info?.total_pages === 'number' ? info.total_pages : undefined;
        if (typeof nextTotalPages === 'number' && nextTotalPages > 0) {
          totalPages = nextTotalPages;
        } else if (batch.length < perPage) {
          break;
        }

        if (batch.length === 0) break;
        page += 1;
      }

      return all;
    } catch (error: any) {
      this.buildTunnelError('获取 CIDR 路由列表', error);
    }
  }

  /**
   * 创建 Tunnel CIDR 路由
   */
  async createCidrRoute(
    accountId: string,
    params: { network: string; tunnelId: string; comment?: string; virtualNetworkId?: string }
  ): Promise<any> {
    try {
      const result = await (this.client as any).zeroTrust.networks.routes.create({
        account_id: accountId,
        network: params.network,
        tunnel_id: params.tunnelId,
        comment: params.comment,
        virtual_network_id: params.virtualNetworkId,
      });
      return result;
    } catch (error: any) {
      this.buildTunnelError('创建 CIDR 路由', error);
    }
  }

  /**
   * 删除 Tunnel CIDR 路由
   */
  async deleteCidrRoute(accountId: string, routeId: string): Promise<any> {
    try {
      const result = await (this.client as any).zeroTrust.networks.routes.delete(routeId, {
        account_id: accountId,
      });
      return result;
    } catch (error: any) {
      this.buildTunnelError('删除 CIDR 路由', error);
    }
  }

  /**
   * 获取 Tunnel 对应的主机名路由列表（private hostname routes）
   */
  async listHostnameRoutes(accountId: string, tunnelId?: string): Promise<any[]> {
    try {
      const perPage = 100;
      let page = 1;
      let totalPages = 1;
      const all: any[] = [];

      while (page <= totalPages && page <= 200) {
        const result = await this.requestTunnelRaw(
          '获取主机名路由列表',
          'GET',
          `/accounts/${accountId}/zerotrust/routes/hostname`,
          { query: { tunnel_id: tunnelId, page, per_page: perPage } }
        );

        const batch = Array.isArray(result)
          ? result
          : (Array.isArray(result?.result) ? result.result : []);
        all.push(...batch);

        const info = (result as any)?.result_info;
        const nextTotalPages = typeof info?.total_pages === 'number' ? info.total_pages : undefined;
        if (typeof nextTotalPages === 'number' && nextTotalPages > 0) {
          totalPages = nextTotalPages;
        } else if (batch.length < perPage) {
          break;
        }

        if (batch.length === 0) break;
        page += 1;
      }

      if (!tunnelId) return all;
      return all.filter((r: any) => String(r?.tunnel_id || '').trim() === tunnelId);
    } catch (error: any) {
      this.buildTunnelError('获取主机名路由列表', error);
    }
  }

  /**
   * 创建 Tunnel 主机名路由
   */
  async createHostnameRoute(
    accountId: string,
    params: { hostname: string; tunnelId: string; comment?: string }
  ): Promise<any> {
    try {
      const result = await this.requestTunnelRaw(
        '创建主机名路由',
        'POST',
        `/accounts/${accountId}/zerotrust/routes/hostname`,
        {
          body: {
            hostname: params.hostname,
            tunnel_id: params.tunnelId,
            comment: params.comment,
          },
        }
      );
      return result;
    } catch (error: any) {
      this.buildTunnelError('创建主机名路由', error);
    }
  }

  /**
   * 删除 Tunnel 主机名路由
   */
  async deleteHostnameRoute(accountId: string, routeId: string): Promise<any> {
    try {
      const result = await this.requestTunnelRaw(
        '删除主机名路由',
        'DELETE',
        `/accounts/${accountId}/zerotrust/routes/hostname/${routeId}`
      );
      return result;
    } catch (error: any) {
      this.buildTunnelError('删除主机名路由', error);
    }
  }

  private normalizeHostname(input: unknown): string {
    return String(input ?? '').trim().replace(/\.+$/, '').toLowerCase();
  }

  /**
   * 创建/更新 Tunnel 对应的 CNAME 记录（指向 <tunnelId>.cfargotunnel.com）
   * 说明：Cloudflare Tunnel 的 public hostname 需要 proxied CNAME 记录。
   */
  async upsertTunnelCnameRecord(zoneId: string, hostname: string, tunnelId: string): Promise<{ action: 'created' | 'updated' | 'unchanged' }> {
    const zone = String(zoneId || '').trim();
    const name = this.normalizeHostname(hostname);
    const tid = String(tunnelId || '').trim();
    if (!zone) throw new Error('缺少 Zone ID');
    if (!name) throw new Error('缺少主机名');
    if (!tid) throw new Error('缺少 Tunnel ID');

    const target = `${tid}.cfargotunnel.com`;
    const normalizeTarget = (v: any) => String(v ?? '').trim().toLowerCase().replace(/\.$/, '');
    const targetNorm = normalizeTarget(target);

    try {
      const listResp = await (this.client.dns.records as any).list({
        zone_id: zone,
        name,
        per_page: 100,
      } as any);

      const records: any[] = (listResp as any)?.result || [];
      const matches = records.filter(r => this.normalizeHostname(r?.name) === name);
      const cnames = matches.filter(r => String(r?.type || '').toUpperCase() === 'CNAME');
      const others = matches.filter(r => String(r?.type || '').toUpperCase() !== 'CNAME');

      if (others.length > 0) {
        const types = [...new Set(others.map(r => String(r?.type || '').toUpperCase()).filter(Boolean))].join(', ') || '未知类型';
        const err = new Error(`配置 DNS 记录失败: 主机名已存在非 CNAME 记录（${types}），无法创建 Tunnel CNAME，请先删除/改名`);
        (err as any).status = 400;
        throw err;
      }

      const existing = cnames[0];

      if (existing) {
        const existingContent = normalizeTarget(existing?.content);
        const existingProxied = existing?.proxied === true;
        const needsUpdate = existingContent !== targetNorm || !existingProxied;

        if (!needsUpdate) return { action: 'unchanged' };

        await (this.client.dns.records as any).update(existing.id, {
          zone_id: zone,
          type: 'CNAME',
          name,
          content: target,
          proxied: true,
          ttl: 1,
        } as any);

        cache.del(this.key(`dns_records_${zone}`));
        return { action: 'updated' };
      }

      await (this.client.dns.records as any).create({
        zone_id: zone,
        type: 'CNAME',
        name,
        content: target,
        proxied: true,
        ttl: 1,
      } as any);

      cache.del(this.key(`dns_records_${zone}`));
      return { action: 'created' };
    } catch (error: any) {
      const status = error?.status || error?.statusCode;
      let message = `配置 DNS 记录失败: ${error?.message || String(error)}`;
      if (status === 401) {
        message = '配置 DNS 记录失败: Cloudflare Token 无效或已过期';
      } else if (status === 403) {
        message = '配置 DNS 记录失败: 权限不足，请在 Token 权限中添加 区域.DNS（编辑）';
      } else if (status === 429) {
        message = '配置 DNS 记录失败: Cloudflare API 请求过于频繁（触发限流），请稍后重试';
      } else if (typeof status === 'number' && status >= 500) {
        message = '配置 DNS 记录失败: Cloudflare 服务异常，请稍后重试';
      }
      const err = new Error(message);
      (err as any).status = status;
      throw err;
    }
  }

  /**
   * 删除 Tunnel CNAME 记录（仅当记录指向 <tunnelId>.cfargotunnel.com 时）
   */
  async deleteTunnelCnameRecordIfMatch(zoneId: string, hostname: string, tunnelId: string): Promise<{ deleted: boolean }> {
    const zone = String(zoneId || '').trim();
    const name = this.normalizeHostname(hostname);
    const tid = String(tunnelId || '').trim();
    if (!zone) throw new Error('缺少 Zone ID');
    if (!name) throw new Error('缺少主机名');
    if (!tid) throw new Error('缺少 Tunnel ID');

    const target = `${tid}.cfargotunnel.com`.toLowerCase();

    try {
      const listResp = await (this.client.dns.records as any).list({
        zone_id: zone,
        type: 'CNAME',
        name,
        per_page: 100,
      } as any);

      const records: any[] = (listResp as any)?.result || [];
      const normalizeTarget = (v: any) => String(v ?? '').trim().toLowerCase().replace(/\.$/, '');
      const candidates = records.filter(r => this.normalizeHostname(r?.name) === name);
      const toDelete = candidates.find(r => normalizeTarget(r?.content) === target);
      if (!toDelete?.id) return { deleted: false };

      await (this.client.dns.records as any).delete(toDelete.id, { zone_id: zone } as any);
      cache.del(this.key(`dns_records_${zone}`));
      return { deleted: true };
    } catch (error: any) {
      const status = error?.status || error?.statusCode;
      let message = `删除 DNS 记录失败: ${error?.message || String(error)}`;
      if (status === 401) {
        message = '删除 DNS 记录失败: Cloudflare Token 无效或已过期';
      } else if (status === 403) {
        message = '删除 DNS 记录失败: 权限不足，请在 Token 权限中添加 区域.DNS（编辑）';
      } else if (status === 429) {
        message = '删除 DNS 记录失败: Cloudflare API 请求过于频繁（触发限流），请稍后重试';
      } else if (typeof status === 'number' && status >= 500) {
        message = '删除 DNS 记录失败: Cloudflare 服务异常，请稍后重试';
      }
      const err = new Error(message);
      (err as any).status = status;
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
