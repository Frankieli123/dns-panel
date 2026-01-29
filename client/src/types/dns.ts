export type ProviderType =
  | 'cloudflare'
  | 'aliyun'
  | 'dnspod'
  | 'dnspod_token'
  | 'huawei'
  | 'baidu'
  | 'west'
  | 'huoshan'
  | 'jdcloud'
  | 'dnsla'
  | 'namesilo'
  | 'powerdns'
  | 'spaceship';

export interface DnsCredential {
  id: number;
  name: string;
  provider: ProviderType;
  providerName?: string;
  accountId?: string | null;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * 供应商能力配置
 */
export interface ProviderCapabilities {
  supportsWeight: boolean;
  supportsLine: boolean;
  supportsStatus: boolean;
  supportsRemark: boolean;
  supportsUrlForward: boolean;
  supportsLogs: boolean;
  remarkMode: 'inline' | 'separate' | 'unsupported';
  paging: 'server' | 'client';
  requiresDomainId: boolean;
  recordTypes: string[];
}

export interface ProviderConfig {
  type: ProviderType;
  name: string;
  icon?: string;
  authFields: AuthField[];
  capabilities?: ProviderCapabilities;
}

export interface AuthField {
  key: string;
  label: string;
  type: 'text' | 'password' | 'url';
  placeholder?: string;
  required: boolean;
  helpText?: string;
}

/**
 * DNS线路
 */
export interface DnsLine {
  code: string;
  name: string;
  parentCode?: string;
}

export type DnsCredentialSecrets = Record<string, string>;
