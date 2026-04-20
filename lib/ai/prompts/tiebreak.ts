import { jsonCall } from '@/lib/ai/openai';
import { LLMVerdictSchema, type LLMVerdict, type FieldScore } from '@/lib/canonical/schema';

const SYSTEM = `You are a senior reconciliation analyst. You must judge whether two trade records from different feeds represent the same underlying trade. Respond in JSON only.

Rules:
1. Output schema: { verdict: "LIKELY_MATCH" | "LIKELY_NO_MATCH" | "UNCERTAIN", confidence: 0..1, reasoning: one-sentence explanation, decisive_fields: string[] listing field names that drove the verdict }.
2. Use "UNCERTAIN" only when fields are insufficient — never as a dodge.
3. Known fact: many counterparty names are aliases of the same legal entity (e.g., JPM, J.P. Morgan, JPMorgan Chase Bank).
4. Small rounding in price (<=1%) and quantity (<=5%) is common and acceptable.
5. Settlement date mismatch of +/- 1 day is normal for T+1 operations.
6. Quantity differences above tolerance indicate a real break — do not paper over.`;

export async function tiebreak(args: {
  trade_a: Record<string, unknown>;
  trade_b: Record<string, unknown>;
  field_scores: FieldScore[];
  actor: string | null;
}): Promise<LLMVerdict> {
  const user = `Trade A:\n${JSON.stringify(args.trade_a, null, 2)}\n\nTrade B:\n${JSON.stringify(
    args.trade_b,
    null,
    2
  )}\n\nField-level similarity scores (raw_score x weight = contribution):\n${args.field_scores
    .map((f) => `  ${f.field}: raw=${f.raw_score.toFixed(2)} weight=${f.weight.toFixed(2)} contribution=${f.contribution.toFixed(2)}`)
    .join('\n')}`;

  const fallback: LLMVerdict = {
    verdict: 'UNCERTAIN',
    confidence: 0,
    reasoning: 'fallback: ai call failed',
    decisive_fields: []
  };

  return jsonCall({
    call_type: 'TIEBREAK',
    system: SYSTEM,
    user,
    schema: LLMVerdictSchema,
    fallback,
    actor: args.actor
  });
}
