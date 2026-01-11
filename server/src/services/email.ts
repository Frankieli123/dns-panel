import crypto from 'crypto';
import nodemailer from 'nodemailer';
import { config as envConfig } from '../config';

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user?: string;
  pass?: string;
  from: string;
}

const transporterCache = new Map<string, nodemailer.Transporter>();

function normalizeSmtpConfig(input?: Partial<SmtpConfig> | null): SmtpConfig {
  const host = String(input?.host ?? envConfig.smtp.host ?? '').trim();
  const port = Number(input?.port ?? envConfig.smtp.port);
  const from = String(input?.from ?? envConfig.smtp.from ?? '').trim();

  if (!host) {
    throw new Error('SMTP 未配置: SMTP_HOST');
  }
  if (!Number.isFinite(port) || port <= 0) {
    throw new Error('SMTP 未配置: SMTP_PORT');
  }
  if (!from) {
    throw new Error('SMTP 未配置: SMTP_FROM');
  }

  const user = String(input?.user ?? envConfig.smtp.user ?? '').trim();
  const pass = String(input?.pass ?? envConfig.smtp.pass ?? '').trim();

  if ((user && !pass) || (!user && pass)) {
    throw new Error('SMTP 认证信息不完整');
  }

  return {
    host,
    port,
    secure: !!(input?.secure ?? envConfig.smtp.secure),
    ...(user && pass ? { user, pass } : {}),
    from,
  };
}

function smtpKey(smtp: SmtpConfig): string {
  const passHash = smtp.pass ? crypto.createHash('sha256').update(smtp.pass).digest('hex') : '';
  return JSON.stringify({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure ? 1 : 0,
    user: smtp.user || '',
    passHash,
  });
}

function getTransporter(smtp: SmtpConfig): nodemailer.Transporter {
  const key = smtpKey(smtp);
  const cached = transporterCache.get(key);
  if (cached) return cached;

  const transporter = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    ...(smtp.user && smtp.pass ? { auth: { user: smtp.user, pass: smtp.pass } } : {}),
  });

  transporterCache.set(key, transporter);
  return transporter;
}

function isLikelyEmail(addr: string): boolean {
  const s = String(addr || '').trim();
  if (!s || s.length > 320) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

function escapeHtml(str: string): string {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export async function sendDomainExpiryEmail(params: {
  to: string;
  payload: any;
  smtp?: Partial<SmtpConfig> | null;
}): Promise<void> {
  const to = String(params?.to || '').trim();
  if (!isLikelyEmail(to)) {
    throw new Error('收件邮箱无效');
  }

  const payload = params?.payload || {};
  const domain = String(payload?.domain || '').trim();
  const expiresAt = String(payload?.expiresAt || '').trim();
  const daysLeft = Number(payload?.daysLeft);
  const thresholdDays = Number(payload?.thresholdDays);
  const checkedAt = String(payload?.checkedAt || '').trim();

  const accounts = Array.isArray(payload?.accounts) ? payload.accounts : [];
  const accountsText = accounts
    .map((a: any) => {
      const provider = a?.provider ? String(a.provider) : '';
      const name = a?.credentialName ? String(a.credentialName) : '';
      const id = a?.credentialId !== undefined ? String(a.credentialId) : '';
      const parts = [name || id].filter(Boolean).join('');
      return `- ${parts || '-'}${provider ? ` (${provider})` : ''}`;
    })
    .join('\n');

  const subjectDaysLeft = Number.isFinite(daysLeft) ? `（剩余 ${daysLeft} 天）` : '';
  const subject = `[DNS Panel] 域名到期提醒：${domain || '-'}${subjectDaysLeft}`;

  const text =
    `域名到期提醒\n\n` +
    `域名: ${domain || '-'}\n` +
    `到期日期(UTC): ${expiresAt || '-'}\n` +
    `剩余天数: ${Number.isFinite(daysLeft) ? daysLeft : '-'}\n` +
    `阈值(天): ${Number.isFinite(thresholdDays) ? thresholdDays : '-'}\n` +
    (accountsText ? `\n关联账户:\n${accountsText}\n` : '') +
    (checkedAt ? `\n检查时间: ${checkedAt}\n` : '');

  const htmlAccounts = accounts
    .map((a: any) => {
      const provider = a?.provider ? String(a.provider) : '';
      const name = a?.credentialName ? String(a.credentialName) : '';
      const id = a?.credentialId !== undefined ? String(a.credentialId) : '';
      const label = escapeHtml(name || id || '-');
      const p = escapeHtml(provider || '');
      return `<li>${label}${p ? ` <span style="color:#6b7280;">(${p})</span>` : ''}</li>`;
    })
    .join('');

  const html =
    `<div style="font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial; line-height:1.6;">` +
    `<h2 style="margin:0 0 12px;">域名到期提醒</h2>` +
    `<table style="border-collapse:collapse;">` +
    `<tr><td style="padding:4px 12px 4px 0;color:#6b7280;">域名</td><td style="padding:4px 0;">${escapeHtml(domain || '-')}</td></tr>` +
    `<tr><td style="padding:4px 12px 4px 0;color:#6b7280;">到期日期(UTC)</td><td style="padding:4px 0;">${escapeHtml(expiresAt || '-')}</td></tr>` +
    `<tr><td style="padding:4px 12px 4px 0;color:#6b7280;">剩余天数</td><td style="padding:4px 0;">${Number.isFinite(daysLeft) ? daysLeft : '-'}</td></tr>` +
    `<tr><td style="padding:4px 12px 4px 0;color:#6b7280;">阈值(天)</td><td style="padding:4px 0;">${Number.isFinite(thresholdDays) ? thresholdDays : '-'}</td></tr>` +
    (checkedAt
      ? `<tr><td style="padding:4px 12px 4px 0;color:#6b7280;">检查时间</td><td style="padding:4px 0;">${escapeHtml(checkedAt)}</td></tr>`
      : '') +
    `</table>` +
    (htmlAccounts ? `<h3 style="margin:16px 0 8px;font-size:14px;color:#111827;">关联账户</h3><ul style="margin:0;padding-left:18px;">${htmlAccounts}</ul>` : '') +
    `</div>`;

  const smtp = normalizeSmtpConfig(params?.smtp);
  const transporter = getTransporter(smtp);
  await transporter.sendMail({
    from: smtp.from,
    to,
    subject,
    text,
    html,
  });
}
