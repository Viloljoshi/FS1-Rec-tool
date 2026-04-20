import type { SupabaseClient } from '@supabase/supabase-js';
import { normalizeTrade, type RawCanonicalTrade } from '@/lib/matching/normalize';
import { scoreFields } from '@/lib/matching/similarity';
import { computePosterior, DEFAULT_WEIGHTS } from '@/lib/matching/fellegi_sunter';
import { loadGoldSet, GOLD_SET_VERSION, type GoldPair } from './gold';
import { f1, precision, recall, type Confusion } from './metrics';
import type { MatchBand } from '@/lib/canonical/schema';

interface RunOptions {
  supabase: SupabaseClient;
  initiatedBy: string | null;
  modelVersion: string;
  rulesVersion: number;
}

export interface EvalReport {
  gold_set_version: string;
  precision_score: number;
  recall_score: number;
  f1_score: number;
  confusion: Confusion;
  per_band: Record<MatchBand, { precision: number; recall: number; f1: number; n: number }>;
  per_class: Record<string, { precision: number; recall: number; f1: number; n: number }>;
  model_version: string;
  matching_rules_version: number;
  pair_count: number;
}

/**
 * Lookup trades by source_ref across all feeds.
 */
async function indexTrades(
  supabase: SupabaseClient,
  sourceRefs: string[]
): Promise<Map<string, RawCanonicalTrade>> {
  if (sourceRefs.length === 0) return new Map();
  const { data } = await supabase
    .from('trades_canonical')
    .select(
      'trade_id, source_id, source_ref, trade_date, settlement_date, direction, symbol, isin, cusip, quantity, price, currency, counterparty, counterparty_canonical_id, account'
    )
    .in('source_ref', sourceRefs);
  const map = new Map<string, RawCanonicalTrade>();
  for (const t of (data ?? []) as RawCanonicalTrade[]) {
    // Keep first seen (source_ref is expected unique within a feed; collisions rare)
    if (!map.has(t.source_ref)) map.set(t.source_ref, t);
  }
  return map;
}

export async function runEval(opts: RunOptions): Promise<EvalReport> {
  const pairs = loadGoldSet();
  const refs = Array.from(new Set(pairs.flatMap((p) => [p.trade_a, p.trade_b])));
  const idx = await indexTrades(opts.supabase, refs);

  const confusion: Confusion = { tp: 0, fp: 0, tn: 0, fn: 0 };
  const byBand: Record<string, Confusion> = {
    HIGH: { tp: 0, fp: 0, tn: 0, fn: 0 },
    MEDIUM: { tp: 0, fp: 0, tn: 0, fn: 0 },
    LOW: { tp: 0, fp: 0, tn: 0, fn: 0 }
  };
  const byClass: Record<string, Confusion> = {};

  /**
   * Rubric:
   *   gold MATCH or AMBIGUOUS → system should NOT reject (HIGH/MEDIUM is correct)
   *   gold NO_MATCH           → system should reject     (LOW is correct)
   * HIGH on NO_MATCH = FP (too confident). LOW on MATCH = FN (missed a match).
   */
  const classify = (gold: GoldPair['label'], band: MatchBand): 'tp' | 'fp' | 'tn' | 'fn' => {
    const goldPositive = gold === 'MATCH' || gold === 'AMBIGUOUS';
    const predPositive = band === 'HIGH' || band === 'MEDIUM';
    if (goldPositive && predPositive) return 'tp';
    if (!goldPositive && predPositive) return 'fp';
    if (!goldPositive && !predPositive) return 'tn';
    return 'fn';
  };

  for (const p of pairs) {
    const a = idx.get(p.trade_a);
    const b = idx.get(p.trade_b);
    if (!a || !b) continue;
    const na = normalizeTrade(a);
    const nb = normalizeTrade(b);
    const raw = scoreFields(na, nb);
    const pr = computePosterior(raw, DEFAULT_WEIGHTS);

    const bucket = classify(p.label, pr.band);
    confusion[bucket]++;

    const bandBucket = byBand[pr.band]!;
    bandBucket[bucket]++;

    const cls = p.exception_class;
    if (!byClass[cls]) byClass[cls] = { tp: 0, fp: 0, tn: 0, fn: 0 };
    byClass[cls][bucket]++;
  }

  const reportBand = Object.fromEntries(
    Object.entries(byBand).map(([band, c]) => [
      band,
      {
        precision: precision(c),
        recall: recall(c),
        f1: f1(c),
        n: c.tp + c.fp + c.tn + c.fn
      }
    ])
  ) as EvalReport['per_band'];

  const reportClass = Object.fromEntries(
    Object.entries(byClass).map(([k, c]) => [
      k,
      {
        precision: precision(c),
        recall: recall(c),
        f1: f1(c),
        n: c.tp + c.fp + c.tn + c.fn
      }
    ])
  );

  const report: EvalReport = {
    gold_set_version: GOLD_SET_VERSION,
    precision_score: precision(confusion),
    recall_score: recall(confusion),
    f1_score: f1(confusion),
    confusion,
    per_band: reportBand,
    per_class: reportClass,
    model_version: opts.modelVersion,
    matching_rules_version: opts.rulesVersion,
    pair_count: pairs.length
  };

  await opts.supabase.from('eval_runs').insert({
    gold_set_version: report.gold_set_version,
    precision_score: report.precision_score,
    recall_score: report.recall_score,
    f1_score: report.f1_score,
    per_band: report.per_band,
    per_class: report.per_class,
    confusion: report.confusion,
    model_version: report.model_version,
    matching_rules_version: report.matching_rules_version,
    initiated_by: opts.initiatedBy
  });

  return report;
}
