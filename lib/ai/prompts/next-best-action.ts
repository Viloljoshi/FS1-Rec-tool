import { jsonCall } from '@/lib/ai/openai';
import { NextBestActionSchema, type NextBestAction } from '@/lib/canonical/schema';

const SYSTEM = `You are a reconciliation analyst assistant. Given a single open exception with its current state, field diffs, and explanation, recommend the most sensible next action for a human analyst.

Rules:
1. JSON only. Schema: { suggested_action: one of [ACCEPT, REJECT, ESCALATE, NOTE, ASSIGN], reason: string (one sentence), confidence: 0..1 }.
2. Never suggest ACCEPT for MEDIUM or LOW band without strong reasoning — analyst must confirm.
3. Favor ESCALATE when material money is in question (WRONG_QTY, WRONG_PRICE) regardless of posterior — these are money breaks, not classification noise.
4. Favor ACCEPT when the only discrepancy is a known counterparty alias (CPY_ALIAS) or a sub-cent price drift (ROUNDING) and posterior >= 0.9.`;

export async function nextBestAction(args: {
  exception: Record<string, unknown>;
  actor: string | null;
}): Promise<NextBestAction> {
  const user = `Exception:\n${JSON.stringify(args.exception, null, 2)}`;

  const fallback: NextBestAction = {
    suggested_action: 'NOTE',
    reason: 'fallback: ai call failed',
    confidence: 0
  };

  return jsonCall({
    call_type: 'NEXT_BEST_ACTION',
    system: SYSTEM,
    user,
    schema: NextBestActionSchema,
    fallback,
    actor: args.actor
  });
}
