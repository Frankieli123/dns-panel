/**
 * DNSPod 解析线路映射
 */

import { DnsLine } from '../base/types';

// 通用线路代码 → DNSPod 线路名称
const GENERIC_TO_DNSPOD: Record<string, string> = {
  default: '默认',
  telecom: '电信',
  unicom: '联通',
  mobile: '移动',
  oversea: '境外',
  edu: '教育网',
  drpeng: '长城宽带',
  cernet: 'CERNET',
};

// DNSPod 线路名称 → 通用线路代码
const DNSPOD_TO_GENERIC: Record<string, string> = Object.fromEntries(
  Object.entries(GENERIC_TO_DNSPOD).map(([g, d]) => [d, g])
);

// 线路显示名称
const GENERIC_DISPLAY: Record<string, string> = {
  default: '默认',
  telecom: '电信',
  unicom: '联通',
  mobile: '移动',
  oversea: '境外',
  edu: '教育网',
  drpeng: '长城宽带',
  cernet: 'CERNET',
};

/**
 * 转换为 DNSPod 线路名称
 */
export function toDnspodLine(genericCode?: string): string | undefined {
  if (!genericCode) return undefined;
  return GENERIC_TO_DNSPOD[genericCode] || genericCode;
}

/**
 * 从 DNSPod 线路名称转换为通用代码
 */
export function fromDnspodLine(dnspodLine?: string): string | undefined {
  if (!dnspodLine) return undefined;
  return DNSPOD_TO_GENERIC[dnspodLine] || dnspodLine;
}

/**
 * 获取默认线路列表
 */
export function defaultLines(): DnsLine[] {
  return Object.keys(GENERIC_TO_DNSPOD).map(code => ({
    code,
    name: GENERIC_DISPLAY[code] || code,
  }));
}
