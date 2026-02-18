import { useState, useRef, useEffect, useCallback } from 'react';
import {
  Table,
  TableContainer,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  IconButton,
  Chip,
  Box,
  Tooltip,
  Typography,
  TextField,
  MenuItem,
  Switch,
  ListSubheader,
  useTheme,
  useMediaQuery,
  Stack,
  Card,
  CardContent,
  CardActions,
  Grid,
  Divider,
  Button,
} from '@mui/material';
import {
  Dns as DnsIcon,
  Edit as EditIcon,
  Delete as DeleteIcon,
  Cloud as CloudIcon,
  CloudQueue as CloudQueueIcon,
  Check as CheckIcon,
  Close as CloseIcon,
  PowerSettingsNew as PowerIcon,
  Save as SaveIcon,
} from '@mui/icons-material';
import { DNSRecord } from '@/types';
import { DnsLine, ProviderCapabilities, ProviderType } from '@/types/dns';
import { formatTTL } from '@/utils/formatters';
import { TTL_OPTIONS } from '@/utils/constants';
import { useProvider } from '@/contexts/ProviderContext';
import { alpha } from '@mui/material/styles';

interface DNSRecordTableProps {
  records: DNSRecord[];
  onUpdate: (recordId: string, params: any) => void;
  onDelete: (recordId: string) => void;
  onStatusChange?: (recordId: string, enabled: boolean) => void;
  lines?: DnsLine[];
  minTTL?: number;
  /** 固定操作列的数据行背景色，默认 #F1F5F9 */
  stickyBodyBgColor?: string;
  /** 显式指定供应商类型，用于覆盖全局上下文 */
  providerType?: ProviderType;
}

/**
 * DNS 记录表格组件
 * 根据供应商能力动态显示字段
 */
export default function DNSRecordTable({
  records,
  onUpdate,
  onDelete,
  onStatusChange,
  lines = [],
  minTTL,
  stickyBodyBgColor,
  providerType,
}: DNSRecordTableProps) {
  const { selectedProvider, currentCapabilities, getProviderCapabilities } = useProvider();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Partial<DNSRecord>>({});
  const [hasOverflow, setHasOverflow] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const bodyBgColor = stickyBodyBgColor ?? '#F1F5F9';

  // 检测是否有内容被遮挡
  const checkOverflow = useCallback(() => {
    const el = containerRef.current;
    if (el) {
      const isOverflowing = el.scrollWidth > el.clientWidth;
      const isScrolledLeft = el.scrollLeft > 0;
      setHasOverflow(isOverflowing && (el.scrollLeft < el.scrollWidth - el.clientWidth));
    }
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    checkOverflow();
    el.addEventListener('scroll', checkOverflow);
    window.addEventListener('resize', checkOverflow);
    return () => {
      el.removeEventListener('scroll', checkOverflow);
      window.removeEventListener('resize', checkOverflow);
    };
  }, [checkOverflow, records]);

  const compactTextFieldSx = {
    '& .MuiInputBase-root': {
      height: 32,
      fontSize: '0.875rem',
    },
    '& .MuiInputBase-input': {
      paddingTop: 0,
      paddingBottom: 0,
    },
    '& .MuiSelect-select': {
      paddingTop: '6px',
      paddingBottom: '6px',
    },
  };

  // 固定操作列样式 - 表头 (背景色 #F8FAFC 来自 theme MuiTableCell.head)
  const stickyHeaderCellSx = {
    position: 'sticky',
    right: 0,
    bgcolor: '#F8FAFC',
    ...(hasOverflow && {
      boxShadow: '-4px 0 8px -4px rgba(0,0,0,0.15)',
    }),
    zIndex: 2,
  };

  // 固定操作列样式 - 数据行 (背景色可通过 stickyBodyBgColor prop 自定义)
  const stickyBodyCellSx = {
    position: 'sticky',
    right: 0,
    bgcolor: bodyBgColor,
    ...(hasOverflow && {
      boxShadow: '-4px 0 8px -4px rgba(0,0,0,0.15)',
    }),
    zIndex: 1,
  };

  // 确定生效的供应商类型和能力
  // 如果 props 传入了 providerType，优先使用 props，否则使用全局 context
  const effectiveProviderType = providerType || selectedProvider;
  const effectiveCapabilities = providerType 
    ? getProviderCapabilities(providerType)
    : currentCapabilities;

  const caps: ProviderCapabilities = effectiveCapabilities || {
    supportsWeight: false,
    supportsLine: false,
    supportsStatus: false,
    supportsRemark: false,
    supportsUrlForward: false,
    supportsLogs: false,
    remarkMode: 'unsupported',
    paging: 'client',
    requiresDomainId: false,
    recordTypes: ['A', 'AAAA', 'CNAME', 'MX', 'TXT', 'SRV', 'CAA', 'NS'],
  };

  const showProxied = effectiveProviderType === 'cloudflare';
  const showWeight = caps.supportsWeight;
  const showLine = caps.supportsLine;
  const showStatus = caps.supportsStatus && !!onStatusChange;
  const showRemark = caps.supportsRemark;
  const recordTypes = caps.recordTypes;

  const ttlOptions = TTL_OPTIONS.filter((o) => {
    if (effectiveProviderType !== 'cloudflare' && o.value === 1) return false;
    if (typeof minTTL === 'number' && Number.isFinite(minTTL) && minTTL > 0) {
      if (effectiveProviderType === 'cloudflare' && o.value === 1) return true;
      return o.value >= minTTL;
    }
    return true;
  });

  const safeTtlOptions = ttlOptions.length > 0
    ? ttlOptions
    : (typeof minTTL === 'number' && Number.isFinite(minTTL) && minTTL > 0
        ? [{ label: `${minTTL} 秒`, value: minTTL }]
        : TTL_OPTIONS.filter(o => (effectiveProviderType === 'cloudflare' ? true : o.value !== 1)));

  const hasLineCategories = lines.some(l => !!l.parentCode);
  const groupedLines = lines.reduce<Record<string, DnsLine[]>>((acc, line) => {
    const key = line.parentCode || '其他';
    if (!acc[key]) acc[key] = [];
    acc[key].push(line);
    return acc;
  }, {});

  // 计算动态列数
  const columnCount = 5 + (showProxied ? 1 : 0) + (showWeight ? 1 : 0) + (showLine ? 1 : 0) + (showStatus ? 1 : 0) + (showRemark ? 1 : 0);
  const minTableWidth = Math.max(650, columnCount * 110);

  const handleEditClick = (record: DNSRecord) => {
    setEditingId(record.id);
    setEditForm({
      type: record.type,
      name: record.name,
      content: record.content,
      ttl: record.ttl,
      proxied: record.proxied,
      priority: record.priority,
      weight: record.weight,
      line: record.line,
      remark: record.remark,
    });
  };

  const handleCancelClick = () => {
    setEditingId(null);
    setEditForm({});
  };

  const handleSaveClick = (recordId: string) => {
    onUpdate(recordId, editForm);
    setEditingId(null);
    setEditForm({});
  };

  const handleChange = (field: keyof DNSRecord, value: any) => {
    setEditForm(prev => ({ ...prev, [field]: value }));
  };

  const handleStatusToggle = (record: DNSRecord) => {
    if (onStatusChange) {
      onStatusChange(record.id, !record.enabled);
    }
  };

  const getLineName = (lineCode?: string) => {
    if (!lineCode) return '-';
    const line = lines.find(l => l.code === lineCode);
    return line?.name || lineCode;
  };

  const normalizeFqdn = (v?: string) => String(v || '').trim().replace(/\.+$/, '').toLowerCase();
  const visibleRecords = records.filter(r => {
    if (r.type !== 'NS') return true;
    const zone = normalizeFqdn(r.zoneName);
    if (!zone) return true;
    const name = normalizeFqdn(r.name);
    if (!name || name === '@') return false;
    return name !== zone;
  });

  const renderMobileView = () => (
    <Stack spacing={2}>
      {visibleRecords.map((record) => {
        const isEditing = editingId === record.id;

        if (isEditing) {
          const editingType =
            typeof editForm.type === 'string' && recordTypes.includes(editForm.type)
              ? editForm.type
              : (recordTypes[0] ?? '');
          const firstAllowedTtl = safeTtlOptions[0]?.value ?? TTL_OPTIONS[0].value;
          const editingTtl =
            typeof editForm.ttl === 'number' && safeTtlOptions.some(o => o.value === editForm.ttl)
              ? editForm.ttl
              : firstAllowedTtl;

          return (
            <Card key={record.id} variant="outlined" sx={{ borderRadius: 2 }}>
              <CardContent sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <Stack direction="row" alignItems="center" spacing={1} sx={{ pb: 1.5, borderBottom: 1, borderColor: 'divider' }}>
                  <DnsIcon color="primary" sx={{ fontSize: '1em' }} />
                  <Typography variant="subtitle2" color="primary.main" fontWeight="bold">编辑记录</Typography>
                </Stack>
                <Grid container spacing={2}>
                  <Grid item xs={4}>
                     <TextField
                        select
                        fullWidth
                        size="small"
                        label="类型"
                        value={editingType}
                        onChange={(e) => handleChange('type', e.target.value)}
                      >
                        {recordTypes.map((type) => (
                          <MenuItem key={type} value={type}>{type}</MenuItem>
                        ))}
                      </TextField>
                  </Grid>
                  <Grid item xs={8}>
                     <TextField
                        fullWidth
                        size="small"
                        label="名称"
                        value={editForm.name ?? ''}
                        onChange={(e) => handleChange('name', e.target.value)}
                      />
                  </Grid>
                  <Grid item xs={12}>
                     <TextField
                        fullWidth
                        size="small"
                        label="内容"
                        multiline
                        maxRows={3}
                        value={editForm.content ?? ''}
                        onChange={(e) => handleChange('content', e.target.value)}
                      />
                  </Grid>
                  <Grid item xs={6}>
                    <TextField
                        select
                        fullWidth
                        size="small"
                        label="TTL"
                        value={editingTtl}
                        onChange={(e) => handleChange('ttl', Number(e.target.value))}
                      >
                        {safeTtlOptions.map((opt) => (
                          <MenuItem key={opt.value} value={opt.value}>{opt.label}</MenuItem>
                        ))}
                      </TextField>
                  </Grid>
                  {showLine && (
                     <Grid item xs={6}>
                       <TextField
                         select
                         fullWidth
                         size="small"
                         label="线路"
                         value={editForm.line || 'default'}
                         onChange={(e) => handleChange('line', e.target.value)}
                       >
                         {hasLineCategories
                           ? Object.keys(groupedLines)
                               .sort((a, b) => a.localeCompare(b, 'zh-CN'))
                               .flatMap((group) => [
                                 <ListSubheader key={`group-${group}`}>{group}</ListSubheader>,
                                 ...groupedLines[group]
                                   .slice()
                                   .sort((a, b) => (a.name || '').localeCompare(b.name || '', 'zh-CN'))
                                   .map((line) => (
                                     <MenuItem key={`${group}-${line.code}`} value={line.code}>
                                       {line.name}
                                     </MenuItem>
                                   )),
                               ])
                           : lines.map((line) => (
                               <MenuItem key={line.code} value={line.code}>
                                 {line.name}
                               </MenuItem>
                             ))}
                       </TextField>
                     </Grid>
                  )}
                  {showProxied && (
                     <Grid item xs={6} sx={{ display: 'flex', alignItems: 'center' }}>
                       <Typography variant="body2" sx={{ mr: 1 }}>代理状态:</Typography>
                       <Switch
                          checked={!!editForm.proxied}
                          onChange={(e) => handleChange('proxied', e.target.checked)}
                          size="small"
                        />
                     </Grid>
                  )}
                  {(editingType === 'MX' || editingType === 'SRV') && (
                     <Grid item xs={6}>
                        <TextField
                           type="number"
                           fullWidth
                           size="small"
                           label="优先级"
                           value={editForm.priority ?? ''}
                           onChange={(e) => handleChange('priority', e.target.value === '' ? undefined : Number(e.target.value))}
                         />
                     </Grid>
                  )}
                   {showWeight && (
                     <Grid item xs={6}>
                       <TextField
                         type="number"
                         fullWidth
                         size="small"
                         label="权重"
                         value={editForm.weight ?? ''}
                         onChange={(e) => handleChange('weight', e.target.value ? Number(e.target.value) : undefined)}
                       />
                     </Grid>
                   )}
                   {showRemark && (
                     <Grid item xs={12}>
                       <TextField
                         fullWidth
                         size="small"
                         label="备注"
                         value={editForm.remark || ''}
                         onChange={(e) => handleChange('remark', e.target.value)}
                       />
                     </Grid>
                   )}
                </Grid>
              </CardContent>
              <CardActions sx={{ justifyContent: 'flex-end', p: 2, pt: 0 }}>
                <Button 
                  size="small" 
                  onClick={handleCancelClick} 
                  color="inherit"
                  startIcon={<CloseIcon />}
                >
                  取消
                </Button>
                <Button 
                  size="small" 
                  variant="contained" 
                  onClick={() => handleSaveClick(record.id)} 
                  startIcon={<SaveIcon />}
                >
                  保存
                </Button>
              </CardActions>
            </Card>
          );
        }

        return (
          <Card key={record.id} variant="outlined" sx={{ borderRadius: 2, opacity: record.enabled === false ? 0.6 : 1 }}>
            <CardContent sx={{ p: 1.5, pb: 0, '&:last-child': { pb: 0 } }}>
              <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 0.5 }}>
                <Chip
                  label={record.type}
                  size="small"
                  sx={{
                    fontWeight: 'bold',
                    height: 20,
                    fontSize: '0.7rem',
                    bgcolor: (theme) => theme.palette.primary.main,
                    color: 'white',
                    flexShrink: 0
                  }}
                />
                <Typography variant="subtitle2" fontWeight="600" sx={{ wordBreak: 'break-all', lineHeight: 1.2, flexGrow: 1 }}>
                  {record.name}
                </Typography>
                <Stack direction="row" spacing={0.5} alignItems="center" sx={{ ml: 'auto', flexShrink: 0 }}>
                  {showProxied && (
                    <Tooltip title={record.proxied ? '已代理' : '仅 DNS'} arrow>
                      {record.proxied 
                        ? <CloudIcon sx={{ fontSize: 20, color: '#f38020' }} /> 
                        : <CloudQueueIcon sx={{ fontSize: 20, color: 'text.disabled' }} />
                      }
                    </Tooltip>
                  )}
                  {showStatus && (
                    <Switch
                      checked={record.enabled !== false}
                      onChange={() => handleStatusToggle(record)}
                      size="small"
                      sx={{ transform: 'scale(0.8)', mr: -1 }}
                    />
                  )}
                </Stack>
              </Stack>
              
              <Typography 
                variant="body2" 
                color="text.secondary" 
                sx={{ 
                  mb: 1, 
                  fontFamily: 'monospace', 
                  wordBreak: 'break-all', 
                  fontSize: '0.85rem',
                  display: '-webkit-box',
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: 'vertical',
                  overflow: 'hidden'
                }}
              >
                {record.content}
              </Typography>
            </CardContent>
            <Divider sx={{ borderStyle: 'dashed' }} />
            <CardActions sx={{ justifyContent: 'flex-end', p: 0.5, px: 1 }}>
               <Button 
                  size="small" 
                  startIcon={<EditIcon sx={{ fontSize: 16 }} />} 
                  onClick={() => handleEditClick(record)}
                  sx={{ color: 'text.secondary', fontSize: '0.75rem', minWidth: 'auto', px: 1 }}
               >
                 编辑
               </Button>
               <Button 
                  size="small" 
                  startIcon={<DeleteIcon sx={{ fontSize: 16 }} />} 
                  color="error" 
                  onClick={() => onDelete(record.id)}
                  sx={{ fontSize: '0.75rem', minWidth: 'auto', px: 1 }}
               >
                 删除
               </Button>
            </CardActions>
          </Card>
        );
      })}
    </Stack>
  );

  if (isMobile) {
    return (visibleRecords.length === 0 ? (
       <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', py: 4, color: 'text.secondary' }}>
          <Typography variant="body2">暂无 DNS 记录</Typography>
       </Box>
    ) : renderMobileView());
  }

  return (
    <TableContainer ref={containerRef} sx={{ width: '100%', overflowX: 'auto', maxWidth: '100%' }}>
      <Table sx={{ minWidth: minTableWidth, '& .MuiTableCell-root': { whiteSpace: 'nowrap' } }}>
        <TableHead>
          <TableRow>
            <TableCell>类型</TableCell>
            <TableCell>名称</TableCell>
            <TableCell sx={{ maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis' }}>内容</TableCell>
            <TableCell>TTL</TableCell>
            {showProxied && <TableCell align="center">代理状态</TableCell>}
            {showLine && <TableCell>线路</TableCell>}
            {showStatus && <TableCell align="center">状态</TableCell>}
            {showRemark && <TableCell>备注</TableCell>}
            <TableCell>优先级</TableCell>
            {showWeight && <TableCell>权重</TableCell>}
            <TableCell align="right" sx={stickyHeaderCellSx}>操作</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {visibleRecords.length === 0 ? (
            <TableRow>
              <TableCell colSpan={columnCount} align="center" sx={{ py: 8 }}>
                <Typography variant="body1" color="text.secondary">
                  暂无 DNS 记录
                </Typography>
              </TableCell>
            </TableRow>
          ) : (
            visibleRecords.map((record) => {
              const isEditing = editingId === record.id;

              if (isEditing) {
                const editingType =
                  typeof editForm.type === 'string' && recordTypes.includes(editForm.type)
                    ? editForm.type
                    : (recordTypes[0] ?? '');
                const firstAllowedTtl = safeTtlOptions[0]?.value ?? TTL_OPTIONS[0].value;
                const editingTtl =
                  typeof editForm.ttl === 'number' && safeTtlOptions.some(o => o.value === editForm.ttl)
                    ? editForm.ttl
                    : firstAllowedTtl;

                return (
                  <TableRow
                    key={record.id}
                    hover
                    sx={{
                      '& > .MuiTableCell-root': {
                        py: 0.5,
                        px: 1,
                      },
                    }}
                  >
                   <TableCell>
                    <TextField
                      select
                      size="small"
                      value={editingType}
                      onChange={(e) => handleChange('type', e.target.value)}
                      sx={{ width: 72, minWidth: 72, ...compactTextFieldSx }}
                    >
                      {recordTypes.map((type) => (
                        <MenuItem key={type} value={type}>{type}</MenuItem>
                      ))}
                    </TextField>
                   </TableCell>
                   <TableCell>
                    <TextField
                      size="small"
                      value={editForm.name ?? ''}
                      onChange={(e) => handleChange('name', e.target.value)}
                      sx={compactTextFieldSx}
                    />
                   </TableCell>
                   <TableCell sx={{ maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    <TextField
                      size="small"
                      fullWidth
                      value={editForm.content ?? ''}
                      onChange={(e) => handleChange('content', e.target.value)}
                      sx={compactTextFieldSx}
                    />
                   </TableCell>
                   <TableCell>
                    <TextField
                      select
                      size="small"
                      value={editingTtl}
                      onChange={(e) => handleChange('ttl', Number(e.target.value))}
                      sx={{ minWidth: 100, ...compactTextFieldSx }}
                    >
                      {safeTtlOptions.map((opt) => (
                        <MenuItem key={opt.value} value={opt.value}>{opt.label}</MenuItem>
                      ))}
                    </TextField>
                   </TableCell>
                   {showProxied && (
                     <TableCell align="center">
                      <Switch
                        checked={!!editForm.proxied}
                        onChange={(e) => handleChange('proxied', e.target.checked)}
                      />
                     </TableCell>
                   )}
                   {showLine && (
                     <TableCell>
                       <TextField
                         select
                         size="small"
                         value={editForm.line || 'default'}
                         onChange={(e) => handleChange('line', e.target.value)}
                         sx={{ minWidth: 100, ...compactTextFieldSx }}
                       >
                         {hasLineCategories
                           ? Object.keys(groupedLines)
                               .sort((a, b) => a.localeCompare(b, 'zh-CN'))
                               .flatMap((group) => [
                                 <ListSubheader key={`group-${group}`}>{group}</ListSubheader>,
                                 ...groupedLines[group]
                                   .slice()
                                   .sort((a, b) => (a.name || '').localeCompare(b.name || '', 'zh-CN'))
                                   .map((line) => (
                                     <MenuItem key={`${group}-${line.code}`} value={line.code}>
                                       {line.name}
                                     </MenuItem>
                                   )),
                               ])
                           : lines.map((line) => (
                               <MenuItem key={line.code} value={line.code}>
                                 {line.name}
                               </MenuItem>
                             ))}
                       </TextField>
                     </TableCell>
                   )}
                   {showStatus && <TableCell />}
                   {showRemark && (
                     <TableCell>
                       <TextField
                         size="small"
                         value={editForm.remark || ''}
                         onChange={(e) => handleChange('remark', e.target.value)}
                         placeholder="备注"
                         sx={{ minWidth: 100, ...compactTextFieldSx }}
                       />
                     </TableCell>
                   )}
                   <TableCell>
                     {(editingType === 'MX' || editingType === 'SRV') && (
                       <TextField
                         type="number"
                         size="small"
                         value={editForm.priority ?? ''}
                         onChange={(e) => handleChange('priority', e.target.value === '' ? undefined : Number(e.target.value))}
                         sx={{ maxWidth: 80, ...compactTextFieldSx }}
                       />
                     )}
                   </TableCell>
                   {showWeight && (
                     <TableCell>
                       <TextField
                         type="number"
                         size="small"
                         value={editForm.weight ?? ''}
                         onChange={(e) => handleChange('weight', e.target.value ? Number(e.target.value) : undefined)}
                         sx={{ maxWidth: 80, ...compactTextFieldSx }}
                         placeholder="1-100"
                       />
                     </TableCell>
                   )}
                   <TableCell align="right" sx={stickyBodyCellSx}>
                    <Box sx={{ display: 'flex', gap: 1, justifyContent: 'flex-end' }}>
                      <IconButton size="small" onClick={() => handleSaveClick(record.id)} color="success">
                        <CheckIcon />
                      </IconButton>
                      <IconButton size="small" onClick={handleCancelClick} color="default">
                        <CloseIcon />
                      </IconButton>
                    </Box>
                   </TableCell>
                </TableRow>
              );
            }

            return (
              <TableRow key={record.id} hover sx={{ opacity: record.enabled === false ? 0.5 : 1 }}>
                <TableCell>
                  <Chip
                    label={record.type}
                    size="small"
                    sx={{
                      fontWeight: 'bold',
                      minWidth: 60,
                      bgcolor: (theme) => theme.palette.primary.main,
                      color: 'white'
                    }}
                  />
                </TableCell>
                <TableCell>
                  <Typography variant="body2" fontWeight="500">
                    {record.name}
                  </Typography>
                </TableCell>
                <TableCell sx={{ maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  <Typography variant="body2" fontFamily="monospace" fontSize="0.85rem">
                    {record.content}
                  </Typography>
                </TableCell>
                <TableCell>{formatTTL(record.ttl)}</TableCell>
                {showProxied && (
                  <TableCell align="center">
                    {record.proxied ? (
                      <Tooltip title="已开启 Cloudflare 代理">
                        <CloudIcon color="warning" />
                      </Tooltip>
                    ) : (
                      <Tooltip title="仅 DNS 解析 (无代理)">
                        <CloudQueueIcon color="disabled" />
                      </Tooltip>
                    )}
                  </TableCell>
                )}
                {showLine && <TableCell>{record.lineName || getLineName(record.line)}</TableCell>}
                {showStatus && (
                  <TableCell align="center">
                    <Tooltip title={record.enabled !== false ? '点击禁用' : '点击启用'}>
                      <IconButton
                        size="small"
                        onClick={() => handleStatusToggle(record)}
                        color={record.enabled !== false ? 'success' : 'default'}
                      >
                        <PowerIcon />
                      </IconButton>
                    </Tooltip>
                  </TableCell>
                )}
                {showRemark && (
                  <TableCell>
                    <Typography variant="body2" color="text.secondary" noWrap sx={{ maxWidth: 120 }}>
                      {record.remark || '-'}
                    </Typography>
                  </TableCell>
                )}
                <TableCell>
                  {record.type === 'MX' || record.type === 'SRV' ? (record.priority ?? '-') : '-'}
                </TableCell>
                {showWeight && <TableCell>{record.weight ?? '-'}</TableCell>}
                <TableCell align="right" sx={stickyBodyCellSx}>
                  <Box sx={{ display: 'flex', gap: 1, justifyContent: 'flex-end' }}>
                    <Tooltip title="编辑记录">
                      <IconButton
                        size="small"
                        onClick={() => handleEditClick(record)}
                        sx={{ color: 'primary.main' }}
                      >
                        <EditIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title="删除记录">
                      <IconButton
                        size="small"
                        onClick={() => onDelete(record.id)}
                        sx={{ color: 'error.main' }}
                      >
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </Box>
                </TableCell>
              </TableRow>
            );
          })
        )}
        </TableBody>
      </Table>
    </TableContainer>
  );
}
