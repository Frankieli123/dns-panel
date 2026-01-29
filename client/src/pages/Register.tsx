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
  PersonAdd as PersonAddIcon 
} from '@mui/icons-material';
import { register as registerUser } from '@/services/auth';
import { isValidEmail, isStrongPassword } from '@/utils/validators';

interface RegisterForm {
  username: string;
  email?: string;
  password: string;
  confirmPassword: string;
}

/**
 * 注册页面
 */
export default function Register() {
  const navigate = useNavigate();
  const theme = useTheme();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<RegisterForm>();

  const password = watch('password');

  const onSubmit = async (data: RegisterForm) => {
    try {
      setLoading(true);
      setError('');

      await registerUser({
        username: data.username,
        email: data.email,
        password: data.password,
      });

      alert('注册成功！请登录');
      navigate('/login');
    } catch (err: any) {
      setError(err || '注册失败，请重试');
    } finally {
      setLoading(false);
    }
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
        <Box
          sx={{
            position: 'absolute',
            top: -100,
            right: -100,
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
            left: -50,
            width: 300,
            height: 300,
            borderRadius: '50%',
            background: 'rgba(255,255,255,0.03)',
          }}
        />

        <Box sx={{ position: 'relative', zIndex: 1, maxWidth: 480, textAlign: 'center' }}>
          <CloudIcon sx={{ fontSize: 80, mb: 4, opacity: 0.9 }} />
          <Typography variant="h3" fontWeight="bold" gutterBottom>
            开始您的体验
          </Typography>
          <Typography variant="h6" sx={{ opacity: 0.7, fontWeight: 'normal', mt: 2, lineHeight: 1.6 }}>
            只需几步即可创建账户并进入 DNS 管理控制台，开始管理您的域名与解析记录。
          </Typography>
        </Box>
      </Box>

      {/* 右侧注册表单区域 */}
      <Box
        sx={{
          flex: { xs: '1 1 auto', md: '0 0 600px' }, // 稍微宽一点
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          p: { xs: 3, sm: 6, md: 8 },
          bgcolor: 'background.paper',
          overflowY: 'auto', // 允许内容过多时滚动
          height: '100vh',
        }}
      >
        <Box sx={{ maxWidth: 460, mx: 'auto', width: '100%', py: 4 }}>
           {/* 移动端 Logo */}
           <Box sx={{ display: { md: 'none' }, mb: 3, textAlign: 'center' }}>
            <CloudIcon sx={{ fontSize: 48, color: 'primary.main' }} />
          </Box>

          <Box sx={{ mb: 4 }}>
            <Typography variant="h4" fontWeight="bold" gutterBottom color="text.primary">
              创建新账户
            </Typography>
            <Typography variant="body1" color="text.secondary">
              请填写以下信息以完成注册
            </Typography>
          </Box>

          {error && (
            <Alert severity="error" sx={{ mb: 3, borderRadius: 2 }}>
              {error}
            </Alert>
          )}

          <form onSubmit={handleSubmit(onSubmit)}>
            <Stack spacing={2}>
              <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 2 }}>
                <TextField
                  fullWidth
                  label="用户名"
                  {...register('username', {
                    required: '请输入用户名',
                    minLength: { value: 3, message: '用户名至少 3 个字符' },
                  })}
                  error={!!errors.username}
                  helperText={errors.username?.message}
                />
                <TextField
                  fullWidth
                  label="邮箱"
                  type="email"
                  {...register('email', {
                    validate: (value) =>
                      !value || isValidEmail(value) || '请输入有效的邮箱地址',
                  })}
                  error={!!errors.email}
                  helperText={errors.email?.message}
                />
              </Box>

              <TextField
                fullWidth
                type={showPassword ? 'text' : 'password'}
                label="密码"
                {...register('password', {
                  required: '请输入密码',
                  validate: (value) =>
                    isStrongPassword(value) || '密码至少 8 位，包含大小写字母和数字',
                })}
                error={!!errors.password}
                helperText={errors.password?.message}
                InputProps={{
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

              <TextField
                fullWidth
                type={showConfirmPassword ? 'text' : 'password'}
                label="确认密码"
                {...register('confirmPassword', {
                  required: '请确认密码',
                  validate: (value) => value === password || '两次密码输入不一致',
                })}
                error={!!errors.confirmPassword}
                helperText={errors.confirmPassword?.message}
                InputProps={{
                  endAdornment: (
                    <InputAdornment position="end">
                      <IconButton
                        onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                        edge="end"
                      >
                        {showConfirmPassword ? <VisibilityOff /> : <Visibility />}
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
                startIcon={!loading && <PersonAddIcon />}
                sx={{ 
                  mt: 2, 
                  height: 48,
                  fontSize: '1rem',
                  fontWeight: 600
                }}
              >
                {loading ? '注册中...' : '创建账户'}
              </Button>
            </Stack>

            <Box sx={{ mt: 4, textAlign: 'center' }}>
              <Typography variant="body2" color="text.secondary">
                已有账户？{' '}
                <Link 
                  component={RouterLink} 
                  to="/login"
                  underline="hover" 
                  fontWeight="600"
                  color="primary.main"
                >
                  直接登录
                </Link>
              </Typography>
            </Box>
          </form>
        </Box>
      </Box>
    </Box>
  );
}
