import { jsonCall } from '@/lib/ai/openai';
import {
  PipelineSuggestionSchema,
  type PipelineSuggestion
} from '@/lib/ai/schemas/pipeline-suggestion';

export {
  PipelineSuggestionSchema,
  BlockingFieldEnum,
  PipelineStageIdEnum,
  MatchTypeEnum
} from '@/lib/ai/schemas/pipeline-suggestion';
export type { PipelineSuggestion } from '@/lib/ai/schemas/pipeline-suggestion';

const SYSTEM = `You are a senior reconciliation engineer. Given a feed's field mapping, a small sample of rows, and a target asset class, propose a complete matching pipeline configuration. Output JSON only.

Rules:
1. Output schema: { summary, asset_class, tolerances: { price_rel_tolerance, quantity_rel_tolerance, date_day_delta, bands: { high_min, medium_min } }, rationale_per_field: { price, quantity, date, bands, blocking_keys, enabled_stages, match_types, ... }, llm_tiebreak_band: "MEDIUM_ONLY" | "ALL" | "NONE", blocking_keys: string[], enabled_stages: string[], match_types: string[], warnings: string[] }.
2. Asset-class priors (start here, then adjust based on the sample):
   - EQUITY cash settlement: price 1%, quantity 5%, date ±1 day, bands 0.95/0.70, tiebreak MEDIUM_ONLY, blocking_keys [symbol, trade_date, direction], all 7 stages enabled, match_types [1:1].
   - FX T+2 spot: price 0.5% (pips), quantity 0.5%, date ±2 days, bands 0.97/0.75, tiebreak MEDIUM_ONLY, blocking_keys [symbol, settlement_date, direction, currency], SKIP hash (RFQ IDs rarely match), match_types [1:1].
   - Fixed Income: price 0.1bp, quantity 5%, date ±1 day, bands 0.97/0.72, tiebreak MEDIUM_ONLY, blocking_keys [isin, trade_date, direction], all stages, match_types [1:1]. Accrued interest often explains apparent drift.
   - Futures: price 0.01%, quantity 0%, date exact, bands 0.98/0.80, tiebreak NONE, blocking_keys [symbol, trade_date, direction], all stages except llm_tiebreak, match_types [1:1]. Exchange-cleared — breaks are real.
3. Blocking keys must include at least one identifier (symbol / isin / cusip) AND one date-like field (trade_date or settlement_date). Never propose blocking on price/quantity — those are scored, not blocked on.
4. \`enabled_stages\` must always include \`normalize\` and \`fellegi_sunter\`. Omitting stages is for efficiency (e.g. skip \`hash\` if IDs are never clean) or policy (skip \`llm_tiebreak\` for exchange-cleared flows).
5. \`match_types\` [1:1] unless the sample shows allocations (one order → multiple fills); then propose [1:1, 1:N] with a warning that N:M support is still engine-side 1:1 plus an analyst flag.
6. Use the sample to tighten tolerances if the data looks clean; loosen if noisy. Never loosen below industry safety minima: price 1% for equities, 0.1bp for FI.
7. \`rationale_per_field\` must explain WHY each choice was made, in one sentence each. Always include entries for: price, quantity, date, bands, blocking_keys, enabled_stages, match_types.
8. \`warnings\` — flag missing fields, suspicious distributions, or decisions that need human review (e.g. "settlement_date missing from feed — TIMING exceptions will not be classifiable").
9. Never propose tolerances wider than 3x the industry prior without an explicit warning.`;

export interface SuggestPipelineArgs {
  asset_class_hint: string;
  feed_mapping: Array<{ source_field: string; canonical_field: string }>;
  sample_rows: Array<Record<string, unknown>>;
  actor: string | null;
}

export async function suggestPipeline(args: SuggestPipelineArgs): Promise<PipelineSuggestion> {
  const mappingSummary = args.feed_mapping
    .map((m) => `  ${m.source_field} → ${m.canonical_field}`)
    .join('\n');
  const sampleSummary = args.sample_rows
    .slice(0, 10)
    .map((row, i) => `  [${i + 1}] ${JSON.stringify(row)}`)
    .join('\n');

  const user = `Target asset class hint: ${args.asset_class_hint}

Feed canonical mapping:
${mappingSummary}

Sample rows (first 10):
${sampleSummary}

Propose a pipeline configuration JSON.`;

  const fallback: PipelineSuggestion = {
    summary: 'AI unavailable — default equities preset returned.',
    asset_class: 'EQUITY',
    tolerances: {
      price_rel_tolerance: 0.01,
      quantity_rel_tolerance: 0.05,
      date_day_delta: 1,
      bands: { high_min: 0.95, medium_min: 0.7 }
    },
    rationale_per_field: {
      price: 'Default: 1% relative tolerance for equities cash settlement.',
      quantity: 'Default: 5% relative tolerance.',
      date: 'Default: ±1 business day for T+1.',
      bands: 'Default: 0.95 HIGH, 0.70 MEDIUM.',
      blocking_keys: 'Default: (symbol, trade_date, direction) — industry-standard equities blocking key.',
      enabled_stages: 'Default: all 7 stages enabled for a full-fidelity cycle.',
      match_types: 'Default: 1:1 — allocations (1:N) not detected in sample.'
    },
    llm_tiebreak_band: 'MEDIUM_ONLY',
    blocking_keys: ['symbol', 'trade_date', 'direction'],
    enabled_stages: ['normalize', 'hash', 'blocking', 'similarity', 'fellegi_sunter', 'hungarian', 'llm_tiebreak'],
    match_types: ['1:1'],
    warnings: ['AI call failed; analyst should review defaults.']
  };

  return jsonCall({
    call_type: 'PIPELINE_SUGGEST',
    system: SYSTEM,
    user,
    schema: PipelineSuggestionSchema,
    fallback,
    actor: args.actor
  });
}
