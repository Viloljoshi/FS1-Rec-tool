import type { NormalizedTrade } from './normalize';

export type BlockingField =
  | 'symbol'
  | 'isin'
  | 'cusip'
  | 'trade_date'
  | 'settlement_date'
  | 'direction'
  | 'currency'
  | 'account';

export const DEFAULT_BLOCKING_KEYS: BlockingField[] = ['symbol', 'trade_date', 'direction'];

function fieldValue(t: NormalizedTrade, f: BlockingField): string {
  switch (f) {
    case 'symbol': return t.symbol ?? '';
    case 'isin': return t.isin ?? '';
    case 'cusip': return t.cusip ?? '';
    case 'trade_date': return t.trade_date;
    case 'settlement_date': return t.settlement_date;
    case 'direction': return t.direction;
    case 'currency': return t.currency;
    case 'account': return t.account;
  }
}

export function blockingKey(t: NormalizedTrade, keys: BlockingField[] = DEFAULT_BLOCKING_KEYS): string {
  return keys.map((k) => fieldValue(t, k)).join('|');
}

export function blockBoth(
  a: NormalizedTrade[],
  b: NormalizedTrade[],
  keys: BlockingField[] = DEFAULT_BLOCKING_KEYS
): Map<string, { a: NormalizedTrade[]; b: NormalizedTrade[] }> {
  const blocks = new Map<string, { a: NormalizedTrade[]; b: NormalizedTrade[] }>();
  for (const t of a) {
    const k = blockingKey(t, keys);
    const entry = blocks.get(k) ?? { a: [], b: [] };
    entry.a.push(t);
    blocks.set(k, entry);
  }
  for (const t of b) {
    const k = blockingKey(t, keys);
    const entry = blocks.get(k) ?? { a: [], b: [] };
    entry.b.push(t);
    blocks.set(k, entry);
  }
  return blocks;
}

export function blockWithLooseDate(
  a: NormalizedTrade[],
  b: NormalizedTrade[],
  keys: BlockingField[] = DEFAULT_BLOCKING_KEYS
): Map<string, { a: NormalizedTrade[]; b: NormalizedTrade[] }> {
  const nonDateKeys = keys.filter((k) => k !== 'trade_date');
  const includesDate = keys.includes('trade_date');
  const blocks = new Map<string, { a: NormalizedTrade[]; b: NormalizedTrade[] }>();
  const addForAllDates = (t: NormalizedTrade, bucket: 'a' | 'b') => {
    const base = nonDateKeys.map((f) => fieldValue(t, f)).join('|');
    if (!includesDate) {
      const entry = blocks.get(base) ?? { a: [], b: [] };
      entry[bucket].push(t);
      blocks.set(base, entry);
      return;
    }
    const d = new Date(t.trade_date);
    for (let i = -1; i <= 1; i++) {
      const shifted = new Date(d);
      shifted.setUTCDate(d.getUTCDate() + i);
      const key = `${base}|${shifted.toISOString().slice(0, 10)}`;
      const entry = blocks.get(key) ?? { a: [], b: [] };
      entry[bucket].push(t);
      blocks.set(key, entry);
    }
  };
  for (const t of a) addForAllDates(t, 'a');
  for (const t of b) addForAllDates(t, 'b');
  return blocks;
}
