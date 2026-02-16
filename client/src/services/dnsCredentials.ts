import api from './api';
import { ApiResponse } from '@/types';
import { DnsCredential, ProviderConfig, DnsCredentialSecrets, ProviderType, ProviderCapabilities } from '@/types/dns';

type ProviderCapabilitiesApi = {
  provider?: ProviderType;
  type?: ProviderType;
  name: string;
  icon?: string;
  supportsWeight?: boolean;
  supportsLine?: boolean;
  supportsStatus?: boolean;
  supportsRemark?: boolean;
  supportsUrlForward?: boolean;
  supportsLogs?: boolean;
  remarkMode?: 'inline' | 'separate' | 'unsupported';
  paging?: 'server' | 'client';
  requiresDomainId?: boolean;
  recordTypes?: string[];
  authFields: Array<{
    name?: string;
    key?: string;
    label: string;
    type: 'text' | 'password' | 'url';
    required: boolean;
    placeholder?: string;
    helpText?: string;
  }>;
};

/**
 * 获取所有支持的提供商配置
 */
export async function getProviders(): Promise<ApiResponse<{ providers: ProviderConfig[] }>> {
  const response = (await api.get('/dns-credentials/providers')) as unknown as ApiResponse<{ providers: ProviderCapabilitiesApi[] }>;

  const rawProviders = response.data?.providers || [];
  const providers = rawProviders
    .map((p): ProviderConfig | null => {
      const type = p.type || p.provider;
      if (!type) return null;

      const capabilities: ProviderCapabilities = {
        supportsWeight: p.supportsWeight ?? false,
        supportsLine: p.supportsLine ?? false,
        supportsStatus: p.supportsStatus ?? false,
        supportsRemark: p.supportsRemark ?? false,
        supportsUrlForward: p.supportsUrlForward ?? false,
        supportsLogs: p.supportsLogs ?? false,
        remarkMode: p.remarkMode ?? 'unsupported',
        paging: p.paging ?? 'client',
        requiresDomainId: p.requiresDomainId ?? false,
        recordTypes: p.recordTypes ?? ['A', 'AAAA', 'CNAME', 'MX', 'TXT'],
      };

      const normalized: ProviderConfig = {
        type,
        name: p.name,
        authFields: (p.authFields || []).map((f, idx) => ({
          key: f.key || f.name || `field_${idx}`,
          label: f.label,
          type: f.type,
          placeholder: f.placeholder,
          required: f.required,
          helpText: f.helpText,
        })),
        capabilities,
      };

      if (p.icon) {
        normalized.icon = p.icon;
      }

      return normalized;
    })
    .filter((p): p is ProviderConfig => p !== null);

  return {
    ...response,
    data: {
      ...(response.data || {}),
      providers,
    },
  } as ApiResponse<{ providers: ProviderConfig[] }>;
}

/**
 * 获取所有凭证
 */
export async function getDnsCredentials(): Promise<ApiResponse<{ credentials: DnsCredential[] }>> {
  const response = await api.get('/dns-credentials');
  return response as unknown as ApiResponse<{ credentials: DnsCredential[] }>;
}

/**
 * 创建新凭证
 */
export async function createDnsCredential(data: {
  name: string;
  provider: ProviderType;
  secrets: DnsCredentialSecrets;
  accountId?: string;
}): Promise<ApiResponse<{ credential: DnsCredential }>> {
  const response = await api.post('/dns-credentials', data);
  return response as unknown as ApiResponse<{ credential: DnsCredential }>;
}

/**
 * 更新凭证
 */
export async function updateDnsCredential(
  id: number,
  data: {
    name?: string;
    secrets?: DnsCredentialSecrets;
    accountId?: string;
    isDefault?: boolean;
  }
): Promise<ApiResponse<{ credential: DnsCredential }>> {
  const response = await api.put(`/dns-credentials/${id}`, data);
  return response as unknown as ApiResponse<{ credential: DnsCredential }>;
}

/**
 * 删除凭证
 */
export async function deleteDnsCredential(id: number): Promise<ApiResponse> {
  const response = await api.delete(`/dns-credentials/${id}`);
  return response as unknown as ApiResponse;
}

/**
 * 验证凭证
 */
export async function verifyDnsCredential(id: number): Promise<ApiResponse<{ valid: boolean; error?: string }>> {
  const response = await api.post(`/dns-credentials/${id}/verify`);
  return response as unknown as ApiResponse<{ valid: boolean; error?: string }>;
}

/**
 * 获取凭证密钥（明文）
 */
export async function getDnsCredentialSecrets(id: number): Promise<ApiResponse<{ secrets: DnsCredentialSecrets }>> {
  const response = await api.get(`/dns-credentials/${id}/secrets`);
  return response as unknown as ApiResponse<{ secrets: DnsCredentialSecrets }>;
}
