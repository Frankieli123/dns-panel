import dotenv from 'dotenv';
import path from 'path';

// 加载环境变量
dotenv.config({ path: path.join(__dirname, '../../.env') });

const resolvedNodeEnv = String(process.env.NODE_ENV || 'development').trim().toLowerCase();
const defaultAcmeEnv = resolvedNodeEnv === 'production' ? 'production' : 'staging';
const resolvedAcmeEnv = (String(process.env.ACME_ENV || defaultAcmeEnv).trim().toLowerCase() === 'production' ? 'production' : 'staging') as 'staging' | 'production';

function parseIntWithMin(value: string | undefined, fallback: number, min: number) {
  const parsed = parseInt(String(value || ''), 10);
  return Math.max(min, Number.isFinite(parsed) ? parsed : fallback);
}

function parseList(value: string | undefined, fallback: string[]) {
  const items = String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  return items.length > 0 ? Array.from(new Set(items)) : fallback;
}

export const config = {
  // 环境配置
  nodeEnv: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '3000', 10),

  // 数据库配置
  databaseUrl: process.env.DATABASE_URL || 'file:./database.db',

  // JWT 配置
  jwt: {
    secret: (process.env.JWT_SECRET || 'default-secret-key') as string,
    expiresIn: (process.env.JWT_EXPIRES_IN || '7d') as string,
  },

  // 加密配置
  encryptionKey: process.env.ENCRYPTION_KEY || 'default-32-character-key-here!',

  // ACME 配置
  acme: {
    env: resolvedAcmeEnv,
    schedulerIntervalMs: Math.max(5000, parseInt(process.env.CERTIFICATE_SCHEDULER_INTERVAL_MS || '15000', 10) || 15000),
    renewalSchedulerIntervalMs: Math.max(60000, parseInt(process.env.CERTIFICATE_RENEWAL_SCHEDULER_INTERVAL_MS || '21600000', 10) || 21600000),
    propagationDelayMs: Math.max(5000, parseInt(process.env.ACME_PROPAGATION_DELAY_MS || '30000', 10) || 30000),
  },

  certificates: {
    vendorSchedulerIntervalMs: Math.max(5000, parseInt(process.env.VENDOR_CERTIFICATE_SCHEDULER_INTERVAL_MS || '30000', 10) || 30000),
    deploySchedulerIntervalMs: Math.max(5000, parseInt(process.env.CERTIFICATE_DEPLOY_SCHEDULER_INTERVAL_MS || '30000', 10) || 30000),
  },

  // SMTP 配置（邮件通知）
  smtp: {
    host: process.env.SMTP_HOST || '',
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    secure: String(process.env.SMTP_SECURE || '').toLowerCase() === 'true',
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.SMTP_FROM || '',
  },

  // CORS 配置
  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:5173',

  // 日志配置
  logRetentionDays: parseInt(process.env.LOG_RETENTION_DAYS || '90', 10),

  // 缓存配置
  cache: {
    domainsTTL: 300, // 5 分钟
    recordsTTL: 120, // 2 分钟
    userTTL: 600, // 10 分钟
  },

  dnsProbe: {
    resolvers: parseList(process.env.DNS_PROBE_RESOLVERS, ['223.5.5.5', '223.6.6.6', '119.29.29.29', '1.1.1.1', '8.8.8.8']),
    dohProviders: parseList(process.env.DNS_PROBE_DOH_PROVIDERS, ['https://dns.alidns.com/resolve', 'https://doh.pub/resolve', 'https://doh.360.cn/resolve']),
    timeoutMs: parseIntWithMin(process.env.DNS_PROBE_TIMEOUT_MS, 2500, 1000),
    maxCnameDepth: parseIntWithMin(process.env.DNS_PROBE_MAX_CNAME_DEPTH, 6, 1),
    successCacheTtlSec: parseIntWithMin(process.env.DNS_PROBE_SUCCESS_CACHE_TTL_SEC, 60, 1),
    negativeCacheTtlSec: parseIntWithMin(process.env.DNS_PROBE_NEGATIVE_CACHE_TTL_SEC, 15, 1),
    unknownCacheTtlSec: parseIntWithMin(process.env.DNS_PROBE_UNKNOWN_CACHE_TTL_SEC, 5, 1),
  },

  // 速率限制配置
  rateLimit: {
    login: {
      windowMs: 60 * 1000, // 1 分钟
      max: 5, // 5 次
    },
    dns: {
      windowMs: 60 * 1000, // 1 分钟
      max: 30, // 30 次
    },
    general: {
      windowMs: 60 * 1000, // 1 分钟
      max: 100, // 100 次
    },
  },
};

// 验证必需的环境变量
export function validateConfig() {
  const required = ['JWT_SECRET', 'ENCRYPTION_KEY'];
  const missing = required.filter((key) => !process.env[key]);

  // 生产环境必须设置这些环境变量
  if (missing.length > 0 && config.nodeEnv === 'production') {
    throw new Error(
      `缺少必需的环境变量: ${missing.join(', ')}\n` +
      `请在 docker-compose.yml 或 .env 文件中设置这些变量。\n` +
      `生成密钥命令:\n` +
      `  JWT_SECRET: openssl rand -base64 48\n` +
      `  ENCRYPTION_KEY: openssl rand -hex 16`
    );
  }

  // 开发环境给出警告
  if (missing.length > 0 && config.nodeEnv !== 'production') {
    console.warn(`\n⚠️  警告: 使用默认值的环境变量: ${missing.join(', ')}`);
    console.warn('   建议: 请通过 .env 文件设置这些值以提高安全性\n');
  }

  // 验证 ENCRYPTION_KEY 长度
  if (config.encryptionKey.length !== 32) {
    console.warn('⚠️  警告: ENCRYPTION_KEY 应该是 32 字符长度');
  }
}
