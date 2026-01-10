import { useEffect, useState } from 'react';
import {
  Box,
  Typography,
  Card,
  CardContent,
  CardHeader,
  TextField,
  Button,
  Alert,
  Divider,
  Grid,
  Stack,
  InputAdornment,
  IconButton,
  FormControl,
  FormLabel,
  RadioGroup,
  FormControlLabel,
  Radio,
  Switch,
  CircularProgress
} from '@mui/material';
import { useForm } from 'react-hook-form';
import {
  Visibility,
  VisibilityOff,
  Security as SecurityIcon,
  Save as SaveIcon
} from '@mui/icons-material';
import { getCurrentUser, getStoredUser, updateDomainExpirySettings, updatePassword } from '@/services/auth';
import { isStrongPassword } from '@/utils/validators';
import DnsCredentialManagement from '@/components/Settings/DnsCredentialManagement';
import TwoFactorSettings from '@/components/Settings/TwoFactorSettings';

interface PasswordForm {
  oldPassword: string;
  newPassword: string;
  confirmPassword: string;
}

const DOMAINS_PER_PAGE_STORAGE_KEY = 'dns_domains_per_page';
const DOMAINS_PER_PAGE_CHANGED_EVENT = 'dns_domains_per_page_changed';

/**
 * 设置页面
 */
export default function Settings() {
  const [passwordSuccess, setPasswordSuccess] = useState('');
  const [passwordError, setPasswordError] = useState('');

  const [domainsPerPage, setDomainsPerPage] = useState<string>('20');
  const [domainsPerPageSuccess, setDomainsPerPageSuccess] = useState('');
  const [domainsPerPageError, setDomainsPerPageError] = useState('');

  const [expirySettingsSuccess, setExpirySettingsSuccess] = useState('');
  const [expirySettingsError, setExpirySettingsError] = useState('');
  const [expirySettingsSaving, setExpirySettingsSaving] = useState(false);
  const [expiryDisplayMode, setExpiryDisplayMode] = useState<'date' | 'days'>('date');
  const [expiryThresholdDays, setExpiryThresholdDays] = useState<string>('7');
  const [expiryNotifyEnabled, setExpiryNotifyEnabled] = useState(false);
  const [expiryWebhookUrl, setExpiryWebhookUrl] = useState('');

  const [showOldPassword, setShowOldPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);

  const {
    register: registerPassword,
    handleSubmit: handlePasswordSubmit,
    watch,
    reset: resetPassword,
    formState: { errors: passwordErrors, isSubmitting: isPasswordSubmitting },
  } = useForm<PasswordForm>();

  const newPassword = watch('newPassword');

  useEffect(() => {
    const raw = localStorage.getItem(DOMAINS_PER_PAGE_STORAGE_KEY);
    const parsed = raw ? parseInt(raw, 10) : NaN;
    if (Number.isFinite(parsed) && parsed >= 20) {
      setDomainsPerPage(String(parsed));
    }

    const stored = getStoredUser();
    if (stored?.domainExpiryDisplayMode === 'days' || stored?.domainExpiryDisplayMode === 'date') {
      setExpiryDisplayMode(stored.domainExpiryDisplayMode);
    }
    if (typeof stored?.domainExpiryThresholdDays === 'number' && Number.isFinite(stored.domainExpiryThresholdDays)) {
      setExpiryThresholdDays(String(stored.domainExpiryThresholdDays));
    }
    if (typeof stored?.domainExpiryNotifyEnabled === 'boolean') {
      setExpiryNotifyEnabled(stored.domainExpiryNotifyEnabled);
    }
    if (typeof stored?.domainExpiryNotifyWebhookUrl === 'string') {
      setExpiryWebhookUrl(stored.domainExpiryNotifyWebhookUrl);
    }
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const res = await getCurrentUser();
        const user = res?.data?.user;
        if (!user) return;

        localStorage.setItem('user', JSON.stringify(user));

        if (user.domainExpiryDisplayMode === 'days' || user.domainExpiryDisplayMode === 'date') {
          setExpiryDisplayMode(user.domainExpiryDisplayMode);
        }
        if (typeof user.domainExpiryThresholdDays === 'number' && Number.isFinite(user.domainExpiryThresholdDays)) {
          setExpiryThresholdDays(String(user.domainExpiryThresholdDays));
        }
        if (typeof user.domainExpiryNotifyEnabled === 'boolean') {
          setExpiryNotifyEnabled(user.domainExpiryNotifyEnabled);
        }
        if (typeof user.domainExpiryNotifyWebhookUrl === 'string') {
          setExpiryWebhookUrl(user.domainExpiryNotifyWebhookUrl);
        } else {
          setExpiryWebhookUrl('');
        }
      } catch {}
    })();
  }, []);

  const onPasswordSubmit = async (data: PasswordForm) => {
    try {
      setPasswordError('');
      setPasswordSuccess('');

      await updatePassword({
        oldPassword: data.oldPassword,
        newPassword: data.newPassword,
      });

      setPasswordSuccess('密码修改成功');
      resetPassword();
    } catch (err: any) {
      setPasswordError((err as any)?.message || String(err) || '密码修改失败');
    }
  };

  const onSaveDomainsPerPage = () => {
    setDomainsPerPageSuccess('');
    setDomainsPerPageError('');

    const parsed = parseInt(domainsPerPage, 10);
    if (!Number.isFinite(parsed) || parsed < 20) {
      setDomainsPerPageError('单页显示域名数量最低为 20');
      return;
    }

    const safe = Math.max(20, Math.floor(parsed));
    localStorage.setItem(DOMAINS_PER_PAGE_STORAGE_KEY, String(safe));
    window.dispatchEvent(new CustomEvent(DOMAINS_PER_PAGE_CHANGED_EVENT, { detail: safe }));
    setDomainsPerPage(String(safe));
    setDomainsPerPageSuccess('设置已保存');
  };

  const onSaveExpirySettings = async () => {
    setExpirySettingsSuccess('');
    setExpirySettingsError('');

    const threshold = Math.floor(Number(expiryThresholdDays));
    if (!Number.isFinite(threshold) || threshold < 1 || threshold > 365) {
      setExpirySettingsError('到期阈值应为 1-365 的整数');
      return;
    }

    if (expiryNotifyEnabled && !expiryWebhookUrl.trim()) {
      setExpirySettingsError('启用通知时需填写 Webhook URL');
      return;
    }

    setExpirySettingsSaving(true);
    try {
      const res = await updateDomainExpirySettings({
        displayMode: expiryDisplayMode,
        thresholdDays: threshold,
        notifyEnabled: expiryNotifyEnabled,
        webhookUrl: expiryWebhookUrl.trim() ? expiryWebhookUrl.trim() : null,
      });

      const user = res?.data?.user;
      if (user) {
        localStorage.setItem('user', JSON.stringify(user));
      }
      setExpirySettingsSuccess('设置已保存');
    } catch (err: any) {
      setExpirySettingsError(err || '设置保存失败');
    } finally {
      setExpirySettingsSaving(false);
    }
  };

  return (
    <Box>
      <Grid container spacing={3}>
        {/* 左侧：修改密码 */}
        <Grid item xs={12} md={5}>
          <Card sx={{ height: '100%', boxShadow: '0 4px 20px rgba(0,0,0,0.05)', border: 'none' }}>
            <CardHeader
              avatar={<SecurityIcon color="primary" />}
              title={<Typography variant="h6" fontWeight="bold">安全设置</Typography>}
              subheader="修改您的登录密码"
            />
            <Divider />
            <CardContent>
              {passwordSuccess && (
                <Alert severity="success" sx={{ mb: 3 }}>
                  {passwordSuccess}
                </Alert>
              )}
              {passwordError && (
                <Alert severity="error" sx={{ mb: 3 }}>
                  {passwordError}
                </Alert>
              )}

              <form onSubmit={handlePasswordSubmit(onPasswordSubmit)}>
                <Stack spacing={2}>
                  <TextField
                    fullWidth
                    type={showOldPassword ? 'text' : 'password'}
                    label="当前密码"
                    {...registerPassword('oldPassword', { required: '请输入当前密码' })}
                    error={!!passwordErrors.oldPassword}
                    helperText={passwordErrors.oldPassword?.message}
                    InputProps={{
                      endAdornment: (
                        <InputAdornment position="end">
                          <IconButton
                            onClick={() => setShowOldPassword(!showOldPassword)}
                            edge="end"
                          >
                            {showOldPassword ? <VisibilityOff /> : <Visibility />}
                          </IconButton>
                        </InputAdornment>
                      ),
                    }}
                  />

                  <TextField
                    fullWidth
                    type={showNewPassword ? 'text' : 'password'}
                    label="新密码"
                    {...registerPassword('newPassword', {
                      required: '请输入新密码',
                      validate: (value) =>
                        isStrongPassword(value) || '密码至少 8 位，包含大小写字母和数字',
                    })}
                    error={!!passwordErrors.newPassword}
                    helperText={passwordErrors.newPassword?.message}
                    InputProps={{
                      endAdornment: (
                        <InputAdornment position="end">
                          <IconButton
                            onClick={() => setShowNewPassword(!showNewPassword)}
                            edge="end"
                          >
                            {showNewPassword ? <VisibilityOff /> : <Visibility />}
                          </IconButton>
                        </InputAdornment>
                      ),
                    }}
                  />

                  <TextField
                    fullWidth
                    type="password"
                    label="确认新密码"
                    {...registerPassword('confirmPassword', {
                      required: '请确认新密码',
                      validate: (value) => value === newPassword || '两次密码输入不一致',
                    })}
                    error={!!passwordErrors.confirmPassword}
                    helperText={passwordErrors.confirmPassword?.message}
                  />

                  <Box sx={{ pt: 1 }}>
                    <Button
                      type="submit"
                      variant="contained"
                      startIcon={<SaveIcon />}
                      disabled={isPasswordSubmitting}
                    >
                      修改密码
                    </Button>
                  </Box>
                </Stack>
              </form>

              <Divider sx={{ my: 3 }} />

              <TwoFactorSettings />

              <Divider sx={{ my: 3 }} />

              <Stack spacing={2}>
                <Typography variant="subtitle1" fontWeight={600}>
                  域名列表每页显示数量
                </Typography>

                {domainsPerPageSuccess && (
                  <Alert severity="success">
                    {domainsPerPageSuccess}
                  </Alert>
                )}
                {domainsPerPageError && (
                  <Alert severity="error">
                    {domainsPerPageError}
                  </Alert>
                )}

                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems={{ xs: 'stretch', sm: 'flex-end' }}>
                  <TextField
                    value={domainsPerPage}
                    onChange={(e) => setDomainsPerPage(e.target.value)}
                    type="number"
                    label="每页域名数量"
                    size="small"
                    sx={{ width: { xs: '100%', sm: 240 } }}
                    InputProps={{
                      inputProps: { min: 20 },
                    }}
                  />
                  <Button
                    variant="outlined"
                    size="small"
                    startIcon={<SaveIcon />}
                    onClick={onSaveDomainsPerPage}
                    sx={{ height: 40 }}
                  >
                    保存
                  </Button>
                </Stack>
              </Stack>

              <Divider sx={{ my: 3 }} />

              <Stack spacing={2}>
                <Typography variant="subtitle1" fontWeight={600}>
                  域名到期
                </Typography>

                {expirySettingsSuccess && (
                  <Alert severity="success">
                    {expirySettingsSuccess}
                  </Alert>
                )}
                {expirySettingsError && (
                  <Alert severity="error">
                    {expirySettingsError}
                  </Alert>
                )}

                <FormControl>
                  <FormLabel>列表显示</FormLabel>
                  <RadioGroup
                    row
                    value={expiryDisplayMode}
                    onChange={(e) => setExpiryDisplayMode((e.target as HTMLInputElement).value as any)}
                  >
                    <FormControlLabel value="date" control={<Radio />} label="到期日期" />
                    <FormControlLabel value="days" control={<Radio />} label="剩余天数" />
                  </RadioGroup>
                </FormControl>

                <TextField
                  value={expiryThresholdDays}
                  onChange={(e) => setExpiryThresholdDays(e.target.value)}
                  type="number"
                  label="到期阈值（天）"
                  size="small"
                  sx={{ width: { xs: '100%', sm: 240 } }}
                  InputProps={{
                    inputProps: { min: 1, max: 365 },
                  }}
                  helperText="当域名剩余天数 ≤ 阈值时触发通知"
                />

                <FormControlLabel
                  control={
                    <Switch
                      checked={expiryNotifyEnabled}
                      onChange={(e) => setExpiryNotifyEnabled(e.target.checked)}
                    />
                  }
                  label="启用到期通知（Webhook）"
                />

                <TextField
                  value={expiryWebhookUrl}
                  onChange={(e) => setExpiryWebhookUrl(e.target.value)}
                  disabled={!expiryNotifyEnabled}
                  label="Webhook URL"
                  size="small"
                  placeholder="https://example.com/webhook"
                  helperText="服务器每天检查一次；命中阈值将向该 URL POST JSON"
                />

                <Box>
                  <Button
                    variant="outlined"
                    size="small"
                    startIcon={expirySettingsSaving ? <CircularProgress size={16} /> : <SaveIcon />}
                    onClick={onSaveExpirySettings}
                    disabled={expirySettingsSaving}
                    sx={{ height: 40 }}
                  >
                    保存
                  </Button>
                </Box>
              </Stack>
            </CardContent>
          </Card>
        </Grid>

        {/* 右侧：DNS 账户管理 */}
        <Grid item xs={12} md={7}>
          <DnsCredentialManagement />
        </Grid>
      </Grid>
    </Box>
  );
}
