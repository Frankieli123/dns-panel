import { useEffect, useMemo, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  MenuItem,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { ContentCopy as CopyIcon } from '@mui/icons-material';
import type { DnsCredential } from '@/types/dns';
import { addZones, AddZoneResult } from '@/services/domains';

const PROVIDER_DISPLAY_NAME: Partial<Record<DnsCredential['provider'], string>> = {
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

const getProviderDisplayName = (provider?: DnsCredential['provider'], providerName?: string): string => {
  if (providerName) return String(providerName);
  if (!provider) return 'DNS';
  return PROVIDER_DISPLAY_NAME[provider] || provider;
};

function parseDomainsText(text: string): string[] {
  const parts = String(text || '').split(/[\s,;]+/g);
  const seen = new Set<string>();
  const out: string[] = [];

  for (const raw of parts) {
    let d = String(raw || '').trim();
    if (!d) continue;
    d = d.replace(/^https?:\/\//i, '');
    d = d.replace(/\/.*$/, '');
    d = d.replace(/\.$/, '');
    if (!d) continue;
    const key = d.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(d);
  }

  return out;
}

const statusLabel = (status?: string): string => {
  const s = String(status || '').trim().toLowerCase();
  if (!s) return '未知';
  if (s === 'active') return '已激活';
  if (s === 'pending' || s === 'initializing') return '待验证';
  if (s === 'moved') return '已迁出';
  return status || '未知';
};

const statusColor = (status?: string): 'default' | 'success' | 'warning' | 'error' => {
  const s = String(status || '').trim().toLowerCase();
  if (s === 'active') return 'success';
  if (s === 'pending' || s === 'initializing') return 'warning';
  if (s === 'moved') return 'error';
  return 'default';
};

export default function AddZoneDialog({
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
  const [credentialId, setCredentialId] = useState<number>(() => initialCredentialId ?? credentials[0]?.id ?? 0);
  const [domainsText, setDomainsText] = useState('');
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [results, setResults] = useState<AddZoneResult[] | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setCredentialId(initialCredentialId ?? credentials[0]?.id ?? 0);
    setDomainsText('');
    setSubmitError(null);
    setResults(null);
    setCopiedKey(null);
  }, [open, initialCredentialId, credentials]);

  const selectedCredential = useMemo(
    () => credentials.find(c => c.id === credentialId) || credentials[0],
    [credentials, credentialId]
  );

  const selectedProvider = selectedCredential?.provider || credentials[0]?.provider;
  const providerLabel = getProviderDisplayName(selectedProvider, selectedCredential?.providerName);
  const hasMultipleProviders = useMemo(() => new Set(credentials.map(c => c.provider)).size > 1, [credentials]);

  const parsedDomains = useMemo(() => parseDomainsText(domainsText), [domainsText]);

  const mutation = useMutation({
    mutationFn: ({ id, domains }: { id: number; domains: string[] }) => addZones(id, domains),
    onSuccess: (resp) => {
      setResults(resp.data?.results || []);
      setSubmitError(null);
    },
    onError: (err) => {
      setSubmitError(String(err));
    },
  });

  const canSubmit =
    !!selectedCredential &&
    parsedDomains.length > 0 &&
    !mutation.isPending;

  const hasSuccess = (results || []).some(r => r.success);

  const handleCopy = async (domain: string, text: string) => {
    const normalized = String(text || '').trim();
    if (!normalized) return;

    try {
      await navigator.clipboard.writeText(normalized);
      setCopiedKey(`${domain}:${normalized}`);
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
    if (parsedDomains.length === 0) {
      setSubmitError('请输入域名（每行一个）');
      return;
    }

    setSubmitError(null);
    mutation.mutate({ id: selectedCredential.id, domains: parsedDomains });
  };

  const handleDone = () => {
    if (mutation.isPending) return;
    onClose(hasSuccess);
  };

  return (
    <Dialog
      open={open}
      onClose={handleDone}
      maxWidth="md"
      fullWidth
      PaperProps={{ sx: { borderRadius: 2 } }}
    >
      <DialogTitle>添加域名到 {providerLabel}</DialogTitle>
      <DialogContent>
        <Stack spacing={2.5} sx={{ mt: 1 }}>
          <Alert severity="info">
            {selectedProvider === 'cloudflare'
              ? '每个账户最多可添加 50 个待验证域名'
              : '将调用提供商 API 添加域名；如返回 DNS 服务器，可直接复制用于设置 NS'}
          </Alert>

          <TextField
            select
            label="选择账户"
            value={selectedCredential?.id ?? ''}
            onChange={(e) => setCredentialId(parseInt(e.target.value, 10))}
            fullWidth
            size="small"
            disabled={mutation.isPending || credentials.length === 0}
            helperText={credentials.length === 0 ? '暂无可用账户，请先在设置中添加凭证' : undefined}
          >
            {credentials.map(c => (
              <MenuItem key={c.id} value={c.id}>
                {hasMultipleProviders ? `${c.name}（${getProviderDisplayName(c.provider, c.providerName)}）` : c.name}
              </MenuItem>
            ))}
          </TextField>

          <TextField
            label="域名列表（每行一个）"
            placeholder={'example.com\nexample.org'}
            value={domainsText}
            onChange={(e) => setDomainsText(e.target.value)}
            multiline
            minRows={6}
            fullWidth
            disabled={mutation.isPending}
            helperText={`将自动去重，共 ${parsedDomains.length} 个`}
          />

          {submitError && <Alert severity="error">{submitError}</Alert>}

          {mutation.isPending && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <CircularProgress size={18} />
              <Typography variant="body2" color="text.secondary">
                正在添加域名...
              </Typography>
            </Box>
          )}

          {results && (
            <>
              <Divider />
              <Stack direction="row" spacing={1} alignItems="center">
                <Typography variant="subtitle2">结果</Typography>
                <Chip size="small" label={`成功 ${(results || []).filter(r => r.success).length}`} color="success" />
                <Chip size="small" label={`失败 ${(results || []).filter(r => !r.success).length}`} color="error" />
              </Stack>

              <TableContainer component={Paper} variant="outlined" sx={{ borderRadius: 2 }}>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>域名</TableCell>
                      <TableCell>状态</TableCell>
                      <TableCell>{selectedProvider === 'cloudflare' ? 'Cloudflare DNS 服务器' : 'DNS 服务器'}</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {results.map((r) => {
                      const ok = r.success;
                      const zoneStatus = r.zone?.status;
                      const ns = r.nameServers || [];

                      return (
                        <TableRow key={r.domain}>
                          <TableCell sx={{ wordBreak: 'break-word' }}>
                            <Stack direction="row" spacing={1} alignItems="center">
                              <Typography variant="body2">{r.domain}</Typography>
                              {r.existed && <Chip size="small" label="已存在" variant="outlined" />}
                            </Stack>
                          </TableCell>
                          <TableCell>
                            <Chip
                              size="small"
                              label={ok ? statusLabel(zoneStatus) : '失败'}
                              color={ok ? statusColor(zoneStatus) : 'error'}
                              variant={ok ? 'filled' : 'outlined'}
                            />
                          </TableCell>
                          <TableCell sx={{ wordBreak: 'break-word' }}>
                            {ok ? (
                              ns.length > 0 ? (
                                <Stack spacing={0.25}>
                                  {ns.map((s) => (
                                    <Stack key={s} direction="row" spacing={0.5} alignItems="center">
                                      <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                                        {s}
                                      </Typography>
                                      <Tooltip title="复制">
                                        <IconButton size="small" onClick={() => handleCopy(r.domain, s)} sx={{ p: 0.25 }}>
                                          <CopyIcon fontSize="inherit" />
                                        </IconButton>
                                      </Tooltip>
                                      {copiedKey === `${r.domain}:${s}` && (
                                        <Typography variant="caption" color="success.main">
                                          已复制
                                        </Typography>
                                      )}
                                    </Stack>
                                  ))}
                                </Stack>
                              ) : (
                                <Typography variant="body2" color="text.secondary">-</Typography>
                              )
                            ) : (
                              <Typography variant="body2" color="error.main">{r.error || '添加失败'}</Typography>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </TableContainer>
            </>
          )}
        </Stack>
      </DialogContent>

      <DialogActions sx={{ px: 3, pb: 2, justifyContent: 'flex-end' }}>
        <Button variant="contained" onClick={handleSubmit} disabled={!canSubmit}>
          添加
        </Button>
        <Button onClick={handleDone} disabled={mutation.isPending} color="inherit">
          {results ? '完成' : '取消'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
