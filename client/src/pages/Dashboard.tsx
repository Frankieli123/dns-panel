import { useState, Fragment, useEffect, useMemo } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  Box,
  Typography,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Button,
  Chip,
  CircularProgress,
  Alert,
  TextField,
  InputAdornment,
  Card,
  CardContent,
  Stack,
  IconButton,
  Collapse,
  Divider,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Menu,
  MenuItem,
  TablePagination,
  useTheme,
  useMediaQuery,
} from '@mui/material';
import {
  Search as SearchIcon,
  Refresh as RefreshIcon,
  Add as AddIcon,
  Dns as DnsIcon,
  CheckCircle as ActiveIcon,
  Pending as PendingIcon,
  Error as ErrorIcon,
  KeyboardArrowDown as KeyboardArrowDownIcon,
  KeyboardArrowUp as KeyboardArrowUpIcon,
  Business as BusinessIcon,
  Delete as DeleteIcon,
  MoreVert as MoreVertIcon,
  OpenInNew as OpenInNewIcon,
  AccessTime as AccessTimeIcon,
  Event as EventIcon,
  CloudQueue as CloudflareIcon,
  Storage as AliyunIcon,
  Language as DnspodIcon,
  Cloud as HuaweiIcon,
  CloudCircle as BaiduIcon,
  Public as WestIcon,
  Whatshot as HuoshanIcon,
  CloudDone as JdcloudIcon,
  Dns as DnslaIcon,
  Label as NamesiloIcon,
  PowerSettingsNew as PowerdnsIcon,
  RocketLaunch as SpaceshipIcon,
} from '@mui/icons-material';
import { deleteZone, getDomains, refreshDomains } from '@/services/domains';
import { getStoredUser } from '@/services/auth';
import { lookupDomainExpiry } from '@/services/domainExpiry';
import { formatRelativeTime } from '@/utils/formatters';
import { alpha } from '@mui/material/styles';
import { Domain } from '@/types';
import { ProviderType } from '@/types/dns';
import DnsManagement from '@/components/DnsManagement/DnsManagement';
import ProviderAccountTabs from '@/components/Dashboard/ProviderAccountTabs';
import AddZoneDialog from '@/components/Dashboard/AddZoneDialog';
import { useProvider } from '@/contexts/ProviderContext';

const DOMAINS_PER_PAGE_STORAGE_KEY = 'dns_domains_per_page';
const DOMAINS_PER_PAGE_CHANGED_EVENT = 'dns_domains_per_page_changed';

const PROVIDER_CONFIG: Record<ProviderType, { icon: React.ReactNode; color: string; name: string }> = {
  cloudflare: { icon: <CloudflareIcon />, color: '#f38020', name: 'Cloudflare' },
  aliyun: { icon: <AliyunIcon />, color: '#ff6a00', name: '阿里云' },
  dnspod: { icon: <DnspodIcon />, color: '#0052d9', name: '腾讯云' },
  dnspod_token: { icon: <DnspodIcon />, color: '#0052d9', name: '腾讯云' },
  huawei: { icon: <HuaweiIcon />, color: '#e60012', name: '华为云' },
  baidu: { icon: <BaiduIcon />, color: '#2932e1', name: '百度云' },
  west: { icon: <WestIcon />, color: '#1e88e5', name: '西部数码' },
  huoshan: { icon: <HuoshanIcon />, color: '#1f54f7', name: '火山引擎' },
  jdcloud: { icon: <JdcloudIcon />, color: '#e1251b', name: '京东云' },
  dnsla: { icon: <DnslaIcon />, color: '#4caf50', name: 'DNSLA' },
  namesilo: { icon: <NamesiloIcon />, color: '#2196f3', name: 'NameSilo' },
  powerdns: { icon: <PowerdnsIcon />, color: '#333333', name: 'PowerDNS' },
  spaceship: { icon: <SpaceshipIcon />, color: '#7e57c2', name: 'Spaceship' },
};

export default function Dashboard() {
  const [searchTerm, setSearchTerm] = useState('');
  const [expandedDomainKey, setExpandedDomainKey] = useState<string | null>(null);
  const [addZoneOpen, setAddZoneOpen] = useState(false);
  const [zoneMenuAnchor, setZoneMenuAnchor] = useState<HTMLElement | null>(null);
  const [zoneMenuDomain, setZoneMenuDomain] = useState<Domain | null>(null);
  const [deleteZoneOpen, setDeleteZoneOpen] = useState(false);
  const [deleteZoneError, setDeleteZoneError] = useState<string | null>(null);
  const [deleteConfirmInput, setDeleteConfirmInput] = useState('');
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(20);
  const navigate = useNavigate();
  const location = useLocation();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));

  const isAllScope = new URLSearchParams(location.search).get('scope') === 'all';
  const [allScopeCredentialId, setAllScopeCredentialId] = useState<number | 'all'>('all');

  const { selectedCredentialId, selectedProvider, credentials, getCredentialsByProvider, selectProvider } = useProvider();

  useEffect(() => {
    if (!isAllScope) return;
    if (selectedProvider !== null) {
      selectProvider(null);
    }
  }, [isAllScope, selectedProvider, selectProvider]);

  useEffect(() => {
    const raw = localStorage.getItem(DOMAINS_PER_PAGE_STORAGE_KEY);
    const parsed = raw ? parseInt(raw, 10) : NaN;
    if (Number.isFinite(parsed) && parsed >= 20) {
      setRowsPerPage(parsed);
    }

    const onDomainsPerPageChanged = (ev: Event) => {
      const detail = (ev as CustomEvent<number>)?.detail;
      const next = Number.isFinite(detail) ? detail : parseInt(localStorage.getItem(DOMAINS_PER_PAGE_STORAGE_KEY) || '', 10);
      if (Number.isFinite(next) && next >= 20) {
        setRowsPerPage(next);
        setPage(0);
        setExpandedDomainKey(null);
      }
    };

    window.addEventListener(DOMAINS_PER_PAGE_CHANGED_EVENT, onDomainsPerPageChanged as EventListener);
    return () => {
      window.removeEventListener(DOMAINS_PER_PAGE_CHANGED_EVENT, onDomainsPerPageChanged as EventListener);
    };
  }, []);

  const credentialNameById = useMemo(() => {
    const map = new Map<number, string>();
    credentials.forEach((c) => {
      map.set(c.id, c.name);
    });
    return map;
  }, [credentials]);

  const credentialProviderById = useMemo(() => {
    const map = new Map<number, ProviderType>();
    credentials.forEach((c) => {
      map.set(c.id, c.provider);
    });
    return map;
  }, [credentials]);

  const effectiveCredentialId = isAllScope
    ? allScopeCredentialId
    : selectedCredentialId;

  const effectiveCredentials = isAllScope
    ? credentials
    : selectedProvider
      ? getCredentialsByProvider(selectedProvider)
      : [];

  const currentProviderCredentials = selectedProvider
    ? getCredentialsByProvider(selectedProvider)
    : [];

  const isZoneManageProvider = (provider?: ProviderType | null): boolean => {
    if (!provider) return false;
    return (
      provider === 'cloudflare' ||
      provider === 'aliyun' ||
      provider === 'dnspod' ||
      provider === 'dnspod_token' ||
      provider === 'huawei' ||
      provider === 'baidu' ||
      provider === 'huoshan' ||
      provider === 'jdcloud' ||
      provider === 'dnsla' ||
      provider === 'powerdns'
    );
  };

  const zoneManageCredentials = useMemo(
    () => credentials.filter(c => isZoneManageProvider(c.provider)),
    [credentials]
  );

  const addZoneCredentials = isAllScope ? zoneManageCredentials : currentProviderCredentials;

  const showAddZone = isAllScope ? true : isZoneManageProvider(selectedProvider);
  const initialAddCredentialId = useMemo(() => {
    if (!showAddZone) return undefined;
    if (isAllScope) {
      if (typeof allScopeCredentialId === 'number' && zoneManageCredentials.some(c => c.id === allScopeCredentialId)) {
        return allScopeCredentialId;
      }
      return zoneManageCredentials[0]?.id;
    }

    if (typeof selectedCredentialId === 'number') return selectedCredentialId;
    return currentProviderCredentials[0]?.id;
  }, [
    showAddZone,
    isAllScope,
    allScopeCredentialId,
    zoneManageCredentials,
    selectedCredentialId,
    currentProviderCredentials,
  ]);

  const { data, isLoading, error, refetch, isRefetching } = useQuery({
    queryKey: isAllScope
      ? ['domains', 'all', allScopeCredentialId, credentials.map(c => c.id)]
      : ['domains', selectedProvider, selectedCredentialId],
    queryFn: async () => {
      if (isAllScope) {
        if (credentials.length === 0) {
          return { data: { domains: [] } };
        }

        if (allScopeCredentialId === 'all') {
          const results = await Promise.allSettled(
            credentials.map(cred => getDomains(cred.id))
          );

          const allDomains: Domain[] = [];
          results.forEach((result, index) => {
            if (result.status === 'fulfilled' && result.value.data?.domains) {
              const cred = credentials[index];
              const credentialName = cred.name;

              result.value.data.domains.forEach(domain => {
                allDomains.push({
                  ...domain,
                  credentialId: cred.id,
                  credentialName,
                  provider: cred.provider,
                });
              });
            }
          });

          return { data: { domains: allDomains } };
        }

        return getDomains(allScopeCredentialId);
      }

      if (!selectedProvider || currentProviderCredentials.length === 0) {
        return { data: { domains: [] } };
      }

      const safeSelectedCredentialId: number | 'all' =
        selectedCredentialId === 'all'
          ? 'all'
          : typeof selectedCredentialId === 'number' && currentProviderCredentials.some(c => c.id === selectedCredentialId)
            ? selectedCredentialId
            : currentProviderCredentials.length === 1
              ? currentProviderCredentials[0].id
              : 'all';

      if (safeSelectedCredentialId === 'all') {
        const results = await Promise.allSettled(
          currentProviderCredentials.map(cred => getDomains(cred.id))
        );

        const allDomains: Domain[] = [];
        results.forEach((result, index) => {
          if (result.status === 'fulfilled' && result.value.data?.domains) {
            const cred = currentProviderCredentials[index];
            result.value.data.domains.forEach(domain => {
              allDomains.push({
                ...domain,
                credentialId: cred.id,
                credentialName: cred.name,
                provider: cred.provider,
              });
            });
          }
        });

        return { data: { domains: allDomains } };
      }

      return getDomains(safeSelectedCredentialId);
    },
    enabled: isAllScope
      ? credentials.length > 0
      : !!selectedProvider && currentProviderCredentials.length > 0,
  });

  useEffect(() => {
    setSearchTerm('');
    setExpandedDomainKey(null);
    setPage(0);
  }, [selectedCredentialId, selectedProvider, isAllScope, allScopeCredentialId]);

  useEffect(() => {
    setPage(0);
    setExpandedDomainKey(null);
  }, [searchTerm]);

  const handleRefresh = async () => {
    if (isAllScope) {
      if (allScopeCredentialId === 'all') {
        await Promise.all(credentials.map(c => refreshDomains(c.id)));
      } else {
        await refreshDomains(allScopeCredentialId);
      }
      refetch();
      return;
    }

    if (selectedProvider) {
      const safeSelectedCredentialId: number | 'all' =
        selectedCredentialId === 'all'
          ? 'all'
          : typeof selectedCredentialId === 'number' && currentProviderCredentials.some(c => c.id === selectedCredentialId)
            ? selectedCredentialId
            : currentProviderCredentials.length === 1
              ? currentProviderCredentials[0].id
              : 'all';

      if (safeSelectedCredentialId === 'all') {
        await Promise.all(currentProviderCredentials.map(c => refreshDomains(c.id)));
      } else {
        await refreshDomains(safeSelectedCredentialId);
      }
      refetch();
    }
  };

  const domains: Domain[] = data?.data?.domains || [];
  const filteredDomains = domains.filter((domain) =>
    domain.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const maxPage = Math.max(0, Math.ceil(filteredDomains.length / rowsPerPage) - 1);
  useEffect(() => {
    if (page > maxPage) {
      setPage(0);
      setExpandedDomainKey(null);
    }
  }, [page, maxPage]);

  const pagedDomains = useMemo(() => {
    const start = page * rowsPerPage;
    const end = start + rowsPerPage;
    return filteredDomains.slice(start, end);
  }, [filteredDomains, page, rowsPerPage]);

  const expiryDisplayMode = getStoredUser()?.domainExpiryDisplayMode === 'days' ? 'days' : 'date';
  const expiryLabel = expiryDisplayMode === 'date' ? '到期日期' : '剩余天数';
  const expiryLookupDomains = useMemo(
    () => Array.from(new Set(pagedDomains.map(d => d.name.toLowerCase()))),
    [pagedDomains]
  );

  const { data: expiryData } = useQuery({
    queryKey: ['domain-expiry', expiryLookupDomains],
    queryFn: () => lookupDomainExpiry(expiryLookupDomains),
    enabled: expiryLookupDomains.length > 0,
    staleTime: 10 * 60 * 1000,
  });

  const expiryByDomain = useMemo(() => {
    const map = new Map<string, string | undefined>();
    const list = (expiryData as any)?.data?.results || [];
    list.forEach((r: any) => {
      const domain = typeof r?.domain === 'string' ? r.domain.toLowerCase() : '';
      const expiresAt = typeof r?.expiresAt === 'string' ? r.expiresAt : undefined;
      if (domain) map.set(domain, expiresAt);
    });
    return map;
  }, [expiryData]);

  const formatExpiryValue = (domainName: string): string => {
    const key = String(domainName || '').trim().toLowerCase();
    const expiresAt = expiryByDomain.get(key);
    if (!expiresAt) return '-';

    const datePart = expiresAt.slice(0, 10);
    if (expiryDisplayMode === 'date') return datePart;

    const expiresMs = Date.parse(`${datePart}T00:00:00Z`);
    if (!Number.isFinite(expiresMs)) return '-';

    const now = new Date();
    const todayUtcMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    const dLeft = Math.floor((expiresMs - todayUtcMs) / 86_400_000);
    if (!Number.isFinite(dLeft)) return '-';
    return `${dLeft} 天`;
  };

  const getStatusConfig = (status: string) => {
    const raw = String(status || '').trim();
    const s = raw.toLowerCase();

    if (s === 'unknown' || s === 'unknow') {
      return { label: '未知', color: 'default' as const, icon: null };
    }

    if (s === 'active') {
      return { label: '已激活', color: 'success' as const, icon: <ActiveIcon fontSize="small" /> };
    }
    if (s === 'pending') {
      return { label: '待验证', color: 'warning' as const, icon: <PendingIcon fontSize="small" /> };
    }
    if (s === 'moved') {
      return { label: '已迁出', color: 'error' as const, icon: <ErrorIcon fontSize="small" /> };
    }
    if (s === 'enable' || s === 'enabled' || s === 'enableing' || s === 'running' || s === 'normal') {
      return { label: '启用', color: 'success' as const, icon: <ActiveIcon fontSize="small" /> };
    }
    if (s === 'disable' || s === 'disabled' || s === 'pause' || s === 'paused' || s === 'stop' || s === 'stopped') {
      return { label: '禁用', color: 'default' as const, icon: null };
    }
    if (raw === 'ENABLE') {
      return { label: '启用', color: 'success' as const, icon: <ActiveIcon fontSize="small" /> };
    }
    if (raw === 'DISABLE') {
      return { label: '禁用', color: 'default' as const, icon: null };
    }

    return { label: raw || '-', color: 'default' as const, icon: null };
  };

  const showAccountColumn = effectiveCredentialId === 'all' && effectiveCredentials.length > 1;

  const getDomainCredentialName = (domain: Domain) => {
    if (typeof domain.credentialId === 'number') {
      const liveName = credentialNameById.get(domain.credentialId);
      if (liveName) return liveName;
    }
    return domain.credentialName || '未知账户';
  };

  const getDomainProvider = (domain: Domain): ProviderType | undefined => {
    if (domain.provider) return domain.provider;
    if (typeof domain.credentialId === 'number') {
      const p = credentialProviderById.get(domain.credentialId);
      if (p) return p;
    }
    return selectedProvider || undefined;
  };

  const canDeleteDomain = (domain: Domain): boolean =>
    isZoneManageProvider(getDomainProvider(domain)) && typeof domain.credentialId === 'number';

  const canOpenZoneMenu = (domain: Domain): boolean => typeof domain.credentialId === 'number';

  const zoneMenuProvider = zoneMenuDomain ? getDomainProvider(zoneMenuDomain) : undefined;
  const zoneMenuProviderLabel = zoneMenuProvider ? (PROVIDER_CONFIG[zoneMenuProvider]?.name || zoneMenuProvider) : 'DNS';

  const deleteMutation = useMutation({
    mutationFn: async (payload: { credentialId: number; zoneId: string }) => deleteZone(payload.credentialId, payload.zoneId),
    onSuccess: async () => {
      setDeleteZoneError(null);
      setDeleteZoneOpen(false);
      setZoneMenuAnchor(null);
      setZoneMenuDomain(null);
      setExpandedDomainKey(null);
      refetch();
    },
    onError: (err: any) => {
      setDeleteZoneError(err?.message ? String(err.message) : String(err));
    },
  });

  const openZoneMenu = (e: ReactMouseEvent<HTMLElement>, domain: Domain) => {
    e.stopPropagation();
    setZoneMenuAnchor(e.currentTarget);
    setZoneMenuDomain(domain);
  };

  const closeZoneMenu = () => setZoneMenuAnchor(null);

  const openDeleteZoneDialog = () => {
    if (!zoneMenuDomain) return;
    setDeleteZoneError(null);
    setDeleteZoneOpen(true);
    closeZoneMenu();
  };

  const closeDeleteZoneDialog = () => {
    if (deleteMutation.isPending) return;
    setDeleteZoneOpen(false);
    setDeleteZoneError(null);
    setDeleteConfirmInput('');
    setZoneMenuDomain(null);
  };

  const confirmDeleteZone = () => {
    if (!zoneMenuDomain) return;
    if (!canDeleteDomain(zoneMenuDomain)) return;
    if (deleteConfirmInput !== zoneMenuDomain.name) return;
    deleteMutation.mutate({
      credentialId: zoneMenuDomain.credentialId as number,
      zoneId: zoneMenuDomain.id,
    });
  };

  // 移动端卡片视图渲染函数
  const renderMobileView = () => (
    <Stack spacing={2}>
      {pagedDomains.map((domain) => {
        const status = getStatusConfig(domain.status);
        const rowKey = `${domain.id}-${domain.credentialId}`;
        const isExpanded = expandedDomainKey === rowKey;
        const detailPath = typeof domain.credentialId === 'number'
          ? `/domain/${domain.id}?credentialId=${domain.credentialId}`
          : `/domain/${domain.id}`;
        
        const providerConfig = domain.provider ? PROVIDER_CONFIG[domain.provider] : null;

        return (
          <Card key={rowKey} variant="outlined" sx={{ borderRadius: 2 }}>
            <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 1.5 }}>
                <Box>
                  <Typography variant="subtitle1" fontWeight="600" sx={{ mb: 0.5 }}>
                    {domain.name}
                  </Typography>
                  <Stack direction="row" spacing={1} alignItems="center">
                     <Chip
                        icon={status.icon || undefined}
                        label={status.label}
                        color={status.color === 'default' ? 'default' : status.color}
                        size="small"
                        sx={{
                          height: 24,
                          fontSize: '0.75rem',
                          bgcolor: (theme) => status.color !== 'default'
                            ? alpha(theme.palette[status.color as 'success' | 'warning' | 'error'].main, 0.1)
                            : undefined,
                          color: (theme) => status.color !== 'default'
                            ? theme.palette[status.color as 'success' | 'warning' | 'error'].dark
                            : undefined,
                          fontWeight: 600,
                          border: 'none',
                          '& .MuiChip-icon': { color: 'inherit' }
                        }}
                      />
                      {showAccountColumn && (
                        <Chip
                          size="small"
                          icon={
                             providerConfig
                             ? <Box component="span" sx={{ display: 'flex', fontSize: 16 }}>{providerConfig.icon}</Box>
                             : <BusinessIcon style={{ fontSize: 14 }} />
                          }
                          label={getDomainCredentialName(domain)}
                          variant="outlined"
                          sx={{ 
                            fontSize: '0.75rem', 
                            height: 24, 
                            borderRadius: 1,
                            ...(providerConfig ? {
                              borderColor: alpha(providerConfig.color, 0.3),
                              bgcolor: alpha(providerConfig.color, 0.08),
                              color: providerConfig.color,
                              '& .MuiChip-icon': { color: 'inherit' }
                            } : {})
                          }}
                        />
                      )}
                  </Stack>
                </Box>
                <Box>
                  <IconButton
                    size="small"
                    onClick={() => navigate(detailPath)}
                    sx={{ color: 'primary.main', bgcolor: alpha(theme.palette.primary.main, 0.1), mr: 1 }}
                  >
                    <OpenInNewIcon fontSize="small" />
                  </IconButton>
                  <IconButton
                    size="small"
                    onClick={(e) => openZoneMenu(e, domain)}
                    disabled={!canOpenZoneMenu(domain)}
                    sx={{ mr: 1 }}
                  >
                    <MoreVertIcon fontSize="small" />
                  </IconButton>
                  <IconButton
                    size="small"
                    onClick={() => setExpandedDomainKey(isExpanded ? null : rowKey)}
                    sx={{ 
                      transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
                      transition: 'transform 0.2s'
                    }}
                  >
                    <KeyboardArrowDownIcon />
                  </IconButton>
                </Box>
              </Box>

              <Stack direction="row" alignItems="center" spacing={0.5} sx={{ color: 'text.secondary', fontSize: '0.75rem' }}>
                <AccessTimeIcon sx={{ fontSize: 14 }} />
                <Typography variant="caption">
                  更新于 {domain.updatedAt ? formatRelativeTime(domain.updatedAt) : '-'}
                </Typography>
              </Stack>

              <Stack direction="row" alignItems="center" spacing={0.5} sx={{ color: 'text.secondary', fontSize: '0.75rem', mt: 0.5 }}>
                <EventIcon sx={{ fontSize: 14 }} />
                <Typography variant="caption">
                  {expiryLabel}: {formatExpiryValue(domain.name)}
                </Typography>
              </Stack>
            </CardContent>
            
            <Collapse in={isExpanded} timeout="auto" unmountOnExit>
              <Divider />
              <Box sx={{ p: 0 }}>
                <DnsManagement zoneId={domain.id} credentialId={domain.credentialId} />
              </Box>
            </Collapse>
          </Card>
        );
      })}
    </Stack>
  );

  // 桌面端表格视图渲染函数
  const renderDesktopView = () => (
    <TableContainer sx={{ overflowX: 'visible' }}>
      <Table sx={{ minWidth: 650, tableLayout: 'fixed' }}>
        <TableHead>
          <TableRow>
            <TableCell width={50} />
            <TableCell>域名</TableCell>
            {showAccountColumn && <TableCell>所属账户</TableCell>}
            <TableCell>状态</TableCell>
            <TableCell>最后更新</TableCell>
            <TableCell>{expiryLabel}</TableCell>
            <TableCell width={52} align="right" />
          </TableRow>
        </TableHead>
        <TableBody>
          {pagedDomains.map((domain) => {
            const status = getStatusConfig(domain.status);
            const rowKey = `${domain.id}-${domain.credentialId}`;
            const isExpanded = expandedDomainKey === rowKey;
            const detailPath = typeof domain.credentialId === 'number'
              ? `/domain/${domain.id}?credentialId=${domain.credentialId}`
              : `/domain/${domain.id}`;

            const providerConfig = domain.provider ? PROVIDER_CONFIG[domain.provider] : null;

            return (
              <Fragment key={rowKey}>
                <TableRow
                  hover
                  sx={{ '& > *': { borderBottom: 'unset' }, cursor: 'pointer' }}
                  onClick={() => setExpandedDomainKey(isExpanded ? null : rowKey)}
                >
                  <TableCell>
                    <IconButton
                      aria-label="expand row"
                      size="small"
                      onClick={(e) => {
                        e.stopPropagation();
                        setExpandedDomainKey(isExpanded ? null : rowKey);
                      }}
                    >
                      {isExpanded ? <KeyboardArrowUpIcon /> : <KeyboardArrowDownIcon />}
                    </IconButton>
                  </TableCell>
                  <TableCell>
                    <Stack direction="row" alignItems="center" spacing={1}>
                      <Typography variant="body1" fontWeight="600" color="text.primary">
                        {domain.name}
                      </Typography>
                      <IconButton
                        size="small"
                        onClick={(e) => {
                          e.stopPropagation();
                          navigate(detailPath);
                        }}
                      >
                        <OpenInNewIcon fontSize="inherit" />
                      </IconButton>
                    </Stack>
                  </TableCell>

                  {showAccountColumn && (
                    <TableCell>
                      <Chip
                        size="small"
                        icon={
                           providerConfig
                           ? <Box component="span" sx={{ display: 'flex', fontSize: 16 }}>{providerConfig.icon}</Box>
                           : <BusinessIcon style={{ fontSize: 14 }} />
                        }
                        label={getDomainCredentialName(domain)}
                        variant="outlined"
                        sx={{ 
                          fontSize: '0.75rem', 
                          height: 24, 
                          borderRadius: 1,
                          ...(providerConfig ? {
                            borderColor: alpha(providerConfig.color, 0.3),
                            bgcolor: alpha(providerConfig.color, 0.08),
                            color: providerConfig.color,
                            '& .MuiChip-icon': { color: 'inherit' }
                          } : {})
                        }}
                      />
                    </TableCell>
                  )}

                  <TableCell>
                    <Chip
                      icon={status.icon || undefined}
                      label={status.label}
                      color={status.color === 'default' ? 'default' : status.color}
                      size="small"
                      sx={{
                        bgcolor: (theme) => status.color !== 'default'
                          ? alpha(theme.palette[status.color as 'success' | 'warning' | 'error'].main, 0.1)
                          : undefined,
                        color: (theme) => status.color !== 'default'
                          ? theme.palette[status.color as 'success' | 'warning' | 'error'].dark
                          : undefined,
                        fontWeight: 600,
                        border: 'none',
                        '& .MuiChip-icon': { color: 'inherit' }
                      }}
                    />
                  </TableCell>
                  <TableCell sx={{ color: 'text.secondary' }}>
                    {domain.updatedAt ? formatRelativeTime(domain.updatedAt) : '-'}
                  </TableCell>
                  <TableCell sx={{ color: 'text.secondary' }}>
                    {formatExpiryValue(domain.name)}
                  </TableCell>
                  <TableCell align="right" onClick={(e) => e.stopPropagation()}>
                    <IconButton
                      size="small"
                      onClick={(e) => openZoneMenu(e, domain)}
                      disabled={!canOpenZoneMenu(domain)}
                    >
                      <MoreVertIcon fontSize="inherit" />
                    </IconButton>
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell style={{ padding: 0 }} colSpan={showAccountColumn ? 7 : 6}>
                    <Collapse in={isExpanded} timeout="auto" unmountOnExit>
                      <DnsManagement zoneId={domain.id} credentialId={domain.credentialId} />
                    </Collapse>
                  </TableCell>
                </TableRow>
              </Fragment>
            );
          })}
        </TableBody>
      </Table>
    </TableContainer>
  );

  const handleChangePage = (_event: unknown, newPage: number) => {
    setPage(newPage);
    setExpandedDomainKey(null);
  };

  return (
    <Box sx={{ maxWidth: 1600, mx: 'auto' }}>
      {/* 域名列表卡片 (包含顶部的 Tabs) */}
      <Card sx={{ border: 'none', boxShadow: '0 4px 20px rgba(0,0,0,0.05)', overflow: 'hidden', bgcolor: isMobile ? 'transparent' : 'background.paper' }}>
        
        {/* 将 Tabs 整合到卡片顶部 */}
        <Box sx={{ bgcolor: 'background.paper', borderRadius: isMobile ? 2 : 0, mb: isMobile ? 2 : 0 }}>
           <ProviderAccountTabs
             mode={isAllScope ? 'all' : 'provider'}
             value={isAllScope ? allScopeCredentialId : undefined}
             onChange={isAllScope ? setAllScopeCredentialId : undefined}
           />
           {!isMobile && <Divider />}
        </Box>

        <CardContent sx={{ p: isMobile ? 0 : 3 }}>
          <Stack
            direction={{ xs: 'column', sm: 'row' }}
            spacing={2}
            justifyContent="space-between"
            alignItems={{ xs: 'stretch', sm: 'center' }}
            sx={{ mb: 3 }}
          >
            <TextField
              placeholder="搜索域名..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              sx={{ width: { xs: '100%', sm: 300 }, bgcolor: 'background.paper' }}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon color="action" />
                  </InputAdornment>
                ),
              }}
              disabled={!isAllScope && !selectedProvider}
            />
            <Stack
              direction={{ xs: 'column', sm: 'row' }}
              spacing={1}
              alignItems={{ xs: 'stretch', sm: 'center' }}
              justifyContent={{ xs: 'stretch', sm: 'flex-end' }}
            >
	              {showAddZone && (
	                <Button
	                  variant="contained"
	                  startIcon={<AddIcon />}
	                  onClick={() => setAddZoneOpen(true)}
	                  disabled={addZoneCredentials.length === 0}
	                  sx={{ whiteSpace: 'nowrap' }}
	                >
	                  添加域名
	                </Button>
	              )}
              <Button
                variant="outlined"
                startIcon={<RefreshIcon />}
                onClick={handleRefresh}
                disabled={isRefetching || (!isAllScope && !selectedProvider) || (isAllScope && credentials.length === 0)}
                sx={{
                  borderColor: 'divider',
                  bgcolor: 'background.paper',
                  color: 'text.secondary',
                  '&:hover': { borderColor: 'primary.main', color: 'primary.main' }
                }}
              >
                {isRefetching ? '刷新中...' : '同步列表'}
              </Button>
            </Stack>
          </Stack>

          {isLoading ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', py: 8 }}>
              <CircularProgress />
            </Box>
          ) : error ? (
            <Alert severity="error" sx={{ mb: 2, borderRadius: 2 }}>
              无法加载域名列表: {(error as any)?.message || String(error)}
            </Alert>
          ) : !isAllScope && !selectedProvider ? (
            <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', py: 8, color: 'text.secondary' }}>
              <DnsIcon sx={{ fontSize: 48, mb: 2, opacity: 0.3 }} />
              <Typography variant="body1">请在左侧选择一个 DNS 提供商以查看域名</Typography>
            </Box>
          ) : isAllScope && credentials.length === 0 ? (
            <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', py: 8, color: 'text.secondary' }}>
              <DnsIcon sx={{ fontSize: 48, mb: 2, opacity: 0.3 }} />
              <Typography variant="body1">暂无已添加账户</Typography>
            </Box>
          ) : filteredDomains.length === 0 ? (
            <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', py: 8, color: 'text.secondary' }}>
               <DnsIcon sx={{ fontSize: 48, mb: 1, opacity: 0.2 }} />
               <Typography variant="body1">
                 {searchTerm ? '没有找到匹配的域名' : '暂无域名数据'}
               </Typography>
            </Box>
          ) : (
            <>
              {isMobile ? renderMobileView() : renderDesktopView()}
              <TablePagination
                component="div"
                count={filteredDomains.length}
                page={page}
                onPageChange={handleChangePage}
                rowsPerPage={rowsPerPage}
                onRowsPerPageChange={() => {}}
                rowsPerPageOptions={[rowsPerPage]}
                labelRowsPerPage="每页显示"
                sx={{ mt: 1 }}
              />
            </>
          )}
        </CardContent>
      </Card>

      <Menu
        anchorEl={zoneMenuAnchor}
        open={!!zoneMenuAnchor}
        onClose={closeZoneMenu}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      >
        <MenuItem onClick={openDeleteZoneDialog} disabled={!zoneMenuDomain || !canDeleteDomain(zoneMenuDomain)}>
          <DeleteIcon fontSize="small" style={{ marginRight: 8 }} />
          从 {zoneMenuProviderLabel} 删除
        </MenuItem>
      </Menu>

      <Dialog open={deleteZoneOpen} onClose={closeDeleteZoneDialog} maxWidth="xs" fullWidth>
        <DialogTitle>确认删除</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <Typography variant="body2">
              确认从 {zoneMenuProviderLabel} 删除域名 <strong>{zoneMenuDomain?.name || '-'}</strong> 吗？
            </Typography>
            <Alert severity="warning">
              该操作会删除整个域名（包含所有 DNS 记录），且不可恢复。
            </Alert>
            <TextField
              label="请输入域名以确认删除"
              placeholder={zoneMenuDomain?.name || ''}
              value={deleteConfirmInput}
              onChange={(e) => setDeleteConfirmInput(e.target.value)}
              fullWidth
              size="small"
              disabled={deleteMutation.isPending}
              autoComplete="off"
            />
            {deleteZoneError && <Alert severity="error">{deleteZoneError}</Alert>}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={closeDeleteZoneDialog} disabled={deleteMutation.isPending} color="inherit">
            取消
          </Button>
          <Button
            onClick={confirmDeleteZone}
            disabled={deleteMutation.isPending || deleteConfirmInput !== zoneMenuDomain?.name}
            color="error"
            variant="contained"
          >
            {deleteMutation.isPending ? '删除中...' : '删除'}
          </Button>
        </DialogActions>
      </Dialog>

	      {showAddZone && (
	        <AddZoneDialog
	          open={addZoneOpen}
	          credentials={addZoneCredentials}
	          initialCredentialId={initialAddCredentialId}
	          onClose={(refresh) => {
	            setAddZoneOpen(false);
	            if (refresh) refetch();
	          }}
	        />
	      )}
    </Box>
  );
}
