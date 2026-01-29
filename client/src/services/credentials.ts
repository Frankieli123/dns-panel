import api from './api';
import { CfCredential, ApiResponse } from '@/types';

/**
 * 获取所有凭证
 */
export async function getCredentials(): Promise<ApiResponse<{ credentials: CfCredential[] }>> {
  const response = await api.get('/credentials');
  return response as unknown as ApiResponse<{ credentials: CfCredential[] }>;
}

/**
 * 创建新凭证
 */
export async function createCredential(data: {
  name: string;
  apiToken: string;
  accountId?: string;
}): Promise<ApiResponse<{ credential: CfCredential }>> {
  const response = await api.post('/credentials', data);
  return response as unknown as ApiResponse<{ credential: CfCredential }>;
}

/**
 * 更新凭证
 */
export async function updateCredential(
  id: number,
  data: {
    name?: string;
    apiToken?: string;
    accountId?: string;
    isDefault?: boolean;
  }
): Promise<ApiResponse<{ credential: CfCredential }>> {
  const response = await api.put(`/credentials/${id}`, data);
  return response as unknown as ApiResponse<{ credential: CfCredential }>;
}

/**
 * 删除凭证
 */
export async function deleteCredential(id: number): Promise<ApiResponse> {
  const response = await api.delete(`/credentials/${id}`);
  return response as unknown as ApiResponse;
}

/**
 * 验证凭证
 */
export async function verifyCredential(id: number): Promise<ApiResponse<{ valid: boolean; error?: string }>> {
  const response = await api.post(`/credentials/${id}/verify`);
  return response as unknown as ApiResponse<{ valid: boolean; error?: string }>;
}
