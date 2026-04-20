import { jsonCall } from '@/lib/ai/openai';
import { ExplainBreakSchema, type ExplainBreak, type FieldScore } from '@/lib/canonical/schema';

const SYSTEM = `You are a reconciliation analyst assistant. Given two trades and their field-level differences, write a one-paragraph explanation for an analyst, classify the most likely exception class, and recommend an action.

Rules:
1. JSON only. Schema: { summary: string (<= 2 sentences), likely_cause: one of [FORMAT_DRIFT, ROUNDING, WRONG_PRICE, TIMING, WRONG_QTY, MISSING_ONE_SIDE, DUPLICATE, CPY_ALIAS, ID_MISMATCH, UNKNOWN], recommended_action: one of [ACCEPT, REJECT, ESCALATE, NOTE, ASSIGN] }.
Class guidance: ROUNDING = sub-cent / sub-0.5bp price drift (accept). WRONG_PRICE = material price disagreement above rounding tolerance (escalate — this is a money break). WRONG_QTY = quantity disagrees materially (escalate).
2. Never say "I cannot determine". Pick the best option with the info given.
3. Be concise: analysts read 50+ of these per hour.`;

export async function explainBreak(args: {
  trade_a: Record<string, unknown>;
  trade_b: Record<string, unknown>;
  field_scores: FieldScore[];
  actor: string | null;
}): Promise<ExplainBreak> {
  const user = `Trade A:\n${JSON.stringify(args.trade_a, null, 2)}\n\nTrade B:\n${JSON.stringify(
    args.trade_b,
    null,
    2
  )}\n\nField scores:\n${args.field_scores
    .map((f) => `  ${f.field}: ${f.raw_score.toFixed(2)}`)
    .join('\n')}`;

  const fallback: ExplainBreak = {
    summary: 'Analysis unavailable. Review fields manually.',
    likely_cause: 'UNKNOWN',
    recommended_action: 'NOTE'
  };

  return jsonCall({
    call_type: 'EXPLAIN_BREAK',
    system: SYSTEM,
    user,
    schema: ExplainBreakSchema,
    fallback,
    actor: args.actor
  });
}
