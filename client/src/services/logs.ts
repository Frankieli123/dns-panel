import api from './api';
import { ApiResponse, Log } from '@/types';

/**
 * 获取操作日志
 */
export const getLogs = async (params?: {
  page?: number;
  limit?: number;
  startDate?: string;
  endDate?: string;
  action?: string;
  resourceType?: string;
  domain?: string;
  status?: string;
}): Promise<ApiResponse<Log[]>> => {
  return api.get('/logs', { params });
};

/**
 * 清理过期日志
 */
export const cleanupLogs = async (retentionDays?: number): Promise<ApiResponse> => {
  return api.delete('/logs/cleanup', {
    params: { retentionDays },
  });
};
