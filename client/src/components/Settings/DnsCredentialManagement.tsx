import { useState, useEffect, Fragment } from 'react';
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
  Tooltip,
  InputAdornment,
  useMediaQuery,
  useTheme
} from '@mui/material';
import {
  Add as AddIcon,
  Edit as EditIcon,
  Delete as DeleteIcon,
  Storage as StorageIcon,
  CheckCircle as CheckCircleIcon,
  Visibility as VisibilityIcon,
  VisibilityOff as VisibilityOffIcon,
  OpenInNew as OpenInNewIcon
} from '@mui/icons-material';
import { useForm } from 'react-hook-form';
import {
  getDnsCredentials,
  createDnsCredential,
  updateDnsCredential,
  deleteDnsCredential,
  verifyDnsCredential,
  getDnsCredentialSecrets,
  getProviders
} from '@/services/dnsCredentials';
import { DnsCredential, ProviderConfig, ProviderType } from '@/types/dns';
import { useProvider } from '@/contexts/ProviderContext';
import ProviderSelector, { getProviderIcon } from './ProviderSelector';

// 各供应商获取凭证的方式说明
const PROVIDER_CREDENTIAL_GUIDE: Record<ProviderType, { title: string; steps: string[]; link?: string }> = {
  cloudflare: {
    title: 'Cloudflare API Token 获取方式',
    steps: [
      '登录 Cloudflare Dashboard',
      '右上角头像 → My Profile → API Tokens',
      'Create Token → Create Custom Token',
      '权限（Permissions）添加：区域 → 区域 → 编辑；区域 → DNS → 编辑',
      '区域资源（Zone Resources）：包含 → 账户的所有区域 → 选择你的账户',
      '创建并复制 Token（若账号下还没有任何域名，建议额外加：Account → Read）'
    ],
    link: 'https://dash.cloudflare.com/profile/api-tokens'
  },
  aliyun: {
    title: '阿里云 AccessKey 获取方式',
    steps: [
      '登录阿里云控制台',
      '点击右上角头像 → AccessKey 管理',
      '创建 AccessKey 或使用已有的 AccessKey',
      '建议创建 RAM 子账号并授予 DNS 相关权限'
    ],
    link: 'https://ram.console.aliyun.com/manage/ak'
  },
  dnspod: {
    title: '腾讯云（两种方式）',
    steps: [
      '方式一：使用腾讯云 API3.0（SecretId/SecretKey）',
      '登录 DNSPod 控制台 → 账号中心 → 密钥管理 → 创建 API 密钥',
      '复制 SecretId 和 SecretKey 并填写到前两个输入框',
      '方式二：使用 DNSPod Token（传统）',
      '登录 DNSPod 控制台 → 账号中心 → 密钥管理 → 创建 DNSPod Token（传统 API Token）',
      '将 ID 与 Token 分别填写到下方的 ID 与 Token 输入框'
    ],
    link: 'https://console.dnspod.cn/account/token/apikey'
  },
  dnspod_token: {
    title: 'DNSPod Token 获取方式',
    steps: [
      '登录 DNSPod 控制台',
      '进入 账号中心 → 密钥管理',
      '创建 DNSPod Token（传统 API Token）',
      '分别复制 Token ID 与 Token（两者组合为 ID,Token）'
    ],
    link: 'https://console.dnspod.cn/account/token'
  },
  huawei: {
    title: '华为云 AccessKey 获取方式',
    steps: [
      '登录华为云控制台',
      '点击右上角用户名 → 我的凭证',
      '选择 访问密钥 → 新增访问密钥',
      '下载并保存 AccessKey ID 和 Secret Access Key'
    ],
    link: 'https://console.huaweicloud.com/iam/#/myCredential'
  },
  baidu: {
    title: '百度云 AccessKey 获取方式',
    steps: [
      '登录百度智能云控制台',
      '点击右上角用户名 → 安全认证',
      '在 Access Key 页面创建或查看密钥',
      '复制 AccessKey 和 SecretKey'
    ],
    link: 'https://console.bce.baidu.com/iam/#/iam/accesslist'
  },
  west: {
    title: '西部数码 API 密码获取方式',
    steps: [
      '登录西部数码会员中心',
      '进入 账户安全 → API 密码设置',
      '设置或查看 API 密码',
      '使用会员账号和 API 密码进行认证'
    ],
    link: 'https://www.west.cn/manager/api/'
  },
  huoshan: {
    title: '火山引擎 AccessKey 获取方式',
    steps: [
      '登录火山引擎控制台',
      '点击右上角用户名 → 密钥管理',
      '创建新的 Access Key',
      '保存 AccessKey ID 和 Secret Access Key'
    ],
    link: 'https://console.volcengine.com/iam/keymanage/'
  },
  jdcloud: {
    title: '京东云 AccessKey 获取方式',
    steps: [
      '登录京东云控制台',
      '点击右上角账户 → Access Key 管理',
      '创建新的 Access Key',
      '复制 AccessKey ID 和 AccessKey Secret'
    ],
    link: 'https://uc.jdcloud.com/account/accesskey'
  },
  dnsla: {
    title: 'DNSLA API 密钥获取方式',
    steps: [
      '登录 DNSLA 控制台',
      '进入 用户中心 → API 接口',
      '创建或查看 API ID 和 API Secret',
      '复制 API ID 和 API Secret'
    ],
    link: 'https://www.dns.la/'
  },
  namesilo: {
    title: 'NameSilo API Key 获取方式',
    steps: [
      '登录 NameSilo 账户',
      '进入 Account → API Manager',
      '生成新的 API Key',
      '复制 API Key（注意保存，只显示一次）'
    ],
    link: 'https://www.namesilo.com/account/api-manager'
  },
  powerdns: {
    title: 'PowerDNS API Key 获取方式',
    steps: [
      '登录 PowerDNS 服务器',
      '查看配置文件中的 api-key 设置',
      '或在 PowerDNS Admin 界面获取 API Key',
      '填写服务器地址格式：IP:端口（如 192.168.1.1:8081）'
    ]
  },
  spaceship: {
    title: 'Spaceship API 密钥获取方式',
    steps: [
      '登录 Spaceship 账户',
      '进入 Account Settings → API',
      '生成 API Key 和 API Secret',
      '复制 API Key 和 API Secret'
    ],
    link: 'https://www.spaceship.com/'
  }
};

interface CredentialFormInputs {
  name: string;
  provider: ProviderType;
  secrets: Record<string, string>;
}

export default function DnsCredentialManagement() {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const { refreshData: refreshProviderData } = useProvider();
  const [credentials, setCredentials] = useState<DnsCredential[]>([]);
  const [providers, setProviders] = useState<ProviderConfig[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingCredential, setEditingCredential] = useState<DnsCredential | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [credentialToDelete, setCredentialToDelete] = useState<DnsCredential | null>(null);

  const [verifying, setVerifying] = useState<number | null>(null);
  const [verifyResult, setVerifyResult] = useState<{ id: number; valid: boolean; message?: string } | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const [secretsPrefillLoading, setSecretsPrefillLoading] = useState(false);
  const [showSecretFields, setShowSecretFields] = useState<Record<string, boolean>>({});

  const {
    register,
    handleSubmit,
    reset,
    watch,
    setValue,
    formState: { errors, isSubmitting }
  } = useForm<CredentialFormInputs>({
    defaultValues: {
      provider: 'cloudflare',
      secrets: {}
    }
  });

  const selectedProviderType = watch('provider');
  const secretValues = watch('secrets');
  const selectedProviderConfig = providers.find(p => p.type === selectedProviderType);

  // 加载数据
  const loadData = async () => {
    setIsLoading(true);
    try {
      const [credsRes, provsRes] = await Promise.all([
        getDnsCredentials(),
        getProviders()
      ]);
      setCredentials(credsRes.data?.credentials || []);
      setProviders(provsRes.data?.providers || []);
    } catch (error) {
      console.error('加载数据失败', error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  // 切换提供商时清空 secrets（防止提交旧提供商的字段）
  useEffect(() => {
    if (!dialogOpen || editingCredential) return;
    setValue('secrets', {});
    setShowSecretFields({});
  }, [dialogOpen, editingCredential, selectedProviderType, setValue]);

  // 打开新增对话框
  const handleOpenAdd = () => {
    setEditingCredential(null);
    setSubmitError(null);
    setSecretsPrefillLoading(false);
    setShowSecretFields({});
    reset({ name: '', provider: 'cloudflare', secrets: {} });
    setDialogOpen(true);
  };

  // 打开编辑对话框
  const handleOpenEdit = async (cred: DnsCredential) => {
    setEditingCredential(cred);
    setSubmitError(null);
    setSecretsPrefillLoading(false);
    setShowSecretFields({});
    reset({
      name: cred.name,
      provider: cred.provider,
      secrets: {}
    });
    setDialogOpen(true);

    setSecretsPrefillLoading(true);
    try {
      const res = await getDnsCredentialSecrets(cred.id);
      setValue('secrets', res.data?.secrets || {}, { shouldDirty: false });
    } catch (error) {
      setSubmitError(`加载密钥失败: ${toErrorMessage(error)}`);
    } finally {
      setSecretsPrefillLoading(false);
    }
  };

  // 关闭对话框
  const handleCloseDialog = () => {
    setDialogOpen(false);
    setEditingCredential(null);
    setSubmitError(null);
    setSecretsPrefillLoading(false);
    setShowSecretFields({});
    reset({ name: '', provider: 'cloudflare', secrets: {} });
  };

  // 验证凭证
  const handleVerify = async (id: number) => {
    setVerifying(id);
    setVerifyResult(null);
    try {
      const res = await verifyDnsCredential(id);
      setVerifyResult({
        id,
        valid: res.data?.valid || false,
        message: res.data?.valid ? '凭证有效' : (res.data?.error || '凭证无效')
      });
    } catch (error: any) {
      setVerifyResult({ id, valid: false, message: error.message || '验证失败' });
    } finally {
      setVerifying(null);
    }
  };

  const toErrorMessage = (error: unknown): string => {
    if (typeof error === 'string') return error;
    const msg = (error as any)?.message;
    return typeof msg === 'string' && msg.trim() ? msg : String(error);
  };

  const handleToggleSecretVisibility = (key: string) => {
    setShowSecretFields(prev => ({ ...prev, [key]: !prev[key] }));
  };

  // 提交表单
  const onSubmit = async (data: CredentialFormInputs) => {
    try {
      setSubmitError(null);

      // 过滤空的 secrets
      const secretsToSubmit = { ...data.secrets };
      Object.keys(secretsToSubmit).forEach(key => {
        if (!secretsToSubmit[key]) delete secretsToSubmit[key];
      });

      if (selectedProviderType === 'dnspod') {
        const secretId = secretsToSubmit.secretId;
        const secretKey = secretsToSubmit.secretKey;
        const tokenId = secretsToSubmit.tokenId;
        const token = secretsToSubmit.token;

        const hasTc3Any = Boolean(secretId || secretKey);
        const hasTc3Pair = Boolean(secretId && secretKey);
        const hasLegacyAny = Boolean(tokenId || token);
        const hasLegacyPair = Boolean(tokenId && token);
        const hasLegacyCombined = Boolean(!hasLegacyPair && !tokenId && token && String(token).includes(','));
        const hasLegacyValid = hasLegacyPair || hasLegacyCombined;

        if (!editingCredential) {
          if (!hasTc3Pair && !hasLegacyValid) {
            setSubmitError('请填写 SecretId/SecretKey 或 DNSPod Token（ID + Token 或 ID,Token），两种方式二选一');
            return;
          }
        }

        if (hasTc3Any && !hasTc3Pair) {
          setSubmitError('SecretId/SecretKey 需要同时填写');
          return;
        }

        if (hasLegacyAny && !hasLegacyValid) {
          setSubmitError('DNSPod Token 请填写 ID + Token，或在 Token 中填入组合格式：ID,Token');
          return;
        }
      }

      if (editingCredential) {
        await updateDnsCredential(editingCredential.id, {
          name: data.name,
          secrets: Object.keys(secretsToSubmit).length > 0 ? secretsToSubmit : undefined
        });
      } else {
        await createDnsCredential({
          name: data.name,
          provider: data.provider,
          secrets: secretsToSubmit
        });
      }

      await loadData();
      await refreshProviderData();
      handleCloseDialog();
    } catch (error: any) {
      setSubmitError(typeof error === 'string' ? error : (error.message || '操作失败'));
    }
  };

  // 删除确认
  const handleDeleteConfirm = async () => {
    if (!credentialToDelete) return;
    try {
      await deleteDnsCredential(credentialToDelete.id);
      await loadData();
      await refreshProviderData();
      setDeleteDialogOpen(false);
      setCredentialToDelete(null);
    } catch (error) {
      console.error('删除失败', error);
    }
  };

  return (
    <Card sx={{ height: '100%', boxShadow: '0 4px 20px rgba(0,0,0,0.05)', border: 'none' }}>
      <CardHeader
        avatar={<StorageIcon color="primary" />}
        title={<Typography variant="h6" fontWeight="bold">DNS 账户管理</Typography>}
        subheader="管理您的所有 DNS 服务商账户凭证"
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
        {isLoading ? (
          <Box display="flex" justifyContent="center" p={3}>
            <CircularProgress />
          </Box>
        ) : credentials.length === 0 ? (
          <Box textAlign="center" py={4}>
            <Typography color="text.secondary">暂无账户，点击上方按钮添加</Typography>
          </Box>
        ) : (
          <Grid container spacing={2}>
            {credentials.map((cred) => (
              <Grid item xs={12} key={cred.id}>
                <Card variant="outlined" sx={{
                  display: 'flex',
                  alignItems: 'center',
                  p: 2
                }}>
                  <Box sx={{ mr: 2, color: 'text.secondary' }}>
                    {getProviderIcon(cred.provider, 'small')}
                  </Box>
                  <Box sx={{ flexGrow: 1 }}>
                    <Stack direction="row" alignItems="center" spacing={1} mb={0.5}>
                      <Typography variant="subtitle1" fontWeight="bold">
                        {cred.name}
                      </Typography>
                      <Chip
                        label={cred.providerName || cred.provider}
                        size="small"
                        variant="outlined"
                        sx={{ height: 20, fontSize: '0.7rem' }}
                      />
                      {verifyResult?.id === cred.id && (
                        <Chip
                          label={verifyResult.valid ? '有效' : '无效'}
                          size="small"
                          color={verifyResult.valid ? 'success' : 'error'}
                          icon={verifyResult.valid ? <CheckCircleIcon /> : undefined}
                          sx={{ height: 20, fontSize: '0.7rem' }}
                        />
                      )}
                    </Stack>
                    <Typography variant="body2" color="text.secondary">
                      ID: {cred.id} • 创建于 {cred.createdAt.substring(0, 10)}
                    </Typography>
                  </Box>

                  <Stack direction="row" spacing={1}>
                    <Tooltip title="验证凭证">
                      <span>
                        <IconButton
                          size="small"
                          onClick={() => handleVerify(cred.id)}
                          disabled={verifying === cred.id}
                        >
                          {verifying === cred.id ? (
                            <CircularProgress size={18} />
                          ) : (
                            <CheckCircleIcon fontSize="small" />
                          )}
                        </IconButton>
                      </span>
                    </Tooltip>
                    <Tooltip title="编辑">
                      <IconButton size="small" onClick={() => handleOpenEdit(cred)}>
                        <EditIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title="删除">
                      <span>
                        <IconButton
                          size="small"
                          color="error"
                          onClick={() => {
                            setCredentialToDelete(cred);
                            setDeleteDialogOpen(true);
                          }}
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

      {/* 新增/编辑对话框 */}
      <Dialog
        open={dialogOpen}
        onClose={handleCloseDialog}
        maxWidth="md"
        fullWidth
        fullScreen={isMobile}
        PaperProps={{
          component: 'form',
          onSubmit: handleSubmit(onSubmit),
          sx: {
            overflow: 'hidden',
          },
        }}
      >
        <DialogTitle>{editingCredential ? '编辑账户' : '新增账户'}</DialogTitle>
        <DialogContent
          sx={{
            pr: 1.5,
            '&::-webkit-scrollbar-track': {
              margin: '10px 0',
            },
          }}
        >
          <Stack spacing={3}>
            {submitError && (
              <Alert severity="error">{submitError}</Alert>
            )}

            <TextField
              label="账户别名"
              fullWidth
              placeholder="例如：个人域名、公司 DNS"
              {...register('name', { required: '请输入账户别名' })}
              error={!!errors.name}
              helperText={errors.name?.message}
            />

            {!editingCredential && (
              <Box>
                <Typography variant="subtitle2" gutterBottom sx={{ mb: 1.5 }}>
                  选择 DNS 服务商
                </Typography>
                <Box>
                  <ProviderSelector
                    providers={providers}
                    selectedProvider={selectedProviderType}
                    onSelect={(provider) => setValue('provider', provider)}
                  />
                </Box>
              </Box>
            )}

            {selectedProviderConfig && (
              <Box sx={{ p: 2, bgcolor: 'background.default', borderRadius: 1 }}>
                <Typography variant="subtitle2" gutterBottom color="primary">
                  {selectedProviderConfig.name} 认证信息
                  {editingCredential && (
                    <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 1 }}>
                      {secretsPrefillLoading ? '(加载密钥中...)' : '(可查看/修改)'}
                    </Typography>
                  )}
                </Typography>

                <Stack spacing={2} mt={1}>
                  {selectedProviderConfig.authFields.map((field) => (
                    <Fragment key={field.key}>
                      {selectedProviderType === 'dnspod' && field.key === 'tokenId' && (
                        <Divider textAlign="left" sx={{ my: 1.5, opacity: 0.8 }}>
                          <Typography variant="caption" color="text.secondary">
                            DNSPod Token 认证
                          </Typography>
                        </Divider>
                      )}

                      <TextField
                        label={field.label}
                        type={
                          field.type === 'password'
                            ? (showSecretFields[field.key] ? 'text' : 'password')
                            : field.type
                        }
                        fullWidth
                        size="small"
                        placeholder={field.placeholder}
                        {...register(`secrets.${field.key}`, {
                          required: editingCredential ? false : (field.required && '此项必填')
                        })}
                        error={!!errors.secrets?.[field.key]}
                        helperText={errors.secrets?.[field.key]?.message || field.helpText}
                        InputLabelProps={{
                          shrink: secretValues && (secretValues as any)[field.key] ? true : undefined,
                        }}
                        InputProps={{
                          endAdornment: field.type === 'password' ? (
                            <InputAdornment position="end">
                              <IconButton
                                onClick={() => handleToggleSecretVisibility(field.key)}
                                edge="end"
                              >
                                {showSecretFields[field.key] ? <VisibilityOffIcon /> : <VisibilityIcon />}
                              </IconButton>
                            </InputAdornment>
                          ) : undefined,
                        }}
                      />
                    </Fragment>
                  ))}
                </Stack>
              </Box>
            )}

            <Alert severity="info" sx={{ mt: 1 }}>
              <Typography variant="subtitle2" fontWeight="bold" gutterBottom>
                {PROVIDER_CREDENTIAL_GUIDE[selectedProviderType]?.title || '获取凭证'}
              </Typography>
              <Box component="ol" sx={{ m: 0, pl: 2.5 }}>
                {PROVIDER_CREDENTIAL_GUIDE[selectedProviderType]?.steps.map((step, index) => (
                  <Typography component="li" variant="body2" key={index} sx={{ mb: 0.5 }}>
                    {step}
                  </Typography>
                ))}
              </Box>
              {PROVIDER_CREDENTIAL_GUIDE[selectedProviderType]?.link && (
                <Button
                  size="small"
                  startIcon={<OpenInNewIcon />}
                  href={PROVIDER_CREDENTIAL_GUIDE[selectedProviderType].link}
                  target="_blank"
                  rel="noopener noreferrer"
                  sx={{ mt: 1, textTransform: 'none' }}
                >
                  前往获取
                </Button>
              )}
            </Alert>
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 3 }}>
          <Button onClick={handleCloseDialog} color="inherit">
            取消
          </Button>
          <Button
            type="submit"
            variant="contained"
            disabled={isSubmitting}
          >
            {isSubmitting ? <CircularProgress size={24} color="inherit" /> : '保存'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* 删除确认对话框 */}
      <Dialog open={deleteDialogOpen} onClose={() => setDeleteDialogOpen(false)} fullScreen={isMobile}>
        <DialogTitle>确认删除</DialogTitle>
        <DialogContent>
          <Typography>
            确定要删除账户 <strong>{credentialToDelete?.name}</strong> 吗？
            <br />
            此操作不可恢复。
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
