import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Alert,
  Box,
  Chip,
  CircularProgress,
  IconButton,
  Link,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from '@mui/material';
import {
  ContentCopy as ContentCopyIcon,
  Visibility as VisibilityIcon,
  VisibilityOff as VisibilityOffIcon,
} from '@mui/icons-material';
import { Tunnel } from '@/types';
import { getTunnelConfig, getTunnelToken } from '@/services/tunnels';
import { formatDateTime } from '@/utils/formatters';

type TunnelConnection = NonNullable<Tunnel['connections']>[number];

type ReplicaRow = {
  id: string;
  originIp: string;
  edgeLocations: string[];
  version: string;
  architecture: string;
  openedAt?: string;
  openedAtTs?: number;
};

type RouteRow = {
  hostname: string;
  path: string;
  service: string;
};

type InstallOs = 'windows' | 'macos' | 'debian' | 'redhat' | 'docker';
type InstallArch = 'x64' | 'x86';

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

const getTimeMs = (value?: string): number | undefined => {
  if (!value) return undefined;
  const ms = new Date(value).getTime();
  if (!Number.isFinite(ms) || ms <= 0) return undefined;
  return ms;
};

const formatDuration = (startMs?: number): string => {
  if (!startMs) return '-';
  const now = Date.now();
  const diff = now - startMs;
  if (!Number.isFinite(diff) || diff <= 0) return '-';

  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  const days = Math.floor(diff / day);
  const hours = Math.floor((diff % day) / hour);
  const minutes = Math.floor((diff % hour) / minute);

  if (days > 0) return `${days} 天 ${hours} 小时`;
  if (hours > 0) return `${hours} 小时 ${minutes} 分钟`;
  if (minutes > 0) return `${minutes} 分钟`;
  return '刚刚';
};

const extractArchitecture = (text: string): string => {
  const lower = String(text || '').toLowerCase();
  if (!lower) return '-';

  const candidates = [
    'windows_amd64',
    'windows_386',
    'linux_amd64',
    'linux_arm64',
    'darwin_amd64',
    'darwin_arm64',
    'amd64',
    'arm64',
    '386',
    'x86_64',
    'aarch64',
  ];
  const hit = candidates.find(x => lower.includes(x));
  return hit || '-';
};

const maskToken = (token: string): string => {
  const raw = String(token || '').trim();
  if (!raw) return '';
  if (raw.length <= 14) return `${raw.slice(0, 2)}******${raw.slice(-2)}`;
  return `${raw.slice(0, 8)}****************${raw.slice(-6)}`;
};

const maskCommandToken = (command: string, token: string): string => {
  const raw = String(token || '').trim();
  if (!raw) return command;
  return command.replace(raw, maskToken(raw));
};

const normalizeRouteRows = (config: any): RouteRow[] => {
  const ingress = Array.isArray(config?.ingress) ? config.ingress : [];
  return ingress
    .filter((r: any) => typeof r?.hostname === 'string' && String(r.hostname).trim())
    .map((r: any) => ({
      hostname: String(r.hostname || '').trim(),
      path: String(r.path || '').trim(),
      service: String(r.service || '').trim(),
    }));
};

const buildReplicaRows = (connections?: TunnelConnection[]): ReplicaRow[] => {
  if (!Array.isArray(connections) || connections.length === 0) return [];

  const grouped = new Map<string, ReplicaRow & { edgeSet: Set<string> }>();

  connections.forEach((conn, index) => {
    const clientId = String(conn?.client_id || '').trim();
    const uuid = String(conn?.uuid || '').trim();
    const key = clientId || uuid || `replica-${index + 1}`;

    if (!grouped.has(key)) {
      const openedAt = String(conn?.opened_at || '').trim();
      const openedAtTs = getTimeMs(openedAt);
      grouped.set(key, {
        id: key,
        originIp: String(conn?.origin_ip || '').trim() || '-',
        edgeLocations: [],
        edgeSet: new Set<string>(),
        version: String(conn?.client_version || '').trim() || '-',
        architecture: extractArchitecture(String(conn?.client_version || '').trim()),
        openedAt: openedAt || undefined,
        openedAtTs,
      });
    }

    const current = grouped.get(key)!;
    const colo = String(conn?.colo_name || '').trim();
    if (colo) current.edgeSet.add(colo);

    if (current.originIp === '-' && conn?.origin_ip) {
      current.originIp = String(conn.origin_ip).trim() || '-';
    }
    if ((current.version === '-' || !current.version) && conn?.client_version) {
      current.version = String(conn.client_version).trim() || '-';
      current.architecture = extractArchitecture(current.version);
    }

    const openedAt = String(conn?.opened_at || '').trim();
    const openedAtTs = getTimeMs(openedAt);
    if (openedAtTs && (!current.openedAtTs || openedAtTs < current.openedAtTs)) {
      current.openedAtTs = openedAtTs;
      current.openedAt = openedAt;
    }
  });

  return Array.from(grouped.values()).map((item) => ({
    id: item.id,
    originIp: item.originIp,
    edgeLocations: Array.from(item.edgeSet.values()),
    version: item.version,
    architecture: item.architecture,
    openedAt: item.openedAt,
    openedAtTs: item.openedAtTs,
  }));
};

function CommandBlock(props: {
  title: string;
  command: string;
  copyValue: string;
  onCopyText: (text: string) => void;
  disabled?: boolean;
}) {
  const { title, command, copyValue, onCopyText, disabled } = props;

  return (
    <Box
      sx={{
        border: '1px solid',
        borderColor: 'divider',
        borderRadius: 1.5,
        bgcolor: 'background.paper',
      }}
    >
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ px: 1.5, py: 1, borderBottom: '1px solid', borderColor: 'divider' }}>
        <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 600 }}>
          {title}
        </Typography>
        <Tooltip title="复制命令">
          <span>
            <IconButton
              size="small"
              onClick={() => onCopyText(copyValue)}
              disabled={disabled}
            >
              <ContentCopyIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
      </Stack>
      <Box
        sx={{
          px: 1.5,
          py: 1.25,
          fontFamily: 'monospace',
          fontSize: 13,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-all',
          bgcolor: '#0B1020',
          color: '#E2E8F0',
          borderRadius: '0 0 6px 6px',
        }}
      >
        {command}
      </Box>
    </Box>
  );
}

export default function TunnelDetailsPanel(props: {
  tunnel: Tunnel;
  credentialId: number;
  open: boolean;
  onCopyText: (text: string) => void;
}) {
  const { tunnel, credentialId, open, onCopyText } = props;
  const [installOs, setInstallOs] = useState<InstallOs>('windows');
  const [installArch, setInstallArch] = useState<InstallArch>('x64');
  const [showToken, setShowToken] = useState(false);

  const replicas = useMemo(() => buildReplicaRows(tunnel.connections), [tunnel.connections]);
  const activeReplicaCount = replicas.length;
  const isDisconnected = tunnel.status === 'inactive' || tunnel.status === 'down' || activeReplicaCount === 0;

  const configQuery = useQuery({
    queryKey: ['tunnel-config', credentialId, tunnel.id],
    queryFn: () => getTunnelConfig(tunnel.id, credentialId),
    enabled: open && typeof credentialId === 'number',
  });

  const tokenQuery = useQuery({
    queryKey: ['tunnel-token', credentialId, tunnel.id],
    queryFn: () => getTunnelToken(tunnel.id, credentialId),
    enabled: open && isDisconnected && typeof credentialId === 'number',
    staleTime: 60 * 1000,
  });

  const routeRows = useMemo(
    () => normalizeRouteRows(configQuery.data?.data?.config),
    [configQuery.data?.data?.config]
  );
  const routeCount = routeRows.length;

  const uptimeStartMs = useMemo(() => {
    const activeAt = getTimeMs(tunnel.conns_active_at);
    if (activeAt) return activeAt;
    const replicaTimes = replicas.map(r => r.openedAtTs).filter((t): t is number => typeof t === 'number');
    if (replicaTimes.length === 0) return undefined;
    return Math.min(...replicaTimes);
  }, [tunnel.conns_active_at, replicas]);
  const uptimeLabel = isDisconnected ? '-' : formatDuration(uptimeStartMs);

  const token = String(tokenQuery.data?.data?.token || '').trim();
  const tokenDisplay = showToken ? token : maskToken(token);

  const installCommand = useMemo(() => {
    if (installOs === 'windows') {
      if (installArch === 'x86') return 'winget install --id Cloudflare.cloudflared --architecture x86';
      return 'winget install --id Cloudflare.cloudflared';
    }
    if (installOs === 'macos') return 'brew install cloudflared';
    if (installOs === 'debian') {
      return [
        'sudo mkdir -p --mode=0755 /usr/share/keyrings',
        'curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg | sudo tee /usr/share/keyrings/cloudflare-main.gpg >/dev/null',
        'echo \'deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared any main\' | sudo tee /etc/apt/sources.list.d/cloudflared.list',
        'sudo apt-get update && sudo apt-get install cloudflared',
      ].join('\n');
    }
    if (installOs === 'redhat') {
      return [
        'curl -fsSl https://pkg.cloudflare.com/cloudflared.repo | sudo tee /etc/yum.repos.d/cloudflared.repo',
        'sudo yum update && sudo yum install cloudflared',
      ].join('\n');
    }
    return 'docker pull cloudflare/cloudflared:latest';
  }, [installOs, installArch]);

  const fullRunCommand = useMemo(() => {
    const tokenOrPlaceholder = token || '<TOKEN>';
    if (installOs === 'windows') {
      return `cloudflared.exe service install ${tokenOrPlaceholder}`;
    }
    if (installOs === 'docker') {
      return `docker run --pull always cloudflare/cloudflared:latest tunnel --no-autoupdate run --token ${tokenOrPlaceholder}`;
    }
    return `sudo cloudflared service install ${tokenOrPlaceholder}`;
  }, [installOs, token]);

  const shownRunCommand = showToken ? fullRunCommand : maskCommandToken(fullRunCommand, token);

  const downloadHref = useMemo(() => {
    if (installOs === 'windows') {
      return installArch === 'x86'
        ? 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-386.msi'
        : 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.msi';
    }
    return 'https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/downloads/';
  }, [installOs, installArch]);

  return (
    <Box
      sx={{
        border: '1px solid',
        borderColor: 'divider',
        borderRadius: 2,
        p: { xs: 1.5, sm: 2 },
        bgcolor: 'background.default',
      }}
    >
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ mb: 2 }}>
        <Box sx={{ flex: 1, p: 1.5, border: '1px solid', borderColor: 'divider', borderRadius: 1.5, bgcolor: 'background.paper' }}>
          <Typography variant="caption" color="text.secondary">Active replicas</Typography>
          <Typography variant="h6" sx={{ mt: 0.5 }}>{activeReplicaCount}</Typography>
        </Box>
        <Box sx={{ flex: 1, p: 1.5, border: '1px solid', borderColor: 'divider', borderRadius: 1.5, bgcolor: 'background.paper' }}>
          <Typography variant="caption" color="text.secondary">Routes</Typography>
          <Typography variant="h6" sx={{ mt: 0.5 }}>
            {configQuery.isLoading ? <CircularProgress size={18} /> : routeCount}
          </Typography>
        </Box>
        <Box sx={{ flex: 1, p: 1.5, border: '1px solid', borderColor: 'divider', borderRadius: 1.5, bgcolor: 'background.paper' }}>
          <Typography variant="caption" color="text.secondary">Status</Typography>
          <Box sx={{ mt: 0.75 }}>
            <Chip size="small" label={getStatusLabel(tunnel.status)} color={getStatusColor(tunnel.status) as any} />
          </Box>
        </Box>
        <Box sx={{ flex: 1, p: 1.5, border: '1px solid', borderColor: 'divider', borderRadius: 1.5, bgcolor: 'background.paper' }}>
          <Typography variant="caption" color="text.secondary">Uptime</Typography>
          <Typography variant="h6" sx={{ mt: 0.5 }}>{uptimeLabel}</Typography>
        </Box>
      </Stack>

      {isDisconnected ? (
        <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, p: { xs: 1.5, sm: 2 }, bgcolor: 'background.paper' }}>
          <Stack spacing={1.5}>
            <Alert severity="warning">
              Tunnel 当前未连接。安装并启动 cloudflared 后，连接会自动恢复。
            </Alert>

            <Box>
              <Typography variant="subtitle2" sx={{ mb: 1 }}>选择操作系统</Typography>
              <ToggleButtonGroup
                size="small"
                exclusive
                value={installOs}
                onChange={(_, next: InstallOs | null) => {
                  if (next) setInstallOs(next);
                }}
              >
                <ToggleButton value="windows">Windows</ToggleButton>
                <ToggleButton value="macos">macOS</ToggleButton>
                <ToggleButton value="debian">Debian</ToggleButton>
                <ToggleButton value="redhat">Red Hat</ToggleButton>
                <ToggleButton value="docker">Docker</ToggleButton>
              </ToggleButtonGroup>
            </Box>

            {installOs !== 'docker' && (
              <Box>
                <Typography variant="subtitle2" sx={{ mb: 1 }}>选择架构</Typography>
                <ToggleButtonGroup
                  size="small"
                  exclusive
                  value={installArch}
                  onChange={(_, next: InstallArch | null) => {
                    if (next) setInstallArch(next);
                  }}
                >
                  <ToggleButton value="x64">64-bit</ToggleButton>
                  <ToggleButton value="x86">32-bit</ToggleButton>
                </ToggleButtonGroup>
              </Box>
            )}

            <Typography variant="body2" color="text.secondary">
              1. 下载并安装 cloudflared：{' '}
              <Link href={downloadHref} target="_blank" rel="noopener noreferrer">
                官方下载 / 安装说明
              </Link>
            </Typography>

            <CommandBlock
              title="安装命令"
              command={installCommand}
              copyValue={installCommand}
              onCopyText={onCopyText}
            />

            <Stack direction="row" spacing={1} alignItems="center">
              <Typography variant="body2" color="text.secondary">
                Token
              </Typography>
              <Tooltip title={showToken ? '隐藏 Token' : '显示 Token'}>
                <span>
                  <IconButton
                    size="small"
                    onClick={() => setShowToken(v => !v)}
                    disabled={!token}
                  >
                    {showToken ? <VisibilityOffIcon fontSize="small" /> : <VisibilityIcon fontSize="small" />}
                  </IconButton>
                </span>
              </Tooltip>
              <Tooltip title="复制完整 Token">
                <span>
                  <IconButton
                    size="small"
                    onClick={() => onCopyText(token)}
                    disabled={!token}
                  >
                    <ContentCopyIcon fontSize="small" />
                  </IconButton>
                </span>
              </Tooltip>
            </Stack>

            {tokenQuery.isLoading ? (
              <Alert severity="info">正在获取 Tunnel Token...</Alert>
            ) : tokenQuery.error ? (
              <Alert severity="error">
                无法获取 Token：{String((tokenQuery.error as any)?.message || tokenQuery.error)}
              </Alert>
            ) : (
              <>
                <Box
                  sx={{
                    border: '1px solid',
                    borderColor: 'divider',
                    borderRadius: 1.5,
                    px: 1.5,
                    py: 1,
                    bgcolor: '#0B1020',
                    color: '#E2E8F0',
                    fontFamily: 'monospace',
                    fontSize: 13,
                    wordBreak: 'break-all',
                  }}
                >
                  {tokenDisplay || '<TOKEN>'}
                </Box>
                <CommandBlock
                  title="连接命令"
                  command={shownRunCommand}
                  copyValue={fullRunCommand}
                  onCopyText={onCopyText}
                />
              </>
            )}
          </Stack>
        </Box>
      ) : (
        <Stack spacing={2}>
          <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1.5, bgcolor: 'background.paper', overflowX: 'auto' }}>
            <Box sx={{ p: 1.25, borderBottom: '1px solid', borderColor: 'divider' }}>
              <Typography variant="subtitle2" fontWeight={700}>Replicas</Typography>
            </Box>
            <Table size="small" sx={{ minWidth: 760 }}>
              <TableHead>
                <TableRow>
                  <TableCell>Replica ID</TableCell>
                  <TableCell>Origin IP</TableCell>
                  <TableCell>Edge Locations</TableCell>
                  <TableCell>Version</TableCell>
                  <TableCell>Architecture</TableCell>
                  <TableCell>Uptime</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {replicas.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} align="center" sx={{ py: 3 }}>
                      <Typography variant="body2" color="text.secondary">暂无在线副本</Typography>
                    </TableCell>
                  </TableRow>
                ) : (
                  replicas.map((replica) => (
                    <TableRow key={replica.id}>
                      <TableCell sx={{ fontFamily: 'monospace' }}>{replica.id}</TableCell>
                      <TableCell>{replica.originIp || '-'}</TableCell>
                      <TableCell>{replica.edgeLocations.length ? replica.edgeLocations.join(', ') : '-'}</TableCell>
                      <TableCell sx={{ fontFamily: 'monospace' }}>{replica.version || '-'}</TableCell>
                      <TableCell sx={{ fontFamily: 'monospace' }}>{replica.architecture || '-'}</TableCell>
                      <TableCell>
                        {replica.openedAtTs ? formatDuration(replica.openedAtTs) : '-'}
                        {replica.openedAt ? (
                          <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                            {formatDateTime(replica.openedAt)}
                          </Typography>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </Box>

          <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1.5, bgcolor: 'background.paper', overflowX: 'auto' }}>
            <Box sx={{ p: 1.25, borderBottom: '1px solid', borderColor: 'divider' }}>
              <Typography variant="subtitle2" fontWeight={700}>Routes</Typography>
            </Box>
            {configQuery.isLoading ? (
              <Box sx={{ p: 2 }}>
                <CircularProgress size={20} />
              </Box>
            ) : configQuery.error ? (
              <Alert severity="error" sx={{ m: 2 }}>
                无法读取路由配置：{String((configQuery.error as any)?.message || configQuery.error)}
              </Alert>
            ) : routeRows.length === 0 ? (
              <Alert severity="info" sx={{ m: 2 }}>暂无公开路由</Alert>
            ) : (
              <Table size="small" sx={{ minWidth: 700 }}>
                <TableHead>
                  <TableRow>
                    <TableCell>Hostname</TableCell>
                    <TableCell>Path</TableCell>
                    <TableCell>Service</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {routeRows.map((route) => (
                    <TableRow key={`${route.hostname}::${route.path || ''}::${route.service || ''}`}>
                      <TableCell>{route.hostname}</TableCell>
                      <TableCell sx={{ fontFamily: 'monospace' }}>{route.path || '-'}</TableCell>
                      <TableCell sx={{ fontFamily: 'monospace' }}>{route.service || '-'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Box>
        </Stack>
      )}
    </Box>
  );
}
