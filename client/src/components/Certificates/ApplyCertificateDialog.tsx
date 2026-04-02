import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  MenuItem,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material';
import { DnsCredential } from '@/types/dns';
import { CertificateCredential, getAcmeProviderLabel, getDnsProviderLabel } from '@/types/cert';
import { certificateDialogActionsSx, certificateDialogContentSx, certificateDialogTitleSx } from './certificateTableStyles';
import { parseDomains } from './certificateUtils';

export default function ApplyCertificateDialog({
  open,
  certificateCredentials,
  certificateCredentialsLoading,
  dnsCredentials,
  dnsLoading,
  submittingMode,
  preferredMode,
  onClose,
  onSubmit,
}: {
  open: boolean;
  certificateCredentials: CertificateCredential[];
  certificateCredentialsLoading: boolean;
  dnsCredentials: DnsCredential[];
  dnsLoading: boolean;
  submittingMode: 'draft' | 'apply' | null;
  preferredMode: 'draft' | 'apply';
  onClose: () => void;
  onSubmit: (mode: 'draft' | 'apply', payload: { certificateCredentialId: number; dnsCredentialId: number; domains: string[]; autoRenew: boolean }) => Promise<void>;
}) {
  const [certificateCredentialId, setCertificateCredentialId] = useState<number>(0);
  const [dnsCredentialId, setDnsCredentialId] = useState<number>(0);
  const [domainsText, setDomainsText] = useState('');
  const [autoRenew, setAutoRenew] = useState(true);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setCertificateCredentialId(certificateCredentials[0]?.id || 0);
    setDnsCredentialId(dnsCredentials[0]?.id || 0);
    setDomainsText('');
    setAutoRenew(true);
    setSubmitError(null);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    if (!certificateCredentialId && certificateCredentials.length > 0) {
      setCertificateCredentialId(certificateCredentials[0].id);
    }
  }, [open, certificateCredentialId, certificateCredentials]);

  useEffect(() => {
    if (!open) return;
    if (!dnsCredentialId && dnsCredentials.length > 0) {
      setDnsCredentialId(dnsCredentials[0].id);
    }
  }, [open, dnsCredentialId, dnsCredentials]);

  const parsedDomains = useMemo(() => parseDomains(domainsText), [domainsText]);
  const submitting = submittingMode !== null;
  const canSubmit = !!certificateCredentialId && !!dnsCredentialId && parsedDomains.length > 0 && !submitting;

  const handleAction = async (mode: 'draft' | 'apply') => {
    if (!certificateCredentialId) {
      setSubmitError('请选择 ACME 账户');
      return;
    }
    if (!dnsCredentialId) {
      setSubmitError('请选择 DNS 账户');
      return;
    }
    if (parsedDomains.length === 0) {
      setSubmitError('请至少填写一个域名');
      return;
    }

    try {
      setSubmitError(null);
      await onSubmit(mode, {
        certificateCredentialId,
        dnsCredentialId,
        domains: parsedDomains,
        autoRenew,
      });
    } catch (error: any) {
      setSubmitError(typeof error === 'string' ? error : (error?.message || '提交失败'));
    }
  };

  return (
    <Dialog open={open} onClose={submitting ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={certificateDialogTitleSx}>申请证书</DialogTitle>
      <DialogContent sx={certificateDialogContentSx}>
        <Stack spacing={1.5}>
          {!certificateCredentialsLoading && certificateCredentials.length === 0 ? (
            <Alert severity="warning">暂无可用 ACME 账户，请先切换到“ACME账户”Tab 新增。</Alert>
          ) : null}

          {!dnsLoading && dnsCredentials.length === 0 ? (
            <Alert severity="warning">暂无可用 DNS 账户，请先到设置页添加 DNS 凭证。</Alert>
          ) : null}

          <TextField
            select
            label="ACME账户"
            value={certificateCredentialId || ''}
            onChange={(event) => setCertificateCredentialId(parseInt(event.target.value, 10))}
            disabled={submitting || certificateCredentialsLoading || certificateCredentials.length === 0}
            fullWidth
            size="small"
            helperText={certificateCredentialsLoading ? '正在加载 ACME 账户...' : undefined}
          >
            {certificateCredentials.map((credential) => (
              <MenuItem key={credential.id} value={credential.id}>
                {credential.name}（{getAcmeProviderLabel(credential.provider)}）
              </MenuItem>
            ))}
          </TextField>

          <TextField
            select
            label="DNS账户"
            value={dnsCredentialId || ''}
            onChange={(event) => setDnsCredentialId(parseInt(event.target.value, 10))}
            disabled={submitting || dnsLoading || dnsCredentials.length === 0}
            fullWidth
            size="small"
            helperText={dnsLoading ? '正在加载 DNS 账户...' : undefined}
          >
            {dnsCredentials.map((credential) => (
              <MenuItem key={credential.id} value={credential.id}>
                {credential.name}（{getDnsProviderLabel(credential.provider)}）
              </MenuItem>
            ))}
          </TextField>

          <TextField
            label="域名列表"
            value={domainsText}
            onChange={(event) => setDomainsText(event.target.value)}
            placeholder={'example.com\nwww.example.com\n*.example.com'}
            multiline
            minRows={4}
            fullWidth
            disabled={submitting}
            helperText={`支持空格/逗号/换行分隔，已去重 ${parsedDomains.length} 个`}
          />

          {parsedDomains.length > 0 ? (
            <Stack spacing={0.25}>
              <Typography variant="body2" color="text.secondary">
                本次将申请以下域名：
              </Typography>
              <Typography variant="body2">{parsedDomains.join(', ')}</Typography>
            </Stack>
          ) : null}

          <FormControlLabel
            control={<Switch checked={autoRenew} onChange={(event) => setAutoRenew(event.target.checked)} disabled={submitting} />}
            label="自动续期"
          />

          {submitError ? <Alert severity="error">{submitError}</Alert> : null}
        </Stack>
      </DialogContent>
      <DialogActions sx={certificateDialogActionsSx}>
        <Button onClick={onClose} disabled={submitting} color="inherit">
          取消
        </Button>
        <Button
          variant={preferredMode === 'draft' ? 'contained' : 'outlined'}
          onClick={() => handleAction('draft')}
          disabled={!canSubmit}
        >
          {submittingMode === 'draft' ? '保存中...' : '保存草稿'}
        </Button>
        <Button
          variant={preferredMode === 'apply' ? 'contained' : 'outlined'}
          onClick={() => handleAction('apply')}
          disabled={!canSubmit}
        >
          {submittingMode === 'apply' ? '申请中...' : '创建并申请'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
