/**
 * Baidu Cloud DNS - BCE Signing (bce-auth-v1)
 * - Endpoint: dns.baidubce.com
 * - Authorization: bce-auth-v1/{AccessKey}/{Timestamp}/{Expiration}/{SignedHeaders}/{Signature}
 * - Timestamp header: x-bce-date (UTC, ISO8601 without milliseconds)
 */

import crypto from 'crypto';

export type QueryParams = Record<string, string | string[] | undefined>;

export interface BceCredentials {
  accessKey: string;
  secretKey: string;
}

export interface BceSignInput {
  method: string;
  host: string;
  path?: string;
  query?: QueryParams;
  headers?: Record<string, string | undefined>;
  timestamp?: Date;
  expirationInSeconds?: number;
}

function rfc3986Encode(input: string): string {
  return encodeURIComponent(input).replace(/[!'()*]/g, ch => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`);
}

function hmacSha256Hex(key: string | Buffer, data: string | Buffer): string {
  return crypto.createHmac('sha256', key).update(data).digest('hex');
}

export function bceIsoTimestamp(date = new Date()): string {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function normalizeHeaders(headers: Record<string, string | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers || {})) {
    if (v === undefined || v === null) continue;
    out[k.toLowerCase()] = String(v).trim().replace(/\s+/g, ' ');
  }
  return out;
}

function canonicalizeUri(path?: string): string {
  const raw = path && path.length > 0 ? path : '/';
  const ensured = raw.startsWith('/') ? raw : `/${raw}`;
  return ensured.split('/').map(seg => rfc3986Encode(seg)).join('/');
}

function canonicalizeQuery(query?: QueryParams): string {
  if (!query) return '';
  const pairs: Array<[string, string]> = [];
  for (const [k, v] of Object.entries(query)) {
    if (!k || k.toLowerCase() === 'authorization') continue;
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

function defaultHeadersToSign(allLowerHeaders: Record<string, string>): string[] {
  const names = Object.keys(allLowerHeaders).filter(n => n !== 'authorization');
  names.sort();
  return names;
}

export function buildBceAuthorization(creds: BceCredentials, input: BceSignInput): { authorization: string; bceDate: string } {
  const method = (input.method || 'GET').toUpperCase();
  const host = input.host.toLowerCase();
  const bceDate = bceIsoTimestamp(input.timestamp || new Date());
  const expiration = Math.max(1, input.expirationInSeconds ?? 1800);

  const baseHeaders: Record<string, string | undefined> = {
    ...(input.headers || {}),
    Host: host,
    'x-bce-date': bceDate,
  };

  const allLowerHeaders = normalizeHeaders(baseHeaders);
  const signedHeaderNames = defaultHeadersToSign(allLowerHeaders);
  const signedHeaders = signedHeaderNames.join(';');

  // BCE requires URL-encoded values in canonical headers
  const canonicalHeaders = signedHeaderNames
    .map(n => `${rfc3986Encode(n)}:${rfc3986Encode(allLowerHeaders[n] ?? '')}`)
    .join('\n');

  const canonicalRequest =
    `${method}\n` +
    `${canonicalizeUri(input.path)}\n` +
    `${canonicalizeQuery(input.query)}\n` +
    `${canonicalHeaders}`;

  const authStringPrefix = `bce-auth-v1/${creds.accessKey}/${bceDate}/${expiration}`;
  const signingKey = hmacSha256Hex(creds.secretKey, authStringPrefix);
  const signature = hmacSha256Hex(signingKey, canonicalRequest);

  const authorization = `${authStringPrefix}/${signedHeaders}/${signature}`;
  return { authorization, bceDate };
}

export function buildBceHeaders(creds: BceCredentials, input: BceSignInput): Record<string, string> {
  const host = input.host.toLowerCase();
  const { authorization, bceDate } = buildBceAuthorization(creds, { ...input, host });

  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(input.headers || {})) {
    if (v === undefined || v === null) continue;
    headers[k] = String(v);
  }

  headers.Host = host;
  headers['x-bce-date'] = bceDate;
  headers.Authorization = authorization;
  return headers;
}

export function generateClientToken(): string {
  return crypto.randomUUID();
}
