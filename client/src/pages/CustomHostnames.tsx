import { useState, useRef } from 'react';
import { useParams, useLocation, useNavigate } from 'react-router-dom';
import {
  Box,
  Alert,
  TextField,
  InputAdornment,
  Stack,
  Button,
  Card,
  CardContent,
  useTheme,
  useMediaQuery,
  IconButton,
  Typography,
} from '@mui/material';
import {
  Search as SearchIcon,
  Add as AddIcon,
  Settings as SettingsIcon,
  ArrowBack as ArrowBackIcon,
} from '@mui/icons-material';
import CustomHostnameList, { CustomHostnameListRef } from '@/components/CustomHostnameList/CustomHostnameList';
import { useProvider } from '@/contexts/ProviderContext';

/**
 * 自定义主机名管理页面
 */
export default function CustomHostnames() {
  const { zoneId } = useParams<{ zoneId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const [searchKeyword, setSearchKeyword] = useState('');
  const listRef = useRef<CustomHostnameListRef>(null);

  const { selectedCredentialId } = useProvider();
  const credParam = new URLSearchParams(location.search).get('credentialId');
  const parsedCredId = credParam ? parseInt(credParam, 10) : undefined;
  const credFromQuery = typeof parsedCredId === 'number' && Number.isFinite(parsedCredId)
    ? parsedCredId
    : undefined;
  const credentialId = typeof credFromQuery === 'number'
    ? credFromQuery
    : (typeof selectedCredentialId === 'number' ? selectedCredentialId : undefined);
  const missingCredentialContext = selectedCredentialId === 'all' && typeof credFromQuery !== 'number';

  if (missingCredentialContext) {
    return (
      <Alert severity="warning" sx={{ mt: 2 }}>
        请从域名列表进入该页面，或在地址栏携带 credentialId 参数（例如：?credentialId=123）。
      </Alert>
    );
  }

  if (!zoneId) {
     return null;
  }

  return (
    <Box>
      {/* 移动端顶部标题栏 */}
      {isMobile && (
        <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 2 }}>
          <IconButton 
            edge="start" 
            onClick={() => navigate(-1)}
            aria-label="back"
          >
            <ArrowBackIcon />
          </IconButton>
          <Typography variant="h6" fontWeight="bold">
            主机名管理
          </Typography>
        </Stack>
      )}

      {/* 顶部操作栏 */}
      <Box sx={{ mb: 2 }}>
        <Stack 
          direction={{ xs: 'column', sm: 'row' }} 
          justifyContent="space-between" 
          alignItems={{ xs: 'stretch', sm: 'center' }}
          spacing={2}
        >
          <TextField
            size="small"
            placeholder="搜索主机名..."
            value={searchKeyword}
            onChange={(e) => setSearchKeyword(e.target.value)}
            sx={{ width: { xs: '100%', sm: 240 } }}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon color="action" fontSize="small" />
                </InputAdornment>
              ),
            }}
          />
          <Stack direction="row" spacing={2} sx={{ justifyContent: { xs: 'flex-end', sm: 'flex-start' } }}>
            <Button
              variant="outlined"
              startIcon={<SettingsIcon />}
              onClick={() => listRef.current?.openFallbackDialog()}
              sx={{ px: 3, flex: { xs: 1, sm: 'none' } }}
            >
              回退源
            </Button>
            <Button
              variant="contained"
              startIcon={<AddIcon />}
              onClick={() => listRef.current?.openAddDialog()}
              sx={{ px: 3, flex: { xs: 1, sm: 'none' } }}
            >
              添加主机名
            </Button>
          </Stack>
        </Stack>
      </Box>

      <Card sx={{ 
        border: 'none', 
        boxShadow: isMobile ? 'none' : '0 4px 20px rgba(0,0,0,0.05)',
        bgcolor: isMobile ? 'transparent' : 'background.paper' 
      }}>
        <CardContent sx={{ p: isMobile ? 0 : 0 }}>
           {/* 直接使用复用组件，它包含了列表、卡片视图、添加/设置弹窗等所有逻辑 */}
           <CustomHostnameList 
              ref={listRef}
              zoneId={zoneId} 
              credentialId={credentialId} 
              filterKeyword={searchKeyword}
           />
        </CardContent>
      </Card>
    </Box>
  );
}
