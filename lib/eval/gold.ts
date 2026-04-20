import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

export interface GoldPair {
  pair_id: string;
  trade_a: string;
  trade_b: string;
  label: 'MATCH' | 'NO_MATCH' | 'AMBIGUOUS';
  exception_class: string;
  reason: string;
  curator: string;
  curated_at: string;
}

export function loadGoldSet(): GoldPair[] {
  const file = path.join(process.cwd(), 'data', 'eval', 'gold.jsonl');
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as GoldPair);
}

export const GOLD_SET_VERSION = '2026-04-19-v1';
