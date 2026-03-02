/**
 * 用户类型
 */
export interface User {
  id: number;
  username: string;
  email?: string | null;
  cfAccountId?: string;
  domainExpiryDisplayMode?: 'date' | 'days';
  domainExpiryThresholdDays?: number;
  domainExpiryNotifyEnabled?: boolean;
  domainExpiryNotifyWebhookUrl?: string | null;
  domainExpiryNotifyEmailEnabled?: boolean;
  domainExpiryNotifyEmailTo?: string | null;
  smtpHost?: string | null;
  smtpPort?: number | null;
  smtpSecure?: boolean | null;
  smtpUser?: string | null;
  smtpFrom?: string | null;
  smtpPassConfigured?: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * 登录响应
 */
export interface LoginResponse {
  success: boolean;
  message: string;
  data: {
    requires2FA?: boolean;
    tempToken?: string;
    token?: string;
    user?: User;
  };
}

/**
 * DNS 记录类型
 */
export type DNSRecordType =
  | 'A'
  | 'AAAA'
  | 'CNAME'
  | 'MX'
  | 'TXT'
  | 'SRV'
  | 'CAA'
  | 'NS'
  | 'PTR'
  | 'REDIRECT_URL'
  | 'FORWARD_URL';

/**
 * DNS 记录
 */
export interface DNSRecord {
  id: string;
  type: DNSRecordType;
  zoneName?: string;
  name: string;
  content: string;
  ttl: number;
  proxied: boolean;
  priority?: number;
  weight?: number;
  line?: string;
  lineName?: string;
  remark?: string;
  enabled?: boolean;
}

import { ProviderType } from './dns';

/**
 * 域名
 */
export interface Domain {
  id: string;
  name: string;
  status: string;
  recordCount?: number;
  updatedAt?: string;
  credentialId?: number;
  credentialName?: string;
  provider?: ProviderType;
  region?: string;
  accessType?: string;
  coverage?: string;
  instanceId?: string;
  planName?: string;
  planSpecName?: string;
  tags?: Record<string, string>;
}

/**
 * 操作日志
 */
export interface Log {
  id: number;
  timestamp: string;
  action: 'CREATE' | 'UPDATE' | 'DELETE';
  resourceType: 'DNS' | 'ZONE' | 'HOSTNAME' | 'TUNNEL' | 'USER' | 'CREDENTIAL';
  domain?: string;
  recordName?: string;
  recordType?: string;
  oldValue?: string;
  newValue?: string;
  status: 'SUCCESS' | 'FAILED';
  errorMessage?: string;
  ipAddress?: string;
}

/**
 * 自定义主机名
 */
export interface CustomHostname {
  id: string;
  hostname: string;
  status?: string;
  ssl: {
    status: string;
    method: string;
    type: string;
    validation_records?: {
      txt_name?: string;
      txt_value?: string;
    }[];
    validation_errors?: any[];
  };
  ownership_verification?: {
    type: string;
    name: string;
    value: string;
  };
  created_at: string;
}

/**
 * Cloudflare Tunnel
 */
export interface Tunnel {
  id: string;
  name?: string;
  status?: 'inactive' | 'degraded' | 'healthy' | 'down';
  created_at?: string;
  deleted_at?: string;
  connections?: Array<{
    colo_name?: string;
    is_pending_reconnect?: boolean;
    uuid?: string;
    client_id?: string;
    client_version?: string;
    opened_at?: string;
    origin_ip?: string;
  }>;
  conns_active_at?: string;
  conns_inactive_at?: string;
  remote_config?: boolean;
  tun_type?: string;
}

export interface TunnelPublicHostnameRoute {
  hostname: string;
  service: string;
  path?: string;
}

export interface TunnelCidrRoute {
  id: string;
  network: string;
  comment?: string;
  tunnelId?: string;
  virtualNetworkId?: string;
  createdAt?: string;
}

export interface TunnelHostnameRoute {
  id: string;
  hostname: string;
  comment?: string;
  tunnelId?: string;
  createdAt?: string;
}

/**
 * Cloudflare 凭证
 */
export interface CfCredential {
  id: number;
  name: string;
  accountId?: string | null;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * API 响应
 */
export interface ApiResponse<T = any> {
  success: boolean;
  message: string;
  data?: T;
  pagination?: {
    total: number;
    page: number;
    limit: number;
    pages: number;
  };
}
