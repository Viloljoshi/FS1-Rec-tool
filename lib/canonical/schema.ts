import { z } from 'zod';

export const CANONICAL_FIELDS = [
  'trade_date',
  'settlement_date',
  'direction',
  'symbol',
  'isin',
  'cusip',
  'quantity',
  'price',
  'currency',
  'counterparty',
  'account',
  'source_ref'
] as const;

export type CanonicalField = (typeof CANONICAL_FIELDS)[number];

/**
 * Fields that MUST be mapped for a feed to produce any canonical trades.
 * A feed missing any of these would skip 100% of its rows — we block the
 * ingest before silently producing an empty cycle.
 */
export const REQUIRED_CANONICAL_FIELDS: readonly CanonicalField[] = [
  'trade_date',
  'direction',
  'symbol',
  'quantity',
  'price'
] as const;

export function missingRequiredFields(
  mapped: ReadonlyArray<CanonicalField | null | undefined>
): CanonicalField[] {
  const present = new Set(mapped.filter((f): f is CanonicalField => !!f));
  return REQUIRED_CANONICAL_FIELDS.filter((f) => !present.has(f));
}

export const TradeDirection = z.enum(['BUY', 'SELL']);
export type TradeDirection = z.infer<typeof TradeDirection>;

export const AssetClass = z.enum(['EQUITY', 'FI', 'FX', 'FUTURE', 'OTHER']);
export type AssetClass = z.infer<typeof AssetClass>;

export const MatchBand = z.enum(['HIGH', 'MEDIUM', 'LOW']);
export type MatchBand = z.infer<typeof MatchBand>;

export const MatchType = z.enum(['1:1', '1:N', 'N:1', 'N:M']);
export type MatchType = z.infer<typeof MatchType>;

export const ExceptionClass = z.enum([
  'FORMAT_DRIFT',
  'ROUNDING',
  'WRONG_PRICE',
  'TIMING',
  'WRONG_QTY',
  'MISSING_ONE_SIDE',
  'DUPLICATE',
  'CPY_ALIAS',
  'ID_MISMATCH',
  'UNKNOWN'
]);
export type ExceptionClass = z.infer<typeof ExceptionClass>;

export const ResolutionActionType = z.enum(['ACCEPT', 'REJECT', 'ESCALATE', 'NOTE', 'ASSIGN']);
export type ResolutionActionType = z.infer<typeof ResolutionActionType>;

export const CanonicalTradeSchema = z.object({
  trade_id: z.string().uuid().optional(),
  source_id: z.string().uuid(),
  source_version: z.number().int().min(1),
  source_ref: z.string().min(1),
  trade_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  settlement_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  direction: TradeDirection,
  symbol: z.string().min(1).max(16),
  isin: z.string().length(12).nullable(),
  cusip: z.string().length(9).nullable(),
  quantity: z.coerce.number().positive(),
  price: z.coerce.number().positive(),
  currency: z.string().length(3),
  counterparty: z.string().min(1),
  counterparty_canonical_id: z.string().uuid().nullable().optional(),
  account: z.string().min(1),
  asset_class: AssetClass.default('EQUITY'),
  lineage: z.object({
    raw_row_id: z.string().uuid(),
    profile_version: z.number().int(),
    mapping_version: z.number().int()
  })
});

export type CanonicalTrade = z.infer<typeof CanonicalTradeSchema>;

export const FieldScoreSchema = z.object({
  field: z.string(),
  raw_score: z.number().min(0).max(1),
  weight: z.number(),
  contribution: z.number()
});

export type FieldScore = z.infer<typeof FieldScoreSchema>;

export const LLMVerdictSchema = z.object({
  verdict: z.enum(['LIKELY_MATCH', 'LIKELY_NO_MATCH', 'UNCERTAIN']),
  confidence: z.number().min(0).max(1),
  reasoning: z.string(),
  decisive_fields: z.array(z.string())
});

export type LLMVerdict = z.infer<typeof LLMVerdictSchema>;

export const MatchExplanationSchema = z.object({
  posterior: z.number().min(0).max(1),
  band: MatchBand,
  match_type: MatchType,
  field_scores: z.array(FieldScoreSchema),
  deterministic_hit: z.boolean(),
  llm_verdict: LLMVerdictSchema.nullable()
});

export type MatchExplanation = z.infer<typeof MatchExplanationSchema>;

export const InferredMappingItemSchema = z.object({
  source_field: z.string(),
  canonical_field: z.enum(CANONICAL_FIELDS).nullable(),
  confidence: z.number().min(0).max(1),
  reasoning: z.string()
});

export const InferSchemaResponseSchema = z.object({
  mappings: z.array(InferredMappingItemSchema)
});

export type InferSchemaResponse = z.infer<typeof InferSchemaResponseSchema>;

export const NextBestActionSchema = z.object({
  suggested_action: ResolutionActionType,
  reason: z.string(),
  confidence: z.number().min(0).max(1)
});
export type NextBestAction = z.infer<typeof NextBestActionSchema>;

export const ExplainBreakSchema = z.object({
  summary: z.string(),
  likely_cause: ExceptionClass,
  recommended_action: ResolutionActionType
});
export type ExplainBreak = z.infer<typeof ExplainBreakSchema>;
