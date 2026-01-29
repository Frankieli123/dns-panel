/**
 * 腾讯云 DNSPod API TC3-HMAC-SHA256 签名认证模块
 */

import crypto from 'crypto';

export interface Tc3Credentials {
  secretId: string;
  secretKey: string;
  token?: string; // 临时凭证 Token（可选）
}

export interface Tc3SignInput {
  host: string;       // dnspod.tencentcloudapi.com
  service: string;    // dnspod
  action: string;
  version: string;    // 2021-03-23
  timestamp: number;  // 秒级时间戳
  payload: string;    // JSON 字符串
  contentType?: string;
}

function sha256Hex(data: string): string {
  return crypto.createHash('sha256').update(data, 'utf8').digest('hex');
}

function hmacSha256(key: Buffer | string, data: string): Buffer {
  return crypto.createHmac('sha256', key).update(data, 'utf8').digest();
}

/**
 * 获取 TC3 日期格式
 */
export function tc3Date(timestampSeconds: number): string {
  const d = new Date(timestampSeconds * 1000);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * 构建规范请求
 */
export function buildCanonicalRequest(input: Tc3SignInput): {
  canonicalRequest: string;
  signedHeaders: string;
} {
  const method = 'POST';
  const canonicalUri = '/';
  const canonicalQueryString = '';

  const contentType = input.contentType || 'application/json; charset=utf-8';
  const host = input.host.toLowerCase();

  // TC3 要求小写 header 名称，按字母排序
  const canonicalHeaders = `content-type:${contentType}\nhost:${host}\n`;
  const signedHeaders = 'content-type;host';
  const hashedPayload = sha256Hex(input.payload || '');

  const canonicalRequest =
    `${method}\n` +
    `${canonicalUri}\n` +
    `${canonicalQueryString}\n` +
    `${canonicalHeaders}\n` +
    `${signedHeaders}\n` +
    `${hashedPayload}`;

  return { canonicalRequest, signedHeaders };
}

/**
 * 构建待签名字符串
 */
export function buildStringToSign(input: Tc3SignInput, canonicalRequest: string): {
  stringToSign: string;
  credentialScope: string;
} {
  const algorithm = 'TC3-HMAC-SHA256';
  const date = tc3Date(input.timestamp);
  const credentialScope = `${date}/${input.service}/tc3_request`;
  const hashedCanonicalRequest = sha256Hex(canonicalRequest);

  const stringToSign =
    `${algorithm}\n` +
    `${input.timestamp}\n` +
    `${credentialScope}\n` +
    `${hashedCanonicalRequest}`;

  return { stringToSign, credentialScope };
}

/**
 * 计算 TC3 签名
 */
export function calcTc3Signature(
  creds: Tc3Credentials,
  input: Tc3SignInput,
  canonicalRequest: string
): { authorization: string; signedHeaders: string } {
  const { signedHeaders } = buildCanonicalRequest(input);
  const { stringToSign, credentialScope } = buildStringToSign(input, canonicalRequest);

  const date = tc3Date(input.timestamp);
  const secretDate = hmacSha256(`TC3${creds.secretKey}`, date);
  const secretService = hmacSha256(secretDate, input.service);
  const secretSigning = hmacSha256(secretService, 'tc3_request');
  const signature = crypto.createHmac('sha256', secretSigning).update(stringToSign, 'utf8').digest('hex');

  const authorization =
    `TC3-HMAC-SHA256 ` +
    `Credential=${creds.secretId}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaders}, ` +
    `Signature=${signature}`;

  return { authorization, signedHeaders };
}

/**
 * 构建 TC3 请求头
 */
export function buildTc3Headers(creds: Tc3Credentials, input: Tc3SignInput): Record<string, string> {
  const contentType = input.contentType || 'application/json; charset=utf-8';
  const host = input.host.toLowerCase();

  const { canonicalRequest } = buildCanonicalRequest({ ...input, contentType, host });
  const { authorization } = calcTc3Signature(creds, { ...input, contentType, host }, canonicalRequest);

  const headers: Record<string, string> = {
    Host: host,
    'Content-Type': contentType,
    Authorization: authorization,
    'X-TC-Action': input.action,
    'X-TC-Version': input.version,
    'X-TC-Timestamp': String(input.timestamp),
  };

  if (creds.token) {
    headers['X-TC-Token'] = creds.token;
  }

  return headers;
}
