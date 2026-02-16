import { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Box,
  Typography,
  CircularProgress,
  Alert,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Stack,
  Tabs,
  Tab,
  useTheme,
  useMediaQuery,
} from '@mui/material';
import { 
  Add as AddIcon, 
  Dns as DnsIcon,
  Settings as SettingsIcon,
  Refresh as RefreshIcon
} from '@mui/icons-material';
import { getDNSRecords, createDNSRecord, updateDNSRecord, deleteDNSRecord, getDNSLines, getDNSMinTTL, setDNSRecordStatus, refreshDNSRecords } from '@/services/dns';
import DNSRecordTable from '@/components/DNSRecordTable/DNSRecordTable';
import QuickAddForm from '@/components/QuickAddForm/QuickAddForm';
import CustomHostnameList, { CustomHostnameListRef } from '@/components/CustomHostnameList/CustomHostnameList';
import { useProvider } from '@/contexts/ProviderContext';

interface DnsManagementProps {
  zoneId: string;
  credentialId?: number;
}

/**
 * Component for managing DNS records and Custom Hostnames for a specific domain.
 * Designed to be used within an expandable row in the Dashboard.
 */
export default function DnsManagement({ zoneId, credentialId }: DnsManagementProps) {
  const [activeTab, setActiveTab] = useState(0);
  const { selectedProvider, credentials, getProviderCapabilities } = useProvider();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));

  const credentialProvider = (typeof credentialId === 'number'
    ? credentials.find(c => c.id === credentialId)?.provider
    : selectedProvider) ?? undefined;
  const capabilities = getProviderCapabilities(credentialProvider);
  const supportsCustomHostnames = credentialProvider === 'cloudflare';
  const supportsLine = capabilities?.supportsLine ?? false;
  const supportsStatus = capabilities?.supportsStatus ?? false;
  const customHostnameListRef = useRef<CustomHostnameListRef>(null);

  const queryClient = useQueryClient();
  const [showQuickAdd, setShowQuickAdd] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);

  const {
    data,
    isLoading,
    isFetching: isRecordsFetching,
    error,
    refetch: refetchRecords,
  } = useQuery({
    queryKey: ['dns-records', zoneId, credentialId],
    queryFn: () => getDNSRecords(zoneId, credentialId),
    enabled: !!zoneId,
  });

  // 获取线路列表
  const { data: linesData, refetch: refetchLines } = useQuery({
    queryKey: ['dns-lines', zoneId, credentialId],
    queryFn: () => getDNSLines(zoneId, credentialId),
    enabled: !!zoneId && supportsLine,
  });

  const { data: minTtlData, refetch: refetchMinTtl } = useQuery({
    queryKey: ['dns-min-ttl', zoneId, credentialId],
    queryFn: () => getDNSMinTTL(zoneId, credentialId),
    enabled: !!zoneId,
  });

  const handleRefresh = async () => {
    if (!zoneId || isRefreshing) return;
    setIsRefreshing(true);
    setRefreshError(null);
    try {
      try {
        await refreshDNSRecords(zoneId, credentialId);
      } catch (err) {
        setRefreshError(String((err as any)?.message || err));
      }

      await Promise.all([
        refetchRecords(),
        supportsLine ? refetchLines() : Promise.resolve(),
        refetchMinTtl(),
      ]);
    } finally {
      setIsRefreshing(false);
    }
  };

  const createMutation = useMutation({
    mutationFn: (params: any) => createDNSRecord(zoneId, params, credentialId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dns-records', zoneId, credentialId] });
      setShowQuickAdd(false);
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ recordId, params }: { recordId: string, params: any }) => updateDNSRecord(zoneId, recordId, params, credentialId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dns-records', zoneId, credentialId] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (recordId: string) => deleteDNSRecord(zoneId, recordId, credentialId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dns-records', zoneId, credentialId] });
    },
  });

  const statusMutation = useMutation({
    mutationFn: ({ recordId, enabled }: { recordId: string; enabled: boolean }) =>
      setDNSRecordStatus(zoneId, recordId, enabled, credentialId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dns-records', zoneId, credentialId] });
    },
  });

  useEffect(() => {
    if (!supportsCustomHostnames && activeTab !== 0) {
      setActiveTab(0);
    }
  }, [supportsCustomHostnames, activeTab]);

  const handleTabChange = (_event: React.SyntheticEvent, newValue: number) => {
    setActiveTab(newValue);
  };

  const records = data?.data?.records || [];
  const lines = linesData?.data?.lines || [];
  const minTTL = minTtlData?.data?.minTTL;

  return (
    <Box sx={{ py: { xs: 1, sm: 2 }, px: { xs: 2, sm: 6 }, bgcolor: 'background.default', width: '100%', maxWidth: '100%', overflow: 'hidden' }}>
      <Stack 
        direction={{ xs: 'column', sm: 'row' }} 
        justifyContent="space-between" 
        alignItems={{ xs: 'stretch', sm: 'center' }} 
        spacing={{ xs: 2, sm: 0 }}
        sx={{ borderBottom: 1, borderColor: 'divider', mb: 2 }}
      >
        <Tabs value={activeTab} onChange={handleTabChange} sx={{ borderBottom: 0, minHeight: { xs: 40, sm: 48 } }}>
          <Tab label="DNS 记录" sx={{ minHeight: { xs: 40, sm: 48 }, py: 1 }} />
          {supportsCustomHostnames && <Tab label="自定义主机名" sx={{ minHeight: { xs: 40, sm: 48 }, py: 1 }} />}
        </Tabs>
        
        <Box sx={{ mb: 1, mr: { xs: 0, sm: 1 }, flexShrink: 0 }}>
          {activeTab === 0 && (
            <Stack direction="row" spacing={1} sx={{ width: '100%' }}>
              <Button
                variant="contained"
                size="small"
                startIcon={<AddIcon />}
                onClick={() => setShowQuickAdd(true)}
                sx={{ flex: { xs: 1, sm: 'none' } }}
              >
                添加记录
              </Button>
              <Button
                variant="outlined"
                size="small"
                startIcon={<RefreshIcon />}
                onClick={handleRefresh}
                disabled={isLoading || isRecordsFetching || isRefreshing}
                sx={{ flex: { xs: 1, sm: 'none' } }}
              >
                {isRefreshing ? '刷新中...' : '刷新'}
              </Button>
            </Stack>
          )}
          {activeTab === 1 && supportsCustomHostnames && (
             <Stack direction="row" spacing={1} sx={{ width: '100%' }}>
              <Button
                variant="outlined"
                size="small"
                startIcon={<SettingsIcon />}
                onClick={() => customHostnameListRef.current?.openFallbackDialog()}
                sx={{ flex: { xs: 1, sm: 'none' } }}
              >
                回退源
              </Button>
              <Button
                variant="contained"
                size="small"
                startIcon={<AddIcon />}
                onClick={() => customHostnameListRef.current?.openAddDialog()}
                sx={{ flex: { xs: 1, sm: 'none' } }}
              >
                添加主机名
              </Button>
            </Stack>
          )}
        </Box>
      </Stack>

      {activeTab === 0 && (
        <>
          {refreshError && (
            <Alert severity="warning" sx={{ m: 2 }} onClose={() => setRefreshError(null)}>
              {refreshError}
            </Alert>
          )}
          {isLoading ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', p: 3 }}>
              <CircularProgress size={24} />
            </Box>
          ) : error ? (
             <Alert severity="error" sx={{ m: 2 }}>
              {(error as any)?.message || String(error)}
            </Alert>
          ) : (
            <DNSRecordTable
              records={records}
              lines={lines}
              minTTL={minTTL}
              providerType={credentialProvider}
              onUpdate={(recordId, params) => updateMutation.mutate({ recordId, params })}
              onDelete={(recordId) => {
                if (window.confirm('确定要删除这条 DNS 记录吗？')) {
                  deleteMutation.mutate(recordId);
                }
              }}
              onStatusChange={supportsStatus ? (recordId, enabled) => statusMutation.mutate({ recordId, enabled }) : undefined}
            />
          )}

          {/* 快速添加对话框 */}
          <Dialog 
            open={showQuickAdd} 
            onClose={() => setShowQuickAdd(false)} 
            maxWidth="md" 
            fullWidth
            fullScreen={isMobile}
            PaperProps={{
              sx: { borderRadius: isMobile ? 0 : 2 }
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
        </>
      )}
      {supportsCustomHostnames && activeTab === 1 && (
        <CustomHostnameList ref={customHostnameListRef} zoneId={zoneId} credentialId={credentialId} />
      )}
    </Box>
  );
}
