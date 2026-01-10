import api from './api';
import { ApiResponse } from '@/types';

export type DomainExpirySource = 'rdap' | 'unknown';

export interface DomainExpiryResult {
  domain: string;
  expiresAt?: string; // ISO string (UTC)
  source: DomainExpirySource;
  checkedAt: string; // ISO string (UTC)
}

export const lookupDomainExpiry = async (
  domains: string[]
): Promise<ApiResponse<{ results: DomainExpiryResult[] }>> => {
  return api.post('/domain-expiry/lookup', { domains });
};

