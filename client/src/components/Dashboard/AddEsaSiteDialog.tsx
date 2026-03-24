import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  Stack,
  TextField,
  Typography,
  useMediaQuery,
  useTheme,
  IconButton,
  Tooltip,
} from '@mui/material';
import { ContentCopy as CopyIcon } from '@mui/icons-material';
import type { DnsCredential } from '@/types/dns';
import { useProvider } from '@/contexts/ProviderContext';
import AutoDnsConfigDialog, { type AutoDnsConfigRequest } from './AutoDnsConfigDialog';
import { findMatchingCandidateZones } from '@/utils/autoDns';
import { createEsaSite, ESA_SUPPORTED_REGIONS, listEsaRatePlanInstances, verifyEsaSite, type EsaRatePlanInstance } from '@/services/aliyunEsa';

const COVERAGE_OPTIONS: Array<{ value: string; label: string; help: string }> = [
  { value: 'overseas', label: '海外', help: '不包含中国内地' },
  { value: 'domestic', label: '国内', help: '包含中国内地（需 ICP 备案）' },
  { value: 'global', label: '全球', help: '包含中国内地（需 ICP 备案）' },
];

const ACCESS_TYPE_OPTIONS: Array<{ value: string; label: string; help: string }> = [
  { value: 'CNAME', label: 'CNAME 接入', help: '保留原 DNS 服务商，按提示添加验证记录' },
  { value: 'NS', label: 'NS 接入', help: '需要将域名 NS 修改为 ESA 提供的 NS' },
];

function getInstanceMeta(i?: EsaRatePlanInstance | null): { status: string; quota?: number; used: number; remaining?: number; usable: boolean } {
  const status = String(i?.status || '').trim();
  const statusLower = status.toLowerCase();
  const quota = typeof i?.siteQuota === 'number' && Number.isFinite(i.siteQuota) ? i.siteQuota : undefined;
  const used = typeof i?.usedSiteCount === 'number' && Number.isFinite(i.usedSiteCount) ? i.usedSiteCount : 0;
  const remaining = quota === undefined ? undefined : Math.max(0, quota - used);
  const usableStatus = !statusLower || statusLower === 'online';
  const usableQuota = remaining === undefined ? true : remaining > 0;
  return { status, quota, used, remaining, usable: usableStatus && usableQuota };
}

export default function AddEsaSiteDialog({
  open,
  credentials,
  initialCredentialId,
  onClose,
}: {
  open: boolean;
  credentials: DnsCredential[];
  initialCredentialId?: number;
  onClose: (refresh: boolean) => void;
}) {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const { credentials: allDnsCredentials } = useProvider();

  const [credentialId, setCredentialId] = useState<number>(() => initialCredentialId ?? credentials[0]?.id ?? 0);
  const [siteName, setSiteName] = useState('');
  const [coverage, setCoverage] = useState<string>('overseas');
  const [accessType, setAccessType] = useState<string>('CNAME');
  const [instanceId, setInstanceId] = useState<string>('');
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ siteId: string; verifyCode?: string; nameServerList?: string } | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [autoDnsRequest, setAutoDnsRequest] = useState<AutoDnsConfigRequest | null>(null);
  const [isCheckingAutoDns, setIsCheckingAutoDns] = useState(false);

  useEffect(() => {
    if (!open) return;
    setCredentialId(initialCredentialId ?? credentials[0]?.id ?? 0);
    setSiteName('');
    setCoverage('overseas');
    setAccessType('CNAME');
    setInstanceId('');
    setSubmitError(null);
    setCreated(null);
    setCopiedKey(null);
    setAutoDnsRequest(null);
    setIsCheckingAutoDns(false);
  }, [open, initialCredentialId, credentials]);

  const selectedCredential = useMemo(
    () => credentials.find(c => c.id === credentialId) || credentials[0],
    [credentials, credentialId]
  );

  const instancesQuery = useQuery({
    queryKey: ['esa-instances', credentialId],
    queryFn: async () => {
      const settled = await Promise.allSettled(
        ESA_SUPPORTED_REGIONS.map(async (region) => {
          const resp = await listEsaRatePlanInstances({
            credentialId,
            page: 1,
            pageSize: 100,
            region,
            checkRemainingSiteQuota: false,
          });
          const instances = (resp.data?.instances || []) as EsaRatePlanInstance[];
          return {
            region,
            resp,
            instances: instances.map((i) => ({ ...i, region })),
          };
        })
      );

      const merged: EsaRatePlanInstance[] = [];
      let firstResp: any | null = null;
      let firstError: any | null = null;

      settled.forEach((r) => {
        if (r.status === 'fulfilled') {
          if (!firstResp) firstResp = r.value.resp;
          merged.push(...r.value.instances);
        } else if (!firstError) {
          firstError = r.reason;
        }
      });

      if (!firstResp) {
        throw firstError || new Error('获取 ESA 套餐实例失败');
      }

      const unique = Array.from(
        new Map(merged.map((i) => [i.instanceId, i])).values()
      );

      return {
        ...firstResp,
        data: {
          ...firstResp.data,
          instances: unique,
          total: unique.length,
          pageNumber: 1,
          pageSize: unique.length,
        },
      };
    },
    enabled: open && typeof credentialId === 'number' && Number.isFinite(credentialId) && credentialId > 0,
    staleTime: 60_000,
  });

  const instances = (instancesQuery.data?.data?.instances || []) as EsaRatePlanInstance[];
  const selectedInstance = useMemo(
    () => instances.find((i) => i.instanceId === instanceId) || instances[0],
    [instances, instanceId]
  );
  const hasUsableInstance = instances.some((i: EsaRatePlanInstance) => getInstanceMeta(i).usable);
  const selectedMeta = getInstanceMeta(selectedInstance);
  const selectedRegion = typeof selectedInstance?.region === 'string' ? selectedInstance.region : undefined;

  useEffect(() => {
    if (!open) return;
    if (instanceId) return;
    if (instances.length === 0) return;
    const firstUsable = instances.find((i: EsaRatePlanInstance) => getInstanceMeta(i).usable);
    setInstanceId((firstUsable || instances[0]).instanceId);
  }, [open, instanceId, instances]);

  const mutation = useMutation({
    mutationFn: (payload: { credentialId: number; siteName: string; coverage: string; accessType: string; instanceId: string; region?: string }) =>
      createEsaSite(payload),
    onSuccess: async (resp) => {
      const createdSite = resp.data ? {
        siteId: resp.data.siteId,
        verifyCode: resp.data.verifyCode,
        nameServerList: resp.data.nameServerList,
      } : null;
      setSubmitError(null);

      const verifyCode = String(resp.data?.verifyCode || '').trim();
      const verifyRecordName = siteName.trim() ? `_esaauth.${siteName.trim()}` : '';
      if (String(accessType || '').trim().toUpperCase() !== 'CNAME' || !verifyCode || !verifyRecordName) {
        setCreated(createdSite);
        return;
      }

      setIsCheckingAutoDns(true);
      try {
        const candidates = await findMatchingCandidateZones(allDnsCredentials, verifyRecordName);
        if (candidates.length === 0) {
          setCreated(createdSite);
          return;
        }

        setAutoDnsRequest({
          title: '自动配置 ESA 验证 TXT',
          description: '检测到项目内已存在可托管该 TXT 的域名，可直接自动创建；若不处理，仍可按当前弹窗内容手动配置。',
          recordType: 'TXT',
          fqdn: verifyRecordName,
          value: verifyCode,
          candidates,
          afterUpsert: {
            pendingText: 'TXT 已处理，正在自动验证 ESA 站点...',
            successText: 'ESA 站点验证已自动完成',
            run: async () => {
              const verifyResp = await verifyEsaSite({
                credentialId: selectedCredential?.id || credentialId,
                siteId: String(resp.data?.siteId || ''),
                region: selectedRegion,
              });
              if (verifyResp.data?.passed) {
                return { success: true, message: 'ESA 站点验证已自动完成' };
              }
              return { success: false, message: 'TXT 已创建，但 ESA 自动验证暂未通过，可能需要等待 DNS 生效后再试' };
            },
          },
        });
        return;
      } catch {
        setCreated(createdSite);
      } finally {
        setIsCheckingAutoDns(false);
      }
    },
    onError: (err) => {
      setSubmitError(String(err));
      setCreated(null);
    },
  });

  const canSubmit =
    !!selectedCredential &&
    !mutation.isPending &&
    !isCheckingAutoDns &&
    !instancesQuery.isLoading &&
    !!siteName.trim() &&
    !!coverage.trim() &&
    !!accessType.trim() &&
    !!instanceId.trim() &&
    selectedMeta.usable;

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

  const handleSubmit = () => {
    if (!selectedCredential) {
      setSubmitError('请选择账户');
      return;
    }
    const name = siteName.trim();
    if (!name) {
      setSubmitError('请输入站点域名');
      return;
    }
    if (!instanceId.trim()) {
      setSubmitError('请选择套餐实例');
      return;
    }

    setSubmitError(null);
    mutation.mutate({
      credentialId: selectedCredential.id,
      siteName: name,
      coverage,
      accessType,
      instanceId: instanceId.trim(),
      region: selectedRegion,
    });
  };

  const handleDone = () => {
    if (mutation.isPending || isCheckingAutoDns) return;
    onClose(!!created?.siteId);
  };

  const handleAutoDnsClose = (configured: boolean) => {
    setAutoDnsRequest(null);
    if (configured) {
      onClose(true);
    }
  };

  const coverageHelp = COVERAGE_OPTIONS.find(o => o.value === coverage)?.help;
  const accessHelp = ACCESS_TYPE_OPTIONS.find(o => o.value === accessType)?.help;

  const verifyTxtName = siteName.trim() ? `_esaauth.${siteName.trim()}` : '_esaauth.<domain>';
  const showManualTxtGuide = !!created?.siteId && accessType === 'CNAME' && !isCheckingAutoDns && !autoDnsRequest;

  return (
    <Dialog open={open} onClose={handleDone} maxWidth="sm" fullWidth fullScreen={isMobile}>
      <DialogTitle>添加 ESA 站点</DialogTitle>
      <DialogContent>
        <Stack spacing={2.5} sx={{ mt: 1 }}>
          <Alert severity="info">
            ESA 站点创建后通常需要完成域名验证。若覆盖范围包含中国内地，请确保域名已完成 ICP 备案。
          </Alert>

          <TextField
            select
            label="选择阿里云账户"
            value={selectedCredential?.id ?? ''}
            onChange={(e) => setCredentialId(parseInt(e.target.value, 10))}
            fullWidth
            size="small"
            disabled={mutation.isPending || isCheckingAutoDns || credentials.length === 0}
            helperText={credentials.length === 0 ? '暂无可用账户，请先在设置中添加阿里云 DNS 凭证' : undefined}
          >
            {credentials.map(c => (
              <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>
            ))}
          </TextField>

          <TextField
            label="站点域名"
            placeholder="example.com"
            value={siteName}
            onChange={(e) => setSiteName(e.target.value)}
            fullWidth
            size="small"
            disabled={mutation.isPending || isCheckingAutoDns}
            autoComplete="off"
          />

          <TextField
            select
            label="接入方式"
            value={accessType}
            onChange={(e) => setAccessType(e.target.value)}
            fullWidth
            size="small"
            disabled={mutation.isPending || isCheckingAutoDns}
            helperText={accessHelp}
          >
            {ACCESS_TYPE_OPTIONS.map(o => (
              <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>
            ))}
          </TextField>

          <TextField
            select
            label="覆盖范围"
            value={coverage}
            onChange={(e) => setCoverage(e.target.value)}
            fullWidth
            size="small"
            disabled={mutation.isPending || isCheckingAutoDns}
            helperText={coverageHelp}
          >
            {COVERAGE_OPTIONS.map(o => (
              <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>
            ))}
          </TextField>

          <TextField
            select
            label="套餐实例"
            value={instanceId}
            onChange={(e) => setInstanceId(e.target.value)}
            fullWidth
            size="small"
            disabled={mutation.isPending || isCheckingAutoDns || instancesQuery.isLoading}
            helperText={
              instancesQuery.isLoading
                ? '加载中...'
                : (instances.length === 0
                    ? '未找到套餐实例（已自动尝试 cn-hangzhou / ap-southeast-1）'
                    : (!hasUsableInstance
                        ? '没有可用套餐实例（可能：实例状态非 online 或站点配额已用完）'
                        : (!selectedMeta.usable ? '当前实例不可用，请选择其他实例' : undefined)))
            }
          >
            {instances.map(i => {
              const meta = getInstanceMeta(i);
              const parts: string[] = [];
              parts.push(`${i.planName || 'plan'}${i.planType ? `（${i.planType}）` : ''}`);
              if (typeof meta.quota === 'number') parts.push(`站点 ${meta.used}/${meta.quota}`);
              if (meta.status) parts.push(`状态 ${meta.status}`);
              if (i.region) parts.push(i.region);

              return (
                <MenuItem key={i.instanceId} value={i.instanceId} disabled={!meta.usable}>
                  {parts.join(' · ')}
                </MenuItem>
              );
            })}
          </TextField>

          {instancesQuery.isLoading && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <CircularProgress size={18} />
              <Typography variant="body2" color="text.secondary">正在加载套餐实例...</Typography>
            </Box>
          )}

          {instancesQuery.error && (
            <Alert severity="error">
              {String((instancesQuery.error as any)?.message || instancesQuery.error)}
            </Alert>
          )}

          {submitError && <Alert severity="error">{submitError}</Alert>}

          {isCheckingAutoDns && (
            <Alert severity="info" icon={<CircularProgress size={16} color="inherit" />}>
              站点已创建，正在检查项目内是否存在可自动配置的 DNS...
            </Alert>
          )}

          {mutation.isPending && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <CircularProgress size={18} />
              <Typography variant="body2" color="text.secondary">正在创建站点...</Typography>
            </Box>
          )}

          {created?.siteId && (
            <Alert severity="success">
              <Stack spacing={1.2}>
                <Typography variant="subtitle2">创建成功</Typography>
                <Typography variant="body2">SiteId: {created.siteId}</Typography>

                {showManualTxtGuide && (
                  <>
                    <Typography variant="body2">
                      请添加 TXT 记录完成验证：
                    </Typography>
                    <Stack direction="row" spacing={1} alignItems="center">
                      <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>{verifyTxtName}</Typography>
                      <Tooltip title={copiedKey === `txt:${verifyTxtName}` ? '已复制' : '复制'}>
                        <IconButton size="small" onClick={() => handleCopy(`txt:${verifyTxtName}`, verifyTxtName)}>
                          <CopyIcon fontSize="inherit" />
                        </IconButton>
                      </Tooltip>
                    </Stack>
                    <Stack direction="row" spacing={1} alignItems="center">
                      <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>{created.verifyCode || '-'}</Typography>
                      <Tooltip title={copiedKey === `code:${created.verifyCode}` ? '已复制' : '复制'}>
                        <IconButton size="small" onClick={() => handleCopy(`code:${created.verifyCode}`, created.verifyCode)}>
                          <CopyIcon fontSize="inherit" />
                        </IconButton>
                      </Tooltip>
                    </Stack>
                  </>
                )}

                {accessType === 'NS' && (
                  <>
                    <Typography variant="body2">
                      请将域名 NS 修改为：
                    </Typography>
                    <Stack direction="row" spacing={1} alignItems="center">
                      <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>{created.nameServerList || '-'}</Typography>
                      <Tooltip title={copiedKey === `ns:${created.nameServerList}` ? '已复制' : '复制'}>
                        <IconButton size="small" onClick={() => handleCopy(`ns:${created.nameServerList}`, created.nameServerList)}>
                          <CopyIcon fontSize="inherit" />
                        </IconButton>
                      </Tooltip>
                    </Stack>
                  </>
                )}
              </Stack>
            </Alert>
          )}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 3 }}>
        <Button onClick={handleDone} color="inherit" disabled={mutation.isPending || isCheckingAutoDns}>
          {created?.siteId ? '完成' : '取消'}
        </Button>
        <Button
          onClick={handleSubmit}
          variant="contained"
          disabled={!canSubmit}
        >
          {mutation.isPending ? <CircularProgress size={22} color="inherit" /> : '创建站点'}
        </Button>
      </DialogActions>

      <AutoDnsConfigDialog
        open={!!autoDnsRequest}
        request={autoDnsRequest}
        onClose={handleAutoDnsClose}
      />
    </Dialog>
  );
}
