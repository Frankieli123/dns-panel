/**
 * JDCloud DNS (domainservice) - JDCLOUD2-HMAC-SHA256 signing
 * - Endpoint: domainservice.jdcloud-api.com
 * - Service: domainservice, Region: cn-north-1
 * - Authorization: JDCLOUD2-HMAC-SHA256 Credential=... SignedHeaders=... Signature=...
 * - Timestamp header: x-jdcloud-date (UTC, YYYYMMDDTHHMMSSZ)
 */

import crypto from 'crypto';

export type QueryParams = Record<string, string | string[] | undefined>;

export interface JdcloudCredentials {
  accessKeyId: string;
  accessKeySecret: string;
}

export interface JdcloudSignInput {
  method: string;
  host: string;
  service: string;
  region: string;
  path?: string;
  query?: QueryParams;
  headers?: Record<string, string | undefined>;
  body?: string | Buffer;
  timestamp?: Date;
}

function sha256Hex(data: string | Buffer): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

function hmacSha256(key: string | Buffer, data: string | Buffer): Buffer {
  return crypto.createHmac('sha256', key).update(data).digest();
}

function hmacSha256Hex(key: string | Buffer, data: string | Buffer): string {
  return crypto.createHmac('sha256', key).update(data).digest('hex');
}

function rfc3986Encode(input: string): string {
  return encodeURIComponent(input).replace(/[!'()*]/g, ch => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`);
}

export function jdcloudAmzDate(date = new Date()): string {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z').replace(/[-:]/g, '');
}

function jdcloudNonce(): string {
  // JDCloud gateway requires x-jdcloud-nonce header.
  // Keep it simple: use random bytes as hex to avoid case/encoding issues.
  return crypto.randomBytes(16).toString('hex');
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
  const names = Object.keys(allLowerHeaders).filter(n =>
    n === 'host' || n === 'x-jdcloud-date' || n === 'content-type' || n.startsWith('x-jdcloud-')
  );
  names.sort();
  return names;
}

export function buildJdcloudAuthorization(creds: JdcloudCredentials, input: JdcloudSignInput): { authorization: string; amzDate: string } {
  const method = (input.method || 'GET').toUpperCase();
  const host = input.host.toLowerCase();
  const amzDate = jdcloudAmzDate(input.timestamp || new Date());
  const dateStamp = amzDate.slice(0, 8);

  const payload = input.body ?? '';
  const hashedPayload = sha256Hex(payload);

  const baseHeaders: Record<string, string | undefined> = {
    ...(input.headers || {}),
    Host: host,
    'x-jdcloud-date': amzDate,
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

  const algorithm = 'JDCLOUD2-HMAC-SHA256';
  const credentialScope = `${dateStamp}/${input.region}/${input.service}/jdcloud2_request`;
  const stringToSign = `${algorithm}\n${amzDate}\n${credentialScope}\n${sha256Hex(canonicalRequest)}`;

  const kDate = hmacSha256(`JDCLOUD2${creds.accessKeySecret}`, dateStamp);
  const kRegion = hmacSha256(kDate, input.region);
  const kService = hmacSha256(kRegion, input.service);
  const kSigning = hmacSha256(kService, 'jdcloud2_request');
  const signature = hmacSha256Hex(kSigning, stringToSign);

  const authorization = `${algorithm} Credential=${creds.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  return { authorization, amzDate };
}

export function buildJdcloudHeaders(creds: JdcloudCredentials, input: JdcloudSignInput): Record<string, string> {
  const host = input.host.toLowerCase();

  const nonce =
    input.headers?.['x-jdcloud-nonce'] ??
    input.headers?.['X-Jdcloud-Nonce'] ??
    input.headers?.['X-JDCLOUD-Nonce'] ??
    jdcloudNonce();

  const mergedInput: JdcloudSignInput = {
    ...input,
    host,
    headers: {
      ...(input.headers || {}),
      'x-jdcloud-nonce': nonce,
    },
  };

  const { authorization, amzDate } = buildJdcloudAuthorization(creds, mergedInput);

  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(mergedInput.headers || {})) {
    if (v === undefined || v === null) continue;
    headers[k] = String(v);
  }

  headers.Host = host;
  headers['x-jdcloud-date'] = amzDate;
  headers.Authorization = authorization;
  return headers;
}
