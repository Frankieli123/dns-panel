import { Domain } from '@/types';
import { DnsCredential } from '@/types/dns';
import { getDomainById, getDomains } from '@/services/domains';

export const normalizeHostname = (input: unknown): string =>
  String(input ?? '').trim().replace(/\.+$/, '').toLowerCase();

export const stripWildcardPrefix = (hostname: string): string =>
  normalizeHostname(hostname).replace(/^\*\./, '');

export const findBestZone = (hostname: string, domains: Domain[]): Domain | undefined => {
  const host = stripWildcardPrefix(hostname);
  let best: Domain | undefined;

  for (const domain of domains) {
    const zone = normalizeHostname(domain?.name);
    if (!zone) continue;
    if (host === zone || host.endsWith(`.${zone}`)) {
      if (!best || zone.length > normalizeHostname(best.name).length) best = domain;
    }
  }

  return best;
};

export const listMatchingZones = (hostname: string, domains: Domain[]): Domain[] => {
  const host = stripWildcardPrefix(hostname);

  return domains
    .filter((domain) => {
      const zone = normalizeHostname(domain?.name);
      return !!zone && (host === zone || host.endsWith(`.${zone}`));
    })
    .sort((a, b) => normalizeHostname(b.name).length - normalizeHostname(a.name).length);
};

export const toRelativeRecordName = (fqdn: string, zoneName: string): string => {
  const host = String(fqdn || '').trim().replace(/\.+$/, '');
  const zone = String(zoneName || '').trim().replace(/\.+$/, '');

  if (!host || !zone) return host;
  if (normalizeHostname(host) === normalizeHostname(zone)) return '@';

  const hostParts = host.split('.');
  const zoneParts = zone.split('.');
  if (hostParts.length <= zoneParts.length) return host;

  return hostParts.slice(0, hostParts.length - zoneParts.length).join('.') || '@';
};

export const isAuthoritativeZone = (domain: Domain | null | undefined): boolean =>
  domain?.authorityStatus === 'authoritative';

const shouldRetryWithDetail = (domain: Domain): boolean =>
  (!domain.authorityStatus || domain.authorityStatus === 'unknown') && typeof domain.credentialId === 'number';

const refreshZoneAuthority = async (domain: Domain): Promise<Domain> => {
  if (typeof domain.credentialId !== 'number') return domain;

  try {
    const resp = await getDomainById(domain.id, domain.credentialId);
    const detail = resp.data?.domain;
    if (!detail) return domain;

    return {
      ...domain,
      authorityStatus: detail.authorityStatus,
      authorityReason: detail.authorityReason,
      authorityMeta: detail.authorityMeta,
    };
  } catch {
    return domain;
  }
};

export async function loadCandidateZones(credentials: DnsCredential[]): Promise<Domain[]> {
  if (!Array.isArray(credentials) || credentials.length === 0) return [];

  const settled = await Promise.allSettled(
    credentials.map(async (credential) => {
      const resp = await getDomains(credential.id);
      const domains = resp.data?.domains || [];
      return domains.map((domain) => ({
        ...domain,
        credentialId: credential.id,
        credentialName: credential.name,
        provider: credential.provider,
      }));
    })
  );

  return settled.flatMap((item) => (item.status === 'fulfilled' ? item.value : []));
}

export async function findMatchingCandidateZones(
  credentials: DnsCredential[],
  hostname: string
): Promise<Domain[]> {
  const domains = await loadCandidateZones(credentials);
  const matches = listMatchingZones(hostname, domains);
  const authoritative = matches.filter(isAuthoritativeZone);
  if (authoritative.length > 0) return authoritative;

  const uncertain = matches.filter(shouldRetryWithDetail);
  if (uncertain.length === 0) return [];

  const settled = await Promise.allSettled(uncertain.map((domain) => refreshZoneAuthority(domain)));
  const refreshed = settled
    .map((item) => (item.status === 'fulfilled' ? item.value : null))
    .filter((item): item is Domain => !!item);

  return refreshed.filter(isAuthoritativeZone);
}
