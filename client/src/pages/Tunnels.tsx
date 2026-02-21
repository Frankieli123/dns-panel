import { useParams, useLocation, useNavigate } from 'react-router-dom';
import {
  Box,
  Alert,
  Card,
  CardContent,
  useTheme,
  useMediaQuery,
  IconButton,
  Typography,
  Stack,
} from '@mui/material';
import { ArrowBack as ArrowBackIcon } from '@mui/icons-material';
import { useProvider } from '@/contexts/ProviderContext';

export default function Tunnels() {
  const { zoneId } = useParams<{ zoneId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));

  const { selectedCredentialId } = useProvider();
  const credParam = new URLSearchParams(location.search).get('credentialId');
  const parsedCredId = credParam ? parseInt(credParam, 10) : undefined;
  const credFromQuery = typeof parsedCredId === 'number' && Number.isFinite(parsedCredId)
    ? parsedCredId
    : undefined;
  const missingCredentialContext = selectedCredentialId === 'all' && typeof credFromQuery !== 'number';

  if (missingCredentialContext) {
    return (
      <Alert severity="warning" sx={{ mt: 2 }}>
        请从域名列表进入该页面，或在地址栏携带 credentialId 参数（例如：?credentialId=123）。
      </Alert>
    );
  }

  if (!zoneId) return null;

  return (
    <Box>
      {isMobile && (
        <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 2 }}>
          <IconButton edge="start" onClick={() => navigate(-1)} aria-label="back">
            <ArrowBackIcon />
          </IconButton>
          <Typography variant="h6" fontWeight="bold">
            Tunnel 管理
          </Typography>
        </Stack>
      )}

      <Card
        sx={{
          border: 'none',
          boxShadow: isMobile ? 'none' : '0 4px 20px rgba(0,0,0,0.05)',
          bgcolor: isMobile ? 'transparent' : 'background.paper',
        }}
      >
        <CardContent sx={{ p: isMobile ? 0 : 3 }}>
          <Alert severity="info">
            Tunnel 管理功能即将在此处添加。
          </Alert>
        </CardContent>
      </Card>
    </Box>
  );
}

