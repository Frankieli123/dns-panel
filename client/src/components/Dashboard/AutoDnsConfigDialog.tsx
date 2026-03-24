import { useEffect, useMemo, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import {
  Alert,
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
} from '@mui/material';
import { Domain, DNSRecord } from '@/types';
import { createDNSRecord, getDNSRecords, updateDNSRecord } from '@/services/dns';
import { findBestZone, normalizeHostname, toRelativeRecordName } from '@/utils/autoDns';

const PROVIDER_DISPLAY_NAME: Record<string, string> = {
  cloudflare: 'Cloudflare',
  aliyun: '阿里云',
  dnspod: '腾讯云',
  dnspod_token: '腾讯云',
  huawei: '华为云',
  baidu: '百度云',
  huoshan: '火山引擎',
  jdcloud: '京东云',
  dnsla: 'DNSLA',
  namesilo: 'NameSilo',
  powerdns: 'PowerDNS',
  spaceship: 'Spaceship',
  west: '西部数码',
};

export type AutoDnsConfigRequest = {
  title: string;
  description?: string;
  recordType: 'TXT' | 'CNAME';
  fqdn: string;
  value: string;
  candidates: Domain[];
  afterUpsert?: {
    pendingText?: string;
    successText?: string;
    run: () => Promise<{ success?: boolean; message?: string } | void>;
  };
};

const toRecordFqdn = (record: DNSRecord, fallbackZoneName?: string): string => {
  const recordName = String(record.name || '').trim().replace(/\.+$/, '');
  const zoneName = String(record.zoneName || fallbackZoneName || '').trim().replace(/\.+$/, '');

  if (!recordName) return normalizeHostname(zoneName);
  if (recordName === '@') return normalizeHostname(zoneName);

  const normalizedRecordName = normalizeHostname(recordName);
  const normalizedZoneName = normalizeHostname(zoneName);

  if (!normalizedZoneName) return normalizedRecordName;
  if (normalizedRecordName === normalizedZoneName || normalizedRecordName.endsWith(`.${normalizedZoneName}`)) {
    return normalizedRecordName;
  }

  return normalizeHostname(`${recordName}.${zoneName}`);
};

export default function AutoDnsConfigDialog({
  open,
  request,
  onClose,
}: {
  open: boolean;
  request: AutoDnsConfigRequest | null;
  onClose: (configured: boolean) => void;
}) {
  const candidates = request?.candidates || [];
  const bestZone = useMemo(
    () => (request?.fqdn ? findBestZone(request.fqdn, candidates) : undefined),
    [request?.fqdn, candidates]
  );
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [createdRecord, setCreatedRecord] = useState<DNSRecord | null>(null);
  const [autoStarted, setAutoStarted] = useState(false);
  const [actionLabel, setActionLabel] = useState<'create' | 'update'>('create');
  const [afterActionState, setAfterActionState] = useState<'idle' | 'pending' | 'success' | 'failed'>('idle');
  const [afterActionMessage, setAfterActionMessage] = useState<string | null>(null);
  const hasMultipleCandidates = candidates.length > 1;

  useEffect(() => {
    if (!open) return;
    setSubmitError(null);
    setCreatedRecord(null);
    setAutoStarted(false);
    setActionLabel('create');
    setAfterActionState('idle');
    setAfterActionMessage(null);
  }, [open]);

  const candidateOptions = useMemo(
    () => candidates.map((candidate) => ({
      key: `${candidate.credentialId}:${candidate.id}`,
      zone: candidate,
    })),
    [candidates]
  );

  const [selectedCandidateKey, setSelectedCandidateKey] = useState('');

  useEffect(() => {
    if (!open) return;
    setSelectedCandidateKey(
      bestZone ? `${bestZone.credentialId}:${bestZone.id}` : candidateOptions[0]?.key || ''
    );
  }, [open, bestZone, candidateOptions]);

  const selectedZone = useMemo(() => {
    if (!hasMultipleCandidates) return bestZone || candidates[0];
    return candidateOptions.find((candidate) => candidate.key === selectedCandidateKey)?.zone
      || bestZone
      || candidates[0];
  }, [hasMultipleCandidates, bestZone, candidates, candidateOptions, selectedCandidateKey]);

  const relativeRecordName = useMemo(
    () => (selectedZone ? toRelativeRecordName(request?.fqdn || '', selectedZone.name) : ''),
    [request?.fqdn, selectedZone]
  );

  const mutation = useMutation({
    mutationFn: async () => {
      if (!request) throw new Error('缺少自动配置请求');
      if (!selectedZone || typeof selectedZone.credentialId !== 'number') throw new Error('请选择目标域名');

      const existingResp = await getDNSRecords(selectedZone.id, selectedZone.credentialId);
      const existingRecords = existingResp.data?.records || [];
      const expectedFqdn = normalizeHostname(request.fqdn);
      const expectedValue = String(request.value || '').trim();
      const existingRecord = existingRecords.find((record) => {
        const sameName = toRecordFqdn(record, selectedZone.name) === expectedFqdn;
        const sameType = String(record.type || '').trim().toUpperCase() === request.recordType;
        if (!sameName || !sameType) return false;
        if (request.recordType !== 'TXT') return true;
        return String(record.content || '').trim() === expectedValue;
      });

      const payload = {
        type: request.recordType,
        name: relativeRecordName || '@',
        content: request.value,
      };

      let resp;
      if (existingRecord?.id) {
        setActionLabel('update');
        resp = await updateDNSRecord(
          selectedZone.id,
          existingRecord.id,
          payload,
          selectedZone.credentialId
        );
      } else {
        setActionLabel('create');
        resp = await createDNSRecord(
          selectedZone.id,
          payload,
          selectedZone.credentialId
        );
      }

      return resp.data?.record || null;
    },
    onSuccess: async (record) => {
      setSubmitError(null);
      setCreatedRecord(record || null);

      if (!record || !request?.afterUpsert) return;

      setAfterActionState('pending');
      setAfterActionMessage(null);
      try {
        const result = await request.afterUpsert.run();
        if (result?.success === false) {
          setAfterActionState('failed');
          setAfterActionMessage(result.message || '后续自动处理失败');
          return;
        }
        setAfterActionState('success');
        setAfterActionMessage(result?.message || request.afterUpsert.successText || null);
      } catch (error: any) {
        setAfterActionState('failed');
        setAfterActionMessage(error?.message || '后续自动处理失败');
      }
    },
    onError: (error) => {
      setSubmitError(String(error));
    },
  });
  const isBusy = mutation.isPending || afterActionState === 'pending';

  const handleSubmit = () => {
    setSubmitError(null);
    mutation.mutate();
  };

  useEffect(() => {
    if (hasMultipleCandidates) return;
    if (!open || autoStarted || createdRecord || mutation.isPending || !selectedZone || !request?.value) return;
    setAutoStarted(true);
    handleSubmit();
  }, [open, autoStarted, createdRecord, mutation.isPending, selectedZone, request?.value, hasMultipleCandidates]);

  const handleDone = () => {
    if (isBusy) return;
    onClose(!!createdRecord);
  };

  return (
    <Dialog open={open} onClose={handleDone} maxWidth="sm" fullWidth disableEscapeKeyDown={isBusy}>
      <DialogTitle>{request?.title || '自动配置 DNS'}</DialogTitle>
      <DialogContent>
        <Stack spacing={2.5} sx={{ mt: 1 }}>
          {request?.description && <Alert severity="info">{request.description}</Alert>}

          {!createdRecord ? (
            <>
              <Stack spacing={1}>
                <Typography variant="caption" color="text.secondary">
                  {mutation.isPending ? '自动配置中' : (hasMultipleCandidates ? '检测到多个可用主域名，请选择后继续' : '即将自动创建记录')}
                </Typography>
                {hasMultipleCandidates && !createdRecord && (
                  <TextField
                    select
                    label="选择目标主域名"
                    value={selectedCandidateKey}
                    onChange={(e) => setSelectedCandidateKey(e.target.value)}
                    fullWidth
                    size="small"
                    disabled={isBusy}
                    helperText="当项目内命中多个主域名时，需要你确认具体落到哪一个账户/域名"
                  >
                    {candidateOptions.map((candidate) => (
                      <MenuItem key={candidate.key} value={candidate.key}>
                        {candidate.zone.credentialName || '-'} / {candidate.zone.name} / {PROVIDER_DISPLAY_NAME[candidate.zone.provider || ''] || candidate.zone.provider || 'DNS'}
                      </MenuItem>
                    ))}
                  </TextField>
                )}
                <Typography variant="body2">
                  目标账户：{selectedZone?.credentialName || '-'}（{PROVIDER_DISPLAY_NAME[selectedZone?.provider || ''] || selectedZone?.provider || 'DNS'}）
                </Typography>
                <Typography variant="body2">
                  目标主域名：{selectedZone?.name || '-'}
                </Typography>
                <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                  {request?.recordType || '-'} {relativeRecordName || '-'} → {request?.value || '-'}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  FQDN: {request?.fqdn || '-'}
                </Typography>
              </Stack>

              {mutation.isPending && (
                <Stack direction="row" spacing={1} alignItems="center">
                  <CircularProgress size={18} />
                  <Typography variant="body2" color="text.secondary">
                    正在自动{actionLabel === 'update' ? '更新' : '创建'} DNS 记录...
                  </Typography>
                </Stack>
              )}

              {!mutation.isPending && afterActionState === 'pending' && (
                <Stack direction="row" spacing={1} alignItems="center">
                  <CircularProgress size={18} />
                  <Typography variant="body2" color="text.secondary">
                    {request?.afterUpsert?.pendingText || '正在执行后续自动处理...'}
                  </Typography>
                </Stack>
              )}

              {submitError && <Alert severity="error">{submitError}</Alert>}
            </>
          ) : (
            <Stack spacing={1.5}>
              <Alert severity="success">
                <Stack spacing={0.75}>
                  <Typography variant="subtitle2">自动配置成功</Typography>
                  <Typography variant="body2">
                    本次操作：{actionLabel === 'update' ? '更新已有记录' : '新建记录'}
                  </Typography>
                  <Typography variant="body2">{createdRecord.type} {createdRecord.name}</Typography>
                  <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>{createdRecord.content}</Typography>
                </Stack>
              </Alert>

              {afterActionState === 'success' && afterActionMessage && (
                <Alert severity="success">{afterActionMessage}</Alert>
              )}

              {afterActionState === 'failed' && afterActionMessage && (
                <Alert severity="warning">{afterActionMessage}</Alert>
              )}

              {afterActionState === 'pending' && (
                <Alert severity="info">
                  {request?.afterUpsert?.pendingText || '正在执行后续自动处理...'}
                </Alert>
              )}
            </Stack>
          )}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 3 }}>
        <Button onClick={handleDone} color="inherit" disabled={isBusy}>
          {createdRecord ? '完成' : '取消'}
        </Button>
        {!createdRecord && hasMultipleCandidates && (
          <Button
            onClick={handleSubmit}
            variant="contained"
            disabled={isBusy || !selectedZone || !request?.value}
          >
            开始配置
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
