import { DnsLine } from '../base/types';
import { defaultLines as defaultGenericLines } from '../dnspod/lines';

const LINE_ID_TO_GENERIC: Record<string, string> = {
  '0': 'default',
  '10=0': 'telecom',
  '10=1': 'unicom',
  '10=3': 'mobile',
  '10=2': 'edu',
  '3=0': 'oversea',
  '10=22': 'btvn',
  '80=0': 'search',
  '7=0': 'internal',
};

const GENERIC_TO_LINE_ID: Record<string, string> = Object.fromEntries(
  Object.entries(LINE_ID_TO_GENERIC).map(([id, code]) => [code, id])
);

export function fromLineId(lineId?: string): string | undefined {
  const id = String(lineId || '').trim();
  if (!id) return undefined;
  return LINE_ID_TO_GENERIC[id] || id;
}

export function toLineId(codeOrId?: string): string | undefined {
  const input = String(codeOrId || '').trim();
  if (!input) return undefined;

  return GENERIC_TO_LINE_ID[input] || input;
}

export function defaultLines(): DnsLine[] {
  return defaultGenericLines();
}
