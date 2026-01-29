import api from './api';
import { ApiResponse, DNSRecord } from '@/types';
import { DnsLine } from '@/types/dns';

export interface RecordsResponseCapabilities {
  supportsWeight?: boolean;
  supportsLine?: boolean;
  supportsStatus?: boolean;
  supportsRemark?: boolean;
}

/**
 * 获取 DNS 记录列表
 */
export const getDNSRecords = async (
  zoneId: string,
  credentialId?: number
): Promise<ApiResponse<{ records: DNSRecord[]; capabilities?: RecordsResponseCapabilities }>> => {
  const params = credentialId !== undefined ? { credentialId } : {};

  const pageSize = 500;
  let page = 1;
  let total = 0;
  const rawRecords: any[] = [];
  let firstResponse: any | undefined;

  while (page <= 200) {
    const response = await api.get(`/dns-records/zones/${zoneId}/records`, {
      params: {
        ...params,
        page,
        pageSize,
      },
    });

    if (!firstResponse) firstResponse = response;

    const batch = (response as any)?.data?.records || [];
    total = (response as any)?.data?.total ?? total;
    rawRecords.push(...batch);

    if (batch.length === 0) break;
    if (total > 0 && rawRecords.length >= total) break;
    page += 1;
  }

  const records: DNSRecord[] = rawRecords.map((r: any) => ({
    id: r.id,
    type: r.type,
    zoneName: r.zoneName,
    name: r.name,
    content: r.value,
    ttl: r.ttl,
    proxied: !!r.proxied,
    priority: r.priority,
    weight: r.weight,
    line: r.line,
    lineName: r.lineName,
    remark: r.remark,
    enabled:
      typeof r.enabled === 'boolean'
        ? r.enabled
        : r.status === '1'
          ? true
          : r.status === '0'
            ? false
            : undefined,
  }));

  const capabilities = (firstResponse as any)?.data?.capabilities;

  return {
    ...(firstResponse as any),
    data: {
      ...(firstResponse as any)?.data,
      records,
      capabilities,
    },
  } as ApiResponse<{ records: DNSRecord[]; capabilities?: RecordsResponseCapabilities }>;
};

/**
 * 获取解析线路列表
 */
export const getDNSLines = async (
  zoneId: string,
  credentialId?: number
): Promise<ApiResponse<{ lines: DnsLine[] }>> => {
  const params = credentialId !== undefined ? { credentialId } : {};
  const response = await api.get(`/dns-records/zones/${zoneId}/lines`, { params });
  return response as unknown as ApiResponse<{ lines: DnsLine[] }>;
};

export const getDNSMinTTL = async (
  zoneId: string,
  credentialId?: number
): Promise<ApiResponse<{ minTTL: number }>> => {
  const params = credentialId !== undefined ? { credentialId } : {};
  const response = await api.get(`/dns-records/zones/${zoneId}/min-ttl`, { params });
  return response as unknown as ApiResponse<{ minTTL: number }>;
};

/**
 * 创建 DNS 记录
 */
export const createDNSRecord = async (
  zoneId: string,
  params: {
    type: string;
    name: string;
    content: string;
    ttl?: number;
    proxied?: boolean;
    priority?: number;
    weight?: number;
    line?: string;
    remark?: string;
  },
  credentialId?: number
): Promise<ApiResponse<{ record: DNSRecord }>> => {
  const queryParams = credentialId !== undefined ? { credentialId } : {};

  const response = await api.post(
    `/dns-records/zones/${zoneId}/records`,
    {
      name: params.name,
      type: params.type,
      value: params.content,
      ttl: params.ttl,
      proxied: params.proxied,
      priority: params.priority,
      weight: params.weight,
      line: params.line,
      remark: params.remark,
    },
    { params: queryParams }
  );

  const r = (response as any)?.data?.record;
  const record: DNSRecord | null = r
    ? {
        id: r.id,
        type: r.type,
        name: r.name,
        content: r.value,
        ttl: r.ttl,
        proxied: !!r.proxied,
        priority: r.priority,
        weight: r.weight,
        line: r.line,
        lineName: r.lineName,
        remark: r.remark,
        enabled: r.enabled,
      }
    : null;

  return {
    ...(response as any),
    data: {
      ...(response as any)?.data,
      record,
    },
  } as ApiResponse<{ record: DNSRecord }>;
};

/**
 * 更新 DNS 记录
 */
export const updateDNSRecord = async (
  zoneId: string,
  recordId: string,
  params: {
    type?: string;
    name?: string;
    content?: string;
    ttl?: number;
    proxied?: boolean;
    priority?: number;
    weight?: number;
    line?: string;
    remark?: string;
  },
  credentialId?: number
): Promise<ApiResponse<{ record: DNSRecord }>> => {
  const queryParams = credentialId !== undefined ? { credentialId } : {};

  const response = await api.put(
    `/dns-records/zones/${zoneId}/records/${recordId}`,
    {
      name: params.name,
      type: params.type,
      value: params.content,
      ttl: params.ttl,
      proxied: params.proxied,
      priority: params.priority,
      weight: params.weight,
      line: params.line,
      remark: params.remark,
    },
    { params: queryParams }
  );

  const r = (response as any)?.data?.record;
  const record: DNSRecord | null = r
    ? {
        id: r.id,
        type: r.type,
        name: r.name,
        content: r.value,
        ttl: r.ttl,
        proxied: !!r.proxied,
        priority: r.priority,
        weight: r.weight,
        line: r.line,
        lineName: r.lineName,
        remark: r.remark,
        enabled: r.enabled,
      }
    : null;

  return {
    ...(response as any),
    data: {
      ...(response as any)?.data,
      record,
    },
  } as ApiResponse<{ record: DNSRecord }>;
};

/**
 * 设置 DNS 记录状态
 */
export const setDNSRecordStatus = async (
  zoneId: string,
  recordId: string,
  enabled: boolean,
  credentialId?: number
): Promise<ApiResponse> => {
  const params = credentialId !== undefined ? { credentialId } : {};
  return api.put(`/dns-records/zones/${zoneId}/records/${recordId}/status`, { enabled }, { params });
};

/**
 * 删除 DNS 记录
 */
export const deleteDNSRecord = async (
  zoneId: string,
  recordId: string,
  credentialId?: number
): Promise<ApiResponse> => {
  const params = credentialId !== undefined ? { credentialId } : {};
  return api.delete(`/dns-records/zones/${zoneId}/records/${recordId}`, { params });
};
