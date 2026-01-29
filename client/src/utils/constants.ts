/**
 * DNS 记录类型选项
 */
export const DNS_RECORD_TYPES = [
  'A',
  'AAAA',
  'CNAME',
  'MX',
  'TXT',
  'SRV',
  'CAA',
  'NS',
  'PTR',
] as const;

/**
 * TTL 选项
 */
export const TTL_OPTIONS = [
  { label: '自动', value: 1 },
  { label: '1 分钟', value: 60 },
  { label: '5 分钟', value: 300 },
  { label: '10 分钟', value: 600 },
  { label: '15 分钟', value: 900 },
  { label: '30 分钟', value: 1800 },
  { label: '1 小时', value: 3600 },
  { label: '2 小时', value: 7200 },
  { label: '5 小时', value: 18000 },
  { label: '12 小时', value: 43200 },
  { label: '1 天', value: 86400 },
];

/**
 * 操作类型
 */
export const ACTION_TYPES = {
  CREATE: '创建',
  UPDATE: '更新',
  DELETE: '删除',
};

/**
 * 资源类型
 */
export const RESOURCE_TYPES = {
  DNS: 'DNS 记录',
  ZONE: '域名',
  HOSTNAME: '自定义主机名',
  USER: '用户',
  CREDENTIAL: '供应商账户',
  DOMAIN_EXPIRY: '域名到期',
};

/**
 * 操作状态
 */
export const OPERATION_STATUS = {
  SUCCESS: '成功',
  FAILED: '失败',
};
