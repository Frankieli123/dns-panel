/**
 * DNS Provider 基础类型定义
 * 统一所有DNS提供商的接口规范
 */

/**
 * 提供商类型枚举
 */
export enum ProviderType {
  CLOUDFLARE = 'cloudflare',
  ALIYUN = 'aliyun',
  DNSPOD = 'dnspod',
  DNSPOD_TOKEN = 'dnspod_token',
  HUAWEI = 'huawei',
  BAIDU = 'baidu',
  WEST = 'west',
  HUOSHAN = 'huoshan',
  JDCLOUD = 'jdcloud',
  DNSLA = 'dnsla',
  NAMESILO = 'namesilo',
  POWERDNS = 'powerdns',
  SPACESHIP = 'spaceship',
}

/**
 * 提供商密钥类型（用于类型安全）
 */
export type ProviderKey = `${ProviderType}`;

/**
 * 认证字段定义（用于前端动态表单生成）
 */
export interface AuthFieldDefinition {
  name: string;           // 字段名称（如 'accessKeyId'）
  label: string;          // 显示标签（如 'Access Key ID'）
  type: 'text' | 'password' | 'url';
  required: boolean;
  placeholder?: string;
  helpText?: string;      // 帮助文本
}

/**
 * 提供商能力配置
 */
export interface ProviderCapabilities {
  provider: ProviderType;
  name: string;                    // 提供商显示名称

  // 功能支持
  supportsWeight: boolean;         // 是否支持权重
  supportsLine: boolean;           // 是否支持线路/解析线路
  supportsStatus: boolean;         // 是否支持启用/禁用记录
  supportsRemark: boolean;         // 是否支持备注
  supportsUrlForward: boolean;     // 是否支持URL转发
  supportsLogs: boolean;           // 是否支持操作日志

  // 备注模式
  remarkMode: 'inline' | 'separate' | 'unsupported';

  // 分页方式
  paging: 'server' | 'client';     // 服务端分页 vs 客户端分页

  // 域名ID要求
  requiresDomainId: boolean;       // 是否需要先获取domainId才能操作记录

  // 支持的记录类型
  recordTypes: string[];

  // 认证字段定义
  authFields: AuthFieldDefinition[];

  // 缓存TTL（秒）
  domainCacheTtl: number;
  recordCacheTtl: number;

  // 重试配置
  retryableErrors: string[];       // 可重试的错误代码
  maxRetries: number;
}

/**
 * 提供商错误
 */
export interface ProviderError {
  provider: ProviderType;
  code: string;                    // 错误代码
  message: string;                 // 错误消息
  httpStatus?: number;             // HTTP状态码
  retriable: boolean;              // 是否可重试
  meta?: Record<string, unknown>;  // 额外元数据
}

/**
 * 域名列表结果
 */
export interface ZoneListResult {
  total: number;
  zones: Zone[];
}

/**
 * 域名/Zone
 */
export interface Zone {
  id: string;                      // 提供商的Zone ID
  name: string;                    // 域名名称
  status: string;                  // 状态（active/pending/等）
  recordCount?: number;            // 记录数量
  updatedAt?: string;              // 最后更新时间
  meta?: Record<string, unknown>;  // 提供商特定的元数据
}

/**
 * DNS记录查询参数
 */
export interface RecordQueryParams {
  page?: number;
  pageSize?: number;
  keyword?: string;                // 关键词搜索
  subDomain?: string;              // 子域名筛选
  type?: string;                   // 记录类型筛选
  value?: string;                  // 记录值筛选
  line?: string;                   // 线路筛选
  status?: '0' | '1';              // 状态筛选（0=禁用，1=启用）
}

/**
 * DNS记录列表结果
 */
export interface RecordListResult {
  total: number;
  records: DnsRecord[];
}

/**
 * DNS记录（统一格式）
 */
export interface DnsRecord {
  id: string;                      // 记录ID
  zoneId: string;                  // 所属域名ID
  zoneName: string;                // 所属域名名称
  name: string;                    // 记录名称（主机记录）
  type: string;                    // 记录类型
  value: string;                   // 记录值
  ttl: number;                     // TTL
  line?: string;                   // 线路（如果支持）
  weight?: number;                 // 权重（如果支持）
  priority?: number;               // 优先级（MX/SRV记录）
  status?: '0' | '1';              // 状态（0=禁用，1=启用）
  remark?: string;                 // 备注
  proxied?: boolean;               // 代理状态（Cloudflare特有）
  updatedAt?: string;              // 更新时间
  meta?: Record<string, unknown>;  // 提供商特定字段
}

/**
 * 创建DNS记录参数
 */
export interface CreateRecordParams {
  name: string;                    // 主机记录（如 www, @）
  type: string;                    // 记录类型
  value: string;                   // 记录值
  ttl?: number;                    // TTL（默认600）
  line?: string;                   // 线路（默认default）
  weight?: number;                 // 权重
  priority?: number;               // 优先级（MX/SRV）
  remark?: string;                 // 备注
  proxied?: boolean;               // 代理状态（Cloudflare）
}

/**
 * 更新DNS记录参数
 */
export interface UpdateRecordParams extends CreateRecordParams {
  // 继承CreateRecordParams的所有字段
}

/**
 * 解析线路
 */
export interface DnsLine {
  code: string;                    // 线路代码
  name: string;                    // 线路名称
  parentCode?: string;             // 父线路代码
}

/**
 * 解析线路列表
 */
export interface LineListResult {
  lines: DnsLine[];
}

/**
 * 提供商凭证（解密后）
 */
export interface ProviderCredentials {
  provider: ProviderType;
  secrets: Record<string, string>; // 解密后的认证信息
  accountId?: string;              // 可选的账户ID
}

/**
 * DNS Provider 接口
 * 所有提供商必须实现此接口
 */
export interface IDnsProvider {
  /**
   * 获取提供商能力配置
   */
  getCapabilities(): ProviderCapabilities;

  /**
   * 验证认证信息
   */
  checkAuth(): Promise<boolean>;

  /**
   * 获取域名列表
   */
  getZones(page?: number, pageSize?: number, keyword?: string): Promise<ZoneListResult>;

  /**
   * 获取域名详情
   */
  getZone(zoneId: string): Promise<Zone>;

  /**
   * 获取DNS记录列表
   */
  getRecords(zoneId: string, params?: RecordQueryParams): Promise<RecordListResult>;

  /**
   * 获取单条DNS记录详情
   */
  getRecord(zoneId: string, recordId: string): Promise<DnsRecord>;

  /**
   * 创建DNS记录
   */
  createRecord(zoneId: string, params: CreateRecordParams): Promise<DnsRecord>;

  /**
   * 更新DNS记录
   */
  updateRecord(zoneId: string, recordId: string, params: UpdateRecordParams): Promise<DnsRecord>;

  /**
   * 删除DNS记录
   */
  deleteRecord(zoneId: string, recordId: string): Promise<boolean>;

  /**
   * 设置DNS记录状态（启用/禁用）
   */
  setRecordStatus(zoneId: string, recordId: string, enabled: boolean): Promise<boolean>;

  /**
   * 获取解析线路列表
   */
  getLines(zoneId?: string): Promise<LineListResult>;

  /**
   * 获取最低TTL
   */
  getMinTTL(zoneId?: string): Promise<number>;

  /**
   * 添加域名（如果支持）
   */
  addZone?(domain: string): Promise<Zone>;
}
