import api from './api';
import type { ApiResponse } from '@/types';

export const ESA_SUPPORTED_REGIONS = ['cn-hangzhou', 'ap-southeast-1'] as const;
export type EsaRegion = (typeof ESA_SUPPORTED_REGIONS)[number];

export interface EsaSite {
  siteId: string;
  siteName: string;
  region?: string;
  status?: string;
  accessType?: string;
  coverage?: string;
  cnameZone?: string;
  nameServerList?: string;
  verifyCode?: string;
  instanceId?: string;
  planName?: string;
  planSpecName?: string;
  resourceGroupId?: string;
  createTime?: string;
  updateTime?: string;
  visitTime?: string;
  offlineReason?: string;
  tags?: Record<string, string>;
}

export interface EsaRatePlanInstance {
  instanceId: string;
  region?: string;
  planName?: string;
  planType?: string;
  siteQuota?: number;
  usedSiteCount?: number;
  expireTime?: string;
  duration?: number;
  createTime?: string;
  status?: string;
  coverages?: string;
  billingMode?: string;
}

export interface EsaDnsRecord {
  recordId: string;
  recordName: string;
  type: string;
  region?: string;
  ttl?: number;
  proxied?: boolean;
  comment?: string;
  createTime?: string;
  updateTime?: string;
  data?: Record<string, unknown>;
  sourceType?: string;
  bizName?: string;
  hostPolicy?: string;
  recordCname?: string;
}

export interface EsaRecordCertificateStatus {
  recordName: string;
  count?: number;
  applyingCount?: number;
  status?: string;
  certificates?: EsaCertificate[];
}

export interface EsaCertificate {
  id: string;
  casId?: string;
  name?: string;
  region?: string;
  status?: string;
  type?: string;
  commonName?: string;
  notBefore?: string;
  notAfter?: string;
  issuer?: string;
  issuerCN?: string;
  san?: string;
  sigAlg?: string;
  pubAlg?: string;
  createTime?: string;
  updateTime?: string;
  serialNumber?: string;
  fingerprintSha256?: string;
  applyCode?: number;
  applyMessage?: string;
  dcv?: Array<{ id?: string; type?: string; key?: string; value?: string; status?: string }>;
}

export interface EsaCertificateApplyResult {
  domain: string;
  status?: string;
  certificateId?: string;
}

export async function listEsaSites(params: {
  credentialId: number;
  keyword?: string;
  page?: number;
  pageSize?: number;
  region?: string;
}): Promise<ApiResponse<{ sites: EsaSite[]; total: number; pageNumber: number; pageSize: number }>> {
  const response = await api.get('/aliyun-esa/sites', { params });
  return response as unknown as ApiResponse<{ sites: EsaSite[]; total: number; pageNumber: number; pageSize: number }>;
}

export async function listEsaRatePlanInstances(params: {
  credentialId: number;
  page?: number;
  pageSize?: number;
  status?: string;
  checkRemainingSiteQuota?: boolean;
  region?: string;
}): Promise<ApiResponse<{ instances: EsaRatePlanInstance[]; total: number; pageNumber: number; pageSize: number }>> {
  const response = await api.get('/aliyun-esa/instances', { params });
  return response as unknown as ApiResponse<{ instances: EsaRatePlanInstance[]; total: number; pageNumber: number; pageSize: number }>;
}

export async function createEsaSite(data: {
  credentialId: number;
  siteName: string;
  coverage: string;
  accessType: string;
  instanceId: string;
  region?: string;
}): Promise<ApiResponse<{ siteId: string; verifyCode?: string; nameServerList?: string }>> {
  const response = await api.post('/aliyun-esa/sites', data);
  return response as unknown as ApiResponse<{ siteId: string; verifyCode?: string; nameServerList?: string }>;
}

export async function verifyEsaSite(params: {
  credentialId: number;
  siteId: string;
  region?: string;
}): Promise<ApiResponse<{ passed: boolean }>> {
  const response = await api.post(`/aliyun-esa/sites/${encodeURIComponent(params.siteId)}/verify`, {
    credentialId: params.credentialId,
    region: params.region,
  });
  return response as unknown as ApiResponse<{ passed: boolean }>;
}

export async function deleteEsaSite(params: {
  credentialId: number;
  siteId: string;
  region?: string;
}): Promise<ApiResponse<{ deleted: boolean }>> {
  const response = await api.delete(`/aliyun-esa/sites/${encodeURIComponent(params.siteId)}`, { params });
  return response as unknown as ApiResponse<{ deleted: boolean }>;
}

export async function listEsaRecords(params: {
  credentialId: number;
  siteId: string;
  recordName?: string;
  recordMatchType?: string;
  type?: string;
  proxied?: boolean | string;
  page?: number;
  pageSize?: number;
  region?: string;
}): Promise<ApiResponse<{ records: EsaDnsRecord[]; total: number; pageNumber: number; pageSize: number }>> {
  const response = await api.get('/aliyun-esa/records', { params });
  return response as unknown as ApiResponse<{ records: EsaDnsRecord[]; total: number; pageNumber: number; pageSize: number }>;
}

export async function createEsaRecord(data: {
  credentialId: number;
  siteId: string;
  recordName: string;
  type: string;
  ttl?: number;
  proxied?: boolean;
  sourceType?: string;
  bizName?: string;
  comment?: string;
  hostPolicy?: string;
  data: Record<string, unknown>;
  authConf?: Record<string, unknown>;
  region?: string;
}): Promise<ApiResponse<{ recordId: string }>> {
  const response = await api.post('/aliyun-esa/records', data);
  return response as unknown as ApiResponse<{ recordId: string }>;
}

export async function updateEsaRecord(recordId: string, data: {
  credentialId: number;
  ttl?: number;
  proxied?: boolean;
  sourceType?: string;
  bizName?: string;
  comment?: string;
  hostPolicy?: string;
  data: Record<string, unknown>;
  authConf?: Record<string, unknown>;
  region?: string;
}): Promise<ApiResponse<{ updated: boolean }>> {
  const response = await api.put(`/aliyun-esa/records/${encodeURIComponent(recordId)}`, data);
  return response as unknown as ApiResponse<{ updated: boolean }>;
}

export async function deleteEsaRecord(params: {
  credentialId: number;
  recordId: string;
  region?: string;
}): Promise<ApiResponse<{ deleted: boolean }>> {
  const response = await api.delete(`/aliyun-esa/records/${encodeURIComponent(params.recordId)}`, { params });
  return response as unknown as ApiResponse<{ deleted: boolean }>;
}

export async function getEsaRecord(params: {
  credentialId: number;
  recordId: string;
  region?: string;
}): Promise<ApiResponse<{ record: EsaDnsRecord }>> {
  const response = await api.get(`/aliyun-esa/records/${encodeURIComponent(params.recordId)}`, { params });
  return response as unknown as ApiResponse<{ record: EsaDnsRecord }>;
}

export async function listEsaCertificatesByRecord(data: {
  credentialId: number;
  siteId: string;
  recordNames: string[];
  validOnly?: boolean;
  detail?: boolean;
  region?: string;
}): Promise<ApiResponse<{ records: EsaRecordCertificateStatus[]; total: number; siteId: string; siteName?: string }>> {
  const response = await api.post('/aliyun-esa/certificates/by-record', data);
  return response as unknown as ApiResponse<{ records: EsaRecordCertificateStatus[]; total: number; siteId: string; siteName?: string }>;
}

export async function applyEsaCertificate(data: {
  credentialId: number;
  siteId: string;
  domains: string[];
  type?: string;
  region?: string;
}): Promise<ApiResponse<{ results: EsaCertificateApplyResult[]; requestId?: string }>> {
  const response = await api.post('/aliyun-esa/certificates/apply', data);
  return response as unknown as ApiResponse<{ results: EsaCertificateApplyResult[]; requestId?: string }>;
}

export async function getEsaCertificate(params: {
  credentialId: number;
  siteId: string;
  certificateId: string;
  region?: string;
}): Promise<ApiResponse<{ certificate: EsaCertificate; requestId?: string }>> {
  const response = await api.get(`/aliyun-esa/certificates/${encodeURIComponent(params.certificateId)}`, { params });
  return response as unknown as ApiResponse<{ certificate: EsaCertificate; requestId?: string }>;
}

export async function checkEsaCnameStatus(data: {
  records: Array<{ recordName: string; recordCname: string }>;
}): Promise<ApiResponse<{ results: Array<{ recordName: string; status: string }> }>> {
  const response = await api.post('/aliyun-esa/cname-status', data);
  return response as unknown as ApiResponse<{ results: Array<{ recordName: string; status: string }> }>;
}
