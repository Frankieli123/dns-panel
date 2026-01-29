import { Box, Card, CardContent, Grid, Typography, Radio, alpha, useTheme } from '@mui/material';
import {
  CloudQueue,
  Storage,
  Language,
  Cloud,
  CloudCircle,
  Public,
  Whatshot,
  CloudDone,
  Dns,
  Label,
  PowerSettingsNew,
  RocketLaunch,
} from '@mui/icons-material';
import { ProviderConfig, ProviderType } from '@/types/dns';

interface ProviderSelectorProps {
  providers: ProviderConfig[];
  selectedProvider: ProviderType | null;
  onSelect: (provider: ProviderType) => void;
}

const PROVIDER_COLORS: Record<string, string> = {
  cloudflare: '#f38020',
  aliyun: '#ff6a00',
  dnspod: '#0052d9',
  dnspod_token: '#0052d9',
  huawei: '#e60012',
  baidu: '#2932e1',
  west: '#1e88e5',
  huoshan: '#1f54f7',
  jdcloud: '#e1251b',
  dnsla: '#4caf50',
  namesilo: '#2196f3',
  powerdns: '#333333',
  spaceship: '#7e57c2',
};

export const getProviderIcon = (type: string, size: 'small' | 'large' = 'large') => {
  const fontSize = size === 'large' ? 'medium' : 'small';
  const color = PROVIDER_COLORS[type] || '#757575';
  const sx = { color };

  switch (type) {
    case 'cloudflare':
      return <CloudQueue fontSize={fontSize} sx={sx} />;
    case 'aliyun':
      return <Storage fontSize={fontSize} sx={sx} />;
    case 'dnspod':
    case 'dnspod_token':
      return <Language fontSize={fontSize} sx={sx} />;
    case 'huawei':
      return <Cloud fontSize={fontSize} sx={sx} />;
    case 'baidu':
      return <CloudCircle fontSize={fontSize} sx={sx} />;
    case 'west':
      return <Public fontSize={fontSize} sx={sx} />;
    case 'huoshan':
      return <Whatshot fontSize={fontSize} sx={sx} />;
    case 'jdcloud':
      return <CloudDone fontSize={fontSize} sx={sx} />;
    case 'dnsla':
      return <Dns fontSize={fontSize} sx={sx} />;
    case 'namesilo':
      return <Label fontSize={fontSize} sx={sx} />;
    case 'powerdns':
      return <PowerSettingsNew fontSize={fontSize} sx={sx} />;
    case 'spaceship':
      return <RocketLaunch fontSize={fontSize} sx={sx} />;
    default:
      return <Language fontSize={fontSize} sx={sx} />;
  }
};

export default function ProviderSelector({ providers, selectedProvider, onSelect }: ProviderSelectorProps) {
  const theme = useTheme();

  return (
    <Box sx={{ 
      maxHeight: '60vh', 
      overflowY: 'auto', 
      p: 0.5,
      // 自定义滚动条样式
      '&::-webkit-scrollbar': {
        width: '6px',
      },
      '&::-webkit-scrollbar-track': {
        background: 'transparent',
      },
      '&::-webkit-scrollbar-thumb': {
        background: (theme) => alpha(theme.palette.text.secondary, 0.15),
        borderRadius: '3px',
      },
      '&::-webkit-scrollbar-thumb:hover': {
        background: (theme) => alpha(theme.palette.text.secondary, 0.3),
      },
    }}>
      <Grid container spacing={1.5}>
        {providers.filter(p => p.type !== 'dnspod_token').map((provider) => {
          const providerType = provider.type;
          const isSelected = !!providerType && selectedProvider === providerType;
          const brandColor = PROVIDER_COLORS[providerType] || theme.palette.primary.main;

          return (
            <Grid item xs={4} sm={3} md={2} key={provider.type || provider.name}>
              <Card
                variant="outlined"
                sx={{
                  cursor: 'pointer',
                  height: '100%',
                  borderRadius: '10px',
                  borderColor: isSelected ? brandColor : undefined,
                  bgcolor: isSelected ? alpha(brandColor, 0.04) : undefined,
                  borderWidth: isSelected ? 2 : 1,
                  transition: 'all 0.2s',
                  '&:hover': {
                    borderColor: brandColor,
                    bgcolor: alpha(brandColor, 0.04),
                    transform: 'translateY(-2px)',
                    boxShadow: `0 4px 12px ${alpha(brandColor, 0.15)}`
                  }
                }}
                onClick={() => {
                  if (!providerType) return;
                  onSelect(providerType);
                }}
              >
                <CardContent sx={{ 
                  display: 'flex', 
                  flexDirection: 'column', 
                  alignItems: 'center', 
                  p: '10px !important',
                  gap: 1
                }}>
                  <Box sx={{
                    p: 0.5,
                    borderRadius: '50%',
                    bgcolor: alpha(brandColor, 0.1),
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: 32,
                    height: 32,
                    transition: 'all 0.2s'
                  }}>
                    {getProviderIcon(provider.type, 'large')}
                  </Box>
                  <Typography variant="body2" fontWeight="600" align="center" noWrap sx={{ width: '100%', fontSize: '0.75rem' }}>
                    {provider.name}
                  </Typography>
                  {/* Radio 按钮对于这种卡片选择模式可能有点多余，这里通过边框和背景色已经能很好区分选中状态了，如果需要可以简化或移除 */}
                  <Radio
                    checked={isSelected}
                    sx={{
                      p: 0,
                      opacity: isSelected ? 1 : 0, // 仅选中时显示，或者完全移除
                      height: 0,
                      width: 0,
                      overflow: 'hidden'
                    }}
                  />
                </CardContent>
              </Card>
            </Grid>
          );
        })}
      </Grid>
    </Box>
  );
}
