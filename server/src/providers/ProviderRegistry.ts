/**
 * Provider Registry - 提供商注册表
 * 工厂模式：根据提供商类型实例化对应的 Provider
 */

import { decrypt } from '../utils/encryption';
import { CloudflareProvider, CLOUDFLARE_CAPABILITIES } from './cloudflare';
import { AliyunProvider, ALIYUN_CAPABILITIES } from './aliyun';
import { DnspodProvider, DNSPOD_CAPABILITIES } from './dnspod';
import { DnspodTokenProvider, DNSPOD_TOKEN_CAPABILITIES } from './dnspod_token';
import { HuaweiProvider, HUAWEI_CAPABILITIES } from './huawei';
import { BaiduProvider, BAIDU_CAPABILITIES } from './baidu';
import { WestProvider, WEST_CAPABILITIES } from './west';
import { HuoshanProvider, HUOSHAN_CAPABILITIES } from './huoshan';
import { JdcloudProvider, JDCLOUD_CAPABILITIES } from './jdcloud';
import { DnslaProvider, DNSLA_CAPABILITIES } from './dnsla';
import { NamesiloProvider, NAMESILO_CAPABILITIES } from './namesilo';
import { PowerdnsProvider, POWERDNS_CAPABILITIES } from './powerdns';
import { SpaceshipProvider, SPACESHIP_CAPABILITIES } from './spaceship';
import {
  IDnsProvider,
  ProviderCapabilities,
  ProviderCredentials,
  ProviderType,
} from './base/types';

/**
 * Provider 初始化参数
 */
export interface ProviderInit {
  provider: ProviderType;
  secrets: Record<string, string>;
  accountId?: string;
  encrypted?: boolean; // 默认 true，secrets 是否已加密
}

type ProviderConstructor = new (credentials: ProviderCredentials) => IDnsProvider;

/**
 * 安全解密（失败时返回原值）
 */
function safeDecrypt(value: string): string {
  try {
    return decrypt(value);
  } catch {
    return value;
  }
}

/**
 * Provider 注册表
 */
export class ProviderRegistry {
  /**
   * 提供商类映射
   */
  private static readonly providerMap: Record<string, ProviderConstructor> = {
    [ProviderType.CLOUDFLARE]: CloudflareProvider,
    [ProviderType.ALIYUN]: AliyunProvider,
    [ProviderType.DNSPOD]: DnspodProvider,
    [ProviderType.DNSPOD_TOKEN]: DnspodTokenProvider,
    [ProviderType.HUAWEI]: HuaweiProvider,
    [ProviderType.BAIDU]: BaiduProvider,
    [ProviderType.WEST]: WestProvider,
    [ProviderType.HUOSHAN]: HuoshanProvider,
    [ProviderType.JDCLOUD]: JdcloudProvider,
    [ProviderType.DNSLA]: DnslaProvider,
    [ProviderType.NAMESILO]: NamesiloProvider,
    [ProviderType.POWERDNS]: PowerdnsProvider,
    [ProviderType.SPACESHIP]: SpaceshipProvider,
  };

  /**
   * 提供商能力配置映射
   */
  private static readonly capabilitiesMap: Record<string, ProviderCapabilities> = {
    [ProviderType.CLOUDFLARE]: CLOUDFLARE_CAPABILITIES,
    [ProviderType.ALIYUN]: ALIYUN_CAPABILITIES,
    [ProviderType.DNSPOD]: DNSPOD_CAPABILITIES,
    [ProviderType.DNSPOD_TOKEN]: DNSPOD_TOKEN_CAPABILITIES,
    [ProviderType.HUAWEI]: HUAWEI_CAPABILITIES,
    [ProviderType.BAIDU]: BAIDU_CAPABILITIES,
    [ProviderType.WEST]: WEST_CAPABILITIES,
    [ProviderType.HUOSHAN]: HUOSHAN_CAPABILITIES,
    [ProviderType.JDCLOUD]: JDCLOUD_CAPABILITIES,
    [ProviderType.DNSLA]: DNSLA_CAPABILITIES,
    [ProviderType.NAMESILO]: NAMESILO_CAPABILITIES,
    [ProviderType.POWERDNS]: POWERDNS_CAPABILITIES,
    [ProviderType.SPACESHIP]: SPACESHIP_CAPABILITIES,
  };

  /**
   * 获取所有支持的提供商类型
   */
  static getSupportedProviders(): ProviderType[] {
    return Object.keys(this.providerMap) as ProviderType[];
  }

  /**
   * 检查提供商是否支持
   */
  static isSupported(provider: ProviderType): boolean {
    return provider in this.providerMap;
  }

  /**
   * 获取提供商能力配置
   */
  static getCapabilities(provider: ProviderType): ProviderCapabilities {
    const caps = this.capabilitiesMap[provider];
    if (!caps) {
      throw new Error(`不支持的提供商: ${provider}`);
    }
    return caps;
  }

  /**
   * 获取所有提供商的能力配置（用于前端展示）
   */
  static getAllCapabilities(): ProviderCapabilities[] {
    return Object.values(this.capabilitiesMap);
  }

  /**
   * 创建 Provider 实例
   */
  static createProvider(init: ProviderInit): IDnsProvider {
    const Provider = this.providerMap[init.provider];
    if (!Provider) {
      throw new Error(`不支持的提供商: ${init.provider}`);
    }

    // 解密 secrets
    const encrypted = init.encrypted !== false;
    const decryptedSecrets: Record<string, string> = {};

    for (const [key, value] of Object.entries(init.secrets || {})) {
      decryptedSecrets[key] = encrypted ? safeDecrypt(String(value)) : String(value);
    }

    const credentials: ProviderCredentials = {
      provider: init.provider,
      secrets: decryptedSecrets,
      accountId: init.accountId,
    };

    return new Provider(credentials);
  }

  /**
   * 注册新的提供商（用于动态扩展）
   */
  static registerProvider(
    type: ProviderType,
    constructor: ProviderConstructor,
    capabilities: ProviderCapabilities
  ): void {
    this.providerMap[type] = constructor;
    this.capabilitiesMap[type] = capabilities;
  }
}
