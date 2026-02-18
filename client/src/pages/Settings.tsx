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
  Save as SaveIcon,
  Language as DomainIcon
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
  const [expiryEmailEnabled, setExpiryEmailEnabled] = useState(false);
  const [expiryEmailTo, setExpiryEmailTo] = useState('');
  const [smtpHost, setSmtpHost] = useState('');
  const [smtpPort, setSmtpPort] = useState<string>('587');
  const [smtpSecure, setSmtpSecure] = useState(false);
  const [smtpUser, setSmtpUser] = useState('');
  const [smtpPass, setSmtpPass] = useState('');
  const [smtpPassConfigured, setSmtpPassConfigured] = useState(false);
  const [smtpFrom, setSmtpFrom] = useState('');

  const [showOldPassword, setShowOldPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showSmtpPassword, setShowSmtpPassword] = useState(false);

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
    if (typeof stored?.domainExpiryNotifyEmailEnabled === 'boolean') {
      setExpiryEmailEnabled(stored.domainExpiryNotifyEmailEnabled);
    }
    if (typeof stored?.domainExpiryNotifyEmailTo === 'string') {
      setExpiryEmailTo(stored.domainExpiryNotifyEmailTo);
    } else if (typeof stored?.email === 'string') {
      setExpiryEmailTo(stored.email);
    }

    if (typeof stored?.smtpHost === 'string') {
      setSmtpHost(stored.smtpHost);
    }
    if (typeof stored?.smtpPort === 'number' && Number.isFinite(stored.smtpPort)) {
      setSmtpPort(String(stored.smtpPort));
    }
    if (typeof stored?.smtpSecure === 'boolean') {
      setSmtpSecure(stored.smtpSecure);
    }
    if (typeof stored?.smtpUser === 'string') {
      setSmtpUser(stored.smtpUser);
    }
    if (typeof stored?.smtpFrom === 'string') {
      setSmtpFrom(stored.smtpFrom);
    }
    if (typeof stored?.smtpPassConfigured === 'boolean') {
      setSmtpPassConfigured(stored.smtpPassConfigured);
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
        if (typeof user.domainExpiryNotifyEmailEnabled === 'boolean') {
          setExpiryEmailEnabled(user.domainExpiryNotifyEmailEnabled);
        }
        if (typeof user.domainExpiryNotifyEmailTo === 'string') {
          setExpiryEmailTo(user.domainExpiryNotifyEmailTo);
        } else if (typeof user.email === 'string') {
          setExpiryEmailTo(user.email);
        } else {
          setExpiryEmailTo('');
        }

        setSmtpHost(typeof user.smtpHost === 'string' ? user.smtpHost : '');
        setSmtpPort(typeof user.smtpPort === 'number' && Number.isFinite(user.smtpPort) ? String(user.smtpPort) : '587');
        setSmtpSecure(typeof user.smtpSecure === 'boolean' ? user.smtpSecure : false);
        setSmtpUser(typeof user.smtpUser === 'string' ? user.smtpUser : '');
        setSmtpFrom(typeof user.smtpFrom === 'string' ? user.smtpFrom : '');
        setSmtpPassConfigured(!!user.smtpPassConfigured);
        setSmtpPass('');
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

    if (expiryEmailEnabled) {
      const email = expiryEmailTo.trim();
      if (!email) {
        setExpirySettingsError('启用邮件通知时需填写收件邮箱');
        return;
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        setExpirySettingsError('收件邮箱格式不正确');
        return;
      }
    }

    const smtpHostTrim = smtpHost.trim();
    const hasCustomSmtp = !!smtpHostTrim;
    const smtpFromTrim = smtpFrom.trim();
    const smtpUserTrim = smtpUser.trim();
    const smtpPassTrim = smtpPass.trim();

    let smtpPortValue: number | null = null;
    const portRaw = smtpPort.trim();
    if (hasCustomSmtp && portRaw) {
      const parsedPort = parseInt(portRaw, 10);
      if (!Number.isFinite(parsedPort) || parsedPort < 1 || parsedPort > 65535) {
        setExpirySettingsError('SMTP 端口无效，应为 1-65535 的整数');
        return;
      }
      smtpPortValue = parsedPort;
    }

    if (expiryEmailEnabled && hasCustomSmtp && !smtpFromTrim) {
      setExpirySettingsError('启用邮件通知且使用自定义 SMTP 时需填写 From');
      return;
    }

    if (hasCustomSmtp) {
      if (!smtpUserTrim && smtpPassTrim) {
        setExpirySettingsError('填写 SMTP 密码时需同时填写 SMTP 用户名');
        return;
      }
      if (smtpUserTrim && !smtpPassTrim && !smtpPassConfigured) {
        setExpirySettingsError('请填写 SMTP 密码');
        return;
      }
    }

    setExpirySettingsSaving(true);
    try {
      const payload: any = {
        displayMode: expiryDisplayMode,
        thresholdDays: threshold,
        notifyEnabled: expiryNotifyEnabled,
        webhookUrl: expiryWebhookUrl.trim() ? expiryWebhookUrl.trim() : null,
        notifyEmailEnabled: expiryEmailEnabled,
        emailTo: expiryEmailTo.trim() ? expiryEmailTo.trim() : null,
        smtpHost: hasCustomSmtp ? smtpHostTrim : null,
        smtpPort: hasCustomSmtp ? smtpPortValue : null,
        smtpSecure: hasCustomSmtp ? smtpSecure : null,
        smtpUser: hasCustomSmtp ? (smtpUserTrim ? smtpUserTrim : null) : null,
        smtpFrom: hasCustomSmtp ? (smtpFromTrim ? smtpFromTrim : null) : null,
      };

      if (!hasCustomSmtp) {
        payload.smtpPass = null;
      } else if (smtpPassTrim) {
        payload.smtpPass = smtpPassTrim;
      }

      const res = await updateDomainExpirySettings(payload);

      const user = res?.data?.user;
      if (user) {
        localStorage.setItem('user', JSON.stringify(user));
        setSmtpHost(typeof user.smtpHost === 'string' ? user.smtpHost : '');
        setSmtpPort(typeof user.smtpPort === 'number' && Number.isFinite(user.smtpPort) ? String(user.smtpPort) : '587');
        setSmtpSecure(typeof user.smtpSecure === 'boolean' ? user.smtpSecure : false);
        setSmtpUser(typeof user.smtpUser === 'string' ? user.smtpUser : '');
        setSmtpFrom(typeof user.smtpFrom === 'string' ? user.smtpFrom : '');
        setSmtpPassConfigured(!!user.smtpPassConfigured);
        setSmtpPass('');
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
        {/* 左侧：安全设置 & 域名设置 */}
        <Grid item xs={12} md={5}>
          <Stack spacing={3}>
            <Card sx={{ boxShadow: '0 4px 20px rgba(0,0,0,0.05)', border: 'none' }}>
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
              </CardContent>
            </Card>

            <Card sx={{ boxShadow: '0 4px 20px rgba(0,0,0,0.05)', border: 'none' }}>
              <CardHeader
                avatar={<DomainIcon color="primary" />}
                title={<Typography variant="h6" fontWeight="bold">域名设置</Typography>}
                subheader="列表显示与到期通知"
              />
              <Divider />
              <CardContent>
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
                    fullWidth
                    value={expiryWebhookUrl}
                    onChange={(e) => setExpiryWebhookUrl(e.target.value)}
                    disabled={!expiryNotifyEnabled}
                    label="Webhook URL"
                    size="small"
                    placeholder="https://example.com/webhook"
                    helperText="服务器每天检查一次；命中阈值将向该 URL POST JSON"
                  />

                  <FormControlLabel
                    control={
                      <Switch
                        checked={expiryEmailEnabled}
                        onChange={(e) => setExpiryEmailEnabled(e.target.checked)}
                      />
                    }
                    label="启用到期通知（邮件）"
                  />

                  <TextField
                    fullWidth
                    value={expiryEmailTo}
                    onChange={(e) => setExpiryEmailTo(e.target.value)}
                    disabled={!expiryEmailEnabled}
                    label="接收邮箱"
                    size="small"
                    placeholder="admin@example.com"
                    helperText="命中阈值将发送邮件提醒"
                  />

                  <Divider sx={{ my: 2 }} />

                  <Typography variant="subtitle1" fontWeight={600}>
                    SMTP 设置
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    留空则使用服务端环境变量 SMTP_*；填写 SMTP 主机后将使用自定义 SMTP。
                  </Typography>

                  <Stack spacing={2} sx={{ width: '100%' }}>
                    <TextField
                      fullWidth
                      value={smtpHost}
                      onChange={(e) => setSmtpHost(e.target.value)}
                      label="SMTP 主机"
                      size="small"
                      placeholder="smtp.example.com"
                    />

                    <Box
                      sx={{
                        width: '100%',
                        display: 'grid',
                        gridTemplateColumns: { xs: '1fr', sm: '240px 1fr' },
                        gap: 2,
                        alignItems: { sm: 'center' },
                      }}
                    >
                      <TextField
                        fullWidth
                        value={smtpPort}
                        onChange={(e) => setSmtpPort(e.target.value)}
                        disabled={!smtpHost.trim()}
                        type="number"
                        label="端口"
                        size="small"
                        placeholder="587"
                        InputProps={{
                          inputProps: { min: 1, max: 65535 },
                        }}
                      />

                      <FormControlLabel
                        control={
                          <Switch
                            checked={smtpSecure}
                            onChange={(e) => setSmtpSecure(e.target.checked)}
                            disabled={!smtpHost.trim()}
                          />
                        }
                        label="使用 SMTPS"
                        sx={{ m: 0 }}
                      />
                    </Box>

                    <Box
                      sx={{
                        width: '100%',
                        display: 'grid',
                        gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' },
                        gap: 2,
                      }}
                    >
                      <TextField
                        fullWidth
                        value={smtpUser}
                        onChange={(e) => setSmtpUser(e.target.value)}
                        disabled={!smtpHost.trim()}
                        label="SMTP 用户名（可选）"
                        size="small"
                        placeholder="user@example.com"
                        helperText="如不需要认证，用户名/密码都留空"
                      />

                      <TextField
                        fullWidth
                        value={smtpPass}
                        onChange={(e) => setSmtpPass(e.target.value)}
                        disabled={!smtpHost.trim()}
                        type={showSmtpPassword ? 'text' : 'password'}
                        label="SMTP 密码（可选）"
                        size="small"
                        placeholder={smtpPassConfigured ? '已设置（留空不修改）' : '留空表示不使用认证'}
                        helperText={smtpPassConfigured ? '已设置（留空不修改）' : undefined}
                        InputProps={{
                          endAdornment: (
                            <InputAdornment position="end">
                              <IconButton
                                onClick={() => setShowSmtpPassword(!showSmtpPassword)}
                                edge="end"
                              >
                                {showSmtpPassword ? <VisibilityOff /> : <Visibility />}
                              </IconButton>
                            </InputAdornment>
                          ),
                        }}
                      />
                    </Box>

                    <TextField
                      fullWidth
                      value={smtpFrom}
                      onChange={(e) => setSmtpFrom(e.target.value)}
                      disabled={!smtpHost.trim()}
                      label="From（发件人）"
                      size="small"
                      placeholder="DNS Panel <no-reply@example.com>"
                    />
                  </Stack>

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
          </Stack>
        </Grid>

        {/* 右侧：DNS 账户管理 */}
        <Grid item xs={12} md={7}>
          <DnsCredentialManagement />
        </Grid>
      </Grid>
    </Box>
  );
}
