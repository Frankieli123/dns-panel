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
  IconButton
} from '@mui/material';
import { useForm } from 'react-hook-form';
import {
  Visibility,
  VisibilityOff,
  Security as SecurityIcon,
  Save as SaveIcon
} from '@mui/icons-material';
import { updatePassword } from '@/services/auth';
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
