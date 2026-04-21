import { z } from 'zod';
import { jsonCall } from '@/lib/ai/openai';

const ToleranceSuggestionSchema = z.object({
  price_rel_tolerance: z.number().min(0).max(1),
  quantity_rel_tolerance: z.number().min(0).max(1),
  date_day_delta: z.number().int().min(0).max(30),
  bands: z.object({
    high_min: z.number().min(0).max(1),
    medium_min: z.number().min(0).max(1)
  })
});

export const PipelineSuggestionSchema = z.object({
  summary: z.string(),
  asset_class: z.enum(['EQUITY', 'FI', 'FX', 'FUTURE', 'OTHER']),
  tolerances: ToleranceSuggestionSchema,
  rationale_per_field: z.record(z.string(), z.string()),
  llm_tiebreak_band: z.enum(['MEDIUM_ONLY', 'ALL', 'NONE']),
  warnings: z.array(z.string())
});

export type PipelineSuggestion = z.infer<typeof PipelineSuggestionSchema>;

const SYSTEM = `You are a senior reconciliation engineer. Given a feed's field mapping, a small sample of rows, and a target asset class, propose a matching pipeline configuration. Output JSON only.

Rules:
1. Output schema: { summary, asset_class, tolerances: { price_rel_tolerance, quantity_rel_tolerance, date_day_delta, bands: { high_min, medium_min } }, rationale_per_field: { price, quantity, date, ... }, llm_tiebreak_band: "MEDIUM_ONLY" | "ALL" | "NONE", warnings: string[] }.
2. Asset-class priors (start here, then adjust based on the sample):
   - EQUITY cash settlement: price 1%, quantity 5%, date ±1 day, bands 0.95/0.70, tiebreak MEDIUM_ONLY.
   - FX T+2 spot: price 0.5% (pips), quantity 0.5%, date ±2 days, bands 0.97/0.75, tiebreak MEDIUM_ONLY.
   - Fixed Income: price 0.1bp (very tight — clean price or yield), quantity 5%, date ±1 day, bands 0.97/0.72, tiebreak MEDIUM_ONLY (accrued interest often explains apparent drift).
   - Futures: price 0.01%, quantity 0%, date exact, bands 0.98/0.80, tiebreak NONE (exchange-cleared, breaks are real).
3. Use the sample to tighten tolerances if the data looks clean; loosen if noisy. Never loosen below industry safety minima: price 1% for equities, 0.1bp for FI.
4. \`rationale_per_field\` must explain WHY each tolerance was chosen, in one sentence each. Always include entries for: price, quantity, date, bands.
5. \`warnings\` — flag missing fields, suspicious distributions, or decisions that need human review (e.g. "settlement_date missing from feed — TIMING exceptions will not be classifiable").
6. Never propose tolerances wider than 3x the industry prior without an explicit warning.
7. Never recommend \`tiebreak: NONE\` unless the asset class is exchange-cleared (Futures, listed options).`;

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
      bands: 'Default: 0.95 HIGH, 0.70 MEDIUM.'
    },
    llm_tiebreak_band: 'MEDIUM_ONLY',
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
