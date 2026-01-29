import rateLimit from 'express-rate-limit';
import { config } from '../config';

/**
 * 登录接口速率限制
 */
export const loginLimiter = rateLimit({
  windowMs: config.rateLimit.login.windowMs,
  max: config.rateLimit.login.max,
  message: {
    success: false,
    message: '登录尝试次数过多，请稍后再试',
  },
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * DNS 操作速率限制
 */
export const dnsLimiter = rateLimit({
  windowMs: config.rateLimit.dns.windowMs,
  max: config.rateLimit.dns.max,
  message: {
    success: false,
    message: 'DNS 操作过于频繁，请稍后再试',
  },
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * 通用 API 速率限制
 */
export const generalLimiter = rateLimit({
  windowMs: config.rateLimit.general.windowMs,
  max: config.rateLimit.general.max,
  message: {
    success: false,
    message: '请求过于频繁，请稍后再试',
  },
  standardHeaders: true,
  legacyHeaders: false,
});
