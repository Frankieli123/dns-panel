/**
 * Huawei Cloud DNS - SDK-HMAC-SHA256 signing
 * - Endpoint: dns.myhuaweicloud.com
 * - Authorization: SDK-HMAC-SHA256 Access=..., SignedHeaders=..., Signature=...
 * - Timestamp header: X-Sdk-Date (UTC, YYYYMMDDTHHMMSSZ)
 */

import crypto from 'crypto';

export type QueryParams = Record<string, string | string[] | undefined>;

export interface HuaweiCredentials {
  accessKeyId: string;
  secretAccessKey: string;
}

export interface HuaweiSignInput {
  method: string;
  host: string;
  path?: string;
  query?: QueryParams;
  headers?: Record<string, string | undefined>;
  body?: string | Buffer;
  timestamp?: Date;
}

function sha256Hex(data: string | Buffer): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

function hmacSha256Hex(key: string | Buffer, data: string | Buffer): string {
  return crypto.createHmac('sha256', key).update(data).digest('hex');
}

function rfc3986Encode(input: string): string {
  return encodeURIComponent(input).replace(/[!'()*]/g, ch => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`);
}

export function huaweiSdkDate(date = new Date()): string {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z').replace(/[-:]/g, '');
}

function canonicalizeUri(path?: string): string {
  const raw = path && path.length > 0 ? path : '/';
  const ensured = raw.startsWith('/') ? raw : `/${raw}`;
  const ensuredWithTrailingSlash = ensured.endsWith('/') ? ensured : `${ensured}/`;
  return ensuredWithTrailingSlash.split('/').map(seg => rfc3986Encode(seg)).join('/');
}

function canonicalizeQuery(query?: QueryParams): string {
  if (!query) return '';
  const pairs: Array<[string, string]> = [];
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined) continue;
    if (Array.isArray(v)) {
      for (const item of v) pairs.push([k, item ?? '']);
    } else {
      pairs.push([k, v ?? '']);
    }
  }
  pairs.sort((a, b) => (a[0] === b[0] ? a[1].localeCompare(b[1]) : a[0].localeCompare(b[0])));
  return pairs.map(([k, v]) => `${rfc3986Encode(k)}=${rfc3986Encode(v)}`).join('&');
}

function normalizeHeaders(headers: Record<string, string | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers || {})) {
    if (v === undefined || v === null) continue;
    out[k.toLowerCase()] = String(v).trim().replace(/\s+/g, ' ');
  }
  return out;
}

function pickSignedHeaderNames(allLowerHeaders: Record<string, string>): string[] {
  const names = Object.keys(allLowerHeaders).filter(n => n === 'host' || n === 'x-sdk-date' || n === 'content-type' || n.startsWith('x-sdk-'));
  names.sort();
  return names;
}

export function buildHuaweiAuthorization(creds: HuaweiCredentials, input: HuaweiSignInput): { authorization: string; sdkDate: string; signedHeaders: string } {
  const method = (input.method || 'GET').toUpperCase();
  const host = input.host.toLowerCase();
  const sdkDate = huaweiSdkDate(input.timestamp || new Date());

  const payload = input.body ?? '';
  const hashedPayload = sha256Hex(payload);

  const baseHeaders: Record<string, string | undefined> = {
    ...(input.headers || {}),
    Host: host,
    'X-Sdk-Date': sdkDate,
  };

  const allLowerHeaders = normalizeHeaders(baseHeaders);
  const signedHeaderNames = pickSignedHeaderNames(allLowerHeaders);
  const signedHeaders = signedHeaderNames.join(';');

  const canonicalHeaders = signedHeaderNames.map(n => `${n}:${allLowerHeaders[n] ?? ''}\n`).join('');

  const canonicalRequest =
    `${method}\n` +
    `${canonicalizeUri(input.path)}\n` +
    `${canonicalizeQuery(input.query)}\n` +
    `${canonicalHeaders}\n` +
    `${signedHeaders}\n` +
    `${hashedPayload}`;

  const algorithm = 'SDK-HMAC-SHA256';
  const stringToSign = `${algorithm}\n${sdkDate}\n${sha256Hex(canonicalRequest)}`;
  const signature = hmacSha256Hex(creds.secretAccessKey, stringToSign);

  const authorization = `${algorithm} Access=${creds.accessKeyId}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  return { authorization, sdkDate, signedHeaders };
}

export function buildHuaweiHeaders(creds: HuaweiCredentials, input: HuaweiSignInput): Record<string, string> {
  const host = input.host.toLowerCase();
  const { authorization, sdkDate } = buildHuaweiAuthorization(creds, { ...input, host });

  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(input.headers || {})) {
    if (v === undefined || v === null) continue;
    headers[k] = String(v);
  }

  headers.Host = host;
  headers['X-Sdk-Date'] = sdkDate;
  headers.Authorization = authorization;
  return headers;
}
