import https from 'https';
import net from 'net';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

type DomainExpirySource = 'rdap' | 'whois' | 'unknown';

export interface DomainExpiryResult {
  domain: string;
  expiresAt?: string; // ISO string (UTC)
  source: DomainExpirySource;
  checkedAt: string; // ISO string (UTC)
  error?: string; // diagnostic message for missing expiresAt
}

const CACHE_KEY_PREFIX = 'domainExpiry:';

function normalizeDomain(input: string): string {
  const raw = String(input || '').trim().toLowerCase();
  const noDot = raw.endsWith('.') ? raw.slice(0, -1) : raw;

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const punycode = require('punycode');
    return punycode.toASCII(noDot);
  } catch {
    return noDot;
  }
}

function toUtcDateOnlyIso(date: Date): string {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())).toISOString();
}

function parseRdapExpirationDate(payload: any): string | undefined {
  const events = Array.isArray(payload?.events) ? payload.events : [];
  for (const ev of events) {
    const action = typeof ev?.eventAction === 'string' ? ev.eventAction.toLowerCase() : '';
    if (!action) continue;
    if (action !== 'expiration' && action !== 'expiry' && action !== 'expires') continue;

    const dateRaw = ev?.eventDate;
    if (typeof dateRaw !== 'string' || !dateRaw) continue;
    const parsed = new Date(dateRaw);
    if (Number.isNaN(parsed.getTime())) continue;
    return toUtcDateOnlyIso(parsed);
  }
  return undefined;
}

const WHOIS_PORT = 43;
const whoisServerCache = new Map<string, string>();

async function fetchWhoisRaw(server: string, query: string, timeoutMs = 8000): Promise<string> {
  const host = String(server || '').trim();
  const q = String(query || '').trim();
  if (!host || !q) throw new Error('WHOIS invalid server/query');

  return await new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port: WHOIS_PORT });
    const chunks: Buffer[] = [];
    let settled = false;

    const finish = (err?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        socket.destroy();
      } catch {}
      if (err) reject(err);
      else resolve(Buffer.concat(chunks).toString('utf8'));
    };

    const timer = setTimeout(() => finish(new Error('WHOIS timeout')), timeoutMs);

    socket.on('connect', () => {
      try {
        socket.write(`${q}\r\n`);
      } catch (err: any) {
        finish(err instanceof Error ? err : new Error(String(err)));
      }
    });
    socket.on('data', d => {
      chunks.push(Buffer.isBuffer(d) ? d : Buffer.from(String(d), 'utf8'));
    });
    socket.on('end', () => finish());
    socket.on('error', err => finish(err instanceof Error ? err : new Error(String(err))));
  });
}

function parseWhoisReferralServer(text: string): string | undefined {
  const raw = String(text || '');
  const match = raw.match(/^\s*(?:registrar whois server|whois server)\s*:\s*(\S+)\s*$/im);
  const server = match?.[1] ? String(match[1]).trim() : '';
  if (!server) return undefined;
  if (!/^[a-z0-9.-]+$/i.test(server)) return undefined;
  return server.toLowerCase();
}

function parseDateFromWhois(value: string): Date | undefined {
  const raw = String(value || '').trim();
  if (!raw) return undefined;

  const cleaned = raw.replace(/\s*\(.*\)\s*$/, '').trim();
  const direct = new Date(cleaned);
  if (!Number.isNaN(direct.getTime())) return direct;

  const isoDateOnly = cleaned.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoDateOnly) {
    const y = parseInt(isoDateOnly[1], 10);
    const m = parseInt(isoDateOnly[2], 10);
    const d = parseInt(isoDateOnly[3], 10);
    return new Date(Date.UTC(y, m - 1, d));
  }

  const dotDate = cleaned.match(/^(\d{4})\.(\d{2})\.(\d{2})$/);
  if (dotDate) {
    const y = parseInt(dotDate[1], 10);
    const m = parseInt(dotDate[2], 10);
    const d = parseInt(dotDate[3], 10);
    return new Date(Date.UTC(y, m - 1, d));
  }

  const mmmDate = cleaned.match(/^(\d{2})-([A-Za-z]{3})-(\d{4})/);
  if (mmmDate) {
    const day = parseInt(mmmDate[1], 10);
    const monRaw = mmmDate[2].toLowerCase();
    const year = parseInt(mmmDate[3], 10);
    const months: Record<string, number> = {
      jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
      jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
    };
    const month = months[monRaw];
    if (month !== undefined) return new Date(Date.UTC(year, month, day));
  }

  const firstToken = cleaned.split(/\s+/)[0] || '';
  if (firstToken && firstToken !== cleaned) {
    const retry = new Date(firstToken);
    if (!Number.isNaN(retry.getTime())) return retry;
  }

  return undefined;
}

function parseWhoisExpirationDate(text: string): string | undefined {
  const raw = String(text || '');
  if (!raw) return undefined;

  const lines = raw.split(/\r?\n/);
  const patterns: RegExp[] = [
    /^\s*registry expiry date\s*:\s*(.+)\s*$/i,
    /^\s*registrar registration expiration date\s*:\s*(.+)\s*$/i,
    /^\s*expiration date\s*:\s*(.+)\s*$/i,
    /^\s*expiry date\s*:\s*(.+)\s*$/i,
    /^\s*expires on\s*:\s*(.+)\s*$/i,
    /^\s*expires\s*:\s*(.+)\s*$/i,
    /^\s*paid-till\s*:\s*(.+)\s*$/i,
    /^\s*paid till\s*:\s*(.+)\s*$/i,
  ];

  for (const line of lines) {
    for (const re of patterns) {
      const m = line.match(re);
      if (!m?.[1]) continue;
      const dt = parseDateFromWhois(m[1]);
      if (!dt) continue;
      return toUtcDateOnlyIso(dt);
    }
  }

  return undefined;
}

async function resolveWhoisServerForDomain(domain: string): Promise<string | undefined> {
  const parts = String(domain || '').trim().toLowerCase().split('.').filter(Boolean);
  const tld = parts.length >= 2 ? parts[parts.length - 1] : '';
  if (!tld) return undefined;

  const cached = whoisServerCache.get(tld);
  if (cached) return cached;

  try {
    const iana = await fetchWhoisRaw('whois.iana.org', tld, 5000);
    const match = iana.match(/^\s*whois\s*:\s*(\S+)\s*$/im);
    const server = match?.[1] ? String(match[1]).trim().toLowerCase() : '';
    if (server) {
      whoisServerCache.set(tld, server);
      return server;
    }
  } catch {
    // ignore
  }

  return undefined;
}

async function fetchWhoisExpiration(domain: string): Promise<{ expiresAt?: string; error?: string }> {
  const server = await resolveWhoisServerForDomain(domain);
  if (!server) return { error: 'whois: unable to resolve whois server' };

  try {
    const raw = await fetchWhoisRaw(server, domain);
    const expiresAt = parseWhoisExpirationDate(raw);
    if (expiresAt) return { expiresAt };

    const referral = parseWhoisReferralServer(raw);
    if (referral && referral !== server) {
      const raw2 = await fetchWhoisRaw(referral, domain);
      const expiresAt2 = parseWhoisExpirationDate(raw2);
      if (expiresAt2) return { expiresAt: expiresAt2 };
      return { error: 'whois: expiration field not found (referral)' };
    }
    return { error: 'whois: expiration field not found' };
  } catch (err: any) {
    return { error: `whois: ${err?.message ? String(err.message) : String(err)}` };
  }

  return { error: 'whois: unknown error' };
}

async function fetchJson(url: string): Promise<any> {
  return await new Promise((resolve, reject) => {
    const req = https.request(
      url,
      {
        method: 'GET',
        headers: {
          Accept: 'application/rdap+json, application/json',
          'User-Agent': 'dns-panel/1.0 (domain-expiry)',
        },
      },
      res => {
        const chunks: Buffer[] = [];
        res.on('data', d => chunks.push(Buffer.isBuffer(d) ? d : Buffer.from(d)));
        res.on('end', () => {
          const status = res.statusCode || 0;
          const raw = Buffer.concat(chunks).toString('utf8');
          if (status < 200 || status >= 300) {
            reject(new Error(`RDAP HTTP ${status}`));
            return;
          }
          try {
            resolve(raw ? JSON.parse(raw) : {});
          } catch {
            reject(new Error('RDAP invalid JSON response'));
          }
        });
      }
    );
    req.on('error', reject);
    req.end();
  });
}

function ttlSecondsFor(expiresAtIso?: string): number {
  if (!expiresAtIso) return 7 * 24 * 60 * 60;

  const expiresAt = new Date(expiresAtIso);
  if (Number.isNaN(expiresAt.getTime())) return 7 * 24 * 60 * 60;

  const msLeft = expiresAt.getTime() - Date.now();
  const daysLeft = Math.floor(msLeft / 86_400_000);
  if (daysLeft <= 7) return 24 * 60 * 60;
  if (daysLeft <= 90) return 3 * 24 * 60 * 60;
  if (daysLeft <= 180) return 7 * 24 * 60 * 60;
  return 14 * 24 * 60 * 60;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = [];
  let cursor = 0;

  const workers = Array.from({ length: Math.max(1, limit) }, async () => {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) break;
      results[index] = await fn(items[index]);
    }
  });

  await Promise.all(workers);
  return results;
}

export class DomainExpiryService {
  static async lookupDomains(
    domains: string[],
    opts?: { forceRefresh?: boolean; concurrency?: number }
  ): Promise<DomainExpiryResult[]> {
    const input = Array.isArray(domains) ? domains : [];
    const normalized = input
      .map(normalizeDomain)
      .filter(Boolean);

    const forceRefresh = !!opts?.forceRefresh;
    const concurrency = typeof opts?.concurrency === 'number' ? Math.max(1, Math.min(10, opts.concurrency)) : 3;

    const unique = Array.from(new Set(normalized));
    if (unique.length === 0) return [];

    const lookupOne = async (domain: string): Promise<DomainExpiryResult> => {
      const cacheKey = `${CACHE_KEY_PREFIX}${domain}`;
      const now = new Date();

      if (!forceRefresh) {
        const cached = await prisma.cache.findUnique({ where: { key: cacheKey } });
        if (cached && cached.expiresAt.getTime() > now.getTime()) {
          try {
            const parsed = cached.value ? JSON.parse(cached.value) : {};
            const parsedSource = parsed?.source;
            return {
              domain,
              expiresAt: typeof parsed?.expiresAt === 'string' ? parsed.expiresAt : undefined,
              source: parsedSource === 'rdap' || parsedSource === 'whois' ? parsedSource : 'unknown',
              checkedAt: typeof parsed?.checkedAt === 'string' ? parsed.checkedAt : cached.createdAt.toISOString(),
              error: typeof parsed?.error === 'string' ? parsed.error : undefined,
            } satisfies DomainExpiryResult;
          } catch {
            // fall through and refresh
          }
        }
      }

      const checkedAt = new Date().toISOString();
      let expiresAt: string | undefined;
      let source: DomainExpirySource = 'unknown';
      let error: string | undefined;

      try {
        const rdap = await fetchJson(`https://rdap.org/domain/${encodeURIComponent(domain)}`);
        const parsedExpiresAt = parseRdapExpirationDate(rdap);
        if (parsedExpiresAt) {
          expiresAt = parsedExpiresAt;
          source = 'rdap';
        } else {
          error = 'rdap: expiration event not found';
        }
      } catch (err: any) {
        error = `rdap: ${err?.message ? String(err.message) : String(err)}`;
      }

      if (!expiresAt) {
        const whois = await fetchWhoisExpiration(domain);
        if (whois.expiresAt) {
          expiresAt = whois.expiresAt;
          source = 'whois';
          error = undefined;
        } else {
          const rdapPart = error ? error : 'rdap: unknown';
          const whoisPart = whois.error ? whois.error : 'whois: unknown';
          error = `${rdapPart} | ${whoisPart}`;
        }
      }

      const value: DomainExpiryResult = { domain, expiresAt, source, checkedAt, ...(error ? { error } : {}) };
      const ttlSeconds = ttlSecondsFor(expiresAt);
      const cacheExpiresAt = new Date(Date.now() + ttlSeconds * 1000);

      await prisma.cache.upsert({
        where: { key: cacheKey },
        create: {
          key: cacheKey,
          value: JSON.stringify(value),
          expiresAt: cacheExpiresAt,
        },
        update: {
          value: JSON.stringify(value),
          expiresAt: cacheExpiresAt,
        },
      });

      return value;
    };

    const results: DomainExpiryResult[] = [];
    const chunkSize = 500;
    for (let start = 0; start < unique.length; start += chunkSize) {
      const chunk = unique.slice(start, start + chunkSize);
      const chunkResults = await mapWithConcurrency(chunk, concurrency, lookupOne);
      results.push(...chunkResults);
    }

    return results;
  }
}
