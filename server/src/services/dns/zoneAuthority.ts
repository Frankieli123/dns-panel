import { promises as dnsPromises } from 'dns';
import NodeCache from 'node-cache';
import { ProviderType, Zone } from '../../providers/base/types';

type ZoneAuthorityStatus = NonNullable<Zone['authorityStatus']>;

const cache = new NodeCache({ stdTTL: 1800, useClones: false });

const LOOKUP_TIMEOUT_MS = 3500;

const normalizeName = (value: unknown): string =>
  String(value ?? '').trim().replace(/\.+$/, '').toLowerCase();

const uniqNames = (values: unknown[]): string[] => {
  const set = new Set<string>();

  values.forEach((value) => {
    if (Array.isArray(value)) {
      uniqNames(value).forEach((item) => set.add(item));
      return;
    }

    const normalized = normalizeName(value);
    if (normalized) set.add(normalized);
  });

  return Array.from(set);
};

const extractNameServers = (zone: Zone): string[] => {
  const meta = (zone.meta || {}) as Record<string, any>;
  const raw = (meta.raw || {}) as Record<string, any>;

  return uniqNames([
    meta.nameServers,
    meta.vanityNameServers,
    meta.expectedNameServers,
    raw.name_servers,
    raw.vanity_name_servers,
    raw.nameServers,
    raw.vanityNameServers,
    raw.nameservers,
    raw.EffectiveDNS,
    raw.ActualNsList,
    raw.DnspodNsList,
    raw.DnsServers?.DnsServer,
    raw.NameServers,
    raw.defNsList,
    raw.AllocateDNSServerList,
    Array.isArray(raw.nameservers) ? raw.nameservers.map((item: any) => item?.hostname || item?.hostName || item) : undefined,
    Array.isArray(raw.ns_records) ? raw.ns_records.map((item: any) => item?.hostname || item?.hostName || item) : undefined,
  ]);
};

const withTimeout = async <T>(promise: Promise<T>, ms: number): Promise<T> => {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error('DNS lookup timeout')), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};

const resolvePublicNameServers = async (zoneName: string): Promise<string[] | null> => {
  const normalizedZone = normalizeName(zoneName);
  if (!normalizedZone) return [];

  const cacheKey = `public-ns:${normalizedZone}`;
  const cached = cache.get<string[] | null>(cacheKey);
  if (cached !== undefined) return cached;

  try {
    const result = await withTimeout(dnsPromises.resolveNs(normalizedZone), LOOKUP_TIMEOUT_MS);
    const normalized = uniqNames(result);
    cache.set(cacheKey, normalized);
    return normalized;
  } catch (error: any) {
    const code = String(error?.code || '').toUpperCase();
    if (code === 'ENODATA' || code === 'ENOTFOUND' || code === 'ESERVFAIL' || code === 'EREFUSED') {
      cache.set(cacheKey, []);
      return [];
    }
    return null;
  }
};

const intersects = (a: string[], b: string[]): boolean => {
  if (a.length === 0 || b.length === 0) return false;
  const set = new Set(a.map(normalizeName));
  return b.some((item) => set.has(normalizeName(item)));
};

const hasDnsErrorStatus = (rawStatus: string): boolean => {
  const normalized = normalizeName(rawStatus).replace(/_/g, '');
  return normalized.includes('error') || normalized === 'dnserror' || normalized === 'invalid';
};

const isPendingStatus = (value: unknown): boolean => {
  const normalized = normalizeName(value).replace(/\s+/g, '');
  return normalized === 'pending' || normalized.startsWith('pending');
};

const buildResult = (
  status: ZoneAuthorityStatus,
  reason: string,
  publicNameServers: string[] | null,
  expectedNameServers: string[]
): Pick<Zone, 'authorityStatus' | 'authorityReason' | 'authorityMeta'> => ({
  authorityStatus: status,
  authorityReason: reason,
  authorityMeta: {
    publicNameServers: Array.isArray(publicNameServers) && publicNameServers.length > 0 ? publicNameServers : undefined,
    expectedNameServers: expectedNameServers.length > 0 ? expectedNameServers : undefined,
  },
});

export async function attachZoneAuthority(provider: ProviderType, zone: Zone): Promise<Zone> {
  const cacheKey = [
    'zone-authority',
    provider,
    normalizeName(zone.name),
    normalizeName(zone.status),
    normalizeName(zone.updatedAt),
  ].join(':');

  const cached = cache.get<Pick<Zone, 'authorityStatus' | 'authorityReason' | 'authorityMeta'>>(cacheKey);
  if (cached) {
    return { ...zone, ...cached };
  }

  const expectedNameServers = extractNameServers(zone);
  const publicNameServers = await resolvePublicNameServers(zone.name);
  const hasResolvedPublicNameServers = Array.isArray(publicNameServers) && publicNameServers.length > 0;
  const raw = ((zone.meta || {}) as Record<string, any>).raw || {};
  const rawStatus = String(raw?.DNSStatus || raw?.DnsStatus || zone.status || '');
  const cfType = normalizeName(raw?.type);
  const cfStatus = normalizeName(raw?.status || zone.status);
  const huaweiStatus = normalizeName(raw?.status || zone.status);
  const jdcloudStatus = normalizeName(raw?.resolvingStatus || raw?.ResolvingStatus || raw?.status || zone.status);
  const huoshanNsCorrect =
    typeof raw?.IsNSCorrect === 'boolean'
      ? raw.IsNSCorrect
      : typeof raw?.isNSCorrect === 'boolean'
        ? raw.isNSCorrect
        : typeof (zone.meta as Record<string, any> | undefined)?.isNSCorrect === 'boolean'
          ? (zone.meta as Record<string, any>).isNSCorrect
          : undefined;
  const spaceshipNsProvider = normalizeName(raw?.nameservers?.provider || (zone.meta as Record<string, any> | undefined)?.nameServerProvider);
  const spaceshipStatus = normalizeName(raw?.lifecycleStatus || raw?.status || zone.status);
  const namesiloStatus = normalizeName(raw?.status || zone.status);

  let result: Pick<Zone, 'authorityStatus' | 'authorityReason' | 'authorityMeta'>;

  if (provider === ProviderType.CLOUDFLARE) {
    if (cfType === 'partial') {
      result = buildResult('non_authoritative', 'Cloudflare CNAME 接入不是权威 DNS', publicNameServers, expectedNameServers);
    } else if (cfStatus === 'pending' || cfStatus === 'initializing') {
      result = buildResult('pending', 'Cloudflare Zone 尚未完成激活', publicNameServers, expectedNameServers);
    } else if (cfStatus === 'moved' || cfStatus === 'deleted' || cfStatus === 'purged') {
      result = buildResult('non_authoritative', 'Cloudflare Zone 当前不处于可用权威状态', publicNameServers, expectedNameServers);
    } else if (hasResolvedPublicNameServers && expectedNameServers.length > 0) {
      result = intersects(publicNameServers, expectedNameServers)
        ? buildResult('authoritative', '公网 NS 指向当前 Cloudflare Zone', publicNameServers, expectedNameServers)
        : buildResult('non_authoritative', '公网 NS 未指向当前 Cloudflare Zone', publicNameServers, expectedNameServers);
    } else if (cfStatus === 'active' && cfType === 'full') {
      result = buildResult('unknown', 'Cloudflare Zone 已激活，但当前无法确认公网 NS', publicNameServers, expectedNameServers);
    } else {
      result = buildResult('unknown', '暂时无法识别 Cloudflare Zone 权威状态', publicNameServers, expectedNameServers);
    }
  } else if (provider === ProviderType.DNSPOD) {
    if (hasResolvedPublicNameServers && expectedNameServers.length > 0) {
      result = intersects(publicNameServers, expectedNameServers)
        ? buildResult('authoritative', '公网 NS 指向当前 DNSPod 域名', publicNameServers, expectedNameServers)
        : buildResult('non_authoritative', '公网 NS 未指向当前 DNSPod 域名', publicNameServers, expectedNameServers);
    } else if (hasDnsErrorStatus(rawStatus)) {
      result = buildResult('non_authoritative', 'DNSPod 返回 DNS 异常状态', publicNameServers, expectedNameServers);
    } else {
      result = buildResult('unknown', '暂时无法识别 DNSPod 域名权威状态', publicNameServers, expectedNameServers);
    }
  } else if (provider === ProviderType.DNSPOD_TOKEN) {
    if (hasResolvedPublicNameServers && expectedNameServers.length > 0) {
      result = intersects(publicNameServers, expectedNameServers)
        ? buildResult('authoritative', '公网 NS 指向当前 DNSPod 域名', publicNameServers, expectedNameServers)
        : buildResult('non_authoritative', '公网 NS 未指向当前 DNSPod 域名', publicNameServers, expectedNameServers);
    } else {
      result = buildResult('unknown', '暂时无法识别 DNSPod 域名权威状态', publicNameServers, expectedNameServers);
    }
  } else if (provider === ProviderType.HUAWEI) {
    if (isPendingStatus(huaweiStatus)) {
      result = buildResult('pending', '华为云 Zone 仍处于处理中', publicNameServers, expectedNameServers);
    } else if (hasResolvedPublicNameServers && expectedNameServers.length > 0) {
      result = intersects(publicNameServers, expectedNameServers)
        ? buildResult('authoritative', '公网 NS 指向当前华为云 Zone', publicNameServers, expectedNameServers)
        : buildResult('non_authoritative', '公网 NS 未指向当前华为云 Zone', publicNameServers, expectedNameServers);
    } else {
      result = buildResult('unknown', '暂时无法识别华为云 Zone 权威状态', publicNameServers, expectedNameServers);
    }
  } else if (provider === ProviderType.HUOSHAN) {
    if (huoshanNsCorrect === false) {
      result = buildResult('non_authoritative', '火山引擎返回 NS 未正确接入', publicNameServers, expectedNameServers);
    } else if (hasResolvedPublicNameServers && expectedNameServers.length > 0) {
      result = intersects(publicNameServers, expectedNameServers)
        ? buildResult('authoritative', '公网 NS 指向当前火山引擎 Zone', publicNameServers, expectedNameServers)
        : buildResult('non_authoritative', '公网 NS 未指向当前火山引擎 Zone', publicNameServers, expectedNameServers);
    } else if (huoshanNsCorrect === true) {
      result = buildResult('unknown', '火山引擎已检测到 NS 正确，但当前无法确认公网 NS', publicNameServers, expectedNameServers);
    } else {
      result = buildResult('unknown', '暂时无法识别火山引擎 Zone 权威状态', publicNameServers, expectedNameServers);
    }
  } else if (provider === ProviderType.JDCLOUD) {
    if (jdcloudStatus === '5') {
      result = buildResult('pending', '京东云返回 NS 未修改，域名仍处于待接入状态', publicNameServers, expectedNameServers);
    } else if (jdcloudStatus === '3') {
      result = buildResult('non_authoritative', '京东云返回部分解析状态', publicNameServers, expectedNameServers);
    } else if (jdcloudStatus === '4') {
      result = buildResult('non_authoritative', '京东云域名解析已暂停', publicNameServers, expectedNameServers);
    } else if (jdcloudStatus === '9') {
      result = buildResult('non_authoritative', '京东云返回注册局暂停解析状态', publicNameServers, expectedNameServers);
    } else if (jdcloudStatus === '7') {
      result = buildResult('unknown', '京东云域名探测异常，暂时无法确认权威状态', publicNameServers, expectedNameServers);
    } else if (jdcloudStatus === '8') {
      result = buildResult('unknown', '京东云返回域名未注册状态，暂时无法确认权威状态', publicNameServers, expectedNameServers);
    } else if (hasResolvedPublicNameServers && expectedNameServers.length > 0) {
      result = intersects(publicNameServers, expectedNameServers)
        ? buildResult('authoritative', '公网 NS 指向当前京东云域名', publicNameServers, expectedNameServers)
        : buildResult('non_authoritative', '公网 NS 未指向当前京东云域名', publicNameServers, expectedNameServers);
    } else {
      result = buildResult('unknown', '暂时无法识别京东云域名权威状态', publicNameServers, expectedNameServers);
    }
  } else if (provider === ProviderType.SPACESHIP) {
    if (spaceshipNsProvider && spaceshipNsProvider !== 'basic') {
      result = buildResult('non_authoritative', 'Spaceship 当前使用外部 DNS 托管', publicNameServers, expectedNameServers);
    } else if (isPendingStatus(spaceshipStatus)) {
      result = buildResult('pending', 'Spaceship 域名仍处于待接入状态', publicNameServers, expectedNameServers);
    } else if (hasResolvedPublicNameServers && expectedNameServers.length > 0) {
      result = intersects(publicNameServers, expectedNameServers)
        ? buildResult('authoritative', '公网 NS 指向当前 Spaceship DNS', publicNameServers, expectedNameServers)
        : buildResult('non_authoritative', '公网 NS 未指向当前 Spaceship DNS', publicNameServers, expectedNameServers);
    } else {
      result = buildResult('unknown', '暂时无法识别 Spaceship 域名权威状态', publicNameServers, expectedNameServers);
    }
  } else if (provider === ProviderType.NAMESILO) {
    if (namesiloStatus === 'externaldomain') {
      result = buildResult('non_authoritative', 'NameSilo 返回外部托管域名状态', publicNameServers, expectedNameServers);
    } else if (hasResolvedPublicNameServers && expectedNameServers.length > 0) {
      result = intersects(publicNameServers, expectedNameServers)
        ? buildResult('authoritative', '公网 NS 指向当前 NameSilo DNS', publicNameServers, expectedNameServers)
        : buildResult('non_authoritative', '公网 NS 未指向当前 NameSilo DNS', publicNameServers, expectedNameServers);
    } else {
      result = buildResult('unknown', '暂时无法识别 NameSilo 域名权威状态', publicNameServers, expectedNameServers);
    }
  } else if (hasResolvedPublicNameServers && expectedNameServers.length > 0) {
    result = intersects(publicNameServers, expectedNameServers)
      ? buildResult('authoritative', '公网 NS 指向当前 DNS 提供商', publicNameServers, expectedNameServers)
      : buildResult('non_authoritative', '公网 NS 未指向当前 DNS 提供商', publicNameServers, expectedNameServers);
  } else if (isPendingStatus(raw?.status || zone.status)) {
    result = buildResult('pending', '当前 Zone 仍处于待接入状态', publicNameServers, expectedNameServers);
  } else {
    result = buildResult('unknown', '暂时无法识别该域名的权威 DNS', publicNameServers, expectedNameServers);
  }

  cache.set(cacheKey, result);
  return {
    ...zone,
    ...result,
  };
}
