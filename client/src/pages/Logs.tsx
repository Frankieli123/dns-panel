import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Box,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Chip,
  CircularProgress,
  Alert,
  TextField,
  MenuItem,
  TablePagination,
} from '@mui/material';
import { getLogs } from '@/services/logs';
import { formatDateTime } from '@/utils/formatters';
import { ACTION_TYPES, RESOURCE_TYPES, OPERATION_STATUS } from '@/utils/constants';

const safeJsonParse = (value?: string) => {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};

const getRecordName = (log: any) => {
  if (log?.recordName) return log.recordName;

  if (log?.resourceType === 'CREDENTIAL') {
    const parsed = safeJsonParse(log?.newValue) ?? safeJsonParse(log?.oldValue);

    const directName = parsed?.name;
    if (typeof directName === 'string' && directName.trim()) return directName;

    const nestedName = parsed?.credential?.name;
    if (typeof nestedName === 'string' && nestedName.trim()) return nestedName;
  }

  return '-';
};

/**
 * 操作日志页面
 */
export default function Logs() {
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(50);
  const [filters, setFilters] = useState({
    action: '',
    resourceType: '',
    status: '',
  });

  const { data, isLoading, error } = useQuery({
    queryKey: ['logs', page + 1, rowsPerPage, filters],
    queryFn: () =>
      getLogs({
        page: page + 1,
        limit: rowsPerPage,
        ...filters,
      }),
  });

  const logs = data?.data || [];
  const total = data?.pagination?.total || 0;

  const handleChangePage = (_: unknown, newPage: number) => {
    setPage(newPage);
  };

  const handleChangeRowsPerPage = (event: React.ChangeEvent<HTMLInputElement>) => {
    setRowsPerPage(parseInt(event.target.value, 10));
    setPage(0);
  };

  if (isLoading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', mt: 4 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (error) {
    return (
      <Alert severity="error" sx={{ mt: 2 }}>
        {(error as any)?.message || String(error)}
      </Alert>
    );
  }

  return (
    <Box>
      {/* 筛选器 */}
      <Paper sx={{ p: 2, mb: 3 }}>
        <Box sx={{ display: 'flex', gap: 2 }}>
          <TextField
            select
            label="操作类型"
            value={filters.action}
            onChange={(e) => setFilters({ ...filters, action: e.target.value })}
            sx={{ minWidth: 150 }}
          >
            <MenuItem value="">全部</MenuItem>
            {Object.entries(ACTION_TYPES).map(([key, value]) => (
              <MenuItem key={key} value={key}>
                {value}
              </MenuItem>
            ))}
          </TextField>

          <TextField
            select
            label="资源类型"
            value={filters.resourceType}
            onChange={(e) => setFilters({ ...filters, resourceType: e.target.value })}
            sx={{ minWidth: 150 }}
          >
            <MenuItem value="">全部</MenuItem>
            {Object.entries(RESOURCE_TYPES).map(([key, value]) => (
              <MenuItem key={key} value={key}>
                {value}
              </MenuItem>
            ))}
          </TextField>

          <TextField
            select
            label="状态"
            value={filters.status}
            onChange={(e) => setFilters({ ...filters, status: e.target.value })}
            sx={{ minWidth: 150 }}
          >
            <MenuItem value="">全部</MenuItem>
            {Object.entries(OPERATION_STATUS).map(([key, value]) => (
              <MenuItem key={key} value={key}>
                {value}
              </MenuItem>
            ))}
          </TextField>
        </Box>
      </Paper>

      {/* 日志表格 */}
      <TableContainer component={Paper}>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>时间</TableCell>
              <TableCell>操作</TableCell>
              <TableCell>资源类型</TableCell>
              <TableCell>记录名称</TableCell>
              <TableCell>状态</TableCell>
              <TableCell>IP 地址</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {logs.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} align="center">
                  暂无日志记录
                </TableCell>
              </TableRow>
            ) : (
              logs.map((log: any) => (
                <TableRow
                  key={log.id}
                  sx={{
                    backgroundColor: log.status === 'FAILED' ? 'error.light' : 'inherit',
                  }}
                >
                  <TableCell>{formatDateTime(log.timestamp)}</TableCell>
                  <TableCell>
                    <Chip
                      label={ACTION_TYPES[log.action as keyof typeof ACTION_TYPES]}
                      size="small"
                    />
                  </TableCell>
                  <TableCell>
                    {RESOURCE_TYPES[log.resourceType as keyof typeof RESOURCE_TYPES] || log.resourceType || '-'}
                  </TableCell>
                  <TableCell>
                    {getRecordName(log)}
                    {log.recordType && ` (${log.recordType})`}
                  </TableCell>
                  <TableCell>
                    <Chip
                      label={OPERATION_STATUS[log.status as keyof typeof OPERATION_STATUS]}
                      color={log.status === 'SUCCESS' ? 'success' : 'error'}
                      size="small"
                    />
                  </TableCell>
                  <TableCell>{log.ipAddress || '-'}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
        <TablePagination
          component="div"
          count={total}
          page={page}
          onPageChange={handleChangePage}
          rowsPerPage={rowsPerPage}
          onRowsPerPageChange={handleChangeRowsPerPage}
          labelRowsPerPage="每页行数:"
          labelDisplayedRows={({ from, to, count }) => `${from}-${to} / 共 ${count} 条`}
        />
      </TableContainer>
    </Box>
  );
}
