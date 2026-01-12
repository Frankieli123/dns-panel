import { useState, useEffect } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Box,
  Typography,
  Card,
  CardContent,
  CircularProgress,
  Alert,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Stack,
  TextField,
  InputAdornment,
  useTheme,
  useMediaQuery,
  IconButton,
} from '@mui/material';
import {
  Add as AddIcon,
  Dns as DnsIcon,
  Language as LanguageIcon,
  Search as SearchIcon,
  ArrowBack as ArrowBackIcon,
} from '@mui/icons-material';
import { getDNSRecords, createDNSRecord, updateDNSRecord, deleteDNSRecord, getDNSLines, getDNSMinTTL, setDNSRecordStatus } from '@/services/dns';
import { getDomainById } from '@/services/domains';
import DNSRecordTable from '@/components/DNSRecordTable/DNSRecordTable';
import QuickAddForm from '@/components/QuickAddForm/QuickAddForm';
import { useProvider } from '@/contexts/ProviderContext';
import { useBreadcrumb } from '@/contexts/BreadcrumbContext';

/**
 * 域名详情页面 - DNS 记录管理
 */
export default function DomainDetail() {
  const { zoneId } = useParams<{ zoneId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const queryClient = useQueryClient();
  const { setLabel } = useBreadcrumb();
  const [showQuickAdd, setShowQuickAdd] = useState(false);
  const [searchKeyword, setSearchKeyword] = useState('');

  const { selectedCredentialId, selectedProvider, credentials, getProviderCapabilities } = useProvider();
  const credParam = new URLSearchParams(location.search).get('credentialId');
  const parsedCredId = credParam ? parseInt(credParam, 10) : undefined;
  const credFromQuery = typeof parsedCredId === 'number' && Number.isFinite(parsedCredId)
    ? parsedCredId
    : undefined;
  const credentialId = typeof credFromQuery === 'number'
    ? credFromQuery
    : (typeof selectedCredentialId === 'number' ? selectedCredentialId : undefined);
  const missingCredentialContext = selectedCredentialId === 'all' && typeof credFromQuery !== 'number';
  const queriesEnabled = !!zoneId && !missingCredentialContext;
  const credentialProvider = (credentialId
    ? credentials.find(c => c.id === credentialId)?.provider
    : selectedProvider) ?? undefined;
  const capabilities = getProviderCapabilities(credentialProvider);
  const supportsCustomHostnames = credentialProvider === 'cloudflare';
  const supportsLine = capabilities?.supportsLine ?? false;
  const supportsStatus = capabilities?.supportsStatus ?? false;

  // 获取域名信息
  const { data: domainData } = useQuery({
    queryKey: ['domain', zoneId, credentialId],
    queryFn: () => getDomainById(zoneId!, credentialId),
    enabled: queriesEnabled,
  });

  useEffect(() => {
    if (domainData?.data?.domain?.name && zoneId) {
      setLabel(zoneId, domainData.data.domain.name);
    }
  }, [domainData, zoneId, setLabel]);

  // 获取DNS记录
  const { data, isLoading, error } = useQuery({
    queryKey: ['dns-records', zoneId, credentialId],
    queryFn: () => getDNSRecords(zoneId!, credentialId),
    enabled: queriesEnabled,
  });

  // 获取线路列表
  const { data: linesData } = useQuery({
    queryKey: ['dns-lines', zoneId, credentialId],
    queryFn: () => getDNSLines(zoneId!, credentialId),
    enabled: queriesEnabled && supportsLine,
  });

  const { data: minTtlData } = useQuery({
    queryKey: ['dns-min-ttl', zoneId, credentialId],
    queryFn: () => getDNSMinTTL(zoneId!, credentialId),
    enabled: queriesEnabled,
  });

  const createMutation = useMutation({
    mutationFn: (params: any) => createDNSRecord(zoneId!, params, credentialId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dns-records', zoneId, credentialId] });
      setShowQuickAdd(false);
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ recordId, params }: any) => updateDNSRecord(zoneId!, recordId, params, credentialId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dns-records', zoneId, credentialId] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (recordId: string) => deleteDNSRecord(zoneId!, recordId, credentialId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dns-records', zoneId, credentialId] });
    },
  });

  const statusMutation = useMutation({
    mutationFn: ({ recordId, enabled }: { recordId: string; enabled: boolean }) =>
      setDNSRecordStatus(zoneId!, recordId, enabled, credentialId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dns-records', zoneId, credentialId] });
    },
  });

  if (missingCredentialContext) {
    return (
      <Alert severity="warning" sx={{ mt: 2 }}>
        请从域名列表进入该页面，或在地址栏携带 credentialId 参数（例如：?credentialId=123）。
      </Alert>
    );
  }

  if (isLoading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '50vh' }}>
        <CircularProgress />
      </Box>
    );
  }

  if (error) {
    return (
      <Alert severity="error" sx={{ mt: 2 }}>
        {(error as any)?.message || String(error)}
      </Alert>
    );
  }

  const records = data?.data?.records || [];
  const lines = linesData?.data?.lines || [];
  const minTTL = minTtlData?.data?.minTTL;
  const domainName = domainData?.data?.domain?.name || 'DNS 记录';

  const filteredRecords = searchKeyword.trim()
    ? records.filter((r: any) => {
        const keyword = searchKeyword.toLowerCase();
        return (
          r.name?.toLowerCase().includes(keyword) ||
          r.content?.toLowerCase().includes(keyword) ||
          r.type?.toLowerCase().includes(keyword)
        );
      })
    : records;

  return (
    <Box>
      {/* 移动端顶部标题栏 */}
      {isMobile && (
        <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 2 }}>
          <IconButton 
            edge="start" 
            onClick={() => navigate(-1)}
            aria-label="back"
          >
            <ArrowBackIcon />
          </IconButton>
          <Typography variant="h6" fontWeight="bold">
            {domainName}
          </Typography>
        </Stack>
      )}

      {/* 顶部操作栏 */}
      <Box sx={{ mb: 2 }}>
        <Stack 
          direction={{ xs: 'column', sm: 'row' }} 
          justifyContent="space-between" 
          alignItems={{ xs: 'stretch', sm: 'center' }}
          spacing={2}
        >
          <TextField
            size="small"
            placeholder="搜索记录..."
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
            {supportsCustomHostnames && (
              <Button
                variant="outlined"
                startIcon={<LanguageIcon />}
                onClick={() => {
                  navigate(credentialId ? `/hostnames/${zoneId}?credentialId=${credentialId}` : `/hostnames/${zoneId}`);
                }}
                sx={{ px: 3, flex: { xs: 1, sm: 'none' } }}
              >
                主机名
              </Button>
            )}
            <Button
              variant="contained"
              startIcon={<AddIcon />}
              onClick={() => setShowQuickAdd(true)}
              sx={{ px: 3, flex: { xs: 1, sm: 'none' } }}
            >
              添加记录
            </Button>
          </Stack>
        </Stack>
      </Box>
      <Card sx={{ 
        border: 'none', 
        boxShadow: isMobile ? 'none' : '0 4px 20px rgba(0,0,0,0.05)',
        bgcolor: isMobile ? 'transparent' : 'background.paper' 
      }}>
        <CardContent sx={{ p: isMobile ? 0 : 0 }}>
          <DNSRecordTable
            records={filteredRecords}
            lines={lines}
            minTTL={minTTL}
            stickyBodyBgColor="#ffffff"
            providerType={credentialProvider}
            onUpdate={(recordId, params) => updateMutation.mutate({ recordId, params })}
            onDelete={(recordId) => {
              if (window.confirm('确定要删除这条 DNS 记录吗？')) {
                deleteMutation.mutate(recordId);
              }
            }}
            onStatusChange={supportsStatus ? (recordId, enabled) => statusMutation.mutate({ recordId, enabled }) : undefined}
          />
        </CardContent>
      </Card>

      {/* 快速添加对话框 */}
      <Dialog 
        open={showQuickAdd} 
        onClose={() => setShowQuickAdd(false)} 
        maxWidth="md" 
        fullWidth
        PaperProps={{
          sx: { borderRadius: 2 }
        }}
      >
        <DialogTitle sx={{ borderBottom: 1, borderColor: 'divider', pb: 2 }}>
          <Stack direction="row" alignItems="center" spacing={1}>
            <DnsIcon color="primary" />
            <Typography variant="h6" fontWeight="bold">添加 DNS 记录</Typography>
          </Stack>
        </DialogTitle>
        <DialogContent sx={{ mt: 2 }}>
          <QuickAddForm
            onSubmit={(params) => createMutation.mutate(params)}
            loading={createMutation.isPending}
            lines={lines}
            minTTL={minTTL}
            providerType={credentialProvider}
          />
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 3 }}>
          <Button onClick={() => setShowQuickAdd(false)} color="inherit">取消</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
