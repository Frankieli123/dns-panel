import { useEffect } from 'react';
import { useForm, Controller } from 'react-hook-form';
import {
  Box,
  TextField,
  MenuItem,
  Button,
  FormControlLabel,
  Switch,
  Collapse,
  ListSubheader,
} from '@mui/material';
import { TTL_OPTIONS } from '@/utils/constants';
import { validateDNSContent } from '@/utils/validators';
import { useProvider } from '@/contexts/ProviderContext';
import { ProviderCapabilities, DnsLine, ProviderType } from '@/types/dns';

interface QuickAddFormProps {
  onSubmit: (data: any) => void;
  loading?: boolean;
  lines?: DnsLine[];
  minTTL?: number;
  providerType?: ProviderType;
}

interface FormData {
  type: string;
  name: string;
  content: string;
  ttl: number;
  proxied: boolean;
  priority?: number;
  weight?: number;
  line?: string;
  remark?: string;
}

/**
 * 快速添加 DNS 记录表单
 * 根据当前供应商能力动态显示字段
 */
export default function QuickAddForm({ onSubmit, loading, lines = [], minTTL, providerType }: QuickAddFormProps) {
  const { selectedProvider, currentCapabilities, getProviderCapabilities } = useProvider();

  const {
    register,
    handleSubmit,
    watch,
    reset,
    control,
    setValue,
    formState: { errors },
  } = useForm<FormData>({
    defaultValues: {
      type: 'A',
      name: '',
      content: '',
      ttl: 1,
      proxied: false,
      line: 'default',
    },
  });

  const recordType = watch('type');
  const currentTtl = watch('ttl');
  const showPriority = recordType === 'MX' || recordType === 'SRV';

  const effectiveProviderType = providerType || selectedProvider;
  const effectiveCapabilities = getProviderCapabilities(effectiveProviderType) || currentCapabilities;

  // 根据供应商能力决定显示哪些字段
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
  const showLine = caps.supportsLine && lines.length > 0;
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

  useEffect(() => {
    const firstAllowedTtl = safeTtlOptions[0]?.value ?? TTL_OPTIONS[0].value;
    if (!safeTtlOptions.some(o => o.value === currentTtl)) {
      setValue('ttl', firstAllowedTtl, { shouldDirty: false, shouldTouch: false });
    }
  }, [currentTtl, setValue, safeTtlOptions]);

  useEffect(() => {
    if (recordTypes.length === 0) return;
    if (!recordType || !recordTypes.includes(recordType)) {
      setValue('type', recordTypes[0], { shouldDirty: false, shouldTouch: false });
    }
  }, [recordType, recordTypes, setValue]);

  const hasLineCategories = lines.some(l => !!l.parentCode);
  const groupedLines = lines.reduce<Record<string, DnsLine[]>>((acc, line) => {
    const key = line.parentCode || '其他';
    if (!acc[key]) acc[key] = [];
    acc[key].push(line);
    return acc;
  }, {});

  const handleFormSubmit = (data: FormData) => {
    // 只提交当前供应商支持的字段
    const submitData: Record<string, any> = {
      type: data.type,
      name: data.name,
      content: data.content,
      ttl: data.ttl,
    };

    if (showPriority && data.priority !== undefined) {
      submitData.priority = data.priority;
    }
    if (showProxied) {
      submitData.proxied = data.proxied;
    }
    if (showWeight && data.weight !== undefined) {
      submitData.weight = data.weight;
    }
    if (showLine && data.line) {
      submitData.line = data.line;
    }
    if (showRemark && data.remark) {
      submitData.remark = data.remark;
    }

    onSubmit(submitData);
    reset();
  };

  return (
    <Box component="form" onSubmit={handleSubmit(handleFormSubmit)} sx={{ mt: 2 }}>
      <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        {/* 记录类型 */}
        <Controller
          name="type"
          control={control}
          rules={{ required: true }}
          render={({ field }) => (
            (() => {
              const safeTypeValue =
                typeof field.value === 'string' && recordTypes.includes(field.value)
                  ? field.value
                  : (recordTypes[0] ?? '');

              return (
            <TextField
              select
              label="类型"
              {...field}
              value={safeTypeValue}
              sx={{ width: 100, minWidth: 100 }}
              size="small"
            >
              {recordTypes.map((type) => (
                <MenuItem key={type} value={type}>
                  {type}
                </MenuItem>
              ))}
            </TextField>
              );
            })()
          )}
        />

        {/* 名称 */}
        <TextField
          label="名称"
          placeholder="@ 或 www"
          {...register('name', { required: '请输入名称' })}
          error={!!errors.name}
          helperText={errors.name?.message}
          sx={{ flex: 1, minWidth: 150 }}
          size="small"
        />

        {/* 内容 */}
        <TextField
          label="内容"
          placeholder="IP 地址或目标"
          {...register('content', {
            required: '请输入内容',
            validate: (value) => {
              const result = validateDNSContent(recordType, value);
              return result === null ? true : result;
            },
          })}
          error={!!errors.content}
          helperText={errors.content?.message}
          sx={{ flex: 1, minWidth: 150 }}
          size="small"
        />

        {/* TTL */}
        <Controller
          name="ttl"
          control={control}
          render={({ field }) => (
            (() => {
              const firstAllowedTtl = safeTtlOptions[0]?.value ?? TTL_OPTIONS[0].value;
              const safeTtlValue =
                typeof field.value === 'number' && safeTtlOptions.some(o => o.value === field.value)
                  ? field.value
                  : firstAllowedTtl;

              return (
            <TextField
              select
              label="TTL"
              {...field}
              value={safeTtlValue}
              onChange={(e) => field.onChange(Number(e.target.value))}
              sx={{ minWidth: 100 }}
              size="small"
            >
              {safeTtlOptions.map((option) => (
                <MenuItem key={option.value} value={option.value}>
                  {option.label}
                </MenuItem>
              ))}
            </TextField>
              );
            })()
          )}
        />

        {/* 优先级 (MX/SRV) */}
        {showPriority && (
          <TextField
            type="number"
            label="优先级"
            {...register('priority', { valueAsNumber: true })}
            sx={{ width: 90 }}
            size="small"
          />
        )}

        {/* 权重 (DNSPod/华为云等) */}
        {showWeight && (
          <TextField
            type="number"
            label="权重"
            {...register('weight', { valueAsNumber: true })}
            sx={{ width: 90 }}
            size="small"
            placeholder="1-100"
          />
        )}

        {/* 线路 (阿里云/DNSPod等) */}
        {showLine && (
          <Controller
            name="line"
            control={control}
            render={({ field }) => (
              <TextField
                select
                label="线路"
                {...field}
                sx={{ minWidth: 120 }}
                size="small"
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
            )}
          />
        )}

        {/* Cloudflare 代理 */}
        {showProxied && (
          <FormControlLabel
            control={<Switch {...register('proxied')} size="small" />}
            label="代理"
            sx={{ mx: 1 }}
          />
        )}

        {/* 提交按钮 */}
        <Button
          type="submit"
          variant="contained"
          disabled={loading}
          sx={{ minWidth: 80, height: 40 }}
        >
          {loading ? '添加中...' : '添加'}
        </Button>
      </Box>

      {/* 备注 (支持的供应商) */}
      <Collapse in={showRemark} unmountOnExit>
        <Box sx={{ mt: 2 }}>
          <TextField
            label="备注"
            placeholder="记录备注信息"
            {...register('remark')}
            fullWidth
            size="small"
          />
        </Box>
      </Collapse>
    </Box>
  );
}
