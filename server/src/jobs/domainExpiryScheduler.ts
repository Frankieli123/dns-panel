import http from 'http';
import https from 'https';
import { PrismaClient } from '@prisma/client';
import { decrypt } from '../utils/encryption';
import { ProviderRegistry } from '../providers/ProviderRegistry';
import { dnsService, DnsServiceContext } from '../services/dns/DnsService';
import { ProviderType, Zone } from '../providers/base/types';
import { DomainExpiryService } from '../services/domainExpiry';
import { sendDomainExpiryEmail } from '../services/email';

const prisma = new PrismaClient();

const DAY_MS = 24 * 60 * 60 * 1000;

function daysLeft(expiresAtIso: string): number {
  const expiresAt = new Date(expiresAtIso);
  if (Number.isNaN(expiresAt.getTime())) return Number.NaN;
  const ms = expiresAt.getTime() - Date.now();
  return Math.floor(ms / 86_400_000);
}

function getLastNotifiedAt(existing: any): Date | undefined {
  const ln = existing?.lastNotifiedAt;
  if (ln instanceof Date && !Number.isNaN(ln.getTime())) return ln;
  const ca = existing?.createdAt;
  if (ca instanceof Date && !Number.isNaN(ca.getTime())) return ca;
  return undefined;
}

async function listAllZones(ctx: DnsServiceContext): Promise<Zone[]> {
  const zones: Zone[] = [];
  const pageSize = 100;
  for (let page = 1; page <= 500; page++) {
    const result = await dnsService.getZones(ctx, page, pageSize);
    zones.push(...(result.zones || []));
    const total = typeof result.total === 'number' ? result.total : 0;
    if (total > 0 && zones.length >= total) break;
    if (!result.zones || result.zones.length === 0) break;
  }
  return zones;
}

async function postJson(urlStr: string, payload: any, timeoutMs = 8000): Promise<{ status: number; body: string }> {
  const url = new URL(urlStr);
  const proto = url.protocol.toLowerCase();
  if (proto !== 'http:' && proto !== 'https:') {
    throw new Error('Webhook 仅支持 http/https');
  }

  const body = JSON.stringify(payload);
  const mod = proto === 'https:' ? https : http;

  return await new Promise((resolve, reject) => {
    const req = mod.request(
      {
        method: 'POST',
        hostname: url.hostname,
        port: url.port ? parseInt(url.port, 10) : undefined,
        path: `${url.pathname}${url.search}`,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': String(Buffer.byteLength(body)),
          'User-Agent': 'dns-panel/1.0 (domain-expiry-webhook)',
        },
      },
      res => {
        const chunks: Buffer[] = [];
        res.on('data', d => chunks.push(Buffer.isBuffer(d) ? d : Buffer.from(d)));
        res.on('end', () => {
          resolve({
            status: res.statusCode || 0,
            body: Buffer.concat(chunks).toString('utf8'),
          });
        });
      }
    );

    req.on('error', reject);
    req.setTimeout(timeoutMs, () => req.destroy(new Error('Webhook timeout')));
    req.write(body);
    req.end();
  });
}

let isRunning = false;

async function runOnce(): Promise<void> {
  if (isRunning) return;
  isRunning = true;
  const startedAt = Date.now();

  try {
    const users = await prisma.user.findMany({
      select: {
        id: true,
        username: true,
        email: true,
        domainExpiryThresholdDays: true,
        domainExpiryNotifyEnabled: true,
        domainExpiryNotifyWebhookUrl: true,
        domainExpiryNotifyEmailEnabled: true,
        domainExpiryNotifyEmailTo: true,
        smtpHost: true,
        smtpPort: true,
        smtpSecure: true,
        smtpUser: true,
        smtpPass: true,
        smtpFrom: true,
      },
    });

    for (const user of users) {
      const thresholdDays = Number.isFinite(user.domainExpiryThresholdDays)
        ? Math.max(1, Math.min(365, user.domainExpiryThresholdDays))
        : 7;

      const webhookUrl = typeof user.domainExpiryNotifyWebhookUrl === 'string' ? user.domainExpiryNotifyWebhookUrl.trim() : '';
      const webhookEnabled = !!user.domainExpiryNotifyEnabled && !!webhookUrl;

      const emailEnabled = !!(user as any).domainExpiryNotifyEmailEnabled;
      const emailToCandidate = (user as any).domainExpiryNotifyEmailTo ?? user.email ?? '';
      const emailTo = typeof emailToCandidate === 'string' ? String(emailToCandidate).trim() : '';
      const emailChannelEnabled = emailEnabled && !!emailTo;

      const smtpHost = typeof (user as any).smtpHost === 'string' ? String((user as any).smtpHost).trim() : '';
      const smtpPortCandidate = (user as any).smtpPort;
      const smtpPort = Number.isFinite(Number(smtpPortCandidate)) ? Number(smtpPortCandidate) : undefined;
      const smtpSecureCandidate = (user as any).smtpSecure;
      const smtpSecure = typeof smtpSecureCandidate === 'boolean' ? smtpSecureCandidate : undefined;
      const smtpUser = typeof (user as any).smtpUser === 'string' ? String((user as any).smtpUser).trim() : '';
      const smtpFrom = typeof (user as any).smtpFrom === 'string' ? String((user as any).smtpFrom).trim() : '';
      const smtpPassEncrypted = typeof (user as any).smtpPass === 'string' ? String((user as any).smtpPass) : '';
      let smtpPass = '';
      if (smtpHost && smtpPassEncrypted) {
        try {
          smtpPass = decrypt(smtpPassEncrypted);
        } catch {
          smtpPass = '';
        }
      }

      const smtpOverride = smtpHost
        ? {
            host: smtpHost,
            port: smtpPort ?? 587,
            secure: smtpSecure ?? false,
            user: smtpUser,
            pass: smtpPass,
            from: smtpFrom,
          }
        : null;

      const creds = await prisma.dnsCredential.findMany({
        where: { userId: user.id },
        select: { id: true, name: true, provider: true, secrets: true, accountId: true },
      });

      const domainAccounts = new Map<string, Array<{ credentialId: number; credentialName: string; provider: string }>>();

      for (const cred of creds) {
        const provider = cred.provider as ProviderType;
        if (!ProviderRegistry.isSupported(provider)) continue;

        let secrets: any;
        try {
          secrets = JSON.parse(decrypt(cred.secrets));
        } catch {
          continue;
        }

        const ctx: DnsServiceContext = {
          provider,
          secrets,
          accountId: cred.accountId || undefined,
          credentialKey: `cred-${cred.id}`,
          encrypted: false,
        };

        let zones: Zone[] = [];
        try {
          zones = await listAllZones(ctx);
        } catch {
          continue;
        }

        for (const z of zones) {
          const name = String(z?.name || '').trim().toLowerCase();
          if (!name) continue;
          const list = domainAccounts.get(name) || [];
          list.push({ credentialId: cred.id, credentialName: cred.name, provider: cred.provider });
          domainAccounts.set(name, list);
        }
      }

      const domains = Array.from(domainAccounts.keys());
      if (domains.length === 0) continue;

      const expiryResults = await DomainExpiryService.lookupDomains(domains, { concurrency: 3 });

      if (!webhookEnabled && !emailChannelEnabled) continue;

      const domainsInThreshold = expiryResults
        .filter(r => typeof r?.expiresAt === 'string')
        .filter(r => {
          const dLeft = daysLeft(r.expiresAt as string);
          return Number.isFinite(dLeft) && dLeft >= 0 && dLeft <= thresholdDays;
        })
        .map(r => r.domain);

      let notifyResults = expiryResults;
      if (domainsInThreshold.length > 0) {
        const refreshed = await DomainExpiryService.lookupDomains(domainsInThreshold, { concurrency: 3, forceRefresh: true });
        const refreshedByDomain = new Map<string, (typeof refreshed)[number]>();
        refreshed.forEach(r => refreshedByDomain.set(String(r.domain || '').toLowerCase(), r));
        notifyResults = expiryResults.map(r => {
          const fresh = refreshedByDomain.get(String(r.domain || '').toLowerCase());
          if (!fresh) return r;
          if (!fresh.expiresAt && r.expiresAt) return r;
          return fresh;
        });
      }

      {
        const now = new Date();
        const prefix = `domainExpiryFailureLog:${user.id}:`;
        const existing = await prisma.cache.findMany({
          where: {
            key: { startsWith: prefix },
            expiresAt: { gt: now },
          },
          select: { key: true },
        });
        const loggedDomains = new Set(existing.map(r => r.key.slice(prefix.length)));

        const ttlMs = 7 * DAY_MS;
        for (const info of notifyResults) {
          if (info.expiresAt) continue;
          const domain = typeof info.domain === 'string' ? info.domain : '';
          if (!domain) continue;
          if (loggedDomains.has(domain)) continue;

          const err = typeof info.error === 'string' ? info.error.trim() : '';
          if (!err) continue;

          loggedDomains.add(domain);
          const cacheKey = `${prefix}${domain}`;
          const cacheExpiresAt = new Date(Date.now() + ttlMs);

          const value = JSON.stringify({ domain, error: err, checkedAt: info.checkedAt });
          await prisma.cache.upsert({
            where: { key: cacheKey },
            create: {
              key: cacheKey,
              value,
              expiresAt: cacheExpiresAt,
            },
            update: {
              value,
              expiresAt: cacheExpiresAt,
            },
          });

          const logValue = JSON.stringify({ action: 'domain_expiry_lookup_failed', domain, error: err, checkedAt: info.checkedAt });
          await prisma.log.create({
            data: {
              userId: user.id,
              action: 'UPDATE',
              resourceType: 'DOMAIN_EXPIRY',
              domain,
              recordName: domain,
              status: 'FAILED',
              errorMessage: err,
              newValue: logValue,
            },
          });
        }
      }

      for (const info of notifyResults) {
        if (!info.expiresAt) continue;
        const dLeft = daysLeft(info.expiresAt);
        if (!Number.isFinite(dLeft)) continue;
        if (dLeft < 0 || dLeft > thresholdDays) continue;

        const expiresAtDate = new Date(info.expiresAt);
        if (Number.isNaN(expiresAtDate.getTime())) continue;

        const accounts = domainAccounts.get(info.domain) || [];
        const payload = {
          type: 'domain_expiry',
          user: { id: user.id, username: user.username },
          domain: info.domain,
          expiresAt: info.expiresAt,
          daysLeft: dLeft,
          thresholdDays,
          accounts,
          checkedAt: info.checkedAt,
        };

        if (webhookEnabled) {
          const channel = 'webhook';
          const where = {
            userId_domain_expiresAt_thresholdDays_channel: {
              userId: user.id,
              domain: info.domain,
              expiresAt: expiresAtDate,
              thresholdDays,
              channel,
            },
          } as const;

          const existing = await prisma.domainExpiryNotification.findUnique({
            where: where.userId_domain_expiresAt_thresholdDays_channel as any,
            select: { status: true, createdAt: true, lastNotifiedAt: true },
          } as any);

          const ls = getLastNotifiedAt(existing);
          if (ls && Date.now() - ls.getTime() < DAY_MS) {
            // already notified within 24h for this channel
          } else {
            try {
              const resp = await postJson(webhookUrl, payload);
              if (resp.status < 200 || resp.status >= 300) {
                throw new Error(`Webhook HTTP ${resp.status}`);
              }

              await prisma.domainExpiryNotification.upsert({
                where: where.userId_domain_expiresAt_thresholdDays_channel as any,
                create: {
                  userId: user.id,
                  domain: info.domain,
                  expiresAt: expiresAtDate,
                  thresholdDays,
                  channel,
                  status: 'SENT',
                  payload: JSON.stringify(payload),
                  lastNotifiedAt: new Date(),
                },
                update: {
                  status: 'SENT',
                  payload: JSON.stringify(payload),
                  errorMessage: null,
                  lastNotifiedAt: new Date(),
                },
              } as any);
            } catch (err: any) {
              await prisma.domainExpiryNotification.upsert({
                where: where.userId_domain_expiresAt_thresholdDays_channel as any,
                create: {
                  userId: user.id,
                  domain: info.domain,
                  expiresAt: expiresAtDate,
                  thresholdDays,
                  channel,
                  status: 'FAILED',
                  payload: JSON.stringify(payload),
                  errorMessage: err?.message ? String(err.message) : String(err),
                  lastNotifiedAt: new Date(),
                },
                update: {
                  status: 'FAILED',
                  payload: JSON.stringify(payload),
                  errorMessage: err?.message ? String(err.message) : String(err),
                  lastNotifiedAt: new Date(),
                },
              } as any);
            }
          }
        }

        if (emailChannelEnabled) {
          const channel = 'email';
          const where = {
            userId_domain_expiresAt_thresholdDays_channel: {
              userId: user.id,
              domain: info.domain,
              expiresAt: expiresAtDate,
              thresholdDays,
              channel,
            },
          } as const;

          const existing = await prisma.domainExpiryNotification.findUnique({
            where: where.userId_domain_expiresAt_thresholdDays_channel as any,
            select: { status: true, createdAt: true, lastNotifiedAt: true },
          } as any);

          const ls = getLastNotifiedAt(existing);
          if (ls && Date.now() - ls.getTime() < DAY_MS) {
            // already notified within 24h for this channel
          } else {
            try {
              await sendDomainExpiryEmail({
                to: emailTo,
                payload,
                smtp: smtpOverride,
              });

              await prisma.domainExpiryNotification.upsert({
                where: where.userId_domain_expiresAt_thresholdDays_channel as any,
                create: {
                  userId: user.id,
                  domain: info.domain,
                  expiresAt: expiresAtDate,
                  thresholdDays,
                  channel,
                  status: 'SENT',
                  payload: JSON.stringify(payload),
                  lastNotifiedAt: new Date(),
                },
                update: {
                  status: 'SENT',
                  payload: JSON.stringify(payload),
                  errorMessage: null,
                  lastNotifiedAt: new Date(),
                },
              } as any);
            } catch (err: any) {
              await prisma.domainExpiryNotification.upsert({
                where: where.userId_domain_expiresAt_thresholdDays_channel as any,
                create: {
                  userId: user.id,
                  domain: info.domain,
                  expiresAt: expiresAtDate,
                  thresholdDays,
                  channel,
                  status: 'FAILED',
                  payload: JSON.stringify(payload),
                  errorMessage: err?.message ? String(err.message) : String(err),
                  lastNotifiedAt: new Date(),
                },
                update: {
                  status: 'FAILED',
                  payload: JSON.stringify(payload),
                  errorMessage: err?.message ? String(err.message) : String(err),
                  lastNotifiedAt: new Date(),
                },
              } as any);
            }
          }
        }
      }
    }
  } catch (err) {
    console.error('[domain-expiry] job failed:', err);
  } finally {
    isRunning = false;
    const ms = Date.now() - startedAt;
    console.log(`[domain-expiry] job finished in ${ms}ms`);
  }
}

function msUntilNext(hour: number, minute: number): number {
  const now = new Date();
  const next = new Date(now);
  next.setHours(hour, minute, 0, 0);
  if (next.getTime() <= now.getTime()) {
    next.setDate(next.getDate() + 1);
  }
  return next.getTime() - now.getTime();
}

export function startDomainExpiryScheduler() {
  const delay = msUntilNext(3, 0);
  console.log(`[domain-expiry] scheduler armed, next run in ${Math.round(delay / 1000)}s`);
  setTimeout(() => {
    runOnce();
    setInterval(runOnce, DAY_MS);
  }, delay);
}
