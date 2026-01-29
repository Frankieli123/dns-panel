/**
 * 阿里云 DNS API 签名认证模块
 * 实现 HMAC-SHA1 签名算法
 */

import crypto from 'crypto';

export interface AliyunAuth {
  accessKeyId: string;
  accessKeySecret: string;
}

export interface AliyunCommonParams {
  Action: string;
  Version?: string;
  Format?: 'JSON' | 'XML';
  AccessKeyId: string;
  SignatureMethod?: 'HMAC-SHA1';
  SignatureVersion?: '1.0';
  SignatureNonce: string;
  Timestamp: string;
}

/**
 * 生成阿里云 API 所需的 ISO8601 时间戳
 */
export function aliyunIsoTimestamp(date = new Date()): string {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/**
 * RFC3986 URL 编码（阿里云规范）
 */
export function aliyunPercentEncode(input: string): string {
  return encodeURIComponent(input)
    .replace(/!/g, '%21')
    .replace(/'/g, '%27')
    .replace(/\(/g, '%28')
    .replace(/\)/g, '%29')
    .replace(/\*/g, '%2A')
    .replace(/%7E/g, '~');
}

/**
 * 构建规范化查询字符串
 */
export function buildCanonicalizedQuery(params: Record<string, string>): string {
  const keys = Object.keys(params).sort();
  return keys
    .map(k => `${aliyunPercentEncode(k)}=${aliyunPercentEncode(params[k] ?? '')}`)
    .join('&');
}

/**
 * 构建待签名字符串
 */
export function buildStringToSign(method: 'GET' | 'POST', canonicalizedQuery: string): string {
  return `${method}&%2F&${aliyunPercentEncode(canonicalizedQuery)}`;
}

/**
 * HMAC-SHA1 签名
 */
export function signStringToSign(stringToSign: string, accessKeySecret: string): string {
  const key = `${accessKeySecret}&`;
  return crypto.createHmac('sha1', key).update(stringToSign, 'utf8').digest('base64');
}

/**
 * 对参数进行签名
 */
export function signAliyunParams(params: Record<string, string>, accessKeySecret: string): string {
  const canonicalized = buildCanonicalizedQuery(params);
  const stringToSign = buildStringToSign('GET', canonicalized);
  return signStringToSign(stringToSign, accessKeySecret);
}

/**
 * 构建完整的签名请求参数
 */
export function buildSignedQuery(
  auth: AliyunAuth,
  action: string,
  extraParams: Record<string, string | number | undefined>
): Record<string, string> {
  const common: AliyunCommonParams = {
    Action: action,
    Version: '2015-01-09',
    Format: 'JSON',
    AccessKeyId: auth.accessKeyId,
    SignatureMethod: 'HMAC-SHA1',
    SignatureVersion: '1.0',
    SignatureNonce: crypto.randomUUID(),
    Timestamp: aliyunIsoTimestamp(),
  };

  const params: Record<string, string> = {};
  for (const [k, v] of Object.entries({ ...common, ...extraParams })) {
    if (v === undefined || v === null) continue;
    params[k] = String(v);
  }

  params.Signature = signAliyunParams(params, auth.accessKeySecret);
  return params;
}
