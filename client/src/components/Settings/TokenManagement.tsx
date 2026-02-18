import { useState } from 'react';
import {
  Box,
  Card,
  CardHeader,
  CardContent,
  Divider,
  Typography,
  Button,
  Grid,
  IconButton,
  Chip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Alert,
  Stack,
  CircularProgress,
  Tooltip
} from '@mui/material';
import {
  Key as KeyIcon,
  Add as AddIcon,
  Edit as EditIcon,
  Delete as DeleteIcon,
  CheckCircle as CheckCircleIcon,
  Warning as WarningIcon,
} from '@mui/icons-material';
import { useForm } from 'react-hook-form';
import { useAccount } from '@/contexts/AccountContext';
import { createCredential, updateCredential, deleteCredential, verifyCredential } from '@/services/credentials';
import { CfCredential } from '@/types';

interface TokenFormInputs {
  name: string;
  apiToken: string;
}

export default function TokenManagement() {
  const { accounts, isLoading: isAccountsLoading, refreshAccounts } = useAccount();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingCredential, setEditingCredential] = useState<CfCredential | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [credentialToDelete, setCredentialToDelete] = useState<CfCredential | null>(null);

  const [verifying, setVerifying] = useState(false);
  const [verifyResult, setVerifyResult] = useState<{ valid: boolean; message?: string } | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    watch,
    formState: { errors, isSubmitting }
  } = useForm<TokenFormInputs>();

  const apiTokenValue = watch('apiToken');

  // 打开新增对话框
  const handleOpenAdd = () => {
    setEditingCredential(null);
    setVerifyResult(null);
    setSubmitError(null);
    reset({ name: '', apiToken: '' });
    setDialogOpen(true);
  };

  // 打开编辑对话框
  const handleOpenEdit = (credential: CfCredential) => {
    setEditingCredential(credential);
    setVerifyResult(null);
    setSubmitError(null);
    reset({ name: credential.name, apiToken: '' });
    setDialogOpen(true);
  };

  // 关闭对话框
  const handleCloseDialog = () => {
    setDialogOpen(false);
    setEditingCredential(null);
  };

  // 验证 Token
  const handleVerifyToken = async () => {
    // 如果是编辑模式且未修改 Token，验证现有 Token
    if (editingCredential && !apiTokenValue) {
      setVerifying(true);
      try {
        const res = await verifyCredential(editingCredential.id);
        setVerifyResult({
          valid: res.data?.valid || false,
          message: res.data?.valid ? 'Token 有效' : (res.data?.error || 'Token 无效')
        });
      } catch (error: any) {
        setVerifyResult({ valid: false, message: error.message });
      } finally {
        setVerifying(false);
      }
      return;
    }

    // 对于新输入的 Token，进行简单的客户端校验
    if (!apiTokenValue) return;

    if (apiTokenValue.length < 30) {
      setVerifyResult({ valid: false, message: 'Token 格式似乎不正确 (长度过短)' });
    } else {
      setVerifyResult({ valid: true, message: '格式校验通过，保存时将进行连接测试' });
    }
  };

  // 提交表单
  const onSubmit = async (data: TokenFormInputs) => {
    try {
      setSubmitError(null);

      if (editingCredential) {
        const updateData: any = { name: data.name };
        if (data.apiToken) {
          updateData.apiToken = data.apiToken;
        }
        await updateCredential(editingCredential.id, updateData);
      } else {
        await createCredential({
          name: data.name,
          apiToken: data.apiToken
        });
      }

      await refreshAccounts();
      handleCloseDialog();
    } catch (error: any) {
      if (typeof error === 'string') {
        setSubmitError(error);
      } else {
        setSubmitError(error?.message || '操作失败');
      }
    }
  };

  // 删除账户确认
  const handleDeleteClick = (credential: CfCredential) => {
    setCredentialToDelete(credential);
    setDeleteDialogOpen(true);
  };

  // 执行删除
  const handleDeleteConfirm = async () => {
    if (!credentialToDelete) return;
    try {
      await deleteCredential(credentialToDelete.id);
      await refreshAccounts();
      setDeleteDialogOpen(false);
      setCredentialToDelete(null);
    } catch (error: any) {
      console.error('删除失败', error);
    }
  };

  return (
    <Card sx={{ height: '100%', boxShadow: '0 4px 20px rgba(0,0,0,0.05)', border: 'none' }}>
      <CardHeader
        avatar={<KeyIcon color="primary" />}
        title={<Typography variant="h6" fontWeight="bold">多账户管理</Typography>}
        subheader="管理您的 Cloudflare 账户凭证"
        action={
          <Button
            variant="contained"
            size="small"
            startIcon={<AddIcon />}
            onClick={handleOpenAdd}
          >
            新增账户
          </Button>
        }
      />
      <Divider />
      <CardContent>
        {isAccountsLoading ? (
          <Box display="flex" justifyContent="center" p={3}>
            <CircularProgress />
          </Box>
        ) : (
          <Grid container spacing={2}>
            {accounts.map((account) => (
              <Grid item xs={12} key={account.id}>
                <Card variant="outlined" sx={{
                  display: 'flex',
                  alignItems: 'center',
                  p: 2
                }}>
                  <Box sx={{ flexGrow: 1 }}>
                    <Typography variant="subtitle1" fontWeight="bold" mb={0.5}>
                      {account.name}
                    </Typography>
                    <Typography variant="body2" color="text.secondary" sx={{ fontFamily: 'monospace' }}>
                      Token: •••• •••• •••• {account.id ? '****' : ''}
                    </Typography>
                  </Box>

                  <Stack direction="row" spacing={1}>
                    <Tooltip title="编辑">
                      <IconButton size="small" onClick={() => handleOpenEdit(account)}>
                        <EditIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>

                    <Tooltip title="删除">
                      <span>
                        <IconButton
                          size="small"
                          color="error"
                          onClick={() => handleDeleteClick(account)}
                        >
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      </span>
                    </Tooltip>
                  </Stack>
                </Card>
              </Grid>
            ))}
          </Grid>
        )}
      </CardContent>

      <Dialog open={dialogOpen} onClose={handleCloseDialog} maxWidth="sm" fullWidth>
        <DialogTitle>{editingCredential ? '编辑账户' : '新增账户'}</DialogTitle>
        <form onSubmit={handleSubmit(onSubmit)}>
          <DialogContent>
            <Stack spacing={3}>
              {submitError && (
                <Alert severity="error">{submitError}</Alert>
              )}

              <TextField
                label="账户别名"
                fullWidth
                placeholder="例如：个人账户、公司账户"
                {...register('name', { required: '请输入账户别名' })}
                error={!!errors.name}
                helperText={errors.name?.message}
              />

              <Box>
                <TextField
                  label={editingCredential ? "新的 API Token (留空则不修改)" : "Cloudflare API Token"}
                  fullWidth
                  multiline
                  rows={2}
                  placeholder="在此粘贴您的 API Token"
                  {...register('apiToken', {
                    required: editingCredential ? false : '请输入 API Token'
                  })}
                  error={!!errors.apiToken}
                  helperText={errors.apiToken?.message || "请确保 Token 拥有 Zone.Read 和 DNS.Edit 权限"}
                />

                {verifyResult && (
                  <Alert
                    severity={verifyResult.valid ? "success" : "error"}
                    sx={{ mt: 1 }}
                    icon={verifyResult.valid ? <CheckCircleIcon /> : <WarningIcon />}
                  >
                    {verifyResult.message}
                  </Alert>
                )}
              </Box>
            </Stack>
          </DialogContent>
          <DialogActions sx={{ px: 3, pb: 3 }}>
            <Button onClick={handleCloseDialog} color="inherit">
              取消
            </Button>
            <Button
              onClick={handleVerifyToken}
              disabled={verifying || (!apiTokenValue && !editingCredential)}
              color="info"
            >
              {verifying ? <CircularProgress size={24} /> : '验证'}
            </Button>
            <Button
              type="submit"
              variant="contained"
              disabled={isSubmitting}
            >
              {isSubmitting ? <CircularProgress size={24} color="inherit" /> : '保存'}
            </Button>
          </DialogActions>
        </form>
      </Dialog>

      <Dialog open={deleteDialogOpen} onClose={() => setDeleteDialogOpen(false)}>
        <DialogTitle>确认删除账户？</DialogTitle>
        <DialogContent>
          <Typography>
            您确定要删除账户 <strong>{credentialToDelete?.name}</strong> 吗？
            <br />
            此操作将移除该账户下的所有域名管理权。
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteDialogOpen(false)} color="inherit">
            取消
          </Button>
          <Button onClick={handleDeleteConfirm} color="error" variant="contained">
            删除
          </Button>
        </DialogActions>
      </Dialog>
    </Card>
  );
}
