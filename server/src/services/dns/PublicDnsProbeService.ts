import { Resolver } from 'dns/promises';
import NodeCache from 'node-cache';
import { config } from '../../config';

export type PublicDnsProbeMode = 'strict_cname' | 'access_cname';
export type PublicDnsProbeStatus = 'configured' | 'unconfigured' | 'unknown';
export type PublicDnsProbeMatchKind = 'cname' | 'cname_chain' | 'ip_intersection';

export interface PublicDnsProbeInput {
  recordName: string;
  expectedTarget: string;
  mode?: PublicDnsProbeMode;
}

export interface PublicDnsProbeResult {
  status: PublicDnsProbeStatus;
  matchedBy?: PublicDnsProbeMatchKind;
  sourceType?: 'resolver' | 'doh';
  source?: string;
  errors?: string[];
}

interface DnsQueryResult {
  values: string[];
  usable: boolean;
  error?: string;
}

interface DnsSource {
  type: 'resolver' | 'doh';
  name: string;
  queryCname(hostname: string): Promise<DnsQueryResult>;
  queryA(hostname: string): Promise<DnsQueryResult>;
  queryAAAA(hostname: string): Promise<DnsQueryResult>;
}

interface CnameCheckResult {
  matched: boolean;
  matchedBy?: 'cname' | 'cname_chain';
  complete: boolean;
  errors: string[];
}

interface IpCheckResult {
  matched: boolean;
  complete: boolean;
  errors: string[];
}

const cache = new NodeCache({ useClones: false });
const NEGATIVE_DNS_CODES = new Set(['ENODATA', 'ENOTFOUND', 'ENOENT']);
let cachedSources: DnsSource[] | null = null;

function normalizeDnsName(value: unknown): string {
  return String(value || '').trim().replace(/\.+$/, '').toLowerCase();
}

function normalizeIp(value: unknown): string {
  return String(value || '').trim().toLowerCase();
}

function uniqBy(values: unknown[], normalize: (value: unknown) => string): string[] {
  const set = new Set<string>();
  values.forEach((value) => {
    if (Array.isArray(value)) {
      uniqBy(value, normalize).forEach((item) => set.add(item));
      return;
    }
    const normalized = normalize(value);
    if (normalized) set.add(normalized);
  });
  return Array.from(set);
}

function uniqDnsNames(values: unknown[]): string[] {
  return uniqBy(values, normalizeDnsName);
}

function uniqIps(values: unknown[]): string[] {
  return uniqBy(values, normalizeIp);
}

function uniqErrors(values: Array<string | undefined>): string[] | undefined {
  const items = values.map((value) => String(value || '').trim()).filter(Boolean);
  return items.length > 0 ? Array.from(new Set(items)) : undefined;
}

async function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(Object.assign(new Error(message), { code: 'DNS_TIMEOUT' })), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function buildResolverSource(server: string): DnsSource {
  const resolver = new Resolver();
  resolver.setServers([server]);

  const wrap = async (
    fn: (resolver: Resolver) => Promise<string[]>,
    normalize: (value: unknown) => string
  ): Promise<DnsQueryResult> => {
    try {
      const values = await withTimeout(fn(resolver), config.dnsProbe.timeoutMs, `DNS 查询超时: ${server}`);
      return { values: uniqBy(values, normalize), usable: true };
    } catch (error: any) {
      const code = String(error?.code || '').toUpperCase();
      if (NEGATIVE_DNS_CODES.has(code)) {
        return { values: [], usable: true };
      }
      return {
        values: [],
        usable: false,
        error: `${server}: ${String(error?.message || code || 'DNS 查询失败')}`,
      };
    }
  };

  return {
    type: 'resolver',
    name: server,
    queryCname: (hostname) => wrap((currentResolver) => currentResolver.resolveCname(hostname), normalizeDnsName),
    queryA: (hostname) => wrap((currentResolver) => currentResolver.resolve4(hostname), normalizeIp),
    queryAAAA: (hostname) => wrap((currentResolver) => currentResolver.resolve6(hostname), normalizeIp),
  };
}

async function queryDoh(url: string, hostname: string, type: 'A' | 'AAAA' | 'CNAME'): Promise<DnsQueryResult> {
  const typeMap: Record<'A' | 'AAAA' | 'CNAME', number> = {
    A: 1,
    AAAA: 28,
    CNAME: 5,
  };
  const numericType = typeMap[type];
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.dnsProbe.timeoutMs);

  try {
    const response = await fetch(`${url}?name=${encodeURIComponent(hostname)}&type=${numericType}`, {
      method: 'GET',
      headers: { accept: 'application/dns-json, application/json' },
      signal: controller.signal,
    });

    if (!response.ok) {
      return { values: [], usable: false, error: `${url}: HTTP ${response.status}` };
    }

    const json = await response.json() as any;
    const status = Number(json?.Status);
    if (!Number.isFinite(status)) {
      return { values: [], usable: false, error: `${url}: DoH 返回格式无效` };
    }
    if (status === 3) {
      return { values: [], usable: true };
    }
    if (status !== 0) {
      return { values: [], usable: false, error: `${url}: DoH status ${status}` };
    }

    const normalize = type === 'CNAME' ? normalizeDnsName : normalizeIp;
    const answers = Array.isArray(json?.Answer) ? json.Answer : [];
    const values = answers
      .filter((row: any) => Number(row?.type) === numericType)
      .map((row: any) => normalize(row?.data))
      .filter(Boolean);

    return { values: uniqBy(values, normalize), usable: true };
  } catch (error: any) {
    return {
      values: [],
      usable: false,
      error: `${url}: ${error?.name === 'AbortError' ? 'DNS 查询超时' : String(error?.message || 'DoH 查询失败')}`,
    };
  } finally {
    clearTimeout(timer);
  }
}

function buildDohSource(url: string): DnsSource {
  return {
    type: 'doh',
    name: url,
    queryCname: (hostname) => queryDoh(url, hostname, 'CNAME'),
    queryA: (hostname) => queryDoh(url, hostname, 'A'),
    queryAAAA: (hostname) => queryDoh(url, hostname, 'AAAA'),
  };
}

function hasIntersection(left: string[], right: string[]): boolean {
  if (left.length === 0 || right.length === 0) return false;
  const set = new Set(left.map(normalizeIp).filter(Boolean));
  return right.some((value) => set.has(normalizeIp(value)));
}

async function inspectCname(source: DnsSource, recordName: string, expectedTarget: string): Promise<CnameCheckResult> {
  const errors: string[] = [];
  const initial = await source.queryCname(recordName);
  if (initial.error) errors.push(initial.error);
  if (!initial.usable) {
    return { matched: false, complete: false, errors };
  }

  const directTargets = uniqDnsNames(initial.values);
  if (directTargets.includes(expectedTarget)) {
    return { matched: true, matchedBy: 'cname', complete: true, errors };
  }

  if (directTargets.length === 0) {
    return { matched: false, complete: true, errors };
  }

  const seen = new Set<string>(directTargets);
  let frontier = directTargets;
  let complete = true;

  for (let depth = 0; depth < config.dnsProbe.maxCnameDepth && frontier.length > 0; depth += 1) {
    const layerResults = await Promise.all(frontier.map((hostname) => source.queryCname(hostname)));
    const next: string[] = [];

    for (const result of layerResults) {
      if (result.error) errors.push(result.error);
      if (!result.usable) {
        complete = false;
        continue;
      }

      const values = uniqDnsNames(result.values);
      if (values.includes(expectedTarget)) {
        return { matched: true, matchedBy: 'cname_chain', complete: true, errors };
      }

      values.forEach((value) => {
        if (seen.has(value)) return;
        seen.add(value);
        next.push(value);
      });
    }

    if (next.length === 0) {
      return { matched: false, complete, errors };
    }

    frontier = uniqDnsNames(next);
  }

  return { matched: false, complete: false, errors };
}

async function inspectIps(source: DnsSource, recordName: string, expectedTarget: string): Promise<IpCheckResult> {
  const [recordA, recordAAAA, expectedA, expectedAAAA] = await Promise.all([
    source.queryA(recordName),
    source.queryAAAA(recordName),
    source.queryA(expectedTarget),
    source.queryAAAA(expectedTarget),
  ]);

  const errors = [recordA.error, recordAAAA.error, expectedA.error, expectedAAAA.error].filter(Boolean) as string[];
  const recordIps = uniqIps([...recordA.values, ...recordAAAA.values]);
  const expectedIps = uniqIps([...expectedA.values, ...expectedAAAA.values]);

  return {
    matched: hasIntersection(recordIps, expectedIps),
    complete: recordA.usable && recordAAAA.usable && expectedA.usable && expectedAAAA.usable,
    errors,
  };
}

async function inspectSource(
  source: DnsSource,
  recordName: string,
  expectedTarget: string,
  mode: PublicDnsProbeMode
): Promise<PublicDnsProbeResult> {
  const cnameCheck = await inspectCname(source, recordName, expectedTarget);
  if (cnameCheck.matched) {
    return {
      status: 'configured',
      matchedBy: cnameCheck.matchedBy,
      sourceType: source.type,
      source: source.name,
      errors: uniqErrors(cnameCheck.errors),
    };
  }

  if (mode === 'strict_cname') {
    return {
      status: cnameCheck.complete ? 'unconfigured' : 'unknown',
      sourceType: source.type,
      source: source.name,
      errors: uniqErrors(cnameCheck.errors),
    };
  }

  const ipCheck = await inspectIps(source, recordName, expectedTarget);
  if (ipCheck.matched) {
    return {
      status: 'configured',
      matchedBy: 'ip_intersection',
      sourceType: source.type,
      source: source.name,
      errors: uniqErrors([...cnameCheck.errors, ...ipCheck.errors]),
    };
  }

  return {
    status: cnameCheck.complete && ipCheck.complete ? 'unconfigured' : 'unknown',
    sourceType: source.type,
    source: source.name,
    errors: uniqErrors([...cnameCheck.errors, ...ipCheck.errors]),
  };
}

function getCacheTtl(status: PublicDnsProbeStatus): number {
  if (status === 'configured') return config.dnsProbe.successCacheTtlSec;
  if (status === 'unconfigured') return config.dnsProbe.negativeCacheTtlSec;
  return config.dnsProbe.unknownCacheTtlSec;
}

function getSources(): DnsSource[] {
  if (cachedSources) return cachedSources;

  cachedSources = [
    ...config.dnsProbe.resolvers.map((server) => buildResolverSource(server)),
    ...config.dnsProbe.dohProviders.map((url) => buildDohSource(url)),
  ];

  return cachedSources;
}

export class PublicDnsProbeService {
  static async checkCnameStatus(input: PublicDnsProbeInput): Promise<PublicDnsProbeResult> {
    const mode = input.mode || 'access_cname';
    const recordName = normalizeDnsName(input.recordName);
    const expectedTarget = normalizeDnsName(input.expectedTarget);

    if (!recordName || !expectedTarget) {
      return { status: 'unknown', errors: ['recordName 或 expectedTarget 为空'] };
    }

    const cacheKey = `cname-status:${mode}:${recordName}->${expectedTarget}`;
    const cached = cache.get<PublicDnsProbeResult>(cacheKey);
    if (cached) return cached;

    const sources = getSources();
    const errors: string[] = [];
    let sawUnknown = false;
    let fallbackUnconfiguredResult: PublicDnsProbeResult | undefined;

    for (const source of sources) {
      const result = await inspectSource(source, recordName, expectedTarget, mode);
      if (result.errors?.length) errors.push(...result.errors);

      if (result.status === 'configured') {
        const finalResult: PublicDnsProbeResult = {
          ...result,
          errors: uniqErrors(errors),
        };
        cache.set(cacheKey, finalResult, getCacheTtl(finalResult.status));
        return finalResult;
      }

      if (result.status === 'unknown') {
        sawUnknown = true;
        continue;
      }

      if (!fallbackUnconfiguredResult && result.status === 'unconfigured') {
        fallbackUnconfiguredResult = result;
      }
    }

    const finalResult: PublicDnsProbeResult = fallbackUnconfiguredResult && !sawUnknown
      ? {
          ...fallbackUnconfiguredResult,
          errors: uniqErrors(errors),
        }
      : {
          status: 'unknown',
          errors: uniqErrors(errors),
        };

    cache.set(cacheKey, finalResult, getCacheTtl(finalResult.status));
    return finalResult;
  }

  static clearCache() {
    cache.flushAll();
  }
}
