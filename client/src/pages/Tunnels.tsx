import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Box,
  Button,
  Card,
  CardActions,
  CardContent,
  Checkbox,
  Chip,
  Collapse,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControlLabel,
  IconButton,
  InputAdornment,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import {
  Add as AddIcon,
  AltRoute as AltRouteIcon,
  ArrowBack as ArrowBackIcon,
  Delete as DeleteIcon,
  KeyboardArrowDown as KeyboardArrowDownIcon,
  KeyboardArrowUp as KeyboardArrowUpIcon,
  Refresh as RefreshIcon,
  Search as SearchIcon,
} from '@mui/icons-material';
import { useProvider } from '@/contexts/ProviderContext';
import { createTunnel, deleteTunnel, getTunnelConfig, getTunnels } from '@/services/tunnels';
import { Tunnel } from '@/types';
import { formatDateTime } from '@/utils/formatters';
import TunnelPublicHostnamesDialog from '@/components/Tunnels/TunnelPublicHostnamesDialog';
import TunnelDetailsPanel from '@/components/Tunnels/TunnelDetailsPanel';

const getStatusColor = (status?: Tunnel['status']) => {
  if (status === 'healthy') return 'success';
  if (status === 'degraded') return 'warning';
  if (status === 'down') return 'error';
  return 'default';
};

const getStatusLabel = (status?: Tunnel['status']) => {
  if (status === 'healthy') return '正常';
  if (status === 'degraded') return '降级';
  if (status === 'down') return '离线';
  if (status === 'inactive') return '未连接';
  return '未知';
};

const countPublicHostnames = (config: any): number => {
  const ingress = Array.isArray(config?.ingress) ? config.ingress : [];
  return ingress.filter((r: any) => typeof r?.hostname === 'string' && String(r.hostname).trim()).length;
};

function useEnableWhenVisible<T extends Element>() {
  const ref = useRef<T | null>(null);
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    if (enabled) return;
    const el = ref.current;
    if (!el) return;

    if (typeof IntersectionObserver === 'undefined') {
      setEnabled(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setEnabled(true);
          observer.disconnect();
        }
      },
      { rootMargin: '200px' }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [enabled]);

  return { ref, enabled };
}

function TunnelPublicHostnamesCount(props: {
  credentialId: number;
  tunnelId: string;
  mode: 'chip' | 'text';
}) {
  const { credentialId, tunnelId, mode } = props;
  const { ref, enabled } = useEnableWhenVisible<HTMLSpanElement>();

  const query = useQuery({
    queryKey: ['tunnel-config', credentialId, tunnelId],
    queryFn: () => getTunnelConfig(tunnelId, credentialId),
    enabled: enabled && typeof credentialId === 'number',
  });

  const errText = query.error ? String((query.error as any)?.message || query.error) : '';
  const count = !query.error ? countPublicHostnames(query.data?.data?.config) : 0;

  const label = !enabled
    ? '--'
    : (query.isLoading || query.isFetching)
      ? '加载中...'
      : query.error
        ? '读取失败'
        : (count > 0 ? `已配置 ${count}` : '未配置');

  const chipColor = query.error ? 'error' : (count > 0 ? 'primary' : 'default');
  const textColor = query.error ? 'error.main' : 'text.secondary';

  if (mode === 'text') {
    return (
      <Box component="span" ref={ref} sx={{ color: textColor }}>
        {label}
      </Box>
    );
  }

  return (
    <Box component="span" ref={ref}>
      {query.error ? (
        <Tooltip title={errText}>
          <Chip size="small" variant="outlined" label={label} color={chipColor as any} />
        </Tooltip>
      ) : (
        <Chip size="small" variant="outlined" label={label} color={chipColor as any} />
      )}
    </Box>
  );
}

export default function Tunnels() {
  const { zoneId } = useParams<{ zoneId?: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));

  const [searchKeyword, setSearchKeyword] = useState('');
  const [actionAlert, setActionAlert] = useState<{ severity: 'success' | 'error' | 'info' | 'warning'; message: string } | null>(null);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [createName, setCreateName] = useState('');
  const [publicHostnamesTunnel, setPublicHostnamesTunnel] = useState<Tunnel | null>(null);
  const [deleteTargetTunnel, setDeleteTargetTunnel] = useState<Tunnel | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteCleanupDns, setDeleteCleanupDns] = useState(true);
  const [expandedTunnelId, setExpandedTunnelId] = useState<string | null>(null);

  const { selectedCredentialId, credentials } = useProvider();
  const credParam = new URLSearchParams(location.search).get('credentialId');
  const parsedCredId = credParam ? parseInt(credParam, 10) : undefined;
  const credFromQuery = typeof parsedCredId === 'number' && Number.isFinite(parsedCredId)
    ? parsedCredId
    : undefined;
  const credentialId = typeof credFromQuery === 'number'
    ? credFromQuery
    : (typeof selectedCredentialId === 'number' ? selectedCredentialId : undefined);

  const credentialProvider = typeof credentialId === 'number'
    ? credentials.find(c => c.id === credentialId)?.provider
    : undefined;
  const isKnownNonCloudflare = credentialProvider !== undefined && credentialProvider !== 'cloudflare';

  useEffect(() => {
    if (!zoneId) return;
    navigate(`/tunnels${location.search}`, { replace: true });
  }, [zoneId, location.search, navigate]);

  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: ['tunnels', credentialId],
    queryFn: () => getTunnels(credentialId!),
    enabled: typeof credentialId === 'number' && !isKnownNonCloudflare,
  });

  const tunnels: Tunnel[] = data?.data?.tunnels || [];
  const filteredTunnels = useMemo(() => {
    const keyword = searchKeyword.trim().toLowerCase();
    if (!keyword) return tunnels;

    return tunnels.filter(t => {
      const name = String(t?.name || '').toLowerCase();
      const id = String(t?.id || '').toLowerCase();
      return name.includes(keyword) || id.includes(keyword);
    });
  }, [tunnels, searchKeyword]);

  useEffect(() => {
    if (!expandedTunnelId) return;
    const exists = filteredTunnels.some(t => t.id === expandedTunnelId);
    if (!exists) setExpandedTunnelId(null);
  }, [expandedTunnelId, filteredTunnels]);

  const createMutation = useMutation({
    mutationFn: (name: string) => createTunnel(name, credentialId!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tunnels', credentialId] });
      setShowCreateDialog(false);
      setCreateName('');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (vars: { tunnelId: string; cleanupDns?: boolean }) =>
      deleteTunnel(vars.tunnelId, credentialId!, { cleanupDns: vars.cleanupDns }),
    onSuccess: (resp) => {
      queryClient.invalidateQueries({ queryKey: ['tunnels', credentialId] });
      setActionAlert({ severity: 'success', message: resp?.message || '删除 Tunnel 成功' });
      setDeleteDialogOpen(false);
      setDeleteTargetTunnel(null);
    },
    onError: (err) => {
      setActionAlert({ severity: 'error', message: String(err) });
    },
  });

  const copyText = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // ignore
    }
  };

  const openDeleteDialog = (t: Tunnel) => {
    setDeleteTargetTunnel(t);
    setDeleteCleanupDns(true);
    setDeleteDialogOpen(true);
  };

  const toggleTunnelExpand = (tunnelId: string) => {
    setExpandedTunnelId(prev => (prev === tunnelId ? null : tunnelId));
  };

  const closeDeleteDialog = () => {
    if (deleteMutation.isPending) return;
    setDeleteDialogOpen(false);
    setDeleteTargetTunnel(null);
  };

  const deletePreviewQuery = useQuery({
    queryKey: ['tunnel-config', credentialId, deleteTargetTunnel?.id],
    queryFn: () => getTunnelConfig(deleteTargetTunnel!.id, credentialId!),
    enabled: deleteDialogOpen && !!deleteTargetTunnel && typeof credentialId === 'number',
  });
  const deletePreviewCount = countPublicHostnames(deletePreviewQuery.data?.data?.config);

  if (typeof credentialId !== 'number') {
    return (
      <Alert severity="warning" sx={{ mt: 2 }}>
        请先在仪表盘选择一个 Cloudflare 账户后再进入此页面（或在地址栏携带 credentialId 参数，例如：`/tunnels?credentialId=123`）。
      </Alert>
    );
  }

  if (isKnownNonCloudflare) {
    return (
      <Alert severity="info" sx={{ mt: 2 }}>
        Tunnels 仅支持 Cloudflare 账户。
      </Alert>
    );
  }

  return (
    <Box>
      {isMobile && (
        <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 2 }}>
          <IconButton edge="start" onClick={() => navigate(-1)} aria-label="back">
            <ArrowBackIcon />
          </IconButton>
          <Typography variant="h6" fontWeight="bold">
            Tunnels
          </Typography>
        </Stack>
      )}

      {actionAlert && (
        <Alert
          severity={actionAlert.severity}
          sx={{ mb: 2 }}
          onClose={() => setActionAlert(null)}
        >
          {actionAlert.message}
        </Alert>
      )}

      <Box sx={{ mb: 2 }}>
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          justifyContent="space-between"
          alignItems={{ xs: 'stretch', sm: 'center' }}
          spacing={2}
        >
          <TextField
            size="small"
            placeholder="搜索 Tunnel..."
            value={searchKeyword}
            onChange={(e) => setSearchKeyword(e.target.value)}
            sx={{ width: { xs: '100%', sm: 240 } }}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon color="action" fontSize="small" />
                </InputAdornment>
              ),
            }}
          />

          <Stack direction="row" spacing={2} sx={{ justifyContent: { xs: 'flex-end', sm: 'flex-start' } }}>
            <Button
              variant="outlined"
              startIcon={<RefreshIcon />}
              onClick={() => refetch()}
              disabled={isLoading || isFetching}
              sx={{ px: 3, flex: { xs: 1, sm: 'none' } }}
            >
              刷新
            </Button>
            <Button
              variant="contained"
              startIcon={<AddIcon />}
              onClick={() => setShowCreateDialog(true)}
              sx={{ px: 3, flex: { xs: 1, sm: 'none' } }}
            >
              新建 Tunnel
            </Button>
          </Stack>
        </Stack>
      </Box>

      <Card
        sx={{
          border: 'none',
          boxShadow: isMobile ? 'none' : '0 4px 20px rgba(0,0,0,0.05)',
          bgcolor: isMobile ? 'transparent' : 'background.paper',
        }}
      >
        <CardContent sx={{ p: isMobile ? 0 : 0 }}>
          {isLoading ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', p: 3 }}>
              <CircularProgress size={24} />
            </Box>
          ) : error ? (
            <Alert severity="error" sx={{ m: 2 }}>
              {(error as any)?.message || String(error)}
            </Alert>
          ) : filteredTunnels.length === 0 ? (
            <Alert severity="info" sx={{ m: 2 }}>
              暂无 Tunnel
            </Alert>
          ) : isMobile ? (
            <Stack spacing={2} sx={{ p: 2 }}>
              {filteredTunnels.map((t) => {
                const isExpanded = expandedTunnelId === t.id;

                return (
                  <Card key={t.id} variant="outlined" sx={{ borderRadius: 2 }}>
                    <CardContent sx={{ pb: isExpanded ? 1 : 1.5 }}>
                      <Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={2}>
                        <Box sx={{ minWidth: 0 }}>
                          <Typography variant="subtitle1" fontWeight="bold" noWrap>
                            {t.name || t.id}
                          </Typography>
                          <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                            {t.id}
                          </Typography>
                          <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                            路由: <TunnelPublicHostnamesCount credentialId={credentialId} tunnelId={t.id} mode="text" />
                          </Typography>
                        </Box>
                        <Stack direction="row" spacing={0.5} alignItems="center">
                          <Chip
                            size="small"
                            label={getStatusLabel(t.status)}
                            color={getStatusColor(t.status) as any}
                            variant="outlined"
                          />
                          <IconButton
                            size="small"
                            onClick={() => toggleTunnelExpand(t.id)}
                            aria-label={isExpanded ? 'collapse tunnel details' : 'expand tunnel details'}
                          >
                            {isExpanded ? <KeyboardArrowUpIcon /> : <KeyboardArrowDownIcon />}
                          </IconButton>
                        </Stack>
                      </Stack>

                      <Divider sx={{ my: 1.5 }} />

                      <Stack direction="row" justifyContent="space-between" alignItems="center">
                        <Typography variant="caption" color="text.secondary">
                          连接数: {Array.isArray(t.connections) ? t.connections.length : 0}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {t.created_at ? formatDateTime(t.created_at) : '-'}
                        </Typography>
                      </Stack>

                      <Collapse in={isExpanded} timeout="auto" unmountOnExit>
                        <Box sx={{ mt: 1.5 }}>
                          <TunnelDetailsPanel
                            tunnel={t}
                            credentialId={credentialId}
                            open={isExpanded}
                            onCopyText={copyText}
                          />
                        </Box>
                      </Collapse>
                    </CardContent>

                    <CardActions sx={{ pt: 0, px: 2, pb: 2 }}>
                      <Button
                        size="small"
                        startIcon={<AltRouteIcon />}
                        onClick={() => setPublicHostnamesTunnel(t)}
                        sx={{ flex: 1 }}
                      >
                        路由管理
                      </Button>
                      <Button
                        size="small"
                        color="error"
                        startIcon={<DeleteIcon />}
                        onClick={() => {
                          openDeleteDialog(t);
                        }}
                        disabled={deleteMutation.isPending}
                        sx={{ flex: 1 }}
                      >
                        删除
                      </Button>
                    </CardActions>
                  </Card>
                );
              })}
            </Stack>
          ) : (
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell width={56} />
                  <TableCell>名称</TableCell>
                  <TableCell>ID</TableCell>
                  <TableCell>状态</TableCell>
                  <TableCell>路由</TableCell>
                  <TableCell>连接数</TableCell>
                  <TableCell>创建时间</TableCell>
                  <TableCell align="right">操作</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {filteredTunnels.map((t) => {
                  const isExpanded = expandedTunnelId === t.id;

                  return (
                    <Fragment key={t.id}>
                      <TableRow hover sx={{ '& > *': { borderBottom: isExpanded ? 'unset' : undefined } }}>
                        <TableCell>
                          <IconButton
                            size="small"
                            onClick={() => toggleTunnelExpand(t.id)}
                            aria-label={isExpanded ? 'collapse tunnel details' : 'expand tunnel details'}
                          >
                            {isExpanded ? <KeyboardArrowUpIcon /> : <KeyboardArrowDownIcon />}
                          </IconButton>
                        </TableCell>
                        <TableCell sx={{ fontWeight: 600 }}>{t.name || '-'}</TableCell>
                        <TableCell sx={{ fontFamily: 'monospace' }}>{t.id}</TableCell>
                        <TableCell>
                          <Chip
                            size="small"
                            label={getStatusLabel(t.status)}
                            color={getStatusColor(t.status) as any}
                            variant="outlined"
                          />
                        </TableCell>
                        <TableCell>
                          <TunnelPublicHostnamesCount credentialId={credentialId} tunnelId={t.id} mode="chip" />
                        </TableCell>
                        <TableCell>{Array.isArray(t.connections) ? t.connections.length : 0}</TableCell>
                        <TableCell>{t.created_at ? formatDateTime(t.created_at) : '-'}</TableCell>
                        <TableCell align="right">
                          <Tooltip title="路由管理">
                            <span>
                              <IconButton size="small" onClick={() => setPublicHostnamesTunnel(t)}>
                                <AltRouteIcon fontSize="small" />
                              </IconButton>
                            </span>
                          </Tooltip>
                          <Tooltip title="删除">
                            <span>
                              <IconButton
                                size="small"
                                color="error"
                                onClick={() => {
                                  openDeleteDialog(t);
                                }}
                                disabled={deleteMutation.isPending}
                              >
                                <DeleteIcon fontSize="small" />
                              </IconButton>
                            </span>
                          </Tooltip>
                        </TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell colSpan={8} sx={{ p: 0, borderBottom: 0 }}>
                          <Collapse in={isExpanded} timeout="auto" unmountOnExit>
                            <Box sx={{ p: 2 }}>
                              <TunnelDetailsPanel
                                tunnel={t}
                                credentialId={credentialId}
                                open={isExpanded}
                                onCopyText={copyText}
                              />
                            </Box>
                          </Collapse>
                        </TableCell>
                      </TableRow>
                    </Fragment>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={showCreateDialog} onClose={() => setShowCreateDialog(false)} fullWidth maxWidth="sm">
        <DialogTitle>新建 Tunnel</DialogTitle>
        <DialogContent sx={{ '&&': { pt: 2 } }}>
          <TextField
            autoFocus
            fullWidth
            label="名称"
            value={createName}
            onChange={(e) => setCreateName(e.target.value)}
            placeholder="例如：my-tunnel"
            inputProps={{ maxLength: 128 }}
          />
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 3 }}>
          <Button onClick={() => setShowCreateDialog(false)} color="inherit">
            取消
          </Button>
          <Button
            variant="contained"
            disabled={createMutation.isPending || !createName.trim()}
            onClick={() => createMutation.mutate(createName.trim())}
          >
            {createMutation.isPending ? '创建中...' : '创建'}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={deleteDialogOpen} onClose={closeDeleteDialog} fullWidth maxWidth="sm">
        <DialogTitle>删除 Tunnel</DialogTitle>
        <DialogContent sx={{ '&&': { pt: 2 } }}>
          <Stack spacing={2}>
            <Alert severity="warning">
              删除 Tunnel 会导致通过该 Tunnel 暴露的服务不可用。建议先确认 cloudflared 已停止或已迁移到其他 Tunnel。
            </Alert>

            <Box>
              <Typography variant="body2">
                名称：<strong>{deleteTargetTunnel?.name || '-'}</strong>
              </Typography>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                ID：{deleteTargetTunnel?.id || '-'}
              </Typography>
            </Box>

            <FormControlLabel
              control={
                <Checkbox
                  checked={deleteCleanupDns}
                  onChange={(e) => setDeleteCleanupDns(e.target.checked)}
                />
              }
              label="同时清理 DNS CNAME（仅删除指向该 Tunnel 的记录）"
            />

            {deleteCleanupDns && (
              <Alert severity="info">
                {deletePreviewQuery.isLoading || deletePreviewQuery.isFetching
                  ? '正在读取公共主机名列表...'
                  : deletePreviewQuery.error
                    ? `无法读取公共主机名列表：${String((deletePreviewQuery.error as any)?.message || deletePreviewQuery.error)}`
                    : `检测到 ${deletePreviewCount} 个公共主机名，将尝试清理其 DNS CNAME 记录。`}
                {deleteTargetTunnel?.id ? (
                  <>
                    <br />
                    目标：
                    <Typography component="span" sx={{ fontFamily: 'monospace' }}>
                      {` ${deleteTargetTunnel.id}.cfargotunnel.com`}
                    </Typography>
                  </>
                ) : null}
              </Alert>
            )}
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 3 }}>
          <Button onClick={closeDeleteDialog} color="inherit">
            取消
          </Button>
          <Button
            variant="contained"
            color="error"
            disabled={!deleteTargetTunnel || deleteMutation.isPending}
            onClick={() => {
              if (!deleteTargetTunnel) return;
              deleteMutation.mutate({ tunnelId: deleteTargetTunnel.id, cleanupDns: deleteCleanupDns });
            }}
          >
            {deleteMutation.isPending ? '删除中...' : '删除'}
          </Button>
        </DialogActions>
      </Dialog>

      {publicHostnamesTunnel && (
        <TunnelPublicHostnamesDialog
          open={!!publicHostnamesTunnel}
          onClose={() => setPublicHostnamesTunnel(null)}
          tunnel={publicHostnamesTunnel}
          credentialId={credentialId}
        />
      )}
    </Box>
  );
}
