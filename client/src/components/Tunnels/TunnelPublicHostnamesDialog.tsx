import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  FormControlLabel,
  IconButton,
  InputAdornment,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Tabs,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import {
  Add as AddIcon,
  AltRoute as AltRouteIcon,
  Delete as DeleteIcon,
  Dns as DnsIcon,
  Edit as EditIcon,
  Lan as LanIcon,
  Public as PublicIcon,
  Refresh as RefreshIcon,
  Search as SearchIcon,
} from '@mui/icons-material';
import { Domain, Tunnel, TunnelCidrRoute, TunnelHostnameRoute } from '@/types';
import { getDomains } from '@/services/domains';
import {
  createTunnelCidrRoute,
  createTunnelHostnameRoute,
  deleteTunnelCidrRoute,
  deleteTunnelHostnameRoute,
  deleteTunnelPublicHostname,
  getTunnelCidrRoutes,
  getTunnelConfig,
  getTunnelHostnameRoutes,
  upsertTunnelPublicHostname,
} from '@/services/tunnels';

type IngressRule = {
  hostname?: string;
  service?: string;
  path?: string;
};

type PublicRouteRow = {
  hostname: string;
  service: string;
  path: string;
  zone?: Domain;
};

const normalizeHostname = (input: unknown): string =>
  String(input ?? '').trim().replace(/\.+$/, '').toLowerCase();

const stripWildcardPrefix = (hostname: string): string => normalizeHostname(hostname).replace(/^\*\./, '');

const findBestZone = (hostname: string, domains: Domain[]): Domain | undefined => {
  const host = stripWildcardPrefix(hostname);
  let best: Domain | undefined;

  for (const d of domains) {
    const zone = normalizeHostname(d?.name);
    if (!zone) continue;
    if (host === zone || host.endsWith(`.${zone}`)) {
      if (!best || zone.length > normalizeHostname(best.name).length) best = d;
    }
  }

  return best;
};

const CIDR_V4_REGEX = /^(\d{1,3}\.){3}\d{1,3}\/(?:[0-9]|[1-2][0-9]|3[0-2])$/;
const CIDR_V6_REGEX = /^[0-9a-fA-F:]+\/(?:[0-9]|[1-9][0-9]|1[01][0-9]|12[0-8])$/;
const HOSTNAME_ROUTE_REGEX = /^(?:\*\.)?(?=.{1,253}$)(?!-)(?:[a-zA-Z0-9-]{1,63}\.)+[a-zA-Z]{2,63}$/;

const isValidIPv4 = (ip: string): boolean => {
  const parts = ip.split('.');
  if (parts.length !== 4) return false;
  return parts.every((part) => {
    if (!/^\d{1,3}$/.test(part)) return false;
    const n = Number(part);
    return Number.isInteger(n) && n >= 0 && n <= 255;
  });
};

const isValidCidr = (value: string): boolean => {
  const v = value.trim();
  if (!v) return false;
  if (CIDR_V4_REGEX.test(v)) return isValidIPv4(v.split('/')[0]);
  return CIDR_V6_REGEX.test(v);
};

const isValidRouteHostname = (value: string): boolean => HOSTNAME_ROUTE_REGEX.test(value.trim());

export default function TunnelPublicHostnamesDialog(props: {
  open: boolean;
  onClose: () => void;
  tunnel: Tunnel;
  credentialId: number;
}) {
  const { open, onClose, tunnel, credentialId } = props;
  const queryClient = useQueryClient();

  const [activeTab, setActiveTab] = useState(0);

  const [keyword, setKeyword] = useState('');
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorMode, setEditorMode] = useState<'add' | 'edit'>('add');
  const [hostname, setHostname] = useState('');
  const [path, setPath] = useState('');
  const [service, setService] = useState('');
  const [zoneId, setZoneId] = useState('');
  const [zoneTouched, setZoneTouched] = useState(false);

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<PublicRouteRow | null>(null);
  const [deleteDns, setDeleteDns] = useState(false);

  const [cidrNetwork, setCidrNetwork] = useState('');
  const [cidrComment, setCidrComment] = useState('');
  const [cidrDeleteTarget, setCidrDeleteTarget] = useState<TunnelCidrRoute | null>(null);

  const [hostRouteHostname, setHostRouteHostname] = useState('');
  const [hostRouteComment, setHostRouteComment] = useState('');
  const [hostnameDeleteTarget, setHostnameDeleteTarget] = useState<TunnelHostnameRoute | null>(null);

  const targetCname = `${tunnel.id}.cfargotunnel.com`;

  const resetEditor = () => {
    setHostname('');
    setPath('');
    setService('');
    setZoneId('');
    setZoneTouched(false);
  };

  useEffect(() => {
    if (!open) {
      setActiveTab(0);
      setKeyword('');
      setEditorOpen(false);
      setDeleteOpen(false);
      setDeleteTarget(null);
      setDeleteDns(false);
      setCidrNetwork('');
      setCidrComment('');
      setCidrDeleteTarget(null);
      setHostRouteHostname('');
      setHostRouteComment('');
      setHostnameDeleteTarget(null);
      resetEditor();
    }
  }, [open]);

  const domainsQuery = useQuery({
    queryKey: ['tunnel-domains', credentialId],
    queryFn: () => getDomains(credentialId),
    enabled: open && typeof credentialId === 'number',
  });

  const domains: Domain[] = domainsQuery.data?.data?.domains || [];

  const configQuery = useQuery({
    queryKey: ['tunnel-config', credentialId, tunnel.id],
    queryFn: () => getTunnelConfig(tunnel.id, credentialId),
    enabled: open && typeof credentialId === 'number' && !!tunnel?.id,
  });

  const cidrRoutesQuery = useQuery({
    queryKey: ['tunnel-cidr-routes', credentialId, tunnel.id],
    queryFn: () => getTunnelCidrRoutes(tunnel.id, credentialId),
    enabled: open && typeof credentialId === 'number' && !!tunnel?.id,
  });

  const hostnameRoutesQuery = useQuery({
    queryKey: ['tunnel-hostname-routes', credentialId, tunnel.id],
    queryFn: () => getTunnelHostnameRoutes(tunnel.id, credentialId),
    enabled: open && typeof credentialId === 'number' && !!tunnel?.id,
  });

  const config: any = configQuery.data?.data?.config;
  const ingress: IngressRule[] = Array.isArray(config?.ingress) ? config.ingress : [];
  const publicHostnames: IngressRule[] = ingress.filter((r) => typeof r?.hostname === 'string' && r.hostname.trim());

  const cidrRoutes: TunnelCidrRoute[] = cidrRoutesQuery.data?.data?.routes || [];
  const hostnameRoutes: TunnelHostnameRoute[] = hostnameRoutesQuery.data?.data?.routes || [];

  const publicRows: PublicRouteRow[] = useMemo(() => {
    const k = keyword.trim().toLowerCase();
    const base = publicHostnames.map((r) => {
      const h = String(r.hostname || '').trim();
      const p = String(r.path || '').trim();
      const s = String(r.service || '').trim();
      return {
        hostname: h,
        path: p,
        service: s,
        zone: h ? findBestZone(h, domains) : undefined,
      };
    });

    if (!k) return base;
    return base.filter((x) =>
      x.hostname.toLowerCase().includes(k) ||
      x.service.toLowerCase().includes(k) ||
      x.path.toLowerCase().includes(k)
    );
  }, [publicHostnames, keyword, domains]);

  useEffect(() => {
    if (zoneTouched) return;
    const matched = hostname ? findBestZone(hostname, domains) : undefined;
    setZoneId(matched?.id || '');
  }, [hostname, domains, zoneTouched]);

  const upsertMutation = useMutation({
    mutationFn: (payload: { hostname: string; service: string; path?: string; zoneId: string }) =>
      upsertTunnelPublicHostname(tunnel.id, payload, credentialId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tunnel-config', credentialId, tunnel.id] });
      setEditorOpen(false);
      resetEditor();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (payload: { hostname: string; path?: string; zoneId?: string; deleteDns?: boolean }) =>
      deleteTunnelPublicHostname(tunnel.id, payload, credentialId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tunnel-config', credentialId, tunnel.id] });
      setDeleteOpen(false);
      setDeleteTarget(null);
      setDeleteDns(false);
    },
  });

  const createCidrMutation = useMutation({
    mutationFn: (payload: { network: string; comment?: string }) =>
      createTunnelCidrRoute(tunnel.id, payload, credentialId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tunnel-cidr-routes', credentialId, tunnel.id] });
      setCidrNetwork('');
      setCidrComment('');
    },
  });

  const deleteCidrMutation = useMutation({
    mutationFn: (routeId: string) => deleteTunnelCidrRoute(tunnel.id, routeId, credentialId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tunnel-cidr-routes', credentialId, tunnel.id] });
      setCidrDeleteTarget(null);
    },
  });

  const createHostnameRouteMutation = useMutation({
    mutationFn: (payload: { hostname: string; comment?: string }) =>
      createTunnelHostnameRoute(tunnel.id, payload, credentialId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tunnel-hostname-routes', credentialId, tunnel.id] });
      setHostRouteHostname('');
      setHostRouteComment('');
    },
  });

  const deleteHostnameRouteMutation = useMutation({
    mutationFn: (routeId: string) => deleteTunnelHostnameRoute(tunnel.id, routeId, credentialId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tunnel-hostname-routes', credentialId, tunnel.id] });
      setHostnameDeleteTarget(null);
    },
  });

  const openAdd = () => {
    setEditorMode('add');
    resetEditor();
    setEditorOpen(true);
  };

  const openEdit = (row: PublicRouteRow) => {
    setEditorMode('edit');
    setHostname(row.hostname);
    setPath(row.path || '');
    setService(row.service || '');
    setZoneId(row.zone?.id || '');
    setZoneTouched(false);
    setEditorOpen(true);
  };

  const openDelete = (row: PublicRouteRow) => {
    setDeleteTarget(row);
    setDeleteDns(false);
    setDeleteOpen(true);
  };

  const canSubmitPublic = hostname.trim() && service.trim() && zoneId && !upsertMutation.isPending;
  const editorZone = domains.find((d) => d.id === zoneId);

  const canCreateCidr = isValidCidr(cidrNetwork) && !createCidrMutation.isPending;
  const canCreateHostnameRoute = isValidRouteHostname(hostRouteHostname) && !createHostnameRouteMutation.isPending;

  return (
    <>
      <Dialog open={open} onClose={onClose} fullWidth maxWidth="lg">
        <DialogTitle sx={{ pb: 1 }}>
          <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={2}>
            <Stack direction="row" alignItems="center" spacing={1} sx={{ minWidth: 0 }}>
              <AltRouteIcon fontSize="small" />
              <Typography variant="h6" fontWeight={800} noWrap>
                路由管理
              </Typography>
              <Typography variant="body2" color="text.secondary" noWrap sx={{ ml: 1 }}>
                {tunnel.name || tunnel.id}
              </Typography>
            </Stack>

            <Stack direction="row" spacing={1}>
              <Button
                variant="outlined"
                startIcon={<RefreshIcon />}
                onClick={() => {
                  configQuery.refetch();
                  cidrRoutesQuery.refetch();
                  hostnameRoutesQuery.refetch();
                }}
                disabled={configQuery.isFetching || cidrRoutesQuery.isFetching || hostnameRoutesQuery.isFetching}
              >
                刷新
              </Button>
              {activeTab === 0 ? (
                <Button variant="contained" startIcon={<AddIcon />} onClick={openAdd}>
                  添加
                </Button>
              ) : null}
            </Stack>
          </Stack>
        </DialogTitle>

        <DialogContent sx={{ '&&': { pt: 2 } }}>
          <Tabs
            value={activeTab}
            onChange={(_, next) => setActiveTab(next)}
            variant="scrollable"
            allowScrollButtonsMobile
            sx={{ borderBottom: '1px solid', borderColor: 'divider', mb: 2 }}
          >
            <Tab
              icon={(
                <Tooltip title="将公网应用发布到指定域名与路径">
                  <PublicIcon fontSize="small" sx={{ color: activeTab === 0 ? 'primary.main' : 'action.active' }} />
                </Tooltip>
              )}
              iconPosition="start"
              label={`已发布应用程序路由 (${publicHostnames.length})`}
            />
            <Tab
              icon={(
                <Tooltip title="将私网网段（CIDR）绑定到当前 Tunnel">
                  <LanIcon fontSize="small" sx={{ color: activeTab === 1 ? 'primary.main' : 'action.active' }} />
                </Tooltip>
              )}
              iconPosition="start"
              label={`CIDR (${cidrRoutes.length})`}
            />
            <Tab
              icon={(
                <Tooltip title="将内网主机名绑定到当前 Tunnel">
                  <DnsIcon fontSize="small" sx={{ color: activeTab === 2 ? 'primary.main' : 'action.active' }} />
                </Tooltip>
              )}
              iconPosition="start"
              label={`主机名路由 (${hostnameRoutes.length})`}
            />
          </Tabs>

          {activeTab === 0 ? (
            <>
              <Alert severity="info" sx={{ mb: 2 }}>
                已发布应用程序路由会同步创建/更新 DNS 记录（proxied CNAME）指向{' '}
                <Typography component="span" sx={{ fontFamily: 'monospace' }}>
                  {targetCname}
                </Typography>
                。
              </Alert>

              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ mb: 2 }}>
                <TextField
                  size="small"
                  placeholder="搜索主机名 / 服务 / 路径..."
                  value={keyword}
                  onChange={(e) => setKeyword(e.target.value)}
                  InputProps={{
                    startAdornment: (
                      <InputAdornment position="start">
                        <SearchIcon fontSize="small" color="action" />
                      </InputAdornment>
                    ),
                  }}
                  sx={{ flex: 1 }}
                />
              </Stack>

              {configQuery.isLoading ? (
                <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', py: 4 }}>
                  <CircularProgress size={24} />
                </Box>
              ) : configQuery.error ? (
                <Alert severity="error">
                  {String((configQuery.error as any)?.message || configQuery.error)}
                </Alert>
              ) : publicRows.length === 0 ? (
                <Alert severity="info">暂无已发布应用程序路由</Alert>
              ) : (
                <Box sx={{ overflowX: 'auto' }}>
                  <Table size="small" sx={{ minWidth: 720 }}>
                    <TableHead>
                      <TableRow>
                        <TableCell>主机名</TableCell>
                        <TableCell>路径</TableCell>
                        <TableCell>服务</TableCell>
                        <TableCell align="right">操作</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {publicRows.map((r) => (
                        <TableRow key={`${r.hostname}::${r.path || ''}`}>
                          <TableCell sx={{ fontWeight: 700 }}>
                            {r.hostname}
                            {r.zone?.name ? (
                              <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                                域名：{r.zone.name}
                              </Typography>
                            ) : null}
                          </TableCell>
                          <TableCell>{r.path || '-'}</TableCell>
                          <TableCell sx={{ fontFamily: 'monospace' }}>{r.service || '-'}</TableCell>
                          <TableCell align="right">
                            <Tooltip title="编辑">
                              <span>
                                <IconButton size="small" onClick={() => openEdit(r)}>
                                  <EditIcon fontSize="small" />
                                </IconButton>
                              </span>
                            </Tooltip>
                            <Tooltip title="删除">
                              <span>
                                <IconButton size="small" color="error" onClick={() => openDelete(r)}>
                                  <DeleteIcon fontSize="small" />
                                </IconButton>
                              </span>
                            </Tooltip>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </Box>
              )}
            </>
          ) : null}

          {activeTab === 1 ? (
            <Stack spacing={2}>
              <Alert severity="info">
                CIDR 路由用于将私网网段通过当前 Tunnel 暴露到 Zero Trust 网络。
              </Alert>

              <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5}>
                <TextField
                  label="CIDR"
                  placeholder="例如：10.0.0.0/24"
                  value={cidrNetwork}
                  onChange={(e) => setCidrNetwork(e.target.value)}
                  error={!!cidrNetwork && !isValidCidr(cidrNetwork)}
                  helperText={!cidrNetwork || isValidCidr(cidrNetwork) ? ' ' : 'CIDR 格式不正确'}
                  sx={{ flex: 1 }}
                />
                <TextField
                  label="备注（可选）"
                  placeholder="例如：office-network"
                  value={cidrComment}
                  onChange={(e) => setCidrComment(e.target.value)}
                  sx={{ flex: 1 }}
                />
                <Button
                  variant="contained"
                  startIcon={<AddIcon />}
                  disabled={!canCreateCidr}
                  onClick={() => {
                    createCidrMutation.mutate({
                      network: cidrNetwork.trim(),
                      comment: cidrComment.trim() || undefined,
                    });
                  }}
                  sx={{ height: 40, mt: { xs: 0, md: '8px' } }}
                >
                  {createCidrMutation.isPending ? '添加中...' : '添加 CIDR'}
                </Button>
              </Stack>

              {createCidrMutation.error ? (
                <Alert severity="error">
                  {String((createCidrMutation.error as any)?.message || createCidrMutation.error)}
                </Alert>
              ) : null}

              {cidrRoutesQuery.isLoading ? (
                <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
                  <CircularProgress size={24} />
                </Box>
              ) : cidrRoutesQuery.error ? (
                <Alert severity="error">
                  {String((cidrRoutesQuery.error as any)?.message || cidrRoutesQuery.error)}
                </Alert>
              ) : cidrRoutes.length === 0 ? (
                <Alert severity="info">暂无 CIDR 路由</Alert>
              ) : (
                <Box sx={{ overflowX: 'auto' }}>
                  <Table size="small" sx={{ minWidth: 680 }}>
                    <TableHead>
                      <TableRow>
                        <TableCell>CIDR</TableCell>
                        <TableCell>备注</TableCell>
                        <TableCell>创建时间</TableCell>
                        <TableCell align="right">操作</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {cidrRoutes.map((route) => (
                        <TableRow key={route.id}>
                          <TableCell sx={{ fontFamily: 'monospace', fontWeight: 700 }}>{route.network}</TableCell>
                          <TableCell>{route.comment || '-'}</TableCell>
                          <TableCell>{route.createdAt || '-'}</TableCell>
                          <TableCell align="right">
                            <Tooltip title="删除">
                              <span>
                                <IconButton
                                  size="small"
                                  color="error"
                                  onClick={() => setCidrDeleteTarget(route)}
                                  disabled={deleteCidrMutation.isPending}
                                >
                                  <DeleteIcon fontSize="small" />
                                </IconButton>
                              </span>
                            </Tooltip>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </Box>
              )}
            </Stack>
          ) : null}

          {activeTab === 2 ? (
            <Stack spacing={2}>
              <Alert severity="info">
                主机名路由用于把内网主机名通过当前 Tunnel 关联到 Zero Trust 访问路径。
              </Alert>

              <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5}>
                <TextField
                  label="主机名"
                  placeholder="例如：mysql.internal.example.com"
                  value={hostRouteHostname}
                  onChange={(e) => setHostRouteHostname(e.target.value)}
                  error={!!hostRouteHostname && !isValidRouteHostname(hostRouteHostname)}
                  helperText={!hostRouteHostname || isValidRouteHostname(hostRouteHostname) ? ' ' : '主机名格式不正确'}
                  sx={{ flex: 1 }}
                />
                <TextField
                  label="备注（可选）"
                  placeholder="例如：internal-db"
                  value={hostRouteComment}
                  onChange={(e) => setHostRouteComment(e.target.value)}
                  sx={{ flex: 1 }}
                />
                <Button
                  variant="contained"
                  startIcon={<AddIcon />}
                  disabled={!canCreateHostnameRoute}
                  onClick={() => {
                    createHostnameRouteMutation.mutate({
                      hostname: hostRouteHostname.trim(),
                      comment: hostRouteComment.trim() || undefined,
                    });
                  }}
                  sx={{ height: 40, mt: { xs: 0, md: '8px' } }}
                >
                  {createHostnameRouteMutation.isPending ? '添加中...' : '添加主机名'}
                </Button>
              </Stack>

              {createHostnameRouteMutation.error ? (
                <Alert severity="error">
                  {String((createHostnameRouteMutation.error as any)?.message || createHostnameRouteMutation.error)}
                </Alert>
              ) : null}

              {hostnameRoutesQuery.isLoading ? (
                <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
                  <CircularProgress size={24} />
                </Box>
              ) : hostnameRoutesQuery.error ? (
                <Alert severity="error">
                  {String((hostnameRoutesQuery.error as any)?.message || hostnameRoutesQuery.error)}
                </Alert>
              ) : hostnameRoutes.length === 0 ? (
                <Alert severity="info">暂无主机名路由</Alert>
              ) : (
                <Box sx={{ overflowX: 'auto' }}>
                  <Table size="small" sx={{ minWidth: 680 }}>
                    <TableHead>
                      <TableRow>
                        <TableCell>主机名</TableCell>
                        <TableCell>备注</TableCell>
                        <TableCell>创建时间</TableCell>
                        <TableCell align="right">操作</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {hostnameRoutes.map((route) => (
                        <TableRow key={route.id}>
                          <TableCell sx={{ fontWeight: 700 }}>{route.hostname}</TableCell>
                          <TableCell>{route.comment || '-'}</TableCell>
                          <TableCell>{route.createdAt || '-'}</TableCell>
                          <TableCell align="right">
                            <Tooltip title="删除">
                              <span>
                                <IconButton
                                  size="small"
                                  color="error"
                                  onClick={() => setHostnameDeleteTarget(route)}
                                  disabled={deleteHostnameRouteMutation.isPending}
                                >
                                  <DeleteIcon fontSize="small" />
                                </IconButton>
                              </span>
                            </Tooltip>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </Box>
              )}
            </Stack>
          ) : null}
        </DialogContent>

        <DialogActions sx={{ px: 3, pb: 3 }}>
          <Button onClick={onClose} variant="contained">
            关闭
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={editorOpen} onClose={() => setEditorOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>{editorMode === 'add' ? '添加已发布应用程序路由' : '编辑已发布应用程序路由'}</DialogTitle>
        <DialogContent sx={{ '&&': { pt: 2 } }}>
          <Stack spacing={2}>
            <TextField
              label="主机名"
              placeholder="例如：app.example.com"
              value={hostname}
              onChange={(e) => setHostname(e.target.value)}
              autoComplete="off"
              autoFocus
            />
            <TextField
              label="路径（可选）"
              placeholder="例如：^/api/ 或 /"
              value={path}
              onChange={(e) => setPath(e.target.value)}
              autoComplete="off"
            />
            <TextField
              label="服务"
              placeholder="例如：http://localhost:8001"
              value={service}
              onChange={(e) => setService(e.target.value)}
              autoComplete="off"
            />

            <FormControl fullWidth>
              <InputLabel id="tunnel-zone-select-label">所属域名</InputLabel>
              <Select
                labelId="tunnel-zone-select-label"
                label="所属域名"
                value={zoneId}
                onChange={(e) => {
                  setZoneId(String(e.target.value));
                  setZoneTouched(true);
                }}
                disabled={domainsQuery.isLoading || !!domainsQuery.error}
              >
                {domains.map((d) => (
                  <MenuItem key={d.id} value={d.id}>
                    {d.name}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            {domainsQuery.error ? (
              <Alert severity="error">
                无法加载域名列表：{String((domainsQuery.error as any)?.message || domainsQuery.error)}。请确认 Token 权限包含「区域（Zone）读取」。
              </Alert>
            ) : !zoneId ? (
              <Alert severity="warning">
                {domainsQuery.isLoading
                  ? '正在加载域名列表...'
                  : '未找到对应域名，请先在仪表盘添加该域名到 Cloudflare（或手动选择所属域名）。'}
              </Alert>
            ) : (
              <Alert severity="success">
                将在域名 <strong>{editorZone?.name || '-'}</strong> 下创建/更新 proxied CNAME 记录指向{' '}
                <Typography component="span" sx={{ fontFamily: 'monospace' }}>
                  {targetCname}
                </Typography>
                。
              </Alert>
            )}

            {upsertMutation.error ? (
              <Alert severity="error">
                {String((upsertMutation.error as any)?.message || upsertMutation.error)}
              </Alert>
            ) : null}
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 3 }}>
          <Button onClick={() => setEditorOpen(false)} color="inherit">
            取消
          </Button>
          <Button
            variant="contained"
            disabled={!canSubmitPublic}
            onClick={() => {
              const h = hostname.trim();
              const s = service.trim();
              const p = path.trim();
              upsertMutation.mutate({ hostname: h, service: s, path: p ? p : undefined, zoneId });
            }}
          >
            {upsertMutation.isPending ? '保存中...' : '保存'}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={deleteOpen} onClose={() => setDeleteOpen(false)} fullWidth maxWidth="xs">
        <DialogTitle>删除已发布应用程序路由</DialogTitle>
        <DialogContent sx={{ '&&': { pt: 2 } }}>
          <Stack spacing={2}>
            <Typography>
              确定要删除 <strong>{deleteTarget?.hostname || '-'}</strong> 吗？
            </Typography>
            <FormControlLabel
              control={
                <Checkbox
                  checked={deleteDns}
                  onChange={(e) => setDeleteDns(e.target.checked)}
                  disabled={!deleteTarget?.zone?.id}
                />
              }
              label="同时删除对应 DNS CNAME 记录（仅当记录指向本 Tunnel 时）"
            />

            {deleteMutation.error ? (
              <Alert severity="error">
                {String((deleteMutation.error as any)?.message || deleteMutation.error)}
              </Alert>
            ) : null}
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 3 }}>
          <Button onClick={() => setDeleteOpen(false)} color="inherit">
            取消
          </Button>
          <Button
            variant="contained"
            color="error"
            disabled={!deleteTarget || deleteMutation.isPending}
            onClick={() => {
              if (!deleteTarget) return;
              deleteMutation.mutate({
                hostname: deleteTarget.hostname,
                path: deleteTarget.path ? deleteTarget.path : undefined,
                zoneId: deleteTarget.zone?.id,
                deleteDns,
              });
            }}
          >
            {deleteMutation.isPending ? '删除中...' : '删除'}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={!!cidrDeleteTarget} onClose={() => setCidrDeleteTarget(null)} fullWidth maxWidth="xs">
        <DialogTitle>删除 CIDR 路由</DialogTitle>
        <DialogContent sx={{ '&&': { pt: 2 } }}>
          <Stack spacing={2}>
            <Typography>
              确定要删除 CIDR <strong>{cidrDeleteTarget?.network || '-'}</strong> 吗？
            </Typography>
            {deleteCidrMutation.error ? (
              <Alert severity="error">
                {String((deleteCidrMutation.error as any)?.message || deleteCidrMutation.error)}
              </Alert>
            ) : null}
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 3 }}>
          <Button onClick={() => setCidrDeleteTarget(null)} color="inherit">
            取消
          </Button>
          <Button
            variant="contained"
            color="error"
            disabled={!cidrDeleteTarget || deleteCidrMutation.isPending}
            onClick={() => {
              if (!cidrDeleteTarget?.id) return;
              deleteCidrMutation.mutate(cidrDeleteTarget.id);
            }}
          >
            {deleteCidrMutation.isPending ? '删除中...' : '删除'}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={!!hostnameDeleteTarget} onClose={() => setHostnameDeleteTarget(null)} fullWidth maxWidth="xs">
        <DialogTitle>删除主机名路由</DialogTitle>
        <DialogContent sx={{ '&&': { pt: 2 } }}>
          <Stack spacing={2}>
            <Typography>
              确定要删除主机名路由 <strong>{hostnameDeleteTarget?.hostname || '-'}</strong> 吗？
            </Typography>
            {deleteHostnameRouteMutation.error ? (
              <Alert severity="error">
                {String((deleteHostnameRouteMutation.error as any)?.message || deleteHostnameRouteMutation.error)}
              </Alert>
            ) : null}
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 3 }}>
          <Button onClick={() => setHostnameDeleteTarget(null)} color="inherit">
            取消
          </Button>
          <Button
            variant="contained"
            color="error"
            disabled={!hostnameDeleteTarget || deleteHostnameRouteMutation.isPending}
            onClick={() => {
              if (!hostnameDeleteTarget?.id) return;
              deleteHostnameRouteMutation.mutate(hostnameDeleteTarget.id);
            }}
          >
            {deleteHostnameRouteMutation.isPending ? '删除中...' : '删除'}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
