import { useState } from 'react';
import { useNavigate, Link as RouterLink } from 'react-router-dom';
import {
  Box,
  Typography,
  TextField,
  Button,
  Link,
  Alert,
  Stack,
  useTheme,
  InputAdornment,
  IconButton,
} from '@mui/material';
import { useForm } from 'react-hook-form';
import { 
  CloudQueue as CloudIcon, 
  Visibility, 
  VisibilityOff,
  Login as LoginIcon,
  Security as SecurityIcon,
  ArrowBack as ArrowBackIcon
} from '@mui/icons-material';
import { login, verify2FA, saveAuthData } from '@/services/auth';

interface LoginForm {
  username: string;
  password: string;
}

interface TwoFactorForm {
  code: string;
}

/**
 * 登录页面
 */
export default function Login() {
  const navigate = useNavigate();
  const theme = useTheme();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  
  const [requires2FA, setRequires2FA] = useState(false);
  const [tempToken, setTempToken] = useState('');

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginForm>();

  const {
    register: register2FA,
    handleSubmit: handleSubmit2FA,
    formState: { errors: errors2FA },
  } = useForm<TwoFactorForm>();

  const onSubmit = async (data: LoginForm) => {
    try {
      setLoading(true);
      setError('');

      const response = await login(data);
      
      if (response.data.requires2FA && response.data.tempToken) {
        setRequires2FA(true);
        setTempToken(response.data.tempToken);
        return;
      }

      if (response.data.token && response.data.user) {
        saveAuthData(response.data.token, response.data.user);
        navigate('/?scope=all');
      }
    } catch (err: any) {
      setError(err || '登录失败，请重试');
    } finally {
      setLoading(false);
    }
  };

  const on2FASubmit = async (data: TwoFactorForm) => {
    try {
      setLoading(true);
      setError('');

      const response = await verify2FA({
        tempToken,
        code: data.code,
      });

      if (response.data.token && response.data.user) {
        saveAuthData(response.data.token, response.data.user);
        navigate('/?scope=all');
      }
    } catch (err: any) {
      setError(err || '验证码错误，请重试');
    } finally {
      setLoading(false);
    }
  };

  const handleBack = () => {
    setRequires2FA(false);
    setTempToken('');
    setError('');
  };

  return (
    <Box
      sx={{
        minHeight: '100vh',
        display: 'flex',
        bgcolor: 'background.default',
      }}
    >
      {/* 左侧装饰区域 - 桌面端显示 */}
      <Box
        sx={{
          flex: 1,
          display: { xs: 'none', md: 'flex' },
          flexDirection: 'column',
          justifyContent: 'center',
          alignItems: 'center',
          position: 'relative',
          background: `linear-gradient(135deg, ${theme.palette.primary.main} 0%, ${theme.palette.primary.dark} 100%)`,
          color: 'white',
          p: 6,
          overflow: 'hidden',
        }}
      >
        {/* 背景装饰圆 */}
        <Box
          sx={{
            position: 'absolute',
            top: -100,
            left: -100,
            width: 400,
            height: 400,
            borderRadius: '50%',
            background: 'rgba(255,255,255,0.03)',
          }}
        />
        <Box
          sx={{
            position: 'absolute',
            bottom: -50,
            right: -50,
            width: 300,
            height: 300,
            borderRadius: '50%',
            background: 'rgba(255,255,255,0.03)',
          }}
        />

        <Box sx={{ position: 'relative', zIndex: 1, maxWidth: 480, textAlign: 'center' }}>
          <CloudIcon sx={{ fontSize: 80, mb: 4, opacity: 0.9 }} />
          <Typography variant="h3" fontWeight="bold" gutterBottom>
            专业的 DNS 管理平台
          </Typography>
          <Typography variant="h6" sx={{ opacity: 0.7, fontWeight: 'normal', mt: 2, lineHeight: 1.6 }}>
            简单、高效、安全地管理您的 Cloudflare 域名解析记录和自定义主机名。
          </Typography>
        </Box>
      </Box>

      {/* 右侧登录表单区域 */}
      <Box
        sx={{
          flex: { xs: '1 1 auto', md: '0 0 500px' },
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          p: { xs: 3, sm: 6, md: 8 },
          bgcolor: 'background.paper',
        }}
      >
        <Box sx={{ maxWidth: 400, mx: 'auto', width: '100%' }}>
          {/* 移动端 Logo */}
          <Box sx={{ display: { md: 'none' }, mb: 4, textAlign: 'center' }}>
            <CloudIcon sx={{ fontSize: 48, color: 'primary.main' }} />
          </Box>

          {!requires2FA ? (
            <>
              <Box sx={{ mb: 4 }}>
                <Typography variant="h4" fontWeight="bold" gutterBottom color="text.primary">
                  欢迎回来
                </Typography>
                <Typography variant="body1" color="text.secondary">
                  请输入您的账户信息以继续
                </Typography>
              </Box>

              {error && (
                <Alert severity="error" sx={{ mb: 3, borderRadius: 2 }}>
                  {error}
                </Alert>
              )}

              <form onSubmit={handleSubmit(onSubmit)} autoComplete="on">
                <Stack spacing={2.5}>
                  <TextField
                    fullWidth
                    label="用户名或邮箱"
                    autoComplete="username"
                    {...register('username', { required: '请输入用户名或邮箱' })}
                    error={!!errors.username}
                    helperText={errors.username?.message}
                    InputProps={{
                      sx: { height: 50 }
                    }}
                  />

                  <TextField
                    fullWidth
                    type={showPassword ? 'text' : 'password'}
                    label="密码"
                    autoComplete="current-password"
                    {...register('password', { required: '请输入密码' })}
                    error={!!errors.password}
                    helperText={errors.password?.message}
                    InputProps={{
                      sx: { height: 50 },
                      endAdornment: (
                        <InputAdornment position="end">
                          <IconButton
                            onClick={() => setShowPassword(!showPassword)}
                            edge="end"
                          >
                            {showPassword ? <VisibilityOff /> : <Visibility />}
                          </IconButton>
                        </InputAdornment>
                      ),
                    }}
                  />

                  <Button
                    fullWidth
                    type="submit"
                    variant="contained"
                    size="large"
                    disabled={loading}
                    startIcon={!loading && <LoginIcon />}
                    sx={{ 
                      mt: 2, 
                      height: 48,
                      fontSize: '1rem',
                      fontWeight: 600
                    }}
                  >
                    {loading ? '登录中...' : '立即登录'}
                  </Button>
                </Stack>

                <Box sx={{ mt: 4, textAlign: 'center' }}>
                  <Typography variant="body2" color="text.secondary">
                    还没有账户？{' '}
                    <Link 
                      component={RouterLink} 
                      to="/register" 
                      underline="hover" 
                      fontWeight="600"
                      color="primary.main"
                    >
                      免费注册
                    </Link>
                  </Typography>
                </Box>
              </form>
            </>
          ) : (
            <>
              <Box sx={{ mb: 4 }}>
                <Button
                  startIcon={<ArrowBackIcon />}
                  onClick={handleBack}
                  sx={{ mb: 2, ml: -1 }}
                >
                  返回
                </Button>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2 }}>
                  <SecurityIcon sx={{ fontSize: 40, color: 'primary.main' }} />
                  <Typography variant="h4" fontWeight="bold" color="text.primary">
                    两步验证
                  </Typography>
                </Box>
                <Typography variant="body1" color="text.secondary">
                  请输入您的身份验证器应用中的 6 位验证码
                </Typography>
              </Box>

              {error && (
                <Alert severity="error" sx={{ mb: 3, borderRadius: 2 }}>
                  {error}
                </Alert>
              )}

              <form onSubmit={handleSubmit2FA(on2FASubmit)} autoComplete="off">
                <Stack spacing={2.5}>
                  <TextField
                    fullWidth
                    label="验证码"
                    placeholder="000000"
                    autoComplete="one-time-code"
                    {...register2FA('code', { 
                      required: '请输入验证码',
                      pattern: {
                        value: /^\d{6}$/,
                        message: '验证码必须是 6 位数字'
                      }
                    })}
                    error={!!errors2FA.code}
                    helperText={errors2FA.code?.message}
                    InputProps={{
                      sx: { 
                        height: 50,
                        fontSize: '1.5rem',
                        letterSpacing: '0.5em',
                        textAlign: 'center'
                      }
                    }}
                    inputProps={{
                      inputMode: 'numeric',
                      pattern: '[0-9]*',
                      maxLength: 6,
                      style: { textAlign: 'center' }
                    }}
                    autoFocus
                  />

                  <Button
                    fullWidth
                    type="submit"
                    variant="contained"
                    size="large"
                    disabled={loading}
                    startIcon={!loading && <SecurityIcon />}
                    sx={{ 
                      mt: 2, 
                      height: 48,
                      fontSize: '1rem',
                      fontWeight: 600
                    }}
                  >
                    {loading ? '验证中...' : '验证'}
                  </Button>
                </Stack>
              </form>
            </>
          )}
        </Box>
        
        {/* 底部版权信息 */}
        <Box sx={{ mt: 8, textAlign: 'center' }}>
        <Typography variant="body2" color="text.secondary" align="center" sx={{ mt: 8, mb: 4, opacity: 0.7 }}>
          &copy; {new Date().getFullYear()} DNS Panel. All rights reserved.
        </Typography>
        </Box>
      </Box>
    </Box>
  );
}
