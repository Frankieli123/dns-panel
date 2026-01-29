/**
 * 阿里云 DNS 解析线路映射
 */

import { DnsLine } from '../base/types';

// 通用线路代码 → 阿里云线路代码
const GENERIC_TO_ALIYUN: Record<string, string> = {
  default: 'default',
  telecom: 'telecom',
  unicom: 'unicom',
  mobile: 'mobile',
  oversea: 'oversea',
  edu: 'edu',
  drpeng: 'drpeng',
  cernet: 'cernet',
};

// 阿里云线路代码 → 通用线路代码
const ALIYUN_TO_GENERIC: Record<string, string> = Object.fromEntries(
  Object.entries(GENERIC_TO_ALIYUN).map(([g, a]) => [a, g])
);

// 线路显示名称
const GENERIC_DISPLAY: Record<string, string> = {
  default: '默认',
  telecom: '电信',
  unicom: '联通',
  mobile: '移动',
  oversea: '海外',
  edu: '教育网',
  drpeng: '长城宽带',
  cernet: 'CERNET',
};

/**
 * 转换为阿里云线路代码
 */
export function toAliyunLine(genericCode?: string): string | undefined {
  if (!genericCode) return undefined;
  return GENERIC_TO_ALIYUN[genericCode] || genericCode;
}

/**
 * 从阿里云线路代码转换为通用代码
 */
export function fromAliyunLine(aliyunCode?: string): string | undefined {
  if (!aliyunCode) return undefined;
  return ALIYUN_TO_GENERIC[aliyunCode] || aliyunCode;
}

/**
 * 获取默认线路列表
 */
export function getDefaultLines(): DnsLine[] {
  return Object.keys(GENERIC_TO_ALIYUN).map(code => ({
    code,
    name: GENERIC_DISPLAY[code] || code,
  }));
}
