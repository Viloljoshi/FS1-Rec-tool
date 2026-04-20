import type { NormalizedTrade } from './normalize';

export function blockingKey(t: NormalizedTrade): string {
  return `${t.symbol}|${t.trade_date}|${t.direction}`;
}

export function blockBoth(
  a: NormalizedTrade[],
  b: NormalizedTrade[]
): Map<string, { a: NormalizedTrade[]; b: NormalizedTrade[] }> {
  const blocks = new Map<string, { a: NormalizedTrade[]; b: NormalizedTrade[] }>();
  for (const t of a) {
    const k = blockingKey(t);
    const entry = blocks.get(k) ?? { a: [], b: [] };
    entry.a.push(t);
    blocks.set(k, entry);
  }
  for (const t of b) {
    const k = blockingKey(t);
    const entry = blocks.get(k) ?? { a: [], b: [] };
    entry.b.push(t);
    blocks.set(k, entry);
  }
  return blocks;
}

export function blockWithLooseDate(
  a: NormalizedTrade[],
  b: NormalizedTrade[]
): Map<string, { a: NormalizedTrade[]; b: NormalizedTrade[] }> {
  const blocks = new Map<string, { a: NormalizedTrade[]; b: NormalizedTrade[] }>();
  const addForAllDates = (t: NormalizedTrade, bucket: 'a' | 'b') => {
    const d = new Date(t.trade_date);
    for (let i = -1; i <= 1; i++) {
      const shifted = new Date(d);
      shifted.setUTCDate(d.getUTCDate() + i);
      const key = `${t.symbol}|${shifted.toISOString().slice(0, 10)}|${t.direction}`;
      const entry = blocks.get(key) ?? { a: [], b: [] };
      entry[bucket].push(t);
      blocks.set(key, entry);
    }
  };
  for (const t of a) addForAllDates(t, 'a');
  for (const t of b) addForAllDates(t, 'b');
  return blocks;
}
