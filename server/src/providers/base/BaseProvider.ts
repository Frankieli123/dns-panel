/**
 * DNS Provider 基类
 * 提供通用方法、错误处理、重试逻辑和数据标准化
 */

import {
  CreateRecordParams,
  DnsRecord,
  IDnsProvider,
  LineListResult,
  ProviderCapabilities,
  ProviderCredentials,
  ProviderError,
  RecordListResult,
  RecordQueryParams,
  UpdateRecordParams,
  Zone,
  ZoneListResult,
} from './types';

/**
 * DNS Provider 统一错误类
 */
export class DnsProviderError extends Error {
  public readonly details: ProviderError;
  public readonly cause?: unknown;

  constructor(details: ProviderError, cause?: unknown) {
    super(details.message);
    this.name = 'DnsProviderError';
    this.details = details;
    this.cause = cause;
    Object.setPrototypeOf(this, DnsProviderError.prototype);
  }

  toJSON() {
    return {
      name: this.name,
      message: this.message,
      details: this.details,
    };
  }
}

interface RetryOptions {
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
}

/**
 * DNS Provider 抽象基类
 */
export abstract class BaseProvider implements IDnsProvider {
  protected readonly credentials: ProviderCredentials;
  protected readonly capabilities: ProviderCapabilities;

  constructor(credentials: ProviderCredentials, capabilities: ProviderCapabilities) {
    this.credentials = credentials;
    this.capabilities = capabilities;
  }

  getCapabilities(): ProviderCapabilities {
    return this.capabilities;
  }

  /**
   * 创建标准化错误
   */
  protected createError(
    code: string,
    message: string,
    opts?: { httpStatus?: number; meta?: Record<string, unknown>; cause?: unknown }
  ): DnsProviderError {
    const httpStatus = opts?.httpStatus;
    const retriable = this.checkRetriable({ code, httpStatus, message });

    return new DnsProviderError(
      {
        provider: this.capabilities.provider,
        code,
        message,
        httpStatus,
        retriable,
        meta: opts?.meta,
      },
      opts?.cause
    );
  }

  /**
   * 判断错误是否可重试
   */
  protected isRetriable(error: unknown): boolean {
    if (error instanceof DnsProviderError) {
      return error.details.retriable;
    }

    const anyErr = error as any;
    const code = typeof anyErr?.code === 'string' ? anyErr.code : undefined;
    const httpStatus = this.extractHttpStatus(anyErr);
    const message = typeof anyErr?.message === 'string' ? anyErr.message : String(error);

    return this.checkRetriable({ code, httpStatus, message });
  }

  private extractHttpStatus(err: any): number | undefined {
    if (typeof err?.httpStatus === 'number') return err.httpStatus;
    if (typeof err?.status === 'number') return err.status;
    if (typeof err?.statusCode === 'number') return err.statusCode;
    return undefined;
  }

  private checkRetriable(input: {
    code?: string;
    httpStatus?: number;
    message?: string;
  }): boolean {
    const { code, httpStatus, message } = input;

    // 检查配置的可重试错误码
    if (code && this.capabilities.retryableErrors?.includes(code)) {
      return true;
    }

    // HTTP 状态码判断
    if (httpStatus === 408 || httpStatus === 429) return true;
    if (typeof httpStatus === 'number' && httpStatus >= 500) return true;

    // 网络错误关键词
    const msg = (message || '').toLowerCase();
    const networkErrors = [
      'timeout', 'timed out', 'econnreset', 'eai_again',
      'enotfound', 'socket hang up', 'network', 'econnrefused'
    ];

    return networkErrors.some(keyword => msg.includes(keyword));
  }

  /**
   * 带重试的异步操作执行器
   */
  protected async withRetry<T>(fn: () => Promise<T>, options?: RetryOptions): Promise<T> {
    const maxRetries = options?.maxRetries ?? this.capabilities.maxRetries ?? 0;
    const baseDelayMs = options?.baseDelayMs ?? 250;
    const maxDelayMs = options?.maxDelayMs ?? 10_000;

    let attempt = 0;

    while (attempt <= maxRetries) {
      try {
        return await fn();
      } catch (err) {
        const canRetry = attempt < maxRetries && this.isRetriable(err);
        if (!canRetry) throw err;

        // 指数退避 + 随机抖动
        const exponential = baseDelayMs * Math.pow(2, attempt);
        const jitter = 0.5 + Math.random(); // [0.5, 1.5)
        const delay = Math.min(maxDelayMs, Math.floor(exponential * jitter));

        await this.sleep(delay);
        attempt += 1;
      }
    }

    throw this.createError('RETRY_EXHAUSTED', 'Retry attempts exhausted');
  }

  protected sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * 标准化 Zone 数据
   */
  protected normalizeZone(input: Partial<Zone> & Pick<Zone, 'id' | 'name'>): Zone {
    return {
      id: String(input.id),
      name: String(input.name),
      status: input.status ? String(input.status) : 'unknown',
      recordCount: typeof input.recordCount === 'number' ? input.recordCount : undefined,
      updatedAt: input.updatedAt ? String(input.updatedAt) : undefined,
      meta: input.meta,
    };
  }

  /**
   * 标准化 DNS Record 数据
   */
  protected normalizeRecord(
    input: Partial<DnsRecord> &
      Pick<DnsRecord, 'id' | 'name' | 'type' | 'value' | 'ttl'> &
      Pick<DnsRecord, 'zoneId' | 'zoneName'>
  ): DnsRecord {
    return {
      id: String(input.id),
      zoneId: String(input.zoneId),
      zoneName: String(input.zoneName),
      name: String(input.name),
      type: String(input.type),
      value: String(input.value),
      ttl: typeof input.ttl === 'number' ? input.ttl : 600,
      line: input.line ? String(input.line) : undefined,
      weight: typeof input.weight === 'number' ? input.weight : undefined,
      priority: typeof input.priority === 'number' ? input.priority : undefined,
      status: input.status,
      remark: input.remark === undefined || input.remark === null ? undefined : String(input.remark),
      proxied: typeof input.proxied === 'boolean' ? input.proxied : undefined,
      updatedAt: input.updatedAt ? String(input.updatedAt) : undefined,
      meta: input.meta,
    };
  }

  /**
   * 客户端分页
   */
  protected paginate<T>(items: T[], page?: number, pageSize?: number): { total: number; items: T[] } {
    const total = items.length;
    if (!page && !pageSize) return { total, items };

    const safePage = Math.max(1, page || 1);
    const safePageSize = Math.max(1, pageSize || 20);
    const start = (safePage - 1) * safePageSize;
    const end = start + safePageSize;

    return { total, items: items.slice(start, end) };
  }

  /**
   * 应用 Zone 查询条件（客户端筛选+分页）
   */
  protected applyZoneQuery(
    zones: Zone[],
    page?: number,
    pageSize?: number,
    keyword?: string
  ): ZoneListResult {
    let filtered = zones;

    if (keyword) {
      const kw = keyword.toLowerCase();
      filtered = filtered.filter(z => z.name.toLowerCase().includes(kw));
    }

    const { total, items } = this.paginate(filtered, page, pageSize);
    return { total, zones: items };
  }

  /**
   * 应用 Record 查询条件（客户端筛选+分页）
   */
  protected applyRecordQuery(records: DnsRecord[], params?: RecordQueryParams): RecordListResult {
    let filtered = records;
    if (!params) return { total: filtered.length, records: filtered };

    // 关键词搜索
    if (params.keyword) {
      const kw = params.keyword.toLowerCase();
      filtered = filtered.filter(r => {
        const searchText = `${r.name} ${r.type} ${r.value} ${r.remark || ''}`.toLowerCase();
        return searchText.includes(kw);
      });
    }

    // 子域名筛选
    if (params.subDomain) {
      const sd = params.subDomain.toLowerCase();
      filtered = filtered.filter(r => r.name.toLowerCase().includes(sd));
    }

    // 记录类型筛选
    if (params.type) {
      const t = params.type.toUpperCase();
      filtered = filtered.filter(r => r.type.toUpperCase() === t);
    }

    // 记录值筛选
    if (params.value) {
      const v = params.value.toLowerCase();
      filtered = filtered.filter(r => r.value.toLowerCase().includes(v));
    }

    // 线路筛选
    if (params.line) {
      const l = params.line.toLowerCase();
      filtered = filtered.filter(r => (r.line || '').toLowerCase() === l);
    }

    // 状态筛选
    if (params.status) {
      filtered = filtered.filter(r => r.status === params.status);
    }

    const { total, items } = this.paginate(filtered, params.page, params.pageSize);
    return { total, records: items };
  }

  // ========== 抽象方法 - 子类必须实现 ==========

  abstract checkAuth(): Promise<boolean>;

  abstract getZones(page?: number, pageSize?: number, keyword?: string): Promise<ZoneListResult>;

  abstract getZone(zoneId: string): Promise<Zone>;

  abstract getRecords(zoneId: string, params?: RecordQueryParams): Promise<RecordListResult>;

  abstract getRecord(zoneId: string, recordId: string): Promise<DnsRecord>;

  abstract createRecord(zoneId: string, params: CreateRecordParams): Promise<DnsRecord>;

  abstract updateRecord(zoneId: string, recordId: string, params: UpdateRecordParams): Promise<DnsRecord>;

  abstract deleteRecord(zoneId: string, recordId: string): Promise<boolean>;

  abstract setRecordStatus(zoneId: string, recordId: string, enabled: boolean): Promise<boolean>;

  abstract getLines(zoneId?: string): Promise<LineListResult>;

  abstract getMinTTL(zoneId?: string): Promise<number>;

  // 可选方法
  addZone?(domain: string): Promise<Zone>;
}
