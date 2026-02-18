import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Box,
  Button,
  Card,
  CardActions,
  CardContent,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  Stack,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
  useMediaQuery,
  useTheme,
  FormControlLabel,
  Tabs,
  Tab,
  Tooltip,
} from '@mui/material';
import {
  Add as AddIcon,
  ContentCopy as CopyIcon,
  Delete as DeleteIcon,
  Dns as DnsIcon,
  Edit as EditIcon,
  Refresh as RefreshIcon,
} from '@mui/icons-material';
import {
  checkEsaCnameStatus,
  applyEsaCertificate,
  createEsaRecord,
  deleteEsaRecord,
  getEsaCertificate,
  getEsaRecord,
  ESA_SUPPORTED_REGIONS,
  listEsaRatePlanInstances,
  listEsaCertificatesByRecord,
  listEsaRecords,
  updateEsaRecord,
  type EsaCertificate,
  type EsaCertificateApplyResult,
  type EsaDnsRecord,
  type EsaRatePlanInstance,
} from '@/services/aliyunEsa';

function normalizeRecordName(input: string, siteName: string): string {
  const raw = String(input || '').trim().replace(/\.$/, '');
  const site = String(siteName || '').trim().replace(/\.$/, '');
  if (!raw) return '';
  if (!site) return raw;
  if (raw === '@') return site;

  const rawLower = raw.toLowerCase();
  const siteLower = site.toLowerCase();

  if (rawLower === siteLower) return site;
  if (rawLower.endsWith(`.${siteLower}`)) return raw;
  return `${raw}.${site}`;
}

function toDisplayHost(recordName: string, siteName: string): string {
  const name = String(recordName || '').trim();
  const site = String(siteName || '').trim();
  if (!name || !site) return name || '-';
  if (name.toLowerCase() === site.toLowerCase()) return '@';
  const suffix = `.${site}`.toLowerCase();
  if (name.toLowerCase().endsWith(suffix)) {
    return name.slice(0, -suffix.length) || '@';
  }
  return name;
}

function getRecordValue(record: EsaDnsRecord): string {
  const data = record.data as any;
  const v = data?.Value;
  if (typeof v === 'string' && v.trim()) return v;
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  if (v === 0) return '0';
  if (data && typeof data === 'object') {
    try {
      return JSON.stringify(data);
    } catch {
      return '[object]';
    }
  }
  return '-';
}

const RECORD_TYPE_OPTIONS = ['A/AAAA', 'CNAME', 'TXT', 'MX', 'NS'];

const BIZ_NAME_OPTIONS: Array<{ value: string; label: string; help: string }> = [
  { value: 'web', label: 'Web（网页）', help: '常规网站/页面加速' },
  { value: 'api', label: 'API', help: '接口/JSON 等 API 加速' },
  { value: 'image_video', label: 'Image/Video（图像/视频）', help: '图片/视频等大对象加速' },
];

const esaMetaChipSx = { height: 22, fontSize: '0.72rem' } as const;

type CertificateTypeOption = { value: string; label: string; disabled?: boolean };

const DIGICERT_CERT_TYPE_OPTIONS: CertificateTypeOption[] = [
  { value: 'digicert_single', label: 'DigiCert 单域名（免费）' },
  { value: 'digicert_wildcard', label: 'DigiCert 泛域名（免费）' },
];

function getCnameStatusLabel(status?: string): { label: string; color: 'default' | 'success' | 'warning' | 'error' } {
  const s = String(status || '').trim().toLowerCase();
  if (s === 'configured') return { label: '已配置', color: 'success' };
  if (s === 'unconfigured') return { label: '未配置', color: 'warning' };
  if (!s || s === 'unknown') return { label: '未知', color: 'default' };
  return { label: status || '-', color: 'default' };
}

function getHttpsStatusLabel(status?: string): { label: string; color: 'default' | 'success' | 'warning' | 'error' } {
  const s = String(status || '').trim().toLowerCase();
  if (!s) return { label: '未知', color: 'default' };
  if (s === 'configured') return { label: '已配置', color: 'success' };
  if (s === 'applying') return { label: '申请中', color: 'warning' };
  if (s === 'failed') return { label: '失败', color: 'error' };
  if (s === 'none') return { label: '未配置', color: 'default' };
  return { label: status || '-', color: 'default' };
}

export default function EsaRecordManagement({
  credentialId,
  siteId,
  siteName,
  region,
  accessType,
  instanceId,
  planName,
  planSpecName,
}: {
  credentialId: number;
  siteId: string;
  siteName: string;
  region?: string;
  accessType?: string;
  instanceId?: string;
  planName?: string;
  planSpecName?: string;
}) {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const queryClient = useQueryClient();

  const normalizedAccessType = String(accessType || '').trim().toUpperCase();
  const isCnameAccess = normalizedAccessType === 'CNAME';

  const [page, setPage] = useState(0);
  const rowsPerPage = 20;

  const pageNumber = page + 1;
  const pageSize = rowsPerPage;

  const {
    data,
    isLoading,
    isFetching,
    error,
    refetch: refetchRecords,
  } = useQuery({
    queryKey: ['esa-records', credentialId, siteId, region, pageNumber, pageSize],
    queryFn: () => listEsaRecords({
      credentialId,
      siteId,
      region,
      page: pageNumber,
      pageSize,
    }),
    enabled: !!credentialId && !!siteId,
    staleTime: 15_000,
  });

  const records = data?.data?.records || [];
  const total = data?.data?.total ?? records.length;

  const recordNames = useMemo(
    () => Array.from(new Set(records.map((r) => String(r.recordName || '').trim()).filter(Boolean))),
    [records]
  );
  const cnamePairs = useMemo(() => {
    const map = new Map<string, string>();
    records.forEach((r) => {
      const rn = String(r.recordName || '').trim();
      const rc = String(r.recordCname || '').trim();
      if (rn && rc) map.set(rn, rc);
    });
    return Array.from(map.entries()).map(([recordName, recordCname]) => ({ recordName, recordCname }));
  }, [records]);

  const {
    data: certStatusData,
    isFetching: isCertStatusFetching,
    refetch: refetchCertStatus,
    error: certStatusError,
  } = useQuery({
    queryKey: ['esa-cert-status', credentialId, siteId, region, recordNames.join('|')],
    queryFn: () => listEsaCertificatesByRecord({ credentialId, siteId, recordNames, region, validOnly: false, detail: false }),
    enabled: !!credentialId && !!siteId && recordNames.length > 0,
    staleTime: 30_000,
  });

  const {
    data: cnameStatusData,
    isFetching: isCnameStatusFetching,
    refetch: refetchCnameStatus,
    error: cnameStatusError,
  } = useQuery({
    queryKey: ['esa-cname-status', credentialId, siteId, region, cnamePairs.map((p) => `${p.recordName}->${p.recordCname}`).join('|')],
    queryFn: () => checkEsaCnameStatus({ records: cnamePairs }),
    enabled: !!credentialId && !!siteId && cnamePairs.length > 0,
    staleTime: 30_000,
  });

  const certStatusByRecordName = useMemo(() => {
    const map = new Map<string, string>();
    (certStatusData?.data?.records || []).forEach((r: any) => {
      const rn = String(r?.recordName || '').trim();
      if (rn) map.set(rn, String(r?.status || '').trim());
    });
    return map;
  }, [certStatusData]);

  const cnameStatusByRecordName = useMemo(() => {
    const map = new Map<string, string>();
    (cnameStatusData?.data?.results || []).forEach((r: any) => {
      const rn = String(r?.recordName || '').trim();
      if (rn) map.set(rn, String(r?.status || '').trim());
    });
    return map;
  }, [cnameStatusData]);

  useEffect(() => {
    setPage(0);
  }, [credentialId, siteId]);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<EsaDnsRecord | null>(null);
  const [mobileEditingRecordId, setMobileEditingRecordId] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [cnameGuide, setCnameGuide] = useState<{ recordName: string; recordCname: string } | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [httpsDialog, setHttpsDialog] = useState<{ recordName: string; recordId: string } | null>(null);
  const [certType, setCertType] = useState<string>('lets_encrypt');
  const [applyResult, setApplyResult] = useState<EsaCertificateApplyResult | null>(null);
  const [applyCertError, setApplyCertError] = useState<string | null>(null);
  const [selectedCertId, setSelectedCertId] = useState<string>('');

  const [host, setHost] = useState('');
  const [type, setType] = useState<string>('A/AAAA');
  const [value, setValue] = useState('');
  const [ttl, setTtl] = useState<string>('30');
  const [proxied, setProxied] = useState(false);
  const [comment, setComment] = useState('');
  const [priority, setPriority] = useState<string>('');
  const [bizName, setBizName] = useState<string>('web');

  const typeOptions = useMemo(() => {
    const base = isCnameAccess ? ['A/AAAA', 'CNAME'] : RECORD_TYPE_OPTIONS;
    const current = String(type || '').trim();
    if (current && !base.includes(current)) return [...base, current];
    return base;
  }, [isCnameAccess, type]);

  const httpsRecordName = httpsDialog?.recordName;
  const httpsStatus = httpsRecordName ? certStatusByRecordName.get(httpsRecordName) : undefined;
  const httpsCnameStatus = httpsRecordName ? cnameStatusByRecordName.get(httpsRecordName) : undefined;

  const normalizedInstanceId = String(instanceId || '').trim();
  const instanceMetaQuery = useQuery({
    queryKey: ['esa-instance-meta', credentialId, normalizedInstanceId],
    queryFn: async () => {
      if (!normalizedInstanceId) return null;
      const regionsToTry = region
        ? [region, ...ESA_SUPPORTED_REGIONS.filter((r) => r !== region)]
        : [...ESA_SUPPORTED_REGIONS];

      for (const r of regionsToTry) {
        try {
          const resp = await listEsaRatePlanInstances({
            credentialId,
            page: 1,
            pageSize: 100,
            region: r,
            checkRemainingSiteQuota: false,
          });
          const instances = (resp.data?.instances || []) as EsaRatePlanInstance[];
          const matched = instances.find((i) => String(i?.instanceId || '').trim() === normalizedInstanceId);
          if (matched) return matched;
        } catch {
          // ignore
        }
      }

      return null;
    },
    enabled: !!httpsDialog && !!credentialId && !!normalizedInstanceId,
    staleTime: 60_000,
  });

  const resolvedPlanName = String(instanceMetaQuery.data?.planName || planName || '').trim();
  const resolvedPlanType = String(instanceMetaQuery.data?.planType || '').trim();
  const resolvedPlanSpecName = String(planSpecName || '').trim();
  const planHint = `${resolvedPlanName} ${resolvedPlanType} ${resolvedPlanSpecName}`.trim();
  const planHintLower = planHint.toLowerCase();
  const isEntrancePlan =
    planHintLower.includes('entrance') ||
    planHintLower.includes('free') ||
    planHintLower.includes('trial') ||
    planHintLower.includes('lite') ||
    planHintLower.includes('nosla') ||
    planHint.includes('无SLA') ||
    planHint.includes('无sla') ||
    planHint.includes('免费') ||
    planHint.includes('入门');
  const isPaidPlan =
    planHintLower.includes('basic') ||
    planHintLower.includes('pro') ||
    planHintLower.includes('premium') ||
    planHintLower.includes('enterprise') ||
    planHintLower.includes('standard') ||
    planHintLower.includes('sla') ||
    planHint.includes('基础') ||
    planHint.includes('标准') ||
    planHint.includes('专业') ||
    planHint.includes('企业') ||
    planHint.includes('高级') ||
    planHint.includes('SLA');
  const supportsDigicert = isPaidPlan && !isEntrancePlan;
  const digicertSupportStatus: 'supported' | 'unsupported' | 'unknown' = supportsDigicert
    ? 'supported'
    : (isEntrancePlan ? 'unsupported' : 'unknown');

  const certTypeOptions = useMemo(() => {
    const options: CertificateTypeOption[] = [
      { value: 'lets_encrypt', label: isEntrancePlan ? "Let's Encrypt（无SLA）" : "Let's Encrypt（免费）" },
    ];
    if (supportsDigicert) {
      options.push(...DIGICERT_CERT_TYPE_OPTIONS);
    } else {
      options.push({
        value: '__digicert_upgrade',
        label: digicertSupportStatus === 'unknown' ? 'DigiCert（需基础版）' : 'DigiCert（升级至基础版）',
        disabled: true,
      });
    }
    return options;
  }, [supportsDigicert, isEntrancePlan, digicertSupportStatus]);

  useEffect(() => {
    if (supportsDigicert) return;
    if (certType.startsWith('digicert')) setCertType('lets_encrypt');
  }, [supportsDigicert, certType]);

  const managedDcv = useMemo(() => {
    if (!httpsRecordName) return null;
    const domain = String(httpsRecordName || '').trim().replace(/\.$/, '');
    if (!domain) return null;

    const host = toDisplayHost(domain, siteName);
    const prefix = certType === 'lets_encrypt' ? '_acme-challenge' : '_dnsauth';
    const rr = host === '@' || host === '*' ? prefix : `${prefix}.${host}`;
    const valueDomain = domain.replace(/^\*\./, '');
    const value = `${valueDomain}.${siteId}.dcv.aliyun-esa.com`;

    return { rr, value };
  }, [httpsRecordName, siteName, certType, siteId]);

  const {
    data: certDetailData,
    isFetching: isCertDetailFetching,
    refetch: refetchCertDetail,
    error: certDetailError,
  } = useQuery({
    queryKey: ['esa-cert-detail', credentialId, siteId, region, httpsRecordName],
    queryFn: () =>
      listEsaCertificatesByRecord({
        credentialId,
        siteId,
        recordNames: httpsRecordName ? [httpsRecordName] : [],
        region,
        validOnly: false,
        detail: true,
      }),
    enabled: !!credentialId && !!siteId && !!httpsRecordName,
    staleTime: 0,
  });

  const certDetailRecord = certDetailData?.data?.records?.[0];
  const certDetailCertificates = (certDetailRecord?.certificates || []) as EsaCertificate[];

  useEffect(() => {
    if (!httpsRecordName) return;
    if (selectedCertId) return;
    const firstId = certDetailCertificates.find((c) => c?.id)?.id;
    if (firstId) setSelectedCertId(firstId);
  }, [httpsRecordName, certDetailCertificates, selectedCertId]);

  const {
    data: selectedCertData,
    isFetching: isSelectedCertFetching,
    refetch: refetchSelectedCert,
    error: selectedCertError,
  } = useQuery({
    queryKey: ['esa-cert-get', credentialId, siteId, region, selectedCertId],
    queryFn: () => getEsaCertificate({ credentialId, siteId, certificateId: selectedCertId, region }),
    enabled: !!credentialId && !!siteId && !!selectedCertId && !!httpsRecordName,
    staleTime: 0,
  });

  const selectedCertificate = selectedCertData?.data?.certificate;

  const openAdd = () => {
    setEditing(null);
    setMobileEditingRecordId(null);
    setSubmitError(null);
    setHost('');
    setType('A/AAAA');
    setValue('');
    setTtl('30');
    setProxied(isCnameAccess ? true : false);
    setComment('');
    setPriority('');
    setBizName('web');
    setDialogOpen(true);
  };

  const applyEditingRecord = (r: EsaDnsRecord) => {
    const dataValue = getRecordValue(r);
    const dataPriority = (r.data as any)?.Priority;

    setEditing(r);
    setSubmitError(null);
    setHost(toDisplayHost(r.recordName, siteName));
    setType(r.type || 'A/AAAA');
    setValue(dataValue === '-' ? '' : dataValue);
    setTtl(r.ttl !== undefined && r.ttl !== null ? String(r.ttl) : '30');
    setProxied(isCnameAccess ? true : !!r.proxied);
    setComment(r.comment || '');
    setPriority(typeof dataPriority === 'number' && Number.isFinite(dataPriority) ? String(dataPriority) : '');
    setBizName(r.bizName || 'web');
  };

  const openEdit = (r: EsaDnsRecord) => {
    applyEditingRecord(r);
    if (isMobile) {
      setMobileEditingRecordId(r.recordId);
      setDialogOpen(false);
      return;
    }
    setMobileEditingRecordId(null);
    setDialogOpen(true);
  };

  const openHttps = (r: EsaDnsRecord) => {
    const recordName = String(r.recordName || '').trim();
    if (!recordName) return;
    setHttpsDialog({ recordName, recordId: r.recordId });
    setApplyResult(null);
    setApplyCertError(null);
    setSelectedCertId('');
    setCertType('lets_encrypt');
  };

  const closeDialog = () => {
    setDialogOpen(false);
    setMobileEditingRecordId(null);
    setEditing(null);
    setSubmitError(null);
  };

  const closeHttpsDialog = () => {
    setHttpsDialog(null);
    setApplyResult(null);
    setApplyCertError(null);
    setSelectedCertId('');
  };

  const closeCnameGuide = () => {
    setCnameGuide(null);
    setCopiedKey(null);
  };

  const handleCopy = async (key: string, text?: string) => {
    const normalized = String(text || '').trim();
    if (!normalized) return;
    try {
      await navigator.clipboard.writeText(normalized);
      setCopiedKey(key);
      window.setTimeout(() => setCopiedKey(null), 1200);
    } catch {
      setCopiedKey(null);
    }
  };

  const applyCertMutation = useMutation({
    mutationFn: (payload: { domains: string[]; type: string }) =>
      applyEsaCertificate({
        credentialId,
        siteId,
        domains: payload.domains,
        type: payload.type,
        region,
      }),
    onSuccess: async (resp: any) => {
      setApplyCertError(null);
      const first = resp?.data?.results?.[0];
      const nextCertId = first?.certificateId ? String(first.certificateId) : '';
      if (first) {
        setApplyResult(first);
        if (nextCertId) setSelectedCertId(nextCertId);
      }

      await queryClient.invalidateQueries({ queryKey: ['esa-cert-status', credentialId, siteId] });
      await queryClient.invalidateQueries({ queryKey: ['esa-cert-detail', credentialId, siteId] });
      if (nextCertId) {
        await queryClient.invalidateQueries({ queryKey: ['esa-cert-get', credentialId, siteId, region, nextCertId] });
      }
    },
    onError: (err) => {
      setApplyCertError(String(err));
    },
  });

  const handleApplyCertificate = () => {
    if (!httpsRecordName) return;
    if (applyCertMutation.isPending) return;
    setApplyResult(null);
    setApplyCertError(null);

    if (certType.startsWith('digicert') && !supportsDigicert) {
      setApplyCertError('当前套餐暂不支持 DigiCert 免费证书，请升级基础版/更高版本后再试。');
      return;
    }

    if (httpsRecordName.startsWith('*.') && certType === 'digicert_single') {
      setApplyCertError("当前域名为泛域名（*.xxx），DigiCert 单域名不支持泛域名，请切换到 Let's Encrypt 或 DigiCert 泛域名。");
      return;
    }

    if (!httpsRecordName.startsWith('*.') && certType === 'digicert_wildcard') {
      setApplyCertError('DigiCert 泛域名证书仅支持 *.xxx 形式的域名，请切换证书类型或选择泛域名记录。');
      return;
    }

    applyCertMutation.mutate({ domains: [httpsRecordName], type: certType });
  };

  const handleRefreshHttpsDialog = async () => {
    await Promise.allSettled([
      refetchCertStatus(),
      httpsRecordName ? refetchCertDetail() : Promise.resolve(),
      selectedCertId ? refetchSelectedCert() : Promise.resolve(),
    ]);
  };

  const createMutation = useMutation({
    mutationFn: (payload: any) => createEsaRecord(payload),
    onSuccess: async (resp: any) => {
      await queryClient.invalidateQueries({ queryKey: ['esa-records', credentialId, siteId] });
      await queryClient.invalidateQueries({ queryKey: ['esa-cname-status', credentialId, siteId] });
      await queryClient.invalidateQueries({ queryKey: ['esa-cert-status', credentialId, siteId] });
      closeDialog();
      const recordId = String(resp?.data?.recordId || '').trim();
      if (!recordId) return;

      try {
        const detail = await getEsaRecord({ credentialId, recordId, region });
        const record = detail.data?.record;
        const rn = String(record?.recordName || '').trim();
        const rc = String(record?.recordCname || '').trim();
        if (rn && rc) setCnameGuide({ recordName: rn, recordCname: rc });
      } catch {
        // ignore
      }
    },
    onError: (err) => {
      setSubmitError(String(err));
    },
  });

  const updateMutation = useMutation({
    mutationFn: (payload: any) => updateEsaRecord(payload.recordId, payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['esa-records', credentialId, siteId] });
      await queryClient.invalidateQueries({ queryKey: ['esa-cname-status', credentialId, siteId] });
      await queryClient.invalidateQueries({ queryKey: ['esa-cert-status', credentialId, siteId] });
      closeDialog();
    },
    onError: (err) => {
      setSubmitError(String(err));
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (payload: { credentialId: number; recordId: string; region?: string }) => deleteEsaRecord(payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['esa-records', credentialId, siteId] });
      await queryClient.invalidateQueries({ queryKey: ['esa-cname-status', credentialId, siteId] });
      await queryClient.invalidateQueries({ queryKey: ['esa-cert-status', credentialId, siteId] });
    },
  });

  const isSaving = createMutation.isPending || updateMutation.isPending;

  const normalizedType = useMemo(() => String(type || '').trim().toUpperCase(), [type]);
  const showPriority = normalizedType === 'MX';
  const proxySupportedByType = normalizedType === 'A/AAAA' || normalizedType === 'CNAME';
  const proxyEnabled = isCnameAccess ? true : (proxySupportedByType ? proxied : false);
  const proxyEditable = !isCnameAccess && proxySupportedByType;
  const requiresBizName = proxyEnabled;

  useEffect(() => {
    if (!isCnameAccess) return;
    if (!proxied) setProxied(true);
  }, [isCnameAccess, proxied]);

  useEffect(() => {
    if (isCnameAccess) return;
    if (proxySupportedByType) return;
    if (!proxied) return;
    setProxied(false);
  }, [isCnameAccess, proxySupportedByType, proxied]);

  const handleSave = () => {
    setSubmitError(null);

    if (!credentialId) {
      setSubmitError('缺少 credentialId');
      return;
    }
    if (!siteId) {
      setSubmitError('缺少 siteId');
      return;
    }

    const recordName = normalizeRecordName(host, siteName);
    if (!recordName) {
      setSubmitError('请输入主机记录');
      return;
    }

    const t = String(type || '').trim();
    if (!t) {
      setSubmitError('请选择记录类型');
      return;
    }

    if (!typeOptions.includes(t)) {
      setSubmitError('当前站点不支持该记录类型');
      return;
    }

    const v = String(value || '').trim();
    if (!v) {
      setSubmitError('请输入记录值');
      return;
    }

    const ttlNum = ttl.trim() ? parseInt(ttl.trim(), 10) : NaN;
    const ttlToSend = Number.isFinite(ttlNum) ? ttlNum : undefined;

    let priorityNum: number | undefined;
    if (showPriority) {
      const pRaw = priority.trim();
      if (!pRaw) {
        setSubmitError('MX 记录必须填写优先级');
        return;
      }
      const p = parseInt(pRaw, 10);
      if (!Number.isFinite(p) || p < 0) {
        setSubmitError('MX 优先级必须是非负整数');
        return;
      }
      priorityNum = p;
    }

    if (proxyEnabled && t !== 'A/AAAA' && t !== 'CNAME') {
      setSubmitError('开启代理时仅支持 A/AAAA 或 CNAME 记录');
      return;
    }

    if (requiresBizName) {
      const bn = String(bizName || '').trim();
      if (!BIZ_NAME_OPTIONS.some((o) => o.value === bn)) {
        setSubmitError('请选择正确的业务场景（BizName）');
        return;
      }
    }

    const dataPayload: any = { Value: v };
    if (showPriority && priorityNum !== undefined) {
      dataPayload.Priority = priorityNum;
    }

    if (!editing) {
      createMutation.mutate({
        credentialId,
        siteId,
        region,
        recordName,
        type: t,
        ttl: ttlToSend,
        proxied: proxyEnabled,
        bizName: requiresBizName ? bizName : undefined,
        comment: comment.trim() || undefined,
        data: dataPayload,
      });
      return;
    }

    updateMutation.mutate({
      credentialId,
      recordId: editing.recordId,
      region,
      ttl: ttlToSend,
      proxied: proxyEnabled,
      bizName: requiresBizName ? bizName : undefined,
      comment: comment.trim() || undefined,
      data: dataPayload,
    });
  };

  const handleDelete = (r: EsaDnsRecord) => {
    if (deleteMutation.isPending) return;
    if (!window.confirm(`确定删除记录 ${r.recordName} (${r.type}) 吗？`)) return;
    deleteMutation.mutate({ credentialId, recordId: r.recordId, region });
  };

  const {
    data: cnameGuideStatusData,
    isFetching: isCnameGuideStatusFetching,
    refetch: refetchCnameGuideStatus,
  } = useQuery({
    queryKey: ['esa-cname-guide-status', cnameGuide?.recordName, cnameGuide?.recordCname],
    queryFn: () => checkEsaCnameStatus({ records: cnameGuide ? [{ recordName: cnameGuide.recordName, recordCname: cnameGuide.recordCname }] : [] }),
    enabled: !!cnameGuide?.recordName && !!cnameGuide?.recordCname,
    staleTime: 0,
  });

  const cnameGuideStatus = cnameGuideStatusData?.data?.results?.[0]?.status;

  const handleRefreshAll = async () => {
    await Promise.allSettled([
      refetchRecords(),
      cnamePairs.length > 0 ? refetchCnameStatus() : Promise.resolve(),
      recordNames.length > 0 ? refetchCertStatus() : Promise.resolve(),
    ]);
  };

  const tableRecords = records;

  const renderRecordEditorFields = (topMargin: number, compact = false) => (
    <Stack spacing={2.5} sx={{ mt: topMargin }}>
      {submitError && <Alert severity="error">{submitError}</Alert>}

      {!compact && isCnameAccess && (
        <Alert severity="info">
          当前站点为 CNAME 接入：代理（Proxied）默认开启且不可关闭，仅支持添加 A/AAAA 或 CNAME 记录。
        </Alert>
      )}

      <TextField
        label="主机记录"
        placeholder="@ / www / a.b"
        value={host}
        onChange={(e) => setHost(e.target.value)}
        fullWidth
        size="small"
        disabled={isSaving || !!editing}
        helperText={compact ? undefined : (editing ? '更新记录不支持修改主机记录（如需修改请删除后重建）' : `将自动补全为 FQDN（当前站点：${siteName}）`)}
      />

      <TextField
        select
        label="记录类型"
        value={type}
        onChange={(e) => setType(e.target.value)}
        fullWidth
        size="small"
        disabled={isSaving || !!editing}
        helperText={compact ? undefined : (editing ? 'ESA 更新记录不支持修改类型/主机记录（如需修改请删除后重建）' : undefined)}
        SelectProps={{ native: true }}
      >
        {typeOptions.map((t) => (
          <option key={t} value={t}>{t}</option>
        ))}
      </TextField>

      <TextField
        label="记录值"
        placeholder={type === 'A/AAAA' ? '1.2.3.4, 2001:db8::1' : 'example.com'}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        fullWidth
        size="small"
        disabled={isSaving}
        helperText={compact ? undefined : (type === 'A/AAAA' ? '至少包含一个 IPv4；多个 IP 用逗号分隔' : undefined)}
      />

      {showPriority && (
        <TextField
          label="MX 优先级"
          placeholder="0"
          value={priority}
          onChange={(e) => setPriority(e.target.value)}
          fullWidth
          size="small"
          disabled={isSaving}
        />
      )}

      <TextField
        label="TTL（秒）"
        placeholder="30"
        value={ttl}
        onChange={(e) => setTtl(e.target.value)}
        fullWidth
        size="small"
        disabled={isSaving}
        helperText={compact ? undefined : '范围 30~86400；填 1 由系统决定'}
      />

      <FormControlLabel
        control={<Switch checked={proxyEnabled} onChange={(e) => setProxied(e.target.checked)} disabled={isSaving || !proxyEditable} />}
        label="代理（Proxied）"
      />

      {requiresBizName && (
        <TextField
          select
          label="业务场景（BizName）"
          value={bizName}
          onChange={(e) => setBizName(e.target.value)}
          fullWidth
          size="small"
          disabled={isSaving}
          helperText={compact ? undefined : BIZ_NAME_OPTIONS.find((o) => o.value === bizName)?.help}
          SelectProps={{ native: true }}
        >
          {BIZ_NAME_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </TextField>
      )}

      <TextField
        label="备注（可选）"
        placeholder="最多 100 字符"
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        fullWidth
        size="small"
        disabled={isSaving}
      />

      {!compact && (
        <>
          <Divider />
          <Alert severity="info">
            当前实现仅对接 ESA 的 Record API（List/Create/Update/Delete），并用 `Data.Value` 作为主要值字段；目前仅支持 A/AAAA、CNAME、TXT、MX、NS，其他复杂类型后续再补。
          </Alert>
        </>
      )}
    </Stack>
  );

  const renderMobileView = () => (
    records.length === 0 ? (
      <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', py: 4, color: 'text.secondary' }}>
        <Typography variant="body2">暂无 DNS 记录</Typography>
      </Box>
    ) : (
      <Stack spacing={1}>
        {records.map((r) => {
          const isInlineEditing = isMobile && mobileEditingRecordId === r.recordId && editing?.recordId === r.recordId;
          if (isInlineEditing) {
            return (
              <Card key={r.recordId} variant="outlined" sx={{ borderRadius: 2 }}>
                <CardContent sx={{ p: 2, pb: 0, '&:last-child': { pb: 0 } }}>
                  <Stack direction="row" alignItems="center" spacing={1} sx={{ pb: 1.5, borderBottom: 1, borderColor: 'divider' }}>
                    <DnsIcon color="primary" sx={{ fontSize: '1em' }} />
                    <Typography variant="subtitle2" color="primary.main" fontWeight="bold">编辑记录</Typography>
                  </Stack>
                  {renderRecordEditorFields(1.5, true)}
                </CardContent>
                <CardActions sx={{ justifyContent: 'flex-end', p: 2, pt: 1 }}>
                  <Button size="small" onClick={closeDialog} color="inherit" disabled={isSaving}>
                    取消
                  </Button>
                  <Button size="small" onClick={handleSave} variant="contained" disabled={isSaving}>
                    {isSaving ? <CircularProgress size={18} color="inherit" /> : '保存'}
                  </Button>
                </CardActions>
              </Card>
            );
          }

          const cnameStatus = r.recordCname ? getCnameStatusLabel(cnameStatusByRecordName.get(r.recordName)) : null;
          const httpsStatus = getHttpsStatusLabel(certStatusByRecordName.get(r.recordName));

          return (
            <Card key={r.recordId} variant="outlined" sx={{ borderRadius: 2 }}>
              <CardContent sx={{ p: 1.5, pb: 0, '&:last-child': { pb: 0 } }}>
                <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 0.5 }}>
                  <Chip
                    label={r.type || '-'}
                    size="small"
                    sx={{
                      fontWeight: 'bold',
                      height: 20,
                      fontSize: '0.7rem',
                      bgcolor: (theme) => theme.palette.primary.main,
                      color: 'white',
                      flexShrink: 0,
                    }}
                  />
                  <Typography variant="subtitle2" fontWeight="600" sx={{ wordBreak: 'break-all', lineHeight: 1.2, flexGrow: 1 }}>
                    {toDisplayHost(r.recordName, siteName)}
                  </Typography>
                </Stack>

                <Typography
                  variant="body2"
                  color="text.secondary"
                  sx={{
                    mb: 1,
                    fontFamily: 'monospace',
                    wordBreak: 'break-all',
                    fontSize: '0.85rem',
                    display: '-webkit-box',
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: 'vertical',
                    overflow: 'hidden',
                  }}
                >
                  {getRecordValue(r)}
                </Typography>

                <Stack direction="row" spacing={0.5} alignItems="center" sx={{ mb: 1, flexWrap: 'wrap' }}>
                  {cnameStatus && (
                    <Chip
                      size="small"
                      variant="outlined"
                      label={`CNAME ${cnameStatus.label}`}
                      color={cnameStatus.color}
                      sx={esaMetaChipSx}
                    />
                  )}
                  <Chip
                    size="small"
                    variant="outlined"
                    label={`HTTPS ${httpsStatus.label}`}
                    color={httpsStatus.color}
                    clickable
                    onClick={() => openEdit(r)}
                    sx={esaMetaChipSx}
                  />
                </Stack>

                {r.comment && (
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
                    备注：{r.comment}
                  </Typography>
                )}
              </CardContent>
              <Divider sx={{ borderStyle: 'dashed' }} />
              <CardActions sx={{ justifyContent: 'flex-end', p: 0.5, px: 1 }}>
                <Button
                  size="small"
                  startIcon={<EditIcon sx={{ fontSize: 16 }} />}
                  onClick={() => openEdit(r)}
                  sx={{ color: 'text.secondary', fontSize: '0.75rem', minWidth: 'auto', px: 1 }}
                  disabled={deleteMutation.isPending}
                >
                  编辑
                </Button>
                <Button
                  size="small"
                  startIcon={<DeleteIcon sx={{ fontSize: 16 }} />}
                  color="error"
                  onClick={() => handleDelete(r)}
                  sx={{ fontSize: '0.75rem', minWidth: 'auto', px: 1 }}
                  disabled={deleteMutation.isPending}
                >
                  删除
                </Button>
              </CardActions>
            </Card>
          );
        })}
      </Stack>
    )
  );

  return (
    <Box
      sx={{
        py: { xs: 1, sm: 2 },
        px: { xs: 2, sm: 6 },
        bgcolor: 'background.default',
        width: '100%',
        maxWidth: '100%',
        overflow: 'hidden',
      }}
    >
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        justifyContent="space-between"
        alignItems={{ xs: 'stretch', sm: 'center' }}
        spacing={{ xs: 2, sm: 0 }}
        sx={{
          borderBottom: { xs: 'none', sm: '1px solid rgba(0, 0, 0, 0.12)' },
          mb: 2,
        }}
      >
        <Tabs value={0} sx={{ borderBottom: 0, minHeight: { xs: 40, sm: 48 } }}>
          <Tab label="DNS 记录" sx={{ minHeight: { xs: 40, sm: 48 }, py: 1 }} />
        </Tabs>

        <Box sx={{ mb: 1, mr: { xs: 0, sm: 1 }, flexShrink: 0 }}>
          {isMobile ? (
            <Stack direction="row" spacing={1} sx={{ width: '100%' }}>
              <Button
                variant="contained"
                size="small"
                startIcon={<AddIcon />}
                onClick={openAdd}
                disabled={isLoading || deleteMutation.isPending}
                sx={{ flex: { xs: 1, sm: 'none' } }}
              >
                添加记录
              </Button>
              <Button
                variant="outlined"
                size="small"
                startIcon={<RefreshIcon />}
                onClick={handleRefreshAll}
                disabled={isLoading || isFetching || isCnameStatusFetching || isCertStatusFetching}
                sx={{ flex: { xs: 1, sm: 'none' } }}
              >
                {isFetching || isCnameStatusFetching || isCertStatusFetching ? '刷新中...' : '刷新'}
              </Button>
            </Stack>
          ) : (
            <Stack direction="row" spacing={1}>
              <Button
                variant="contained"
                size="small"
                startIcon={<AddIcon />}
                onClick={openAdd}
                disabled={isLoading || deleteMutation.isPending}
              >
                添加记录
              </Button>
              <Button
                variant="outlined"
                size="small"
                startIcon={<RefreshIcon />}
                onClick={handleRefreshAll}
                disabled={isLoading || isFetching || isCnameStatusFetching || isCertStatusFetching}
              >
                {isFetching || isCnameStatusFetching || isCertStatusFetching ? '刷新中...' : '刷新'}
              </Button>
            </Stack>
          )}
        </Box>
      </Stack>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {String((error as any)?.message || error)}
        </Alert>
      )}

      {cnameStatusError && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          无法检测 CNAME 状态：{String((cnameStatusError as any)?.message || cnameStatusError)}
        </Alert>
      )}

      {certStatusError && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          无法获取 HTTPS 证书状态：{String((certStatusError as any)?.message || certStatusError)}
        </Alert>
      )}

      {isLoading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
          <CircularProgress size={24} />
        </Box>
      ) : (
        <>
          {isMobile ? (
            renderMobileView()
          ) : (
            <TableContainer sx={{ width: '100%', overflowX: 'auto', maxWidth: '100%' }}>
              <Table size="small" sx={{ minWidth: 980, '& .MuiTableCell-root': { whiteSpace: 'nowrap' } }}>
                <TableHead>
                  <TableRow>
                    <TableCell>类型</TableCell>
                    <TableCell>名称</TableCell>
                    <TableCell sx={{ maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis' }}>内容</TableCell>
                    <TableCell sx={{ maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis' }}>CNAME</TableCell>
                    <TableCell width={110}>CNAME 状态</TableCell>
                    <TableCell width={110}>HTTPS</TableCell>
                    <TableCell width={80}>TTL</TableCell>
                    <TableCell width={90}>代理</TableCell>
                    <TableCell>备注</TableCell>
                    <TableCell width={90} align="right" />
                  </TableRow>
                </TableHead>
                <TableBody>
                  {tableRecords.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={10} align="center" sx={{ py: 8 }}>
                        <Typography variant="body1" color="text.secondary">
                          暂无记录
                        </Typography>
                      </TableCell>
                    </TableRow>
                  ) : (
                    tableRecords.map((r) => (
                      <TableRow key={r.recordId} hover>
                        <TableCell>{r.type || '-'}</TableCell>
                        <TableCell>{toDisplayHost(r.recordName, siteName)}</TableCell>
                        <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.85rem', maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {getRecordValue(r)}
                        </TableCell>
                        <TableCell sx={{ maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {r.recordCname ? (
                            <Stack direction="row" spacing={0.5} alignItems="center">
                              <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: '0.85rem', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                {r.recordCname}
                              </Typography>
                              <Tooltip title={copiedKey === `cname:${r.recordId}` ? '已复制' : '复制'}>
                                <IconButton size="small" onClick={() => handleCopy(`cname:${r.recordId}`, r.recordCname)}>
                                  <CopyIcon fontSize="inherit" />
                                </IconButton>
                              </Tooltip>
                            </Stack>
                          ) : (
                            '-'
                          )}
                        </TableCell>
                        <TableCell>
                          {r.recordCname ? (
                            <Chip
                              size="small"
                              variant="outlined"
                              {...(() => {
                                const meta = getCnameStatusLabel(cnameStatusByRecordName.get(r.recordName));
                                return { label: meta.label, color: meta.color };
                              })()}
                            />
                          ) : (
                            '-'
                          )}
                        </TableCell>
                        <TableCell>
                          {(() => {
                            const meta = getHttpsStatusLabel(certStatusByRecordName.get(r.recordName));
                            return (
                              <Chip
                                size="small"
                                variant="outlined"
                                label={meta.label}
                                color={meta.color}
                                clickable
                                onClick={() => openHttps(r)}
                              />
                            );
                          })()}
                        </TableCell>
                        <TableCell>{r.ttl ?? '-'}</TableCell>
                        <TableCell>{r.proxied ? '是' : '否'}</TableCell>
                        <TableCell sx={{ color: 'text.secondary' }}>{r.comment || '-'}</TableCell>
                        <TableCell align="right">
                          <IconButton size="small" onClick={() => openEdit(r)} disabled={deleteMutation.isPending}>
                            <EditIcon fontSize="inherit" />
                          </IconButton>
                          <IconButton size="small" onClick={() => handleDelete(r)} disabled={deleteMutation.isPending}>
                            <DeleteIcon fontSize="inherit" />
                          </IconButton>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </TableContainer>
          )}

          <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 1, color: 'text.secondary' }}>
            <Typography variant="caption">共 {total} 条</Typography>
            {(data?.data?.pageSize ?? pageSize) !== pageSize && (
              <Typography variant="caption">
                （pageSize: {data?.data?.pageSize}）
              </Typography>
            )}
          </Stack>
        </>
      )}

      <Dialog open={!!httpsDialog} onClose={closeHttpsDialog} maxWidth="md" fullWidth fullScreen={isMobile}>
        <DialogTitle>HTTPS 证书</DialogTitle>
        <DialogContent>
          <Stack spacing={2.5} sx={{ mt: 1 }}>
            {applyCertError && <Alert severity="error">{applyCertError}</Alert>}
            {applyResult && (
              <Alert severity="success">
                已提交证书申请：{applyResult.domain}
                {applyResult.certificateId ? `（ID: ${applyResult.certificateId}）` : ''}
              </Alert>
            )}

            <Stack spacing={0.5}>
              <Typography variant="caption" color="text.secondary">
                域名
              </Typography>
              <Stack direction="row" spacing={1} alignItems="center" sx={{ flexWrap: 'wrap' }}>
                <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                  {httpsRecordName || '-'}
                </Typography>
                <Chip
                  size="small"
                  variant="outlined"
                  {...(() => {
                    const meta = getHttpsStatusLabel(httpsStatus);
                    return { label: `HTTPS: ${meta.label}`, color: meta.color };
                  })()}
                />
              </Stack>
            </Stack>

            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ xs: 'stretch', sm: 'center' }}>
              <TextField
                select
                label="证书类型"
                value={certType}
                onChange={(e) => setCertType(e.target.value)}
                size="small"
                SelectProps={{ native: true }}
                disabled={applyCertMutation.isPending}
                sx={{ width: { xs: '100%', sm: 260 } }}
              >
                {certTypeOptions.map((o) => (
                  <option key={o.value} value={o.value} disabled={o.disabled}>
                    {o.label}
                  </option>
                ))}
              </TextField>

              <Button
                variant="contained"
                onClick={handleApplyCertificate}
                disabled={
                  applyCertMutation.isPending ||
                  !httpsRecordName ||
                  String(httpsStatus || '')
                    .trim()
                    .toLowerCase() === 'applying' ||
                  (!supportsDigicert && certType.startsWith('digicert')) ||
                  (httpsRecordName?.startsWith('*.') && certType === 'digicert_single') ||
                  (!httpsRecordName?.startsWith('*.') && certType === 'digicert_wildcard')
                }
                sx={{ flexShrink: 0 }}
              >
                {applyCertMutation.isPending ? <CircularProgress size={22} color="inherit" /> : '申请/续签免费证书'}
              </Button>

              <Button
                variant="outlined"
                onClick={handleRefreshHttpsDialog}
                disabled={isCertDetailFetching || isSelectedCertFetching}
                sx={{ flexShrink: 0 }}
              >
                {isCertDetailFetching || isSelectedCertFetching ? '刷新中...' : '刷新状态'}
              </Button>
            </Stack>

            {httpsRecordName?.startsWith('*.') && certType === 'digicert_single' && (
              <Alert severity="warning">当前域名为泛域名（*.xxx），DigiCert 单域名不支持泛域名，请切换到 Let's Encrypt 或 DigiCert 泛域名。</Alert>
            )}

            {!httpsRecordName?.startsWith('*.') && certType === 'digicert_wildcard' && (
              <Alert severity="warning">DigiCert 泛域名证书仅支持 *.xxx 形式的域名，请切换证书类型或选择泛域名记录。</Alert>
            )}

            {!supportsDigicert && (
              <Alert severity="info">
                {digicertSupportStatus === 'unknown'
                  ? `当前未识别套餐版本，默认仅提供 Let's Encrypt；如控制台已支持 DigiCert，请刷新/重新展开后再试。`
                  : `当前套餐仅支持 Let's Encrypt 免费证书；如需 DigiCert，请升级基础版/更高版本。`}
                {planHint ? `（${planHint}）` : ''}
              </Alert>
            )}

            {isCnameAccess && httpsCnameStatus && String(httpsCnameStatus).trim().toLowerCase() !== 'configured' && (
              <Alert severity="warning">
                当前域名的 CNAME 状态为「{getCnameStatusLabel(httpsCnameStatus).label}」，说明域名可能尚未接入 ESA。
                证书即使申请成功，也不会对外访问生效；请先完成域名接入，并按下方「托管 DCV」配置验证记录。
              </Alert>
            )}

            {isCnameAccess && certType.startsWith('digicert') && (
              <Alert severity="info">站点为 CNAME 接入：申请 DigiCert 免费证书需要先按下方「托管 DCV」在你的 DNS 服务商处添加 CNAME 验证记录。</Alert>
            )}

            <Alert severity="info">
              免费证书由 ESA 自动签发并续期；证书签发取决于 DCV 验证是否完成。
              若域名未接入 ESA（CNAME 状态未配置），证书不会对外访问生效。
            </Alert>

            <Divider />

            <Typography variant="subtitle2">托管 DCV（推荐）</Typography>
            {managedDcv ? (
              <Stack spacing={1}>
                <Box>
                  <Typography variant="caption" color="text.secondary">
                    CNAME 记录名（RR）
                  </Typography>
                  <Stack direction="row" spacing={1} alignItems="center">
                    <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                      {managedDcv.rr}
                    </Typography>
                    <Tooltip title={copiedKey === 'dcv:rr' ? '已复制' : '复制'}>
                      <IconButton size="small" onClick={() => handleCopy('dcv:rr', managedDcv.rr)}>
                        <CopyIcon fontSize="inherit" />
                      </IconButton>
                    </Tooltip>
                  </Stack>
                </Box>
                <Box>
                  <Typography variant="caption" color="text.secondary">
                    CNAME 记录值
                  </Typography>
                  <Stack direction="row" spacing={1} alignItems="center">
                    <Typography variant="body2" sx={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>
                      {managedDcv.value}
                    </Typography>
                    <Tooltip title={copiedKey === 'dcv:value' ? '已复制' : '复制'}>
                      <IconButton size="small" onClick={() => handleCopy('dcv:value', managedDcv.value)}>
                        <CopyIcon fontSize="inherit" />
                      </IconButton>
                    </Tooltip>
                  </Stack>
                </Box>
              </Stack>
            ) : (
              <Typography variant="body2" color="text.secondary">
                -
              </Typography>
            )}

            <Divider />

            <Typography variant="subtitle2">证书详情</Typography>
            {certDetailError && (
              <Alert severity="warning">无法获取证书列表：{String((certDetailError as any)?.message || certDetailError)}</Alert>
            )}

            {certDetailCertificates.length === 0 ? (
              <Typography variant="body2" color="text.secondary">
                暂无证书（可先点击上方「申请/续签免费证书」）
              </Typography>
            ) : (
              <Stack spacing={2}>
                <TextField
                  select
                  label="选择证书查看验证信息"
                  value={selectedCertId}
                  onChange={(e) => setSelectedCertId(e.target.value)}
                  fullWidth
                  size="small"
                  SelectProps={{ native: true }}
                >
                  {certDetailCertificates.map((c) => (
                    <option key={c.id} value={c.id}>
                      {(c.commonName || c.name || c.id) + (c.status ? ` · ${c.status}` : '')}
                    </option>
                  ))}
                </TextField>

                {selectedCertError && (
                  <Alert severity="warning">无法获取证书详情：{String((selectedCertError as any)?.message || selectedCertError)}</Alert>
                )}

                {selectedCertificate && (
                  <Stack spacing={1.5}>
                    <Stack spacing={0.5}>
                      <Typography variant="caption" color="text.secondary">
                        证书信息
                      </Typography>
                      <Stack direction="row" spacing={1} alignItems="center" sx={{ flexWrap: 'wrap' }}>
                        <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                          {selectedCertificate.id}
                        </Typography>
                        <Tooltip title={copiedKey === 'cert:id' ? '已复制' : '复制'}>
                          <IconButton size="small" onClick={() => handleCopy('cert:id', selectedCertificate.id)}>
                            <CopyIcon fontSize="inherit" />
                          </IconButton>
                        </Tooltip>
                        {selectedCertificate.status && <Chip size="small" variant="outlined" label={selectedCertificate.status} />}
                        {selectedCertificate.type && <Chip size="small" variant="outlined" label={selectedCertificate.type} />}
                        {selectedCertificate.notAfter && <Chip size="small" variant="outlined" label={`到期: ${selectedCertificate.notAfter}`} />}
                      </Stack>
                      {selectedCertificate.applyMessage && (
                        <Typography variant="body2" color="text.secondary">
                          {selectedCertificate.applyMessage}
                        </Typography>
                      )}
                    </Stack>

                    {Array.isArray(selectedCertificate.dcv) && selectedCertificate.dcv.length > 0 ? (
                      <Stack spacing={1}>
                        <Typography variant="caption" color="text.secondary">
                          验证信息（DCV）
                        </Typography>
                        {selectedCertificate.dcv.map((d, idx) => (
                          <Box key={`${d.id || idx}`} sx={{ p: 1.5, border: 1, borderColor: 'divider', borderRadius: 1 }}>
                            <Stack spacing={1}>
                              <Stack direction="row" spacing={1} alignItems="center" sx={{ flexWrap: 'wrap' }}>
                                {d.type && <Chip size="small" variant="outlined" label={d.type} />}
                                {d.status && <Chip size="small" variant="outlined" label={d.status} />}
                              </Stack>

                              {d.key && (
                                <Box>
                                  <Typography variant="caption" color="text.secondary">
                                    Key
                                  </Typography>
                                  <Stack direction="row" spacing={1} alignItems="center">
                                    <Typography variant="body2" sx={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>
                                      {d.key}
                                    </Typography>
                                    <Tooltip title={copiedKey === `dcv:key:${idx}` ? '已复制' : '复制'}>
                                      <IconButton size="small" onClick={() => handleCopy(`dcv:key:${idx}`, d.key)}>
                                        <CopyIcon fontSize="inherit" />
                                      </IconButton>
                                    </Tooltip>
                                  </Stack>
                                </Box>
                              )}

                              {d.value && (
                                <Box>
                                  <Typography variant="caption" color="text.secondary">
                                    Value
                                  </Typography>
                                  <Stack direction="row" spacing={1} alignItems="center">
                                    <Typography variant="body2" sx={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>
                                      {d.value}
                                    </Typography>
                                    <Tooltip title={copiedKey === `dcv:value:${idx}` ? '已复制' : '复制'}>
                                      <IconButton size="small" onClick={() => handleCopy(`dcv:value:${idx}`, d.value)}>
                                        <CopyIcon fontSize="inherit" />
                                      </IconButton>
                                    </Tooltip>
                                  </Stack>
                                </Box>
                              )}
                            </Stack>
                          </Box>
                        ))}
                      </Stack>
                    ) : (
                      <Typography variant="body2" color="text.secondary">
                        无需验证或暂无验证信息
                      </Typography>
                    )}
                  </Stack>
                )}
              </Stack>
            )}
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={closeHttpsDialog} variant="contained">
            关闭
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={dialogOpen}
        onClose={closeDialog}
        maxWidth="sm"
        fullWidth
        PaperProps={{
          sx: { borderRadius: 2 },
        }}
      >
        <DialogTitle sx={{ borderBottom: 1, borderColor: 'divider', pb: 2 }}>
          <Stack direction="row" alignItems="center" spacing={1}>
            <DnsIcon color="primary" sx={{ fontSize: '1em' }} />
            <Typography variant="h6" fontWeight="bold">{editing ? '编辑记录' : '添加记录'}</Typography>
          </Stack>
        </DialogTitle>
        <DialogContent sx={{ mt: 2 }}>
          {renderRecordEditorFields(1)}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 3 }}>
          <Button onClick={closeDialog} color="inherit" disabled={isSaving}>
            取消
          </Button>
          <Button onClick={handleSave} variant="contained" disabled={isSaving}>
            {isSaving ? <CircularProgress size={22} color="inherit" /> : '保存'}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={!!cnameGuide} onClose={closeCnameGuide} maxWidth="sm" fullWidth>
        <DialogTitle>CNAME 配置</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <Alert severity="info">
              如当前域名 DNS 不在 ESA 托管（CNAME 接入/外部 DNS），请在你的 DNS 服务商处为下面的记录添加 CNAME。
            </Alert>

            <Box>
              <Typography variant="caption" color="text.secondary">记录名</Typography>
              <Stack direction="row" spacing={1} alignItems="center">
                <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>{cnameGuide?.recordName || '-'}</Typography>
                <Tooltip title={copiedKey === `guide:name` ? '已复制' : '复制'}>
                  <IconButton size="small" onClick={() => handleCopy('guide:name', cnameGuide?.recordName)}>
                    <CopyIcon fontSize="inherit" />
                  </IconButton>
                </Tooltip>
              </Stack>
            </Box>

            <Box>
              <Typography variant="caption" color="text.secondary">CNAME 值</Typography>
              <Stack direction="row" spacing={1} alignItems="center">
                <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>{cnameGuide?.recordCname || '-'}</Typography>
                <Tooltip title={copiedKey === `guide:cname` ? '已复制' : '复制'}>
                  <IconButton size="small" onClick={() => handleCopy('guide:cname', cnameGuide?.recordCname)}>
                    <CopyIcon fontSize="inherit" />
                  </IconButton>
                </Tooltip>
              </Stack>
            </Box>

            <Stack direction="row" spacing={1} alignItems="center">
              <Typography variant="body2" color="text.secondary">CNAME 状态：</Typography>
              <Chip
                size="small"
                variant="outlined"
                {...(() => {
                  const meta = getCnameStatusLabel(cnameGuideStatus);
                  return { label: meta.label, color: meta.color };
                })()}
              />
              {isCnameGuideStatusFetching && <CircularProgress size={16} />}
            </Stack>
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => refetchCnameGuideStatus()} disabled={isCnameGuideStatusFetching} startIcon={<RefreshIcon />}>
            检测
          </Button>
          <Button onClick={closeCnameGuide} variant="contained">
            我已设置
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
