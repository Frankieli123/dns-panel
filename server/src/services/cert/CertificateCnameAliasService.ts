import { PrismaClient } from '@prisma/client';
import type { CertificateChallengeState } from './AcmeService';
import { PublicDnsProbeService } from '../dns/PublicDnsProbeService';

const prisma = new PrismaClient();

function normalizeDomain(value: any): string {
  return String(value || '').trim().toLowerCase().replace(/^\*\./, '').replace(/\.$/, '');
}

function normalizeZoneName(value: any): string {
  return String(value || '').trim().toLowerCase().replace(/^\./, '').replace(/\.$/, '');
}

function normalizeRr(value: any): string {
  return String(value || '').trim().toLowerCase().replace(/^\./, '').replace(/\.$/, '');
}

function buildTargetFqdn(rr: string, zoneName: string) {
  const normalizedRr = normalizeRr(rr);
  const normalizedZoneName = normalizeZoneName(zoneName);
  if (!normalizedZoneName) return '';
  if (!normalizedRr || normalizedRr === '@') return normalizedZoneName;
  return `${normalizedRr}.${normalizedZoneName}`;
}

function mapAlias(record: any) {
  return {
    id: record.id,
    domain: record.domain,
    dnsCredentialId: record.dnsCredentialId,
    zoneName: record.zoneName,
    rr: record.rr,
    targetFqdn: record.targetFqdn,
    status: record.status,
    lastCheckedAt: record.lastCheckedAt,
    lastError: record.lastError,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    dnsCredential: record.dnsCredential
      ? {
          id: record.dnsCredential.id,
          name: record.dnsCredential.name,
          provider: record.dnsCredential.provider,
          isDefault: !!record.dnsCredential.isDefault,
        }
      : undefined,
  };
}

async function getAliasRecord(userId: number, id: number) {
  const record = await prisma.certificateCnameAlias.findFirst({
    where: { id, userId },
    include: {
      dnsCredential: {
        select: {
          id: true,
          name: true,
          provider: true,
          isDefault: true,
        },
      },
    },
  });
  if (!record) throw new Error('CNAME Alias 不存在');
  return record;
}

export class CertificateCnameAliasService {
  static async listAliases(userId: number) {
    const rows = await prisma.certificateCnameAlias.findMany({
      where: { userId },
      include: {
        dnsCredential: {
          select: {
            id: true,
            name: true,
            provider: true,
            isDefault: true,
          },
        },
      },
      orderBy: [{ updatedAt: 'desc' }],
    });
    return rows.map(mapAlias);
  }

  static async createAlias(userId: number, input: { domain: string; dnsCredentialId: number; zoneName: string; rr: string }) {
    const domain = normalizeDomain(input.domain);
    const zoneName = normalizeZoneName(input.zoneName);
    const rrInput = input.rr;
    const rr = normalizeRr(rrInput);
    if (!domain) throw new Error('domain 不能为空');
    if (!zoneName) throw new Error('zoneName 不能为空');
    if (rrInput === undefined || rrInput === null) throw new Error('rr 不能为空');

    const dnsCredential = await prisma.dnsCredential.findFirst({
      where: { id: Number(input.dnsCredentialId), userId },
      select: { id: true },
    });
    if (!dnsCredential) throw new Error('DNS 凭证不存在');

    const created = await prisma.certificateCnameAlias.create({
      data: {
        userId,
        domain,
        dnsCredentialId: dnsCredential.id,
        zoneName,
        rr,
        targetFqdn: buildTargetFqdn(rr, zoneName),
        status: 'pending',
      },
      include: {
        dnsCredential: {
          select: { id: true, name: true, provider: true, isDefault: true },
        },
      },
    });

    return mapAlias(created);
  }

  static async updateAlias(userId: number, id: number, input: Partial<{ domain: string; dnsCredentialId: number; zoneName: string; rr: string }>) {
    const existing = await getAliasRecord(userId, id);
    const domain = input.domain !== undefined ? normalizeDomain(input.domain) : existing.domain;
    const zoneName = input.zoneName !== undefined ? normalizeZoneName(input.zoneName) : existing.zoneName;
    const rrInput = input.rr;
    const rr = rrInput !== undefined ? normalizeRr(rrInput) : existing.rr;
    if (!domain) throw new Error('domain 不能为空');
    if (!zoneName) throw new Error('zoneName 不能为空');
    if (rrInput === null) throw new Error('rr 不能为空');

    let dnsCredentialId = existing.dnsCredentialId;
    if (input.dnsCredentialId !== undefined) {
      const dnsCredential = await prisma.dnsCredential.findFirst({
        where: { id: Number(input.dnsCredentialId), userId },
        select: { id: true },
      });
      if (!dnsCredential) throw new Error('DNS 凭证不存在');
      dnsCredentialId = dnsCredential.id;
    }

    const updated = await prisma.certificateCnameAlias.update({
      where: { id: existing.id },
      data: {
        domain,
        dnsCredentialId,
        zoneName,
        rr,
        targetFqdn: buildTargetFqdn(rr, zoneName),
        status: 'pending',
        lastCheckedAt: null,
        lastError: null,
      },
      include: {
        dnsCredential: {
          select: { id: true, name: true, provider: true, isDefault: true },
        },
      },
    });

    return mapAlias(updated);
  }

  static async deleteAlias(userId: number, id: number) {
    await getAliasRecord(userId, id);
    await prisma.certificateCnameAlias.delete({ where: { id } });
  }

  static async checkAlias(userId: number, id: number) {
    const record = await getAliasRecord(userId, id);
    const sourceName = `_acme-challenge.${record.domain}`;
    const probe = await PublicDnsProbeService.checkCnameStatus({
      recordName: sourceName,
      expectedTarget: record.targetFqdn,
      mode: 'strict_cname',
    });

    let status = 'ready';
    let lastError: string | null = null;

    if (probe.status === 'unconfigured') {
      status = 'error';
      lastError = `CNAME 未指向 ${record.targetFqdn}`;
    } else if (probe.status === 'unknown') {
      status = record.status === 'ready' ? 'ready' : 'pending';
      const detail = probe.errors?.[0];
      lastError = detail
        ? `公网 DNS / DoH 暂时不可用，未能确认 CNAME 状态：${detail}`
        : '公网 DNS / DoH 暂时不可用，未能确认 CNAME 状态';
    }

    const updated = await prisma.certificateCnameAlias.update({
      where: { id: record.id },
      data: {
        status,
        lastCheckedAt: new Date(),
        lastError,
      },
      include: {
        dnsCredential: {
          select: { id: true, name: true, provider: true, isDefault: true },
        },
      },
    });

    return mapAlias(updated);
  }

  static async findAliasForDomain(userId: number, domain: string) {
    const normalized = normalizeDomain(domain);
    if (!normalized) return null;
    return await prisma.certificateCnameAlias.findFirst({
      where: { userId, domain: normalized },
      include: {
        dnsCredential: {
          select: { id: true, name: true, provider: true, isDefault: true },
        },
      },
    });
  }

  static async attachAliasGuidance(userId: number, challenges: CertificateChallengeState[]) {
    const next: CertificateChallengeState[] = [];
    for (const challenge of challenges) {
      const alias = await this.findAliasForDomain(userId, challenge.identifier);
      if (!alias) {
        next.push(challenge);
        continue;
      }
      next.push({
        ...challenge,
        mode: challenge.mode || 'manual',
        recordName: alias.targetFqdn,
        zoneName: alias.zoneName,
        ...(alias.status === 'ready'
          ? { zoneId: challenge.zoneId || null }
          : {}),
        aliasDomain: alias.domain,
        aliasStatus: alias.status,
        aliasTargetFqdn: alias.targetFqdn,
        aliasDnsCredentialId: alias.dnsCredentialId,
      } as CertificateChallengeState);
    }
    return next;
  }
}
