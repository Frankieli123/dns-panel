import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Button, Stack } from '@mui/material';
import { Add as AddIcon, Description as DraftIcon, Refresh as RefreshIcon } from '@mui/icons-material';
import { useProvider } from '@/contexts/ProviderContext';
import {
  createCertificateOrder,
  deleteCertificateOrder,
  downloadCertificateOrder,
  getCertificateCredentials,
  getCertificateOrders,
  retryCertificateOrder,
  toggleCertificateAutoRenew,
} from '@/services/certificates';
import { CertificateCredential, CertificateOrder } from '@/types/cert';
import ApplyCertificateDialog from './ApplyCertificateDialog';
import CertificateOrderDetailDialog from './CertificateOrderDetailDialog';
import CertificateSearchField from './CertificateSearchField';
import CertificateTable from './CertificateTable';
import { certificateToolbarSx } from './certificateTableStyles';
import { triggerDownload } from './certificateUtils';

export default function CertificateOrderSection() {
  const { credentials: dnsCredentials, isLoading: dnsLoading } = useProvider();
  const [orders, setOrders] = useState<CertificateOrder[]>([]);
  const [certificateCredentials, setCertificateCredentials] = useState<CertificateCredential[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [preferredMode, setPreferredMode] = useState<'draft' | 'apply'>('apply');
  const [submittingMode, setSubmittingMode] = useState<'draft' | 'apply' | null>(null);
  const [detailOrderId, setDetailOrderId] = useState<number | null>(null);
  const [retryingId, setRetryingId] = useState<number | null>(null);
  const [downloadingId, setDownloadingId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [togglingAutoRenewId, setTogglingAutoRenewId] = useState<number | null>(null);
  const [searchKeyword, setSearchKeyword] = useState('');

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const [ordersRes, credentialsRes] = await Promise.all([
        getCertificateOrders(),
        getCertificateCredentials(),
      ]);
      setOrders(ordersRes.data?.orders || []);
      setCertificateCredentials(credentialsRes.data?.credentials || []);
    } catch (err: any) {
      setError(typeof err === 'string' ? err : (err?.message || '加载证书订单失败'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const detailOrder = useMemo(
    () => orders.find((order) => order.id === detailOrderId) || null,
    [orders, detailOrderId]
  );
  const normalizedSearch = searchKeyword.trim().toLowerCase();
  const visibleOrders = useMemo(() => {
    if (!normalizedSearch) return orders;

    return orders.filter((order) =>
      [
        order.primaryDomain,
        ...(order.domains || []),
        order.certificateCredential?.name,
        order.certificateCredential?.email,
        order.dnsCredential?.name,
      ].some((value) => String(value || '').toLowerCase().includes(normalizedSearch))
    );
  }, [orders, normalizedSearch]);

  const openDialog = (mode: 'draft' | 'apply') => {
    setPreferredMode(mode);
    setDialogOpen(true);
  };

  const handleSubmit = async (mode: 'draft' | 'apply', payload: { certificateCredentialId: number; dnsCredentialId: number; domains: string[]; autoRenew: boolean }) => {
    try {
      setSubmittingMode(mode);
      await createCertificateOrder({ mode, ...payload });
      setDialogOpen(false);
      await loadData();
    } catch (err: any) {
      setError(typeof err === 'string' ? err : (err?.message || '提交失败'));
      throw err;
    } finally {
      setSubmittingMode(null);
    }
  };

  const handleRetry = async (order: CertificateOrder) => {
    try {
      setRetryingId(order.id);
      await retryCertificateOrder(order.id);
      await loadData();
    } catch (err: any) {
      setError(typeof err === 'string' ? err : (err?.message || '提交重试失败'));
    } finally {
      setRetryingId(null);
    }
  };

  const handleDownload = async (order: CertificateOrder) => {
    try {
      setDownloadingId(order.id);
      const blob = await downloadCertificateOrder(order.id);
      triggerDownload(blob, `certificate-${order.id}.zip`);
    } catch (err: any) {
      setError(typeof err === 'string' ? err : (err?.message || '下载证书失败'));
    } finally {
      setDownloadingId(null);
    }
  };

  const handleDelete = async (order: CertificateOrder) => {
    if ((order.deployJobsCount || 0) > 0) {
      setError('该订单已绑定部署任务，无法删除，请先删除/解绑部署任务');
      return;
    }

    const confirmed = window.confirm(`确定删除证书订单 #${order.id}（${order.primaryDomain}）吗？此操作不可恢复。`);
    if (!confirmed) return;

    try {
      setDeletingId(order.id);
      setError(null);
      await deleteCertificateOrder(order.id);
      if (detailOrderId === order.id) setDetailOrderId(null);
      await loadData();
    } catch (err: any) {
      setError(typeof err === 'string' ? err : (err?.message || '删除证书订单失败'));
    } finally {
      setDeletingId(null);
    }
  };

  const handleToggleAutoRenew = async (order: CertificateOrder, enabled: boolean) => {
    try {
      setTogglingAutoRenewId(order.id);
      setError(null);
      const response = await toggleCertificateAutoRenew(order.id, enabled);
      const updatedOrder = response.data?.order;
      if (updatedOrder) {
        setOrders((prev) => prev.map((item) => (item.id === order.id ? updatedOrder : item)));
      }
    } catch (err: any) {
      setError(typeof err === 'string' ? err : (err?.message || '设置自动续期失败'));
    } finally {
      setTogglingAutoRenewId(null);
    }
  };

  return (
    <>
      <Stack spacing={2}>
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          spacing={2}
          justifyContent="space-between"
          alignItems={{ xs: 'stretch', sm: 'center' }}
          sx={certificateToolbarSx}
        >
          <CertificateSearchField
            placeholder="搜索域名 / ACME / DNS..."
            value={searchKeyword}
            onChange={setSearchKeyword}
          />
          <Stack
            direction={{ xs: 'column', sm: 'row' }}
            spacing={1}
            alignItems={{ xs: 'stretch', sm: 'center' }}
            justifyContent={{ xs: 'stretch', sm: 'flex-end' }}
          >
            <Button startIcon={<RefreshIcon />} variant="outlined" onClick={loadData} disabled={loading} sx={{ whiteSpace: 'nowrap', flex: { xs: 1, sm: 'none' } }}>
              刷新列表
            </Button>
            <Button startIcon={<DraftIcon />} variant="outlined" onClick={() => openDialog('draft')} sx={{ whiteSpace: 'nowrap', flex: { xs: 1, sm: 'none' } }}>
              保存草稿
            </Button>
            <Button startIcon={<AddIcon />} variant="contained" onClick={() => openDialog('apply')} sx={{ whiteSpace: 'nowrap', flex: { xs: 1, sm: 'none' } }}>
              创建并申请
            </Button>
          </Stack>
        </Stack>

        {!loading && certificateCredentials.length === 0 ? (
          <Alert severity="warning">暂无 ACME 账户，请先切到“ACME账户”Tab 新增账户。</Alert>
        ) : null}
        {!dnsLoading && dnsCredentials.length === 0 ? (
          <Alert severity="warning">暂无 DNS 账户，请先到设置页添加 DNS 凭证。</Alert>
        ) : null}
        {error ? <Alert severity="error">{error}</Alert> : null}

        <CertificateTable
          orders={visibleOrders}
          loading={loading}
          error={null}
          retryingId={retryingId}
          downloadingId={downloadingId}
          deletingId={deletingId}
          togglingAutoRenewId={togglingAutoRenewId}
          emptyTitle={normalizedSearch ? '未找到匹配的证书订单' : '暂无证书订单'}
          emptyDescription={normalizedSearch ? '试试更换域名、账户名或 DNS 关键词。' : '可以先创建并申请，或先保存一份草稿。'}
          onView={(order) => setDetailOrderId(order.id)}
          onRetry={handleRetry}
          onDownload={handleDownload}
          onDelete={handleDelete}
          onToggleAutoRenew={handleToggleAutoRenew}
        />
      </Stack>

      <ApplyCertificateDialog
        open={dialogOpen}
        certificateCredentials={certificateCredentials}
        certificateCredentialsLoading={loading}
        dnsCredentials={dnsCredentials}
        dnsLoading={dnsLoading}
        submittingMode={submittingMode}
        preferredMode={preferredMode}
        onClose={() => {
          if (submittingMode) return;
          setDialogOpen(false);
        }}
        onSubmit={handleSubmit}
      />

      <CertificateOrderDetailDialog
        open={!!detailOrder}
        order={detailOrder}
        onClose={() => setDetailOrderId(null)}
      />
    </>
  );
}
