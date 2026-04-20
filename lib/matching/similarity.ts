import { distance as levenshteinDistance } from 'fastest-levenshtein';
import natural from 'natural';
import Decimal from 'decimal.js';
import { counterpartyCompareKey, dayDelta, relativeDiff } from '@/lib/canonical/normalize';
import type { NormalizedTrade } from './normalize';
import type { AlgoTelemetry } from './telemetry';

const JW = natural.JaroWinklerDistance;
const DoubleMetaphone = natural.DoubleMetaphone;
const dm = new DoubleMetaphone();

export function jaroWinkler(a: string, b: string): number {
  if (!a || !b) return 0;
  return JW(a, b, { ignoreCase: true });
}

export function levenshteinSimilarity(a: string, b: string): number {
  if (!a && !b) return 1;
  if (!a || !b) return 0;
  const d = levenshteinDistance(a, b);
  const max = Math.max(a.length, b.length);
  return max === 0 ? 1 : 1 - d / max;
}

export function tokenSetRatio(a: string, b: string): number {
  const ta = new Set(a.toLowerCase().split(/\s+/).filter(Boolean));
  const tb = new Set(b.toLowerCase().split(/\s+/).filter(Boolean));
  if (ta.size === 0 && tb.size === 0) return 1;
  const intersect = new Set([...ta].filter((x) => tb.has(x)));
  const union = new Set([...ta, ...tb]);
  return union.size === 0 ? 0 : intersect.size / union.size;
}

export function metaphoneEqual(a: string, b: string): boolean {
  if (!a || !b) return false;
  const [a1, a2] = dm.process(a);
  const [b1, b2] = dm.process(b);
  return a1 === b1 || a1 === b2 || a2 === b1 || (!!a2 && a2 === b2);
}

export function cosine(a: number[], b: number[]): number {
  if (a.length === 0 || b.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

export function counterpartySimilarity(
  a: string,
  b: string,
  embA?: number[] | null,
  embB?: number[] | null,
  telemetry?: AlgoTelemetry
): number {
  const ka = counterpartyCompareKey(a);
  const kb = counterpartyCompareKey(b);
  const jw = jaroWinkler(ka, kb);
  telemetry?.tick('similarity.jaro_winkler');
  const tsr = tokenSetRatio(ka, kb);
  telemetry?.tick('similarity.token_set');
  const meta = metaphoneEqual(ka, kb) ? 0.85 : 0;
  telemetry?.tick('similarity.double_metaphone');
  const emb = embA && embB && embA.length && embB.length ? cosine(embA, embB) : 0;
  if (embA && embB && embA.length && embB.length) telemetry?.tick('similarity.embedding_cosine');
  const blendedJwEmb = emb ? 0.6 * jw + 0.4 * emb : 0;
  return Math.max(jw, tsr, meta, blendedJwEmb);
}

export function idExact(a: string | null, b: string | null): number | null {
  if (a === null || b === null) return null; // neutral
  return a === b ? 1 : 0;
}

export function dateProximity(a: string, b: string, maxDays = 3): number {
  const d = dayDelta(a, b);
  if (d === 0) return 1;
  if (d >= maxDays) return 0;
  return 1 - d / maxDays;
}

export function numericTolerance(a: string, b: string, capRelative = 0.05): number {
  const diff = relativeDiff(a, b);
  if (diff === 0) return 1;
  if (diff >= capRelative) return 0;
  return 1 - diff / capRelative;
}

export function quantityScore(a: string, b: string): number {
  return numericTolerance(a, b, 0.05);
}

export function priceScore(a: string, b: string): number {
  return numericTolerance(a, b, 0.01);
}

export function exactScore<T>(a: T, b: T): number {
  return a === b ? 1 : 0;
}

export interface FieldScores {
  isin: number | null;
  cusip: number | null;
  symbol: number;
  trade_date: number;
  settlement_date: number;
  direction: number;
  quantity: number;
  price: number;
  currency: number;
  counterparty: number;
  account: number;
}

export function scoreFields(
  a: NormalizedTrade,
  b: NormalizedTrade,
  embA?: number[] | null,
  embB?: number[] | null,
  telemetry?: AlgoTelemetry
): FieldScores {
  void Decimal;
  const isinScore = idExact(a.isin, b.isin);
  if (isinScore !== null) telemetry?.tick('similarity.id_exact');
  const cusipScore = idExact(a.cusip, b.cusip);
  if (cusipScore !== null) telemetry?.tick('similarity.id_exact');
  telemetry?.tick('similarity.date_delta', 2);
  telemetry?.tick('similarity.numeric_tolerance', 2);
  const accountScore = levenshteinSimilarity(a.account, b.account);
  telemetry?.tick('similarity.levenshtein');
  return {
    isin: isinScore,
    cusip: cusipScore,
    symbol: exactScore(a.symbol, b.symbol),
    trade_date: dateProximity(a.trade_date, b.trade_date),
    settlement_date: dateProximity(a.settlement_date, b.settlement_date),
    direction: exactScore(a.direction, b.direction),
    quantity: quantityScore(a.quantity, b.quantity),
    price: priceScore(a.price, b.price),
    currency: exactScore(a.currency, b.currency),
    counterparty: counterpartySimilarity(a.counterparty, b.counterparty, embA, embB, telemetry),
    account: accountScore
  };
}
