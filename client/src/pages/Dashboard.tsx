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
  PauseCircleOutline as PauseIcon,
  PlayCircleOutline as ResumeIcon,
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
  LocalOfferOutlined as TagIcon,
  PowerSettingsNew as PowerdnsIcon,
  RocketLaunch as SpaceshipIcon,
  Security as EsaIcon,
} from '@mui/icons-material';
import { deleteZone, getDomains, refreshDomains } from '@/services/domains';
import { deleteEsaSite, ESA_SUPPORTED_REGIONS, listEsaSites, updateEsaSitePause, updateEsaSiteTags } from '@/services/aliyunEsa';
import { getStoredUser } from '@/services/auth';
import { lookupDomainExpiry } from '@/services/domainExpiry';
import { formatRelativeTime } from '@/utils/formatters';
import { alpha } from '@mui/material/styles';
import { Domain } from '@/types';
import { ProviderType } from '@/types/dns';
import DnsManagement from '@/components/DnsManagement/DnsManagement';
import ProviderAccountTabs from '@/components/Dashboard/ProviderAccountTabs';
import AddZoneDialog from '@/components/Dashboard/AddZoneDialog';
import AddEsaSiteDialog from '@/components/Dashboard/AddEsaSiteDialog';
import EsaRecordManagement from '@/components/Dashboard/EsaRecordManagement';
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
  const [addEsaSiteOpen, setAddEsaSiteOpen] = useState(false);
  const [zoneMenuAnchor, setZoneMenuAnchor] = useState<HTMLElement | null>(null);
  const [zoneMenuDomain, setZoneMenuDomain] = useState<Domain | null>(null);
  const [deleteZoneOpen, setDeleteZoneOpen] = useState(false);
  const [deleteZoneError, setDeleteZoneError] = useState<string | null>(null);
  const [deleteConfirmInput, setDeleteConfirmInput] = useState('');
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(20);
  const [aliyunPanel, setAliyunPanel] = useState<'dns' | 'esa'>('dns');
  const navigate = useNavigate();
  const location = useLocation();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));

  const isAllScope = new URLSearchParams(location.search).get('scope') === 'all';
  const [allScopeCredentialId, setAllScopeCredentialId] = useState<number | 'all'>('all');

  const { selectedCredentialId, selectedProvider, credentials, getCredentialsByProvider, selectProvider } = useProvider();

  const allScopeSelectedCredential = useMemo(() => {
    if (!isAllScope) return null;
    if (typeof allScopeCredentialId !== 'number') return null;
    return credentials.find(c => c.id === allScopeCredentialId) || null;
  }, [isAllScope, allScopeCredentialId, credentials]);

  const isAllScopeAliyunCredential = !!allScopeSelectedCredential && allScopeSelectedCredential.provider === 'aliyun';

  useEffect(() => {
    if (!isAllScope) return;
    if (selectedProvider !== null) {
      selectProvider(null);
    }
  }, [isAllScope, selectedProvider, selectProvider]);

  useEffect(() => {
    if (isAllScope) {
      if (!isAllScopeAliyunCredential) {
        setAliyunPanel('dns');
      }
      return;
    }
    if (selectedProvider !== 'aliyun') {
      setAliyunPanel('dns');
    }
  }, [isAllScope, isAllScopeAliyunCredential, selectedProvider]);

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
  const canShowEsaPanel = selectedProvider === 'aliyun' || (isAllScope && isAllScopeAliyunCredential);
  const isEsaPanel = canShowEsaPanel && aliyunPanel === 'esa';
  const listTitle = isEsaPanel ? '站点' : '域名';
  const searchPlaceholder = isEsaPanel ? '搜索站点...' : '搜索域名...';
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
      ? ['domains', 'all', allScopeCredentialId, isEsaPanel ? 'esa' : 'dns', credentials.map(c => c.id)]
      : ['domains', selectedProvider, selectedCredentialId, isEsaPanel ? 'esa' : 'dns'],
    queryFn: async () => {
      if (isEsaPanel) {
        const fetchAllSites = async (credId: number) => {
          const pageSize = 100;
          const allSites: any[] = [];
          const errors: any[] = [];

          for (const region of ESA_SUPPORTED_REGIONS) {
            let page = 1;
            let total = 0;
            const regionSites: any[] = [];

            try {
              while (page <= 200) {
                const resp = await listEsaSites({ credentialId: credId, page, pageSize, region });
                const batch = resp.data?.sites || [];
                total = resp.data?.total ?? total;
                regionSites.push(...batch.map((s: any) => ({ ...s, region })));
                if (batch.length === 0) break;
                if (total > 0 && regionSites.length >= total) break;
                page += 1;
              }
              allSites.push(...regionSites);
            } catch (e) {
              errors.push(e);
            }
          }

          if (allSites.length === 0 && errors.length > 0) {
            throw errors[0];
          }

          const deduped = new Map<string, any>();
          allSites
            .map((s: any) => ({
              ...s,
              siteId: s?.siteId === undefined || s?.siteId === null ? (s?.SiteId ?? '') : s.siteId,
            }))
            .forEach((s: any) => {
              const key = String(s?.siteId || '').trim();
              if (!key || deduped.has(key)) return;
              deduped.set(key, s);
            });
          return Array.from(deduped.values()).filter((s: any) => String(s?.siteId || '').trim());
        };

        const toDomains = (sites: any[], cred: { id: number; name?: string; provider?: ProviderType }) =>
          sites
            .map((s) => {
              const siteId = s?.siteId === undefined || s?.siteId === null ? '' : String(s.siteId).trim();
              const name = String(s?.siteName || '').trim();
              if (!siteId || !name) return null;
              return {
                id: siteId,
                name,
                status: String(s?.status || 'unknown'),
                updatedAt: s?.updateTime ? String(s.updateTime) : undefined,
                credentialId: cred.id,
                credentialName: cred.name,
                provider: cred.provider,
                region: typeof s?.region === 'string' ? s.region : undefined,
                accessType: typeof s?.accessType === 'string' ? s.accessType : undefined,
                coverage:
                  typeof s?.coverage === 'string'
                    ? s.coverage
                    : (s?.Coverage === undefined || s?.Coverage === null ? undefined : String(s.Coverage)),
                instanceId:
                  typeof s?.instanceId === 'string'
                    ? s.instanceId
                    : (s?.InstanceId === undefined || s?.InstanceId === null ? undefined : String(s.InstanceId)),
                planName:
                  typeof s?.planName === 'string'
                    ? s.planName
                    : (s?.PlanName === undefined || s?.PlanName === null ? undefined : String(s.PlanName)),
                planSpecName:
                  typeof s?.planSpecName === 'string'
                    ? s.planSpecName
                    : (s?.PlanSpecName === undefined || s?.PlanSpecName === null ? undefined : String(s.PlanSpecName)),
                tags: s?.tags && typeof s.tags === 'object' ? s.tags : undefined,
              } as Domain;
            })
            .filter((d): d is Domain => !!d);

        if (isAllScope) {
          if (!allScopeSelectedCredential || allScopeSelectedCredential.provider !== 'aliyun') {
            return { data: { domains: [] } };
          }
          const sites = await fetchAllSites(allScopeSelectedCredential.id);
          const domains = toDomains(sites, allScopeSelectedCredential);
          return { data: { domains } };
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
            currentProviderCredentials.map(async (cred) => {
              const sites = await fetchAllSites(cred.id);
              return toDomains(sites, cred);
            })
          );

          const allDomains: Domain[] = [];
          results.forEach((result) => {
            if (result.status === 'fulfilled') {
              allDomains.push(...result.value);
            }
          });

          return { data: { domains: allDomains } };
        }

        const cred = currentProviderCredentials.find(c => c.id === safeSelectedCredentialId);
        const sites = await fetchAllSites(safeSelectedCredentialId);
        const domains = toDomains(sites, {
          id: safeSelectedCredentialId,
          name: cred?.name || credentialNameById.get(safeSelectedCredentialId),
          provider: selectedProvider,
        });

        return { data: { domains } };
      }

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
  }, [selectedCredentialId, selectedProvider, isAllScope, allScopeCredentialId, aliyunPanel]);

  useEffect(() => {
    setPage(0);
    setExpandedDomainKey(null);
  }, [searchTerm]);

  const handleRefresh = async () => {
    if (isEsaPanel) {
      refetch();
      return;
    }

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
      return { label: '已启用', color: 'success' as const, icon: <ActiveIcon fontSize="small" /> };
    }
    if (s === 'pending') {
      return { label: '待验证', color: 'warning' as const, icon: <PendingIcon fontSize="small" /> };
    }
    if (s === 'moved') {
      return { label: '已迁出', color: 'error' as const, icon: <ErrorIcon fontSize="small" /> };
    }
    if (s === 'enable' || s === 'enabled' || s === 'enableing' || s === 'running' || s === 'normal') {
      return { label: '已启用', color: 'success' as const, icon: <ActiveIcon fontSize="small" /> };
    }
    if (s === 'disable' || s === 'disabled' || s === 'pause' || s === 'paused' || s === 'stop' || s === 'stopped') {
      return { label: '禁用', color: 'default' as const, icon: null };
    }
    if (raw === 'ENABLE') {
      return { label: '已启用', color: 'success' as const, icon: <ActiveIcon fontSize="small" /> };
    }
    if (raw === 'DISABLE') {
      return { label: '禁用', color: 'default' as const, icon: null };
    }

    return { label: raw || '-', color: 'default' as const, icon: null };
  };

  const getEsaAccessTypeLabel = (accessType?: string): string | null => {
    const raw = String(accessType || '').trim();
    if (!raw) return null;
    const s = raw.toUpperCase();
    if (s === 'CNAME' || s === 'NS') return s;
    return raw.trim();
  };

  const getEsaCoverageLabel = (coverage?: string): string | null => {
    const raw = String(coverage || '').trim();
    if (!raw) return null;
    const s = raw.toLowerCase();
    if (s === 'global') return '全球';
    if (s === 'domestic') return '国内';
    if (s === 'overseas') return '海外';
    if (s.includes('global')) return '全球';
    if (s.includes('domestic') || s.includes('china') || s === 'cn') return '国内';
    if (s.includes('oversea')) return '海外';
    return raw;
  };

  const getEsaSubscriptionTypeLabel = (domain: Domain): string | null => {
    const planName = String(domain.planName || '').trim();
    const planSpecName = String(domain.planSpecName || '').trim();
    const hint = `${planName} ${planSpecName}`.trim();
    if (!hint) return null;

    const h = hint.toLowerCase();
    const isFree =
      h.includes('free') ||
      h.includes('trial') ||
      h.includes('entrance') ||
      h.includes('lite') ||
      h.includes('nosla') ||
      hint.includes('免费') ||
      hint.includes('入门') ||
      hint.includes('无SLA') ||
      hint.includes('无sla');

    if (isFree) return '免费版';
    if (h.includes('basic') || hint.includes('基础')) return '基础版';
    if (h.includes('standard') || hint.includes('标准')) return '标准版';
    if (h.includes('pro') || hint.includes('专业')) return '专业版';
    if (h.includes('premium') || hint.includes('高级')) return '高级版';
    if (h.includes('enterprise') || hint.includes('企业')) return '企业版';

    return planSpecName || planName || hint;
  };

  const getEsaTagsMeta = (tags?: Record<string, string>): { count: number; tooltip: string } | null => {
    if (!tags || typeof tags !== 'object') return null;
    const entries = Object.entries(tags)
      .map(([k, v]) => [String(k || '').trim(), String(v ?? '').trim()] as const)
      .filter(([k]) => !!k);
    if (entries.length === 0) return null;
    return {
      count: entries.length,
      tooltip: entries.map(([k, v]) => (v ? `${k}=${v}` : k)).join(' · '),
    };
  };

  const esaMetaChipSx = { height: 22, fontSize: '0.72rem', borderRadius: 1 } as const;

  const showAccountColumn = effectiveCredentialId === 'all' && effectiveCredentials.length > 1;

  const [esaSiteActionError, setEsaSiteActionError] = useState<string | null>(null);
  const [esaMenuAnchor, setEsaMenuAnchor] = useState<HTMLElement | null>(null);
  const [esaMenuSite, setEsaMenuSite] = useState<Domain | null>(null);
  const [esaTagsOpen, setEsaTagsOpen] = useState(false);
  const [esaTagsSite, setEsaTagsSite] = useState<Domain | null>(null);
  const [esaTagRows, setEsaTagRows] = useState<Array<{ key: string; value: string }>>([]);
  const [esaTagsError, setEsaTagsError] = useState<string | null>(null);
  const [esaDeleteOpen, setEsaDeleteOpen] = useState(false);
  const [esaDeleteSite, setEsaDeleteSite] = useState<Domain | null>(null);
  const [esaDeleteConfirmInput, setEsaDeleteConfirmInput] = useState('');
  const [esaDeleteError, setEsaDeleteError] = useState<string | null>(null);

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
    !isEsaPanel && isZoneManageProvider(getDomainProvider(domain)) && typeof domain.credentialId === 'number';

  const canOpenZoneMenu = (domain: Domain): boolean => !isEsaPanel && typeof domain.credentialId === 'number';

  const zoneMenuProvider = zoneMenuDomain ? getDomainProvider(zoneMenuDomain) : undefined;
  const zoneMenuProviderLabel = zoneMenuProvider ? (PROVIDER_CONFIG[zoneMenuProvider]?.name || zoneMenuProvider) : 'DNS';

  const canManageEsaSite = (domain: Domain): boolean =>
    isEsaPanel && typeof domain.credentialId === 'number';

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

  const esaPauseMutation = useMutation({
    mutationFn: async (payload: { site: Domain; paused: boolean }) => {
      const { site, paused } = payload;
      return updateEsaSitePause({
        credentialId: site.credentialId as number,
        siteId: site.id,
        siteName: site.name,
        paused,
        region: site.region,
      });
    },
    onSuccess: async () => {
      setEsaSiteActionError(null);
      closeEsaMenu();
      refetch();
    },
    onError: (err: any) => {
      setEsaSiteActionError(err?.message ? String(err.message) : String(err));
    },
  });

  const esaDeleteMutation = useMutation({
    mutationFn: async (payload: { site: Domain }) => {
      const { site } = payload;
      return deleteEsaSite({
        credentialId: site.credentialId as number,
        siteId: site.id,
        region: site.region,
      });
    },
    onSuccess: async () => {
      setEsaDeleteError(null);
      setEsaDeleteOpen(false);
      setEsaDeleteSite(null);
      setEsaDeleteConfirmInput('');
      setExpandedDomainKey(null);
      refetch();
    },
    onError: (err: any) => {
      setEsaDeleteError(err?.message ? String(err.message) : String(err));
    },
  });

  const esaUpdateTagsMutation = useMutation({
    mutationFn: async (payload: { site: Domain; tags: Record<string, unknown> }) => {
      const { site, tags } = payload;
      return updateEsaSiteTags({
        credentialId: site.credentialId as number,
        siteId: site.id,
        regionId: site.region,
        region: site.region,
        tags,
      });
    },
    onSuccess: async () => {
      setEsaTagsError(null);
      setEsaTagsOpen(false);
      setEsaTagsSite(null);
      setEsaTagRows([]);
      refetch();
    },
    onError: (err: any) => {
      setEsaTagsError(err?.message ? String(err.message) : String(err));
    },
  });

  const openEsaMenu = (e: ReactMouseEvent<HTMLElement>, domain: Domain) => {
    e.stopPropagation();
    setEsaMenuAnchor(e.currentTarget);
    setEsaMenuSite(domain);
  };

  const closeEsaMenu = () => {
    setEsaMenuAnchor(null);
    setEsaMenuSite(null);
  };

  const openEsaDeleteDialog = () => {
    if (!esaMenuSite) return;
    if (!canManageEsaSite(esaMenuSite)) return;
    setEsaDeleteError(null);
    setEsaDeleteOpen(true);
    setEsaDeleteSite(esaMenuSite);
    setEsaDeleteConfirmInput('');
    closeEsaMenu();
  };

  const closeEsaDeleteDialog = () => {
    if (esaDeleteMutation.isPending) return;
    setEsaDeleteOpen(false);
    setEsaDeleteError(null);
    setEsaDeleteConfirmInput('');
    setEsaDeleteSite(null);
  };

  const confirmEsaDelete = () => {
    if (!esaDeleteSite) return;
    if (!canManageEsaSite(esaDeleteSite)) return;
    if (esaDeleteConfirmInput !== esaDeleteSite.name) return;
    esaDeleteMutation.mutate({ site: esaDeleteSite });
  };

  const openEsaTagsDialog = (e: ReactMouseEvent<HTMLElement>, site: Domain) => {
    e.stopPropagation();
    if (!canManageEsaSite(site)) return;
    setEsaTagsError(null);
    setEsaTagsSite(site);
    const rows = Object.entries(site.tags || {}).map(([key, value]) => ({ key, value: String(value ?? '') }));
    setEsaTagRows(rows.length > 0 ? rows : [{ key: '', value: '' }]);
    setEsaTagsOpen(true);
  };

  const closeEsaTagsDialog = () => {
    if (esaUpdateTagsMutation.isPending) return;
    setEsaTagsOpen(false);
    setEsaTagsSite(null);
    setEsaTagRows([]);
    setEsaTagsError(null);
  };

  const saveEsaTags = () => {
    if (!esaTagsSite) return;
    if (!canManageEsaSite(esaTagsSite)) return;
    if (esaUpdateTagsMutation.isPending) return;

    const trimmed = esaTagRows
      .map((r) => ({ key: String(r.key || '').trim(), value: String(r.value ?? '') }))
      .filter((r) => !!r.key);

    const keys = new Set<string>();
    for (const r of trimmed) {
      if (r.key.length > 128) {
        setEsaTagsError('标签 Key 最长 128 字符');
        return;
      }
      const keyLower = r.key.toLowerCase();
      if (keyLower.startsWith('acs:') || keyLower.startsWith('aliyun')) {
        setEsaTagsError('标签 Key 不能以 acs: 或 aliyun 开头');
        return;
      }
      if (keyLower.includes('http://') || keyLower.includes('https://')) {
        setEsaTagsError('标签 Key 不能包含 http:// 或 https://');
        return;
      }
      if (keys.has(r.key)) {
        setEsaTagsError(`标签 Key 重复：${r.key}`);
        return;
      }
      keys.add(r.key);
      if (r.value.length > 128) {
        setEsaTagsError('标签 Value 最长 128 字符');
        return;
      }
      const valueLower = r.value.toLowerCase();
      if (valueLower.startsWith('acs:') || valueLower.startsWith('aliyun')) {
        setEsaTagsError('标签 Value 不能以 acs: 或 aliyun 开头');
        return;
      }
      if (valueLower.includes('http://') || valueLower.includes('https://')) {
        setEsaTagsError('标签 Value 不能包含 http:// 或 https://');
        return;
      }
    }

    const tags: Record<string, string> = {};
    trimmed.forEach((r) => {
      tags[r.key] = r.value;
    });
    esaUpdateTagsMutation.mutate({ site: esaTagsSite, tags });
  };

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
        const esaAccessTypeLabel = isEsaPanel ? getEsaAccessTypeLabel(domain.accessType) : null;
        const esaCoverageLabel = isEsaPanel ? getEsaCoverageLabel(domain.coverage) : null;
        const esaSubscriptionLabel = isEsaPanel ? getEsaSubscriptionTypeLabel(domain) : null;
        const esaTagsMeta = isEsaPanel ? getEsaTagsMeta(domain.tags) : null;

        return (
          <Card key={rowKey} variant="outlined" sx={{ borderRadius: 2, boxShadow: 'none' }}>
            <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 1.5 }}>
                <Box>
                  <Stack direction="row" spacing={0.5} alignItems="center" sx={{ mb: 0.5 }}>
                    <Typography variant="subtitle1" fontWeight="600">
                      {domain.name}
                    </Typography>
                    {!isEsaPanel && (
                      <IconButton
                        size="small"
                        onClick={() => navigate(detailPath)}
                        sx={{ color: 'primary.main', bgcolor: alpha(theme.palette.primary.main, 0.1) }}
                      >
                        <OpenInNewIcon fontSize="small" />
                      </IconButton>
                    )}
                  </Stack>
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

                  {isEsaPanel && (
                    <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap" sx={{ mt: 1 }}>
                      {esaAccessTypeLabel && (
                        <Chip size="small" label={esaAccessTypeLabel} variant="outlined" sx={esaMetaChipSx} />
                      )}
                      {esaCoverageLabel && (
                        <Chip size="small" label={esaCoverageLabel} variant="outlined" sx={esaMetaChipSx} />
                      )}
                      {esaSubscriptionLabel && (
                        <Chip
                          size="small"
                          label={esaSubscriptionLabel}
                          color={esaSubscriptionLabel === '免费版' ? 'warning' : 'default'}
                          variant="outlined"
                          sx={esaMetaChipSx}
                        />
                      )}
                      <Chip
                        size="small"
                        label={esaTagsMeta ? `标签: ${esaTagsMeta.count}` : '标签: -'}
                        variant="outlined"
                        sx={esaMetaChipSx}
                        onClick={(e) => openEsaTagsDialog(e, domain)}
                      />
                    </Stack>
                  )}
                </Box>
                <Box>
                  <IconButton
                    size="small"
                    onClick={(e) => {
                      if (isEsaPanel) {
                        openEsaMenu(e, domain);
                      } else {
                        openZoneMenu(e, domain);
                      }
                    }}
                    disabled={isEsaPanel ? !canManageEsaSite(domain) : !canOpenZoneMenu(domain)}
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

              {!isEsaPanel && (
                <Stack direction="row" alignItems="center" spacing={0.5} sx={{ color: 'text.secondary', fontSize: '0.75rem', mt: 0.5 }}>
                  <EventIcon sx={{ fontSize: 14 }} />
                  <Typography variant="caption">
                    {expiryLabel}: {formatExpiryValue(domain.name)}
                  </Typography>
                </Stack>
              )}
            </CardContent>
            
            <Collapse in={isExpanded} timeout="auto" unmountOnExit>
              <Divider />
              <Box sx={{ p: 0 }}>
                {isEsaPanel ? (
                  <EsaRecordManagement
                    credentialId={domain.credentialId as number}
                    siteId={domain.id}
                    siteName={domain.name}
                    region={domain.region}
                    accessType={domain.accessType}
                    instanceId={domain.instanceId}
                    planName={domain.planName}
                    planSpecName={domain.planSpecName}
                  />
                ) : (
                  <DnsManagement zoneId={domain.id} credentialId={domain.credentialId} />
                )}
              </Box>
            </Collapse>
          </Card>
        );
      })}
    </Stack>
  );

  // 桌面端表格视图渲染函数
  const renderDesktopView = () => (
    <TableContainer sx={{ overflowX: isEsaPanel ? 'auto' : 'visible' }}>
      <Table sx={{ minWidth: isEsaPanel ? 1050 : 650, tableLayout: 'fixed' }}>
        <TableHead>
          <TableRow>
            <TableCell width={50} />
            <TableCell width={260}>{isEsaPanel ? '站点' : '域名'}</TableCell>
            {showAccountColumn && <TableCell width={170}>所属账户</TableCell>}
            {isEsaPanel ? (
              <>
                <TableCell width={110}>接入方式</TableCell>
                <TableCell width={90}>区域</TableCell>
                <TableCell width={120}>状态</TableCell>
                <TableCell width={140}>订阅类型</TableCell>
                <TableCell width={90}>标签</TableCell>
                <TableCell width={120}>最后更新</TableCell>
                <TableCell width={52} align="right" />
              </>
            ) : (
              <>
                <TableCell>状态</TableCell>
                <TableCell>最后更新</TableCell>
                <TableCell>{expiryLabel}</TableCell>
                <TableCell width={52} align="right" />
              </>
            )}
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
            const esaAccessTypeLabel = isEsaPanel ? getEsaAccessTypeLabel(domain.accessType) : null;
            const esaCoverageLabel = isEsaPanel ? getEsaCoverageLabel(domain.coverage) : null;
            const esaSubscriptionLabel = isEsaPanel ? getEsaSubscriptionTypeLabel(domain) : null;
            const esaTagsMeta = isEsaPanel ? getEsaTagsMeta(domain.tags) : null;

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
                    {isEsaPanel ? (
                      <Typography variant="body1" fontWeight="600" noWrap sx={{ color: 'primary.main' }}>
                        {domain.name}
                      </Typography>
                    ) : (
                      <Stack direction="row" alignItems="center" spacing={1}>
                        <Typography variant="body1" fontWeight="600" color="text.primary">
                          {domain.name}
                        </Typography>
                        {!isEsaPanel && (
                          <IconButton
                            size="small"
                            onClick={(e) => {
                              e.stopPropagation();
                              navigate(detailPath);
                            }}
                          >
                            <OpenInNewIcon fontSize="inherit" />
                          </IconButton>
                        )}
                      </Stack>
                    )}
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

                  {isEsaPanel ? (
                    <>
                      <TableCell sx={{ color: 'text.secondary' }}>
                        {esaAccessTypeLabel || '-'}
                      </TableCell>
                      <TableCell sx={{ color: 'text.secondary' }}>
                        {esaCoverageLabel || '-'}
                      </TableCell>
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
                      <TableCell>
                        {esaSubscriptionLabel ? (
                          <Chip
                            size="small"
                            label={esaSubscriptionLabel}
                            color={esaSubscriptionLabel === '免费版' ? 'warning' : 'default'}
                            variant="outlined"
                            sx={esaMetaChipSx}
                            title={[domain.planName, domain.planSpecName].filter(Boolean).join(' · ')}
                          />
                        ) : (
                          <Typography variant="body2" color="text.secondary">-</Typography>
                        )}
                      </TableCell>
                      <TableCell>
                        <IconButton
                          size="small"
                          onClick={(e) => openEsaTagsDialog(e, domain)}
                          title={esaTagsMeta?.tooltip || '编辑标签'}
                          sx={{ color: 'text.secondary' }}
                        >
                          <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}>
                            <TagIcon sx={{ fontSize: 18 }} />
                            {esaTagsMeta && <Typography variant="caption">{esaTagsMeta.count}</Typography>}
                          </Box>
                        </IconButton>
                      </TableCell>
                      <TableCell sx={{ color: 'text.secondary' }}>
                        {domain.updatedAt ? formatRelativeTime(domain.updatedAt) : '-'}
                      </TableCell>
                      <TableCell align="right" onClick={(e) => e.stopPropagation()}>
                        <IconButton
                          size="small"
                          onClick={(e) => openEsaMenu(e, domain)}
                          disabled={!canManageEsaSite(domain)}
                        >
                          <MoreVertIcon fontSize="inherit" />
                        </IconButton>
                      </TableCell>
                    </>
                  ) : (
                    <>
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
                    </>
                  )}
                </TableRow>
                <TableRow>
                  <TableCell
                    style={{ padding: 0 }}
                    colSpan={
                      isEsaPanel
                        ? (showAccountColumn ? 10 : 9)
                        : (showAccountColumn ? 7 : 6)
                    }
                  >
                    <Collapse in={isExpanded} timeout="auto" unmountOnExit>
                      {isEsaPanel ? (
                        <EsaRecordManagement
                          credentialId={domain.credentialId as number}
                          siteId={domain.id}
                          siteName={domain.name}
                          region={domain.region}
                          accessType={domain.accessType}
                          instanceId={domain.instanceId}
                          planName={domain.planName}
                          planSpecName={domain.planSpecName}
                        />
                      ) : (
                        <DnsManagement zoneId={domain.id} credentialId={domain.credentialId} />
                      )}
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
              placeholder={searchPlaceholder}
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
              {canShowEsaPanel && (
                <Button
                  variant={isEsaPanel ? 'contained' : 'outlined'}
                  startIcon={<EsaIcon />}
                  onClick={() => setAliyunPanel(p => (p === 'esa' ? 'dns' : 'esa'))}
                  sx={{ whiteSpace: 'nowrap' }}
                >
                  {isEsaPanel ? 'DNS 域名' : 'ESA 站点管理'}
                </Button>
              )}
	              {showAddZone && (
	                <Button
	                  variant="contained"
	                  startIcon={<AddIcon />}
	                  onClick={() => {
	                    if (isEsaPanel) {
	                      setAddEsaSiteOpen(true);
	                      return;
	                    }
	                    setAddZoneOpen(true);
	                  }}
	                  disabled={addZoneCredentials.length === 0}
	                  sx={{ whiteSpace: 'nowrap' }}
	                >
	                  {isEsaPanel ? '添加站点' : '添加域名'}
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

          {isEsaPanel && esaSiteActionError && (
            <Alert severity="error" sx={{ mb: 2, borderRadius: 2 }} onClose={() => setEsaSiteActionError(null)}>
              {esaSiteActionError}
            </Alert>
          )}

          {isLoading ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', py: 8 }}>
              <CircularProgress />
            </Box>
          ) : error ? (
            <Alert severity="error" sx={{ mb: 2, borderRadius: 2 }}>
              无法加载{listTitle}列表: {(error as any)?.message || String(error)}
            </Alert>
          ) : !isAllScope && !selectedProvider ? (
            <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', py: 8, color: 'text.secondary' }}>
              <DnsIcon sx={{ fontSize: 48, mb: 2, opacity: 0.3 }} />
              <Typography variant="body1">请在左侧选择一个 DNS 提供商以查看{listTitle}</Typography>
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
                 {searchTerm ? `没有找到匹配的${listTitle}` : `暂无${listTitle}数据`}
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
                sx={{
                  mt: 1,
                }}
              />
            </>
          )}
        </CardContent>
      </Card>

      <Menu
        anchorEl={esaMenuAnchor}
        open={!!esaMenuAnchor}
        onClose={closeEsaMenu}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      >
        <MenuItem
          onClick={() => {
            const site = esaMenuSite;
            if (!site) return;
            const isPaused = getStatusConfig(site.status).label === '禁用';
            esaPauseMutation.mutate({ site, paused: !isPaused });
            closeEsaMenu();
          }}
          disabled={!esaMenuSite || !canManageEsaSite(esaMenuSite) || esaPauseMutation.isPending}
        >
          {(() => {
            const isPaused = esaMenuSite ? getStatusConfig(esaMenuSite.status).label === '禁用' : false;
            return isPaused ? <ResumeIcon fontSize="small" style={{ marginRight: 8 }} /> : <PauseIcon fontSize="small" style={{ marginRight: 8 }} />;
          })()}
          {esaMenuSite && getStatusConfig(esaMenuSite.status).label === '禁用' ? '启用' : '停用'}
        </MenuItem>
        <MenuItem onClick={openEsaDeleteDialog} disabled={!esaMenuSite || !canManageEsaSite(esaMenuSite) || esaDeleteMutation.isPending}>
          <DeleteIcon fontSize="small" style={{ marginRight: 8 }} />
          删除站点
        </MenuItem>
      </Menu>

      <Dialog open={esaTagsOpen} onClose={closeEsaTagsDialog} maxWidth="sm" fullWidth>
        <DialogTitle>编辑站点标签</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <Typography variant="body2" color="text.secondary">
              站点：<strong>{esaTagsSite?.name || '-'}</strong>
            </Typography>
            <Stack spacing={1}>
              {esaTagRows.map((row, idx) => (
                <Stack
                  key={idx}
                  direction={{ xs: 'column', sm: 'row' }}
                  spacing={1}
                  alignItems={{ xs: 'stretch', sm: 'center' }}
                >
                  <TextField
                    label="Key"
                    size="small"
                    value={row.key}
                    onChange={(e) => {
                      const v = e.target.value;
                      setEsaTagRows((rows) => rows.map((r, i) => (i === idx ? { ...r, key: v } : r)));
                    }}
                    fullWidth
                    autoComplete="off"
                    disabled={esaUpdateTagsMutation.isPending}
                  />
                  <TextField
                    label="Value"
                    size="small"
                    value={row.value}
                    onChange={(e) => {
                      const v = e.target.value;
                      setEsaTagRows((rows) => rows.map((r, i) => (i === idx ? { ...r, value: v } : r)));
                    }}
                    fullWidth
                    autoComplete="off"
                    disabled={esaUpdateTagsMutation.isPending}
                  />
                  <IconButton
                    size="small"
                    onClick={() => {
                      setEsaTagRows((rows) => {
                        const next = rows.filter((_r, i) => i !== idx);
                        return next.length > 0 ? next : [{ key: '', value: '' }];
                      });
                    }}
                    disabled={esaUpdateTagsMutation.isPending}
                    sx={{ alignSelf: { xs: 'flex-end', sm: 'center' } }}
                    title="删除标签"
                  >
                    <DeleteIcon fontSize="small" />
                  </IconButton>
                </Stack>
              ))}
              <Button
                variant="outlined"
                size="small"
                startIcon={<AddIcon />}
                onClick={() => setEsaTagRows((rows) => [...rows, { key: '', value: '' }])}
                disabled={esaUpdateTagsMutation.isPending}
                sx={{ alignSelf: 'flex-start' }}
              >
                添加标签
              </Button>
            </Stack>
            {esaTagsError && <Alert severity="error">{esaTagsError}</Alert>}
            <Alert severity="info">标签将通过阿里云 ESA 标签 API（TagResources/UntagResources）更新。</Alert>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={closeEsaTagsDialog} disabled={esaUpdateTagsMutation.isPending} color="inherit">
            取消
          </Button>
          <Button onClick={saveEsaTags} disabled={!esaTagsSite || esaUpdateTagsMutation.isPending} variant="contained">
            {esaUpdateTagsMutation.isPending ? '保存中...' : '保存'}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={esaDeleteOpen} onClose={closeEsaDeleteDialog} maxWidth="xs" fullWidth>
        <DialogTitle>确认删除站点</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <Typography variant="body2">
              确认删除站点 <strong>{esaDeleteSite?.name || '-'}</strong> 吗？
            </Typography>
            <Alert severity="warning">
              该操作会删除整个站点，且不可恢复。
            </Alert>
            <TextField
              label="请输入站点名以确认删除"
              placeholder={esaDeleteSite?.name || ''}
              value={esaDeleteConfirmInput}
              onChange={(e) => setEsaDeleteConfirmInput(e.target.value)}
              fullWidth
              size="small"
              disabled={esaDeleteMutation.isPending}
              autoComplete="off"
            />
            {esaDeleteError && <Alert severity="error">{esaDeleteError}</Alert>}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={closeEsaDeleteDialog} disabled={esaDeleteMutation.isPending} color="inherit">
            取消
          </Button>
          <Button
            onClick={confirmEsaDelete}
            disabled={esaDeleteMutation.isPending || esaDeleteConfirmInput !== esaDeleteSite?.name}
            color="error"
            variant="contained"
          >
            {esaDeleteMutation.isPending ? '删除中...' : '删除'}
          </Button>
        </DialogActions>
      </Dialog>

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

	      {showAddZone && !isEsaPanel && (
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

	      {isEsaPanel && (
	        <AddEsaSiteDialog
	          open={addEsaSiteOpen}
	          credentials={isAllScope ? getCredentialsByProvider('aliyun') : currentProviderCredentials}
	          initialCredentialId={initialAddCredentialId}
	          onClose={(refresh) => {
	            setAddEsaSiteOpen(false);
	            if (refresh) refetch();
	          }}
	        />
	      )}
    </Box>
  );
}
