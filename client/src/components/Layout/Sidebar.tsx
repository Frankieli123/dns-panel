import {
  Box,
  Typography,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Avatar,
  Divider,
  useTheme,
  alpha,
  Skeleton,
  Tooltip,
  IconButton,
  Menu,
  MenuItem
} from '@mui/material';
import {
  CloudQueue as CloudflareIcon,
  Storage as AliyunIcon,
  Language as DnspodIcon,
  Cloud as HuaweiIcon,
  CloudCircle as BaiduIcon,
  Public as WestIcon,
  Whatshot as HuoshanIcon,
  CloudDone as JdcloudIcon,
  Dns as DnslaIcon,
  Label as NamesiloIcon,
  PowerSettingsNew as PowerdnsIcon,
  RocketLaunch as SpaceshipIcon,
  CloudQueue as CloudIcon,
  Logout as LogoutIcon,
  Settings as SettingsIcon,
  Dashboard as DashboardIcon,
  History as HistoryIcon
} from '@mui/icons-material';
import { useState } from 'react';
import { useProvider } from '@/contexts/ProviderContext';
import { ProviderType } from '@/types/dns';
import { useNavigate } from 'react-router-dom';
import { clearAuthData, getStoredUser } from '@/services/auth';

const PROVIDER_CONFIG: Record<ProviderType, { icon: React.ReactNode; color: string; name: string }> = {
  cloudflare: { icon: <CloudflareIcon />, color: '#f38020', name: 'Cloudflare' },
  aliyun: { icon: <AliyunIcon />, color: '#ff6a00', name: '阿里云' },
  dnspod: { icon: <DnspodIcon />, color: '#0052d9', name: '腾讯云' },
  dnspod_token: { icon: <DnspodIcon />, color: '#0052d9', name: '腾讯云' },
  huawei: { icon: <HuaweiIcon />, color: '#e60012', name: '华为云' },
  baidu: { icon: <BaiduIcon />, color: '#2932e1', name: '百度云' },
  west: { icon: <WestIcon />, color: '#1e88e5', name: '西部数码' },
  huoshan: { icon: <HuoshanIcon />, color: '#1f54f7', name: '火山引擎' },
  jdcloud: { icon: <JdcloudIcon />, color: '#e1251b', name: '京东云' },
  dnsla: { icon: <DnslaIcon />, color: '#4caf50', name: 'DNSLA' },
  namesilo: { icon: <NamesiloIcon />, color: '#2196f3', name: 'NameSilo' },
  powerdns: { icon: <PowerdnsIcon />, color: '#333333', name: 'PowerDNS' },
  spaceship: { icon: <SpaceshipIcon />, color: '#7e57c2', name: 'Spaceship' },
};

const PROVIDER_ORDER: ProviderType[] = [
  'cloudflare', 'aliyun', 'dnspod', 'huawei', 'baidu', 'west',
  'huoshan', 'jdcloud', 'dnsla', 'namesilo', 'powerdns', 'spaceship',
];

interface SidebarProps {
  onClose?: () => void;
}

export default function Sidebar({ onClose }: SidebarProps) {
  const theme = useTheme();
  const navigate = useNavigate();
  const user = getStoredUser();
  const {
    providers,
    selectedProvider,
    selectProvider,
    getCredentialCountByProvider,
    isLoading,
  } = useProvider();

  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);

  const handleUserMenuOpen = (event: React.MouseEvent<HTMLElement>) => {
    setAnchorEl(event.currentTarget);
  };

  const handleUserMenuClose = () => {
    setAnchorEl(null);
  };

  const handleLogout = () => {
    clearAuthData();
    navigate('/login');
  };

  const handleSelectProvider = (type: ProviderType) => {
    selectProvider(type);
    navigate('/'); // 确保回到仪表盘查看该提供商的资源
    if (onClose) onClose();
  };

  if (isLoading) {
    return (
      <Box sx={{ p: 2 }}>
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} variant="rectangular" height={48} sx={{ mb: 1, borderRadius: 1, bgcolor: 'rgba(255,255,255,0.05)' }} />
        ))}
      </Box>
    );
  }

  const sortedProviders = PROVIDER_ORDER
    .map(type => providers.find(p => p.type === type))
    .filter((p): p is NonNullable<typeof p> => p !== undefined);

  return (
        <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', color: 'white' }}>
                                  {/* 品牌 Logo 区域 */}
                                  <Box sx={{ 
                                    px: 3.5,
                                    pt: 3,
                                    pb: 1, // 收紧底部
                                    display: 'flex', 
                                    alignItems: 'center', 
                                    gap: 2,
                                    color: 'white',
                                  }}>
                                    <Avatar 
                                      sx={{ 
                                        bgcolor: theme.palette.primary.main,
                                        width: 48,
                                        height: 48,
                                        boxShadow: `0 0 20px ${alpha(theme.palette.primary.main, 0.4)}`
                                      }}
                                      variant="rounded"
                                    >
                                      <CloudIcon fontSize="medium" />
                                    </Avatar>
                                    <Box sx={{ display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                                      <Typography variant="h6" fontWeight="800" sx={{ lineHeight: 1.1, letterSpacing: 0.5, color: 'white', fontSize: '1.2rem' }}>
                                        DNS Panel
                                      </Typography>
                                      <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.6)', mt: 0.5, fontSize: '0.8rem', fontWeight: 500 }}>
                                        DNS 管理系统
                                      </Typography>
                                    </Box>
                                  </Box>
                            
                                  <Divider sx={{ borderColor: 'rgba(255,255,255,0.08)', mx: 3.5, mt: 1.5, mb: 0.5 }} />                      
                            
                      
                        {/* 仪表盘入口 */}
                            
                      
                        <Box sx={{ px: 2, mb: 0 }}>
                            
                      
                          <ListItemButton
                            
                      
                            onClick={() => {
                            
                      
                         selectProvider(null);
                         navigate('/?scope=all');
                            
                      
                         if (onClose) onClose();
                            
                      
                      }}
                            
                      
                      sx={{
                        py: 0.8,
                        px: 2,
                        borderRadius: '12px',
                        bgcolor: !selectedProvider ? 'rgba(255,255,255,0.1)' : 'transparent',
                        color: !selectedProvider ? 'white' : 'rgba(255,255,255,0.7)',
                        '&:hover': {
                          bgcolor: !selectedProvider ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.05)',
                          color: 'white'
                        },
                        '&.Mui-focusVisible': { bgcolor: 'transparent' },
                        '&:active': { bgcolor: 'transparent' }
                      }}
                            
                      
                    >
                            
                      
                      <Box
                            
                      
                        sx={{
                            
                      
                          width: 32,
                            
                      
                          height: 32,
                            
                      
                          display: 'flex',
                            
                      
                          alignItems: 'center',
                            
                      
                          justifyContent: 'center',
                            
                      
                          color: 'white',
                            
                      
                          mr: 2,
                            
                      
                        }}
                            
                      
                      >
                            
                      
                        <DashboardIcon fontSize="small" sx={{ fontSize: 20 }} />
                            
                      
                      </Box>
                      
                            
                      
                                                      <ListItemText 
                      
                            
                      
                                                        primary="仪表盘" 
                      
                            
                      
                                                        primaryTypographyProps={{
                      
                            
                      
                                                          variant: 'body2',
                      
                            
                      
                                                          fontWeight: 500,
                      
                            
                      
                                                          fontSize: '1rem'
                      
                            
                      
                                                        }}
                      
                            
                      
                                                      />
                      
                            
                      
                                          </ListItemButton>
                      
                            
                      
                                        </Box>
                      
                            
                      
                                        {/* 供应商列表区域 */}
                      
                            
                      
                                        <List component="nav" sx={{ 
                      
                            
                      
                                          px: 2, 
                      
                            
                      
                                          pt: 0,
                      
                            
                      
                                          flexGrow: 1, 
                      
                            
                      
                                          overflowY: 'auto',
                      
                                          '&::-webkit-scrollbar': { width: '4px' },
                      
                                          '&::-webkit-scrollbar-track': { background: 'transparent' },
                      
                                          '&::-webkit-scrollbar-thumb': { background: 'rgba(255, 255, 255, 0.1)', borderRadius: '4px' },
                      
                                          '&::-webkit-scrollbar-thumb:hover': { background: 'rgba(255, 255, 255, 0.2)' },
                      
                                        }}>
                      
                                          {sortedProviders.map((provider) => {
                      
                                            const config = PROVIDER_CONFIG[provider.type];
                      
                                            const count = getCredentialCountByProvider(provider.type);
                      
                                            const isSelected = selectedProvider === provider.type;
                      
                                            const hasAccounts = count > 0;
                      
                                  
                      
                                            return (
                      
                                              <Box key={provider.type} sx={{ mb: 0.8 }}>
                      
                                                <ListItemButton
                      
                                                  onClick={() => hasAccounts ? handleSelectProvider(provider.type) : undefined}
                      
                                                  sx={{
                      
                                                    borderRadius: '12px',
                      
                                                    py: 1.2,
                      
                                                    px: 2,
                      
                                                    bgcolor: isSelected ? alpha(config.color, 0.12) : 'transparent',
                      
                                                    border: '1px solid',
                      
                                                    borderColor: isSelected ? alpha(config.color, 0.3) : 'rgba(255,255,255,0.06)',
                      
                                                    color: isSelected ? 'white' : 'rgba(255,255,255,0.75)',
                      
                                                    transition: 'all 0.2s ease',
                      
                                                    '&:hover': {
                      
                                                      bgcolor: isSelected ? alpha(config.color, 0.18) : 'rgba(255,255,255,0.04)',
                      
                                                      borderColor: isSelected ? config.color : 'rgba(255,255,255,0.2)',
                      
                                                      color: 'white',
                      
                                                      transform: 'translateX(4px)'
                      
                                                    },
                      
                                                    opacity: hasAccounts ? 1 : 0.5,
                      
                                                    cursor: hasAccounts ? 'pointer' : 'default',
                      
                                                  }}
                      
                                                >
                      
                                                  <Box
                      
                                                    sx={{
                      
                                                      width: 32,
                      
                                                      height: 32,
                      
                                                      borderRadius: '8px',
                      
                                                      display: 'flex',
                      
                                                      alignItems: 'center',
                      
                                                      justifyContent: 'center',
                      
                                                      bgcolor: alpha(config.color, 0.15),
                      
                                                      color: config.color,
                      
                                                      mr: 2,
                      
                                                      '& svg': { fontSize: 20 },
                      
                                                    }}
                      
                                                  >
                      
                                                    {config.icon}
                      
                                                  </Box>
                      
                                  
                      
                                                  <ListItemText 
                      
                                                    primary={config.name} 
                      
                                                    primaryTypographyProps={{ 
                      
                                                      variant: 'body2', 
                      
                                                      fontWeight: isSelected ? 700 : 500,
                      
                                                      fontSize: '0.9rem'
                      
                                                    }}
                      
                                                  />
                      
                                                  
                      
                                                  {hasAccounts && (
                      
                                                    <Box
                      
                                                      sx={{
                      
                                                        bgcolor: isSelected ? config.color : 'rgba(255,255,255,0.1)',
                      
                                                        color: isSelected ? 'white' : 'rgba(255,255,255,0.5)',
                      
                                                        fontSize: '0.7rem',
                      
                                                        fontWeight: 'bold',
                      
                                                        borderRadius: '10px',
                      
                                                        minWidth: 20,
                      
                                                        height: 20,
                      
                                                        display: 'flex',
                      
                                                        alignItems: 'center',
                      
                                                        justifyContent: 'center',
                      
                                                        px: 0.8
                      
                                                      }}
                      
                                                    >
                      
                                                      {count}
                      
                                                    </Box>
                      
                                                  )}
                      
                                                </ListItemButton>
                      
                                              </Box>
                      
                                            );
                      
                                          })}
                      
                                              </List>
                      
                                              
                      
            {/* 底部用户区域 */}
                      
                                              
                      
            <Box sx={{ p: 2, pt: 1 }}>
                      
                                              
                      
              <Box 
                      
                                              
                      
                sx={{ 
                      
                                              
                      
                  display: 'flex', 
                      
                                              
                      
                  alignItems: 'center', 
                      
                                              
                      
                  gap: 2,
                      
                                              
                      
                  p: 1.5,
                      
                                              
                      
                  borderRadius: '12px',
                      
                                              
                      
                  bgcolor: 'rgba(255,255,255,0.03)',
                      
                                              
                      
                  border: '1px solid rgba(255,255,255,0.05)',
                      
                                              
                      
                  cursor: 'pointer',
                      
                                              
                      
                  transition: 'all 0.2s',
                      
                                              
                      
                  '&:hover': { 
                      
                                              
                      
                    bgcolor: 'rgba(255,255,255,0.08)',
                      
                                              
                      
                    borderColor: 'rgba(255,255,255,0.1)'
                      
                                              
                      
                  }
                      
                                              
                      
                }}
                      
                                              
                      
                onClick={handleUserMenuOpen}
                      
                                              
                      
              >
                      
                                              
                      
                <Avatar 
                      
                                              
                      
                  sx={{ 
                      
                                              
                      
                    width: 36, 
                      
                                              
                      
                    height: 36, 
                      
                                              
                      
                    bgcolor: theme.palette.primary.light,
                      
                                              
                      
                    fontSize: '1rem'
                      
                                              
                      
                  }}
                      
                                              
                      
                >
                      
                                              
                      
                  {user?.username?.charAt(0).toUpperCase()}
                      
                                              
                      
                </Avatar>
                      
                                              
                      
                <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                      
                                              
                      
                  <Typography variant="subtitle2" color="white" noWrap fontWeight="bold">
                      
                                              
                      
                    {user?.username}
                      
                                              
                      
                  </Typography>
                      
                                              
                      
                  <Typography variant="caption" color="rgba(255,255,255,0.5)" noWrap>
                      
                                              
                      
                    管理员
                      
                                              
                      
                  </Typography>
                      
                                              
                      
                </Box>
                      
                                              
                      
                
                      
                                              
                      
                {/* 右侧功能图标垂直排列 */}
                      
                                              
                      
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                      
                                              
                      
                  <Tooltip title="操作日志" placement="left">
                      
                                              
                      
                    <IconButton 
                      
                                              
                      
                      size="small" 
                      
                                              
                      
                      onClick={(e) => { e.stopPropagation(); navigate('/logs'); }}
                      
                                              
                      
                      sx={{ 
                      
                                              
                      
                        color: 'rgba(255,255,255,0.5)', 
                      
                                              
                      
                        p: 0.2,
                      
                                              
                      
                        '&:hover': { color: 'white' } 
                      
                                              
                      
                      }}
                      
                                              
                      
                    >
                      
                                              
                      
                      <HistoryIcon sx={{ fontSize: 18 }} />
                      
                                              
                      
                    </IconButton>
                      
                                              
                      
                  </Tooltip>
                      
                                              
                      
                  <Tooltip title="系统设置" placement="left">
                      
                                              
                      
                    <IconButton 
                      
                                              
                      
                      size="small" 
                      
                                              
                      
                      onClick={(e) => { e.stopPropagation(); navigate('/settings'); }}
                      
                                              
                      
                      sx={{ 
                      
                                              
                      
                        color: 'rgba(255,255,255,0.5)', 
                      
                                              
                      
                        p: 0.2,
                      
                                              
                      
                        '&:hover': { color: 'white' } 
                      
                                              
                      
                      }}
                      
                                              
                      
                    >
                      
                                              
                      
                      <SettingsIcon sx={{ fontSize: 18 }} />
                      
                                              
                      
                    </IconButton>
                      
                                              
                      
                  </Tooltip>
                      
                                              
                      
                </Box>
                      
                                              
                      
              </Box>
                      
                                          
                      
                                          <Menu
                      
                                            anchorEl={anchorEl}
                      
                                            open={Boolean(anchorEl)}
                      
                                            onClose={handleUserMenuClose}
                      
                                            PaperProps={{
                      
                                              sx: {
                      
                                                mt: -1,
                      
                                                ml: 1,
                      
                                                width: 220,
                      
                                                bgcolor: '#1e293b',
                      
                                                color: 'white',
                      
                                                border: '1px solid rgba(255,255,255,0.1)'
                      
                                              }
                      
                                            }}
                      
                                            transformOrigin={{ horizontal: 'left', vertical: 'bottom' }}
                      
                                            anchorOrigin={{ horizontal: 'left', vertical: 'top' }}
                      
                                          >
                      
                                            <MenuItem onClick={handleLogout} sx={{ color: theme.palette.error.light, '&:hover': { bgcolor: 'rgba(255,50,50,0.1)' } }}>
                      
                                              <ListItemIcon sx={{ color: theme.palette.error.light }}>
                      
                                                <LogoutIcon fontSize="small" />
                      
                                              </ListItemIcon>
                      
                                              <ListItemText primary="退出登录" />
                      
                                            </MenuItem>
                      
                                          </Menu>
                      
                                        </Box>
    </Box>
  );
}
