import api from './api';
import { ApiResponse, Tunnel, TunnelCidrRoute, TunnelHostnameRoute } from '@/types';

export const getTunnels = async (
  credentialId: number
): Promise<ApiResponse<{ accountId: string; tunnels: Tunnel[] }>> => {
  return api.get('/tunnels', { params: { credentialId } });
};

export const getTunnelConfig = async (
  tunnelId: string,
  credentialId: number
): Promise<ApiResponse<{ config: any }>> => {
  return api.get(`/tunnels/${tunnelId}/config`, { params: { credentialId } });
};

export const createTunnel = async (
  name: string,
  credentialId: number
): Promise<ApiResponse<{ tunnel: Tunnel; token: string }>> => {
  return api.post('/tunnels', { name }, { params: { credentialId } });
};

export const updateTunnelConfig = async (
  tunnelId: string,
  config: any,
  credentialId: number
): Promise<ApiResponse<{ config: any }>> => {
  return api.put(`/tunnels/${tunnelId}/config`, { config }, { params: { credentialId } });
};

export const upsertTunnelPublicHostname = async (
  tunnelId: string,
  params: { hostname: string; service: string; path?: string; zoneId: string },
  credentialId: number
): Promise<ApiResponse<{ config: any; dns?: { action: 'created' | 'updated' | 'unchanged' } }>> => {
  return api.post(`/tunnels/${tunnelId}/public-hostnames`, params, { params: { credentialId } });
};

export const deleteTunnelPublicHostname = async (
  tunnelId: string,
  params: { hostname: string; path?: string; zoneId?: string; deleteDns?: boolean },
  credentialId: number
): Promise<ApiResponse<{ config: any; dns?: { deleted?: boolean } }>> => {
  return api.delete(`/tunnels/${tunnelId}/public-hostnames`, { params: { credentialId }, data: params });
};

export const deleteTunnel = async (
  tunnelId: string,
  credentialId: number,
  options?: { cleanupDns?: boolean }
): Promise<ApiResponse<{ cleanup?: any }>> => {
  return api.delete(`/tunnels/${tunnelId}`, {
    params: { credentialId, ...(options?.cleanupDns ? { cleanupDns: 1 } : {}) },
  });
};

export const getTunnelToken = async (
  tunnelId: string,
  credentialId: number
): Promise<ApiResponse<{ token: string }>> => {
  return api.get(`/tunnels/${tunnelId}/token`, { params: { credentialId } });
};

export const getTunnelCidrRoutes = async (
  tunnelId: string,
  credentialId: number
): Promise<ApiResponse<{ routes: TunnelCidrRoute[] }>> => {
  return api.get(`/tunnels/${tunnelId}/routes/cidr`, { params: { credentialId } });
};

export const createTunnelCidrRoute = async (
  tunnelId: string,
  params: { network: string; comment?: string; virtualNetworkId?: string },
  credentialId: number
): Promise<ApiResponse<{ route: TunnelCidrRoute }>> => {
  return api.post(`/tunnels/${tunnelId}/routes/cidr`, params, { params: { credentialId } });
};

export const deleteTunnelCidrRoute = async (
  tunnelId: string,
  routeId: string,
  credentialId: number
): Promise<ApiResponse<{ routeId: string }>> => {
  return api.delete(`/tunnels/${tunnelId}/routes/cidr/${routeId}`, { params: { credentialId } });
};

export const getTunnelHostnameRoutes = async (
  tunnelId: string,
  credentialId: number
): Promise<ApiResponse<{ routes: TunnelHostnameRoute[] }>> => {
  return api.get(`/tunnels/${tunnelId}/routes/hostname`, { params: { credentialId } });
};

export const createTunnelHostnameRoute = async (
  tunnelId: string,
  params: { hostname: string; comment?: string },
  credentialId: number
): Promise<ApiResponse<{ route: TunnelHostnameRoute }>> => {
  return api.post(`/tunnels/${tunnelId}/routes/hostname`, params, { params: { credentialId } });
};

export const deleteTunnelHostnameRoute = async (
  tunnelId: string,
  routeId: string,
  credentialId: number
): Promise<ApiResponse<{ routeId: string }>> => {
  return api.delete(`/tunnels/${tunnelId}/routes/hostname/${routeId}`, { params: { credentialId } });
};
