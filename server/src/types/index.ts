import { Request } from 'express';

/**
 * 扩展 Express Request 类型，添加用户信息
 */
export interface AuthRequest extends Request {
  user?: {
    id: number;
    username: string;
    email: string;
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
  | 'PTR';

/**
 * 操作类型
 */
export type ActionType = 'CREATE' | 'UPDATE' | 'DELETE';

/**
 * 资源类型
 */
export type ResourceType =
  | 'DNS'
  | 'ZONE'
  | 'HOSTNAME'
  | 'TUNNEL'
  | 'USER'
  | 'FALLBACK_ORIGIN'
  | 'CREDENTIAL'
  | 'DOMAIN_EXPIRY';

/**
 * 操作状态
 */
export type OperationStatus = 'SUCCESS' | 'FAILED';

/**
 * DNS 记录接口
 */
export interface DNSRecord {
  id: string;
  type: DNSRecordType;
  name: string;
  content: string;
  ttl: number;
  proxied: boolean;
  priority?: number;
}

/**
 * 域名接口
 */
export interface Domain {
  id: string;
  name: string;
  status: string;
  recordCount?: number;
  updatedAt?: string;
}

/**
 * 日志创建参数
 */
export interface LogCreateParams {
  userId: number;
  action: ActionType;
  resourceType: ResourceType;
  domain?: string;
  recordName?: string;
  recordType?: string;
  oldValue?: string;
  newValue?: string;
  status: OperationStatus;
  errorMessage?: string;
  ipAddress?: string;
}
