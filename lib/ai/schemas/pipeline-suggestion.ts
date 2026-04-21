import { z } from 'zod';

/**
 * Pure-Zod schema for the AI Pipeline Suggester output. Split from
 * lib/ai/prompts/suggest-pipeline.ts so tests can import it without
 * pulling in the OpenAI client (which eagerly reads OPENAI_API_KEY at
 * module load and fails in environments that don't have it set).
 */

export const BlockingFieldEnum = z.enum([
  'symbol',
  'isin',
  'cusip',
  'trade_date',
  'settlement_date',
  'direction',
  'currency',
  'account'
]);

export const PipelineStageIdEnum = z.enum([
  'normalize',
  'hash',
  'blocking',
  'similarity',
  'fellegi_sunter',
  'hungarian',
  'llm_tiebreak'
]);

export const MatchTypeEnum = z.enum(['1:1', '1:N', 'N:1', 'N:M']);

export const ToleranceSuggestionSchema = z.object({
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
  blocking_keys: z.array(BlockingFieldEnum).min(1).max(5),
  enabled_stages: z.array(PipelineStageIdEnum).min(1),
  match_types: z.array(MatchTypeEnum).min(1),
  warnings: z.array(z.string())
});

export type PipelineSuggestion = z.infer<typeof PipelineSuggestionSchema>;
