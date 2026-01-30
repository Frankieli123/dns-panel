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
import { ContentCopy as CopyIcon } from '@mui/icons-material';
import type { DnsCredential } from '@/types/dns';
import { addZones, AddZoneResult } from '@/services/domains';

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
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));

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
    !!String(selectedCredential.accountId || '').trim() &&
    parsedDomains.length > 0 &&
    !mutation.isPending;

  const hasSuccess = (results || []).some(r => r.success);

  const handleCopy = async (r: AddZoneResult) => {
    const ns = r.nameServers || [];
    const text = ns.join('\n').trim();
    if (!text) return;

    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(r.domain);
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
    if (!String(selectedCredential.accountId || '').trim()) {
      setSubmitError('该账户未配置 Account ID，无法添加域名');
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
    <Dialog open={open} onClose={handleDone} maxWidth="md" fullWidth fullScreen={isMobile}>
      <DialogTitle>添加域名（Cloudflare）</DialogTitle>
      <DialogContent>
        <Stack spacing={2.5} sx={{ mt: 1 }}>
          <Alert severity="info">
            Cloudflare 限制：全局 API 1,200 次/5 分钟/用户；且每个账户最多 50 个待验证（pending）域名，超出会返回 429。
          </Alert>

          <TextField
            select
            label="选择账户"
            value={selectedCredential?.id ?? ''}
            onChange={(e) => setCredentialId(parseInt(e.target.value, 10))}
            fullWidth
            size="small"
            disabled={mutation.isPending || credentials.length === 0}
            helperText={credentials.length === 0 ? '暂无可用账户，请先在设置中添加 Cloudflare 凭证' : undefined}
          >
            {credentials.map(c => (
              <MenuItem key={c.id} value={c.id}>
                {c.name}
              </MenuItem>
            ))}
          </TextField>

          {selectedCredential && !String(selectedCredential.accountId || '').trim() && (
            <Alert severity="warning">
              当前账户未配置 Account ID，无法添加域名。请到「设置 → DNS 账户/凭证」为该 Cloudflare 账户补充 Account ID。
            </Alert>
          )}

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

              <Table size="small" sx={{ tableLayout: 'fixed' }}>
                <TableHead>
                  <TableRow>
                    <TableCell width="28%">域名</TableCell>
                    <TableCell width="16%">状态</TableCell>
                    <TableCell>Cloudflare DNS 服务器</TableCell>
                    <TableCell width={64} align="right">复制</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {results.map((r) => {
                    const ok = r.success;
                    const zoneStatus = r.zone?.status;
                    const ns = r.nameServers || [];
                    const canCopy = ok && ns.length > 0;

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
                                  <Typography key={s} variant="body2" sx={{ fontFamily: 'monospace' }}>
                                    {s}
                                  </Typography>
                                ))}
                                {copiedKey === r.domain && (
                                  <Typography variant="caption" color="success.main">
                                    已复制
                                  </Typography>
                                )}
                              </Stack>
                            ) : (
                              <Typography variant="body2" color="text.secondary">-</Typography>
                            )
                          ) : (
                            <Typography variant="body2" color="error.main">{r.error || '添加失败'}</Typography>
                          )}
                        </TableCell>
                        <TableCell align="right">
                          <Tooltip title={canCopy ? '复制 nameservers' : '无可复制内容'}>
                            <span>
                              <IconButton
                                size="small"
                                onClick={() => handleCopy(r)}
                                disabled={!canCopy}
                              >
                                <CopyIcon fontSize="small" />
                              </IconButton>
                            </span>
                          </Tooltip>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </>
          )}
        </Stack>
      </DialogContent>

      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={handleDone} disabled={mutation.isPending}>
          完成
        </Button>
        <Box sx={{ flex: 1 }} />
        <Button variant="contained" onClick={handleSubmit} disabled={!canSubmit}>
          添加
        </Button>
      </DialogActions>
    </Dialog>
  );
}

