import { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Button,
  Alert,
  Stack,
  TextField,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  CircularProgress,
  Chip,
  InputAdornment,
  IconButton,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import {
  Security as SecurityIcon,
  QrCode as QrCodeIcon,
  Check as CheckIcon,
  Close as CloseIcon,
  Visibility,
  VisibilityOff,
} from '@mui/icons-material';
import { get2FAStatus, setup2FA, enable2FA, disable2FA } from '@/services/auth';

export default function TwoFactorSettings() {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const [setupDialogOpen, setSetupDialogOpen] = useState(false);
  const [disableDialogOpen, setDisableDialogOpen] = useState(false);
  
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState('');
  const [secret, setSecret] = useState('');
  const [verifyCode, setVerifyCode] = useState('');
  const [enablePassword, setEnablePassword] = useState('');
  const [showEnablePassword, setShowEnablePassword] = useState(false);
  const [setupLoading, setSetupLoading] = useState(false);
  const [setupStep, setSetupStep] = useState<'qr' | 'verify'>('qr');

  const [disablePassword, setDisablePassword] = useState('');
  const [showDisablePassword, setShowDisablePassword] = useState(false);
  const [disableLoading, setDisableLoading] = useState(false);

  useEffect(() => {
    loadStatus();
  }, []);

  const loadStatus = async () => {
    try {
      setLoading(true);
      const response = await get2FAStatus();
      setEnabled(response.data?.enabled || false);
    } catch (err: any) {
      setError(err || '获取 2FA 状态失败');
    } finally {
      setLoading(false);
    }
  };

  const handleSetupStart = async () => {
    try {
      setSetupLoading(true);
      setError('');
      const response = await setup2FA();
      if (response.data) {
        setQrCodeDataUrl(response.data.qrCodeDataUrl);
        setSecret(response.data.secret);
        setSetupStep('qr');
        setSetupDialogOpen(true);
      }
    } catch (err: any) {
      setError(err || '生成 2FA 密钥失败');
    } finally {
      setSetupLoading(false);
    }
  };

  const handleEnable = async () => {
    if (!verifyCode || verifyCode.length !== 6) {
      setError('请输入 6 位验证码');
      return;
    }

    if (!enablePassword) {
      setError('请输入密码');
      return;
    }

    try {
      setSetupLoading(true);
      setError('');
      await enable2FA(verifyCode, enablePassword);
      setEnabled(true);
      setSuccess('两步验证已成功启用');
      setSetupDialogOpen(false);
      setVerifyCode('');
      setEnablePassword('');
      setQrCodeDataUrl('');
      setSecret('');
      setSetupStep('qr');
    } catch (err: any) {
      setError(err || '启用 2FA 失败');
    } finally {
      setSetupLoading(false);
    }
  };

  const handleDisable = async () => {
    if (!disablePassword) {
      setError('请输入密码');
      return;
    }

    try {
      setDisableLoading(true);
      setError('');
      await disable2FA(disablePassword);
      setEnabled(false);
      setSuccess('两步验证已禁用');
      setDisableDialogOpen(false);
      setDisablePassword('');
    } catch (err: any) {
      setError(err || '禁用 2FA 失败');
    } finally {
      setDisableLoading(false);
    }
  };

  const handleCloseSetupDialog = () => {
    setSetupDialogOpen(false);
    setVerifyCode('');
    setEnablePassword('');
    setQrCodeDataUrl('');
    setSecret('');
    setSetupStep('qr');
    setError('');
  };

  const handleCloseDisableDialog = () => {
    setDisableDialogOpen(false);
    setDisablePassword('');
    setError('');
  };

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
        <CircularProgress size={24} />
      </Box>
    );
  }

  return (
    <Box>
      <Stack spacing={2}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <SecurityIcon color="primary" />
            <Typography variant="subtitle1" fontWeight={600}>
              两步验证 (2FA)
            </Typography>
          </Box>
          <Chip
            icon={enabled ? <CheckIcon /> : <CloseIcon />}
            label={enabled ? '已启用' : '未启用'}
            color={enabled ? 'success' : 'default'}
            size="small"
          />
        </Box>

        <Typography variant="body2" color="text.secondary">
          启用两步验证后，登录时除了密码还需要输入身份验证器应用生成的验证码，大幅提升账户安全性。
        </Typography>

        {success && (
          <Alert severity="success" onClose={() => setSuccess('')}>
            {success}
          </Alert>
        )}

        {error && (
          <Alert severity="error" onClose={() => setError('')}>
            {error}
          </Alert>
        )}

        <Box sx={{ pt: 1 }}>
          {enabled ? (
            <Button
              variant="outlined"
              color="error"
              onClick={() => setDisableDialogOpen(true)}
            >
              禁用两步验证
            </Button>
          ) : (
            <Button
              variant="contained"
              startIcon={<QrCodeIcon />}
              onClick={handleSetupStart}
              disabled={setupLoading}
            >
              {setupLoading ? '生成中...' : '启用两步验证'}
            </Button>
          )}
        </Box>
      </Stack>

      {/* 设置 2FA 对话框 */}
      <Dialog 
        open={setupDialogOpen} 
        onClose={handleCloseSetupDialog}
        maxWidth="sm"
        fullWidth
        fullScreen={isMobile}
      >
        <DialogTitle>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <SecurityIcon color="primary" />
            设置两步验证
          </Box>
        </DialogTitle>
        <DialogContent>
          {setupStep === 'qr' ? (
            <Stack spacing={3} sx={{ pt: 1 }}>
              <Typography variant="body1">
                请使用身份验证器应用扫描下方二维码：
              </Typography>
              
              <Box sx={{ display: 'flex', justifyContent: 'center' }}>
                {qrCodeDataUrl && (
                  <Box
                    component="img"
                    src={qrCodeDataUrl}
                    alt="2FA QR Code"
                    sx={{ width: 200, height: 200, border: '1px solid', borderColor: 'divider', borderRadius: 1 }}
                  />
                )}
              </Box>

              <Alert severity="info">
                <Typography variant="body2" sx={{ mb: 1 }}>
                  推荐使用以下应用：
                </Typography>
                <Typography variant="body2" component="ul" sx={{ m: 0, pl: 2 }}>
                  <li>Google Authenticator</li>
                  <li>Microsoft Authenticator</li>
                  <li>1Password</li>
                  <li>Authy</li>
                </Typography>
              </Alert>

              <Box>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                  无法扫码？请手动输入密钥：
                </Typography>
                <TextField
                  fullWidth
                  value={secret}
                  size="small"
                  InputProps={{
                    readOnly: true,
                    sx: { fontFamily: 'monospace', fontSize: '0.9rem' }
                  }}
                />
              </Box>

              <Button
                variant="contained"
                onClick={() => setSetupStep('verify')}
                fullWidth
              >
                下一步：验证
              </Button>
            </Stack>
          ) : (
            <Stack spacing={3} sx={{ pt: 1 }}>
              <Typography variant="body1">
                请输入身份验证器应用中显示的 6 位验证码，并确认您的密码：
              </Typography>

              {error && (
                <Alert severity="error">
                  {error}
                </Alert>
              )}

              <TextField
                fullWidth
                label="验证码"
                placeholder="000000"
                autoComplete="one-time-code"
                name="one-time-code"
                value={verifyCode}
                onChange={(e) => setVerifyCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                inputProps={{
                  inputMode: 'numeric',
                  pattern: '[0-9]*',
                  maxLength: 6,
                  style: { textAlign: 'center', letterSpacing: '0.5em', fontSize: '1.2rem' }
                }}
                autoFocus
              />

              <TextField
                fullWidth
                type={showEnablePassword ? 'text' : 'password'}
                label="确认密码"
                autoComplete="current-password"
                value={enablePassword}
                onChange={(e) => setEnablePassword(e.target.value)}
                InputProps={{
                  endAdornment: (
                    <InputAdornment position="end">
                      <IconButton
                        onClick={() => setShowEnablePassword(!showEnablePassword)}
                        edge="end"
                      >
                        {showEnablePassword ? <VisibilityOff /> : <Visibility />}
                      </IconButton>
                    </InputAdornment>
                  ),
                }}
              />

              <Stack direction="row" spacing={2}>
                <Button
                  variant="outlined"
                  onClick={() => setSetupStep('qr')}
                  fullWidth
                >
                  返回
                </Button>
                <Button
                  variant="contained"
                  onClick={handleEnable}
                  disabled={setupLoading || verifyCode.length !== 6 || !enablePassword}
                  fullWidth
                >
                  {setupLoading ? '验证中...' : '启用'}
                </Button>
              </Stack>
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseSetupDialog}>取消</Button>
        </DialogActions>
      </Dialog>

      {/* 禁用 2FA 对话框 */}
      <Dialog
        open={disableDialogOpen}
        onClose={handleCloseDisableDialog}
        maxWidth="xs"
        fullWidth
        fullScreen={isMobile}
      >
        <DialogTitle>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <SecurityIcon color="error" />
            禁用两步验证
          </Box>
        </DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <Alert severity="warning">
              禁用两步验证后，您的账户安全性将降低。
            </Alert>

            {error && (
              <Alert severity="error">
                {error}
              </Alert>
            )}

            <TextField
              fullWidth
              type={showDisablePassword ? 'text' : 'password'}
              label="请输入密码确认"
              autoComplete="current-password"
              value={disablePassword}
              onChange={(e) => setDisablePassword(e.target.value)}
              InputProps={{
                endAdornment: (
                  <InputAdornment position="end">
                    <IconButton
                      onClick={() => setShowDisablePassword(!showDisablePassword)}
                      edge="end"
                    >
                      {showDisablePassword ? <VisibilityOff /> : <Visibility />}
                    </IconButton>
                  </InputAdornment>
                ),
              }}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseDisableDialog}>取消</Button>
          <Button
            color="error"
            variant="contained"
            onClick={handleDisable}
            disabled={disableLoading || !disablePassword}
          >
            {disableLoading ? '处理中...' : '确认禁用'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
