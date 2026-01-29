import { useState, useEffect, forwardRef, useImperativeHandle } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Box,
  Typography,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Button,
  Chip,
  CircularProgress,
  Alert,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  FormControlLabel,
  Checkbox,
  Stack,
  IconButton,
  Tooltip,
  Collapse,
  Grid,
  useTheme,
  useMediaQuery,
  Card,
  CardContent,
  CardActions,
  Divider,
} from '@mui/material';
import { 
  Delete as DeleteIcon, 
  Language as LanguageIcon,
  KeyboardArrowDown as KeyboardArrowDownIcon,
  KeyboardArrowUp as KeyboardArrowUpIcon,
  ContentCopy as ContentCopyIcon,
  Settings as SettingsIcon,
  ExpandMore as ExpandMoreIcon
} from '@mui/icons-material';
import { 
  getCustomHostnames, 
  createCustomHostname, 
  deleteCustomHostname,
  getFallbackOrigin,
  updateFallbackOrigin
} from '@/services/hostnames';
import { formatDateTime } from '@/utils/formatters';

export interface CustomHostnameListRef {
  openAddDialog: () => void;
  openFallbackDialog: () => void;
}

interface CustomHostnameListProps {
  zoneId: string;
  credentialId?: number;
  filterKeyword?: string;
}

/**
 * Component for managing Custom Hostnames for a specific domain.
 * Designed to be used within the DnsManagement tabbed view.
 */
const CustomHostnameList = forwardRef<CustomHostnameListRef, CustomHostnameListProps>(({ zoneId, credentialId, filterKeyword }, ref) => {
  const queryClient = useQueryClient();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [showFallbackDialog, setShowFallbackDialog] = useState(false);
  const [hostname, setHostname] = useState('');
  const [useCustomOriginServer, setUseCustomOriginServer] = useState(false);
  const [customOriginServer, setCustomOriginServer] = useState('');
  const [customOriginServerError, setCustomOriginServerError] = useState('');
  const [originInput, setOriginInput] = useState('');
  const [inputError, setInputError] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const closeAddDialog = () => {
    setShowAddDialog(false);
    setHostname('');
    setInputError(false);
    setUseCustomOriginServer(false);
    setCustomOriginServer('');
    setCustomOriginServerError('');
  };

  useImperativeHandle(ref, () => ({
    openAddDialog: () => {
      setHostname('');
      setInputError(false);
      setUseCustomOriginServer(false);
      setCustomOriginServer('');
      setCustomOriginServerError('');
      setShowAddDialog(true);
    },
    openFallbackDialog: () => setShowFallbackDialog(true),
  }));

  // Fetch Hostnames
  const { data: hostnamesData, isLoading, error } = useQuery({
    queryKey: ['custom-hostnames', zoneId, credentialId],
    queryFn: () => getCustomHostnames(zoneId, credentialId),
    enabled: !!zoneId,
  });

  // Fetch Fallback Origin
  const { data: originData } = useQuery({
    queryKey: ['fallback-origin', zoneId, credentialId],
    queryFn: () => getFallbackOrigin(zoneId, credentialId),
    enabled: showFallbackDialog,
  });

  // Sync origin input
  useEffect(() => {
    if (originData?.data?.origin) {
      setOriginInput(originData.data.origin);
    } else if (showFallbackDialog && originData) {
        setOriginInput('');
    }
  }, [originData, showFallbackDialog]);

  const createMutation = useMutation({
    mutationFn: (input: { hostname: string; customOriginServer?: string }) =>
      createCustomHostname(zoneId, input.hostname, {
        credentialId,
        customOriginServer: input.customOriginServer,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['custom-hostnames', zoneId, credentialId] });
      setShowAddDialog(false);
      setHostname('');
      setInputError(false);
      setUseCustomOriginServer(false);
      setCustomOriginServer('');
      setCustomOriginServerError('');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (hostnameId: string) => deleteCustomHostname(zoneId, hostnameId, credentialId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['custom-hostnames', zoneId, credentialId] });
    },
  });

  const updateOriginMutation = useMutation({
    mutationFn: (origin: string) => updateFallbackOrigin(zoneId, origin, credentialId),
    onSuccess: (data) => {
      queryClient.setQueryData(['fallback-origin', zoneId, credentialId], data);
      setShowFallbackDialog(false);
    },
  });

  const handleAdd = () => {
    setCustomOriginServerError('');

    const trimmedHostname = hostname.trim();
    if (!trimmedHostname) {
      setInputError(true);
      return;
    }

    let origin: string | undefined;
    if (useCustomOriginServer) {
      const trimmedOrigin = customOriginServer.trim();
      if (trimmedOrigin) {
        if (/^https?:\/\//i.test(trimmedOrigin)) {
          setCustomOriginServerError('源服务器不支持包含 http:// 或 https://');
          return;
        }

        if (trimmedOrigin.includes('*')) {
          setCustomOriginServerError('源服务器不支持通配符');
          return;
        }

        if (trimmedOrigin.includes(':')) {
          setCustomOriginServerError('源服务器不支持端口或 IP 地址，请填写域名');
          return;
        }

        if (trimmedOrigin.includes('/') || trimmedOrigin.includes(' ')) {
          setCustomOriginServerError('源服务器格式不正确');
          return;
        }

        const ipv4 = /^(?:\d{1,3}\.){3}\d{1,3}$/;
        if (ipv4.test(trimmedOrigin)) {
          setCustomOriginServerError('Cloudflare 自定义源服务器不支持 IP 地址，请填写域名');
          return;
        }

        origin = trimmedOrigin;
      }
    }

    createMutation.mutate({ hostname: trimmedHostname, customOriginServer: origin });
  };

  const handleUpdateOrigin = () => {
    updateOriginMutation.mutate(originInput.trim());
  };

  const handleDelete = (hostnameId: string) => {
    if (window.confirm('确定要删除这个自定义主机名吗？')) {
      deleteMutation.mutate(hostnameId);
    }
  };

  const handleExpandClick = (id: string) => {
    setExpandedId(expandedId === id ? null : id);
  };

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    // TODO: show snackbar
  };

  if (isLoading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', p: 3 }}>
        <CircularProgress size={24} />
      </Box>
    );
  }

  if (error) {
    const errorMessage = (error as any)?.message || String(error);
    const isAuthError = errorMessage.includes('403') || errorMessage.includes('Authentication error');

    return (
      <Alert severity={isAuthError ? 'warning' : 'error'} sx={{ m: 2 }}>
        {isAuthError ? (
          <Box>
            <Typography variant="subtitle2" fontWeight="bold" gutterBottom>
              权限不足或功能不可用
            </Typography>
            <Typography variant="caption" display="block">
              无法访问自定义主机名功能。可能原因：
              1. API Token 缺少权限
              2. 账户套餐不支持 (需 Business/Enterprise)
              3. 未启用该功能
            </Typography>
          </Box>
        ) : (
          errorMessage
        )}
      </Alert>
    );
  }

  const allHostnames = hostnamesData?.data?.hostnames || [];
  const hostnames = filterKeyword?.trim()
    ? allHostnames.filter((item: any) => {
        const keyword = filterKeyword.toLowerCase();
        return (
          item.hostname?.toLowerCase().includes(keyword) ||
          item.ssl?.status?.toLowerCase().includes(keyword)
        );
      })
    : allHostnames;

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active':
        return 'success';
      case 'pending':
        return 'warning';
      case 'moved':
        return 'error';
      default:
        return 'default';
    }
  };

  const getSSLStatusColor = (status: string) => {
    switch (status) {
      case 'active':
        return 'success';
      case 'pending_validation':
        return 'warning';
      case 'pending_deployment':
        return 'info';
      default:
        return 'default';
    }
  };

  const renderMobileView = () => (
    <Stack spacing={2}>
      {hostnames.length === 0 ? (
        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', py: 4, color: 'text.secondary' }}>
           <Typography variant="body2">暂无自定义主机名</Typography>
        </Box>
      ) : (
        hostnames.map((item: any) => {
          const isExpanded = expandedId === item.id;
          
          return (
            <Card key={item.id} variant="outlined" sx={{ borderRadius: 2 }}>
              <CardContent sx={{ p: 2, pb: 1, '&:last-child': { pb: 1 } }}>
                <Box onClick={() => handleExpandClick(item.id)} sx={{ cursor: 'pointer' }}>
                   <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
                      <Typography variant="subtitle1" fontWeight="600" sx={{ wordBreak: 'break-all' }}>
                        {item.hostname}
                      </Typography>
                      <IconButton 
                        size="small"
                        sx={{ transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }}
                      >
                         <ExpandMoreIcon />
                      </IconButton>
                   </Stack>
                   
                   <Stack direction="row" spacing={1} sx={{ mb: 1.5, flexWrap: 'wrap', gap: 1 }}>
                     <Chip
                        label={item.status || 'unknown'}
                        color={getStatusColor(item.status) as any}
                        size="small"
                        sx={{ fontWeight: 'bold', height: 20, fontSize: '0.7rem' }}
                      />
                      <Chip
                        label={`SSL: ${item.ssl?.status || '未知'}`}
                        color={getSSLStatusColor(item.ssl?.status) as any}
                        size="small"
                        sx={{ fontWeight: 'bold', height: 20, fontSize: '0.7rem' }}
                      />
                      <Typography variant="caption" color="text.secondary" sx={{ display: 'flex', alignItems: 'center' }}>
                         {item.ssl?.method?.toUpperCase() || '-'}
                      </Typography>
                   </Stack>
                </Box>

                <Collapse in={isExpanded} timeout="auto" unmountOnExit>
                  <Divider sx={{ my: 1 }} />
                  <Box sx={{ mt: 1 }}>
                     {item.ssl?.validation_records ? (
                        item.ssl.validation_records.map((record: any, index: number) => (
                          <Box key={index} sx={{ mb: 2 }}>
                            <Typography variant="subtitle2" gutterBottom fontWeight="bold" color="primary" fontSize="0.8rem">
                              证书验证 (TXT)
                            </Typography>
                            <Stack spacing={1}>
                                <Box>
                                  <Typography variant="caption" color="text.secondary">TXT 名称</Typography>
                                  <Stack direction="row" alignItems="center" spacing={1}>
                                    <Typography variant="body2" fontFamily="monospace" fontSize="0.75rem" sx={{ wordBreak: 'break-all' }}>
                                      {record.txt_name}
                                    </Typography>
                                    <IconButton size="small" onClick={() => handleCopy(record.txt_name)} sx={{ p: 0.5 }}>
                                      <ContentCopyIcon sx={{ fontSize: 14 }} />
                                    </IconButton>
                                  </Stack>
                                </Box>
                                <Box>
                                  <Typography variant="caption" color="text.secondary">TXT 值</Typography>
                                  <Stack direction="row" alignItems="center" spacing={1}>
                                    <Typography variant="body2" fontFamily="monospace" fontSize="0.75rem" sx={{ wordBreak: 'break-all' }}>
                                      {record.txt_value}
                                    </Typography>
                                    <IconButton size="small" onClick={() => handleCopy(record.txt_value)} sx={{ p: 0.5 }}>
                                      <ContentCopyIcon sx={{ fontSize: 14 }} />
                                    </IconButton>
                                  </Stack>
                                </Box>
                            </Stack>
                          </Box>
                        ))
                      ) : (
                        <Typography variant="caption" color="text.secondary" sx={{ py: 1, display: 'block' }}>
                          无需验证或已完成验证
                        </Typography>
                      )}
                      
                      {item.ownership_verification && (
                        <Box sx={{ mt: 2 }}>
                          <Typography variant="subtitle2" gutterBottom fontWeight="bold" color="primary" fontSize="0.8rem">
                            所有权验证 ({item.ownership_verification.type.toUpperCase()})
                          </Typography>
                          <Stack spacing={1}>
                              <Box>
                                <Typography variant="caption" color="text.secondary">名称</Typography>
                                <Stack direction="row" alignItems="center" spacing={1}>
                                  <Typography variant="body2" fontFamily="monospace" fontSize="0.75rem" sx={{ wordBreak: 'break-all' }}>
                                    {item.ownership_verification.name}
                                  </Typography>
                                  <IconButton size="small" onClick={() => handleCopy(item.ownership_verification.name)} sx={{ p: 0.5 }}>
                                    <ContentCopyIcon sx={{ fontSize: 14 }} />
                                  </IconButton>
                                </Stack>
                              </Box>
                              <Box>
                                <Typography variant="caption" color="text.secondary">值</Typography>
                                <Stack direction="row" alignItems="center" spacing={1}>
                                  <Typography variant="body2" fontFamily="monospace" fontSize="0.75rem" sx={{ wordBreak: 'break-all' }}>
                                    {item.ownership_verification.value}
                                  </Typography>
                                  <IconButton size="small" onClick={() => handleCopy(item.ownership_verification.value)} sx={{ p: 0.5 }}>
                                    <ContentCopyIcon sx={{ fontSize: 14 }} />
                                  </IconButton>
                                </Stack>
                              </Box>
                          </Stack>
                        </Box>
                      )}
                  </Box>
                </Collapse>

              </CardContent>
              <Divider sx={{ borderStyle: 'dashed' }} />
              <CardActions sx={{ justifyContent: 'flex-end', px: 2, pt: 0.5, pb: 0.5 }}>
                <Button 
                   size="small" 
                   startIcon={<DeleteIcon sx={{ fontSize: 16 }} />} 
                   color="error" 
                   onClick={() => handleDelete(item.id)}
                >
                  删除
                </Button>
              </CardActions>
            </Card>
          );
        })
      )}
    </Stack>
  );

  return (
    <Box>
      {isMobile ? renderMobileView() : (
        <Table sx={{ minWidth: 650 }}>
          <TableHead>
            <TableRow>
              <TableCell width={50} />
              <TableCell>主机名</TableCell>
              <TableCell>状态</TableCell>
              <TableCell>SSL 状态</TableCell>
              <TableCell>验证方法</TableCell>
              <TableCell>创建时间</TableCell>
              <TableCell align="right">操作</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {hostnames.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} align="center" sx={{ py: 8 }}>
                   <Typography variant="body1" color="text.secondary">
                    暂无自定义主机名
                  </Typography>
                </TableCell>
              </TableRow>
            ) : (
              hostnames.map((item: any) => (
                <>
                  <TableRow 
                    key={item.id} 
                    hover 
                    onClick={() => handleExpandClick(item.id)}
                    sx={{ cursor: 'pointer', '& > *': { borderBottom: 'unset' } }}
                  >
                    <TableCell>
                      <IconButton size="small">
                        {expandedId === item.id ? <KeyboardArrowUpIcon /> : <KeyboardArrowDownIcon />}
                      </IconButton>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" fontWeight="500">
                        {item.hostname}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Chip
                        label={item.status || 'unknown'}
                        color={getStatusColor(item.status) as any}
                        size="small"
                        sx={{ fontWeight: 'bold', height: 24 }}
                      />
                    </TableCell>
                    <TableCell>
                      <Chip
                        label={item.ssl?.status || '未知'}
                        color={getSSLStatusColor(item.ssl?.status) as any}
                        size="small"
                        sx={{ fontWeight: 'bold', height: 24 }}
                      />
                    </TableCell>
                    <TableCell>{item.ssl?.method?.toUpperCase() || '-'}</TableCell>
                    <TableCell>{formatDateTime(item.created_at)}</TableCell>
                    <TableCell align="right">
                      <Tooltip title="删除主机名">
                        <IconButton
                          size="small"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDelete(item.id);
                          }}
                          sx={{ color: 'error.main' }}
                        >
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell style={{ paddingBottom: 0, paddingTop: 0 }} colSpan={7}>
                      <Collapse in={expandedId === item.id} timeout="auto" unmountOnExit>
                        <Box sx={{ py: 2, px: 5 }}>
                          {item.ssl?.validation_records ? (
                            item.ssl.validation_records.map((record: any, index: number) => (
                              <Box key={index} sx={{ mb: 2 }}>
                                <Typography variant="subtitle2" gutterBottom fontWeight="bold" color="primary">
                                  证书验证 (TXT)
                                </Typography>
                                <Grid container spacing={4}>
                                  <Grid item xs={12} md={5}>
                                    <Typography variant="caption" color="text.secondary">TXT 名称</Typography>
                                    <Stack direction="row" alignItems="center" spacing={1}>
                                      <Typography variant="body2" fontFamily="monospace" sx={{ wordBreak: 'break-all' }}>
                                        {record.txt_name}
                                      </Typography>
                                      <Tooltip title="复制">
                                        <IconButton size="small" onClick={() => handleCopy(record.txt_name)}>
                                          <ContentCopyIcon fontSize="small" />
                                        </IconButton>
                                      </Tooltip>
                                    </Stack>
                                  </Grid>
                                  <Grid item xs={12} md={7}>
                                    <Typography variant="caption" color="text.secondary">TXT 值</Typography>
                                    <Stack direction="row" alignItems="center" spacing={1}>
                                      <Typography variant="body2" fontFamily="monospace" sx={{ wordBreak: 'break-all' }}>
                                        {record.txt_value}
                                      </Typography>
                                      <Tooltip title="复制">
                                        <IconButton size="small" onClick={() => handleCopy(record.txt_value)}>
                                          <ContentCopyIcon fontSize="small" />
                                        </IconButton>
                                      </Tooltip>
                                    </Stack>
                                  </Grid>
                                </Grid>
                              </Box>
                            ))
                          ) : (
                            <Typography variant="body2" color="text.secondary" sx={{ py: 1 }}>
                              无需验证或已完成验证
                            </Typography>
                          )}
                          
                          {/* 所有的权验证 */}
                          {item.ownership_verification && (
                            <Box sx={{ mt: 2 }}>
                              <Typography variant="subtitle2" gutterBottom fontWeight="bold" color="primary">
                                所有权验证 ({item.ownership_verification.type.toUpperCase()})
                              </Typography>
                              <Grid container spacing={4}>
                                  <Grid item xs={12} md={5}>
                                    <Typography variant="caption" color="text.secondary">名称</Typography>
                                    <Stack direction="row" alignItems="center" spacing={1}>
                                      <Typography variant="body2" fontFamily="monospace" sx={{ wordBreak: 'break-all' }}>
                                        {item.ownership_verification.name}
                                      </Typography>
                                      <Tooltip title="复制">
                                        <IconButton size="small" onClick={() => handleCopy(item.ownership_verification.name)}>
                                          <ContentCopyIcon fontSize="small" />
                                        </IconButton>
                                      </Tooltip>
                                    </Stack>
                                  </Grid>
                                  <Grid item xs={12} md={7}>
                                    <Typography variant="caption" color="text.secondary">值</Typography>
                                    <Stack direction="row" alignItems="center" spacing={1}>
                                      <Typography variant="body2" fontFamily="monospace" sx={{ wordBreak: 'break-all' }}>
                                        {item.ownership_verification.value}
                                      </Typography>
                                      <Tooltip title="复制">
                                        <IconButton size="small" onClick={() => handleCopy(item.ownership_verification.value)}>
                                          <ContentCopyIcon fontSize="small" />
                                        </IconButton>
                                      </Tooltip>
                                    </Stack>
                                  </Grid>
                                </Grid>
                            </Box>
                          )}
                        </Box>
                      </Collapse>
                    </TableCell>
                  </TableRow>
                </>
              ))
            )}
          </TableBody>
        </Table>
      )}

      {/* 添加主机名对话框 */}
      <Dialog 
        open={showAddDialog} 
        onClose={closeAddDialog} 
        maxWidth="sm" 
        fullWidth
        PaperProps={{
          sx: { borderRadius: 2 }
        }}
      >
        <DialogTitle sx={{ pb: 2 }}>
          <Stack direction="row" alignItems="center" spacing={1}>
            <LanguageIcon color="primary" />
            <Typography variant="h6" fontWeight="bold">添加自定义主机名</Typography>
          </Stack>
        </DialogTitle>
        <DialogContent sx={{ pt: 2 }}>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField
              fullWidth
              margin="dense"
              label="主机名"
              placeholder="example.com"
              value={hostname}
              onChange={(e) => {
                setHostname(e.target.value);
                if (inputError) setInputError(false);
              }}
              error={inputError}
              helperText={inputError ? "主机名不能为空" : "输入您要添加的自定义域名，需要先在 DNS 中配置 CNAME 记录。"}
              InputLabelProps={{ shrink: true }}
            />

            <FormControlLabel
              control={
                <Checkbox
                  checked={useCustomOriginServer}
                  onChange={(e) => {
                    setUseCustomOriginServer(e.target.checked);
                    setCustomOriginServerError('');
                    if (!e.target.checked) {
                      setCustomOriginServer('');
                    }
                  }}
                />
              }
              label="使用自定义源服务器"
            />

            <Collapse in={useCustomOriginServer} timeout="auto" unmountOnExit>
              <TextField
                fullWidth
                margin="dense"
                label="自定义源服务器"
                placeholder="origin.example.com"
                value={customOriginServer}
                onChange={(e) => {
                  setCustomOriginServer(e.target.value);
                  if (customOriginServerError) setCustomOriginServerError('');
                }}
                error={!!customOriginServerError}
                helperText={customOriginServerError || "留空使用默认源服务器；填写时仅支持域名（hostname），不支持 IP。"}
                InputLabelProps={{ shrink: true }}
              />
            </Collapse>
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 3 }}>
          <Button onClick={closeAddDialog} color="inherit">取消</Button>
          <Button
            onClick={handleAdd}
            variant="contained"
            disabled={createMutation.isPending}
          >
            {createMutation.isPending ? '添加中...' : '添加'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* 回退源设置对话框 */}
      <Dialog 
        open={showFallbackDialog} 
        onClose={() => setShowFallbackDialog(false)} 
        maxWidth="sm" 
        fullWidth
        PaperProps={{
          sx: { borderRadius: 2 }
        }}
      >
        <DialogTitle sx={{ pb: 2 }}>
          <Stack direction="row" alignItems="center" spacing={1}>
            <SettingsIcon color="primary" />
            <Typography variant="h6" fontWeight="bold">回退源设置</Typography>
          </Stack>
        </DialogTitle>
        <DialogContent sx={{ pt: 2 }}>
          <TextField
            fullWidth
            margin="dense"
            label="回退源地址"
            placeholder="origin.example.com"
            value={originInput}
            onChange={(e) => setOriginInput(e.target.value)}
            helperText="当自定义主机名解析失败或未匹配时使用的默认源站地址。"
            InputLabelProps={{ shrink: true }}
          />
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 3 }}>
          <Button onClick={() => setShowFallbackDialog(false)} color="inherit">取消</Button>
          <Button
            onClick={handleUpdateOrigin}
            variant="contained"
            disabled={updateOriginMutation.isPending}
          >
            {updateOriginMutation.isPending ? '保存中...' : '保存'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
});

export default CustomHostnameList;