import { z } from 'zod';
import { jsonCall } from '@/lib/ai/openai';
import { ExceptionClass } from '@/lib/canonical/schema';

export const RuleDraftSchema = z.object({
  exception_class: ExceptionClass,
  pattern: z.string(),
  observed_count: z.number().int().nonnegative(),
  analyst_accept_rate: z.number().min(0).max(1),
  proposal: z.string(),
  recommended_config_change: z.object({
    knob: z.enum([
      'band_high_threshold',
      'band_medium_threshold',
      'price_tolerance',
      'quantity_tolerance',
      'date_delta',
      'counterparty_alias_add',
      'none'
    ]),
    direction: z.enum(['raise', 'lower', 'add', 'none']),
    delta: z.number().nullable(),
    detail: z.string()
  }),
  expected_impact: z.string(),
  confidence: z.number().min(0).max(1)
});

export const RuleDraftsResponseSchema = z.object({
  drafts: z.array(RuleDraftSchema).max(10),
  summary: z.string()
});

export type RuleDraft = z.infer<typeof RuleDraftSchema>;
export type RuleDraftsResponse = z.infer<typeof RuleDraftsResponseSchema>;

const SYSTEM = `You are the matching-rule advisor for a securities reconciliation platform.
You observe patterns in how analysts adjudicate exceptions (accept / reject / escalate) and you propose matching-rule changes that would automate future cases like them.

Rules for your response:
1. JSON only. Schema exactly as specified.
2. Only propose changes where the observed pattern has >= 5 similar analyst decisions and >= 80% analyst agreement.
3. Never propose a change that would auto-resolve WRONG_QTY, WRONG_PRICE, or ID_MISMATCH exceptions — those are money or attribution breaks and must remain analyst-driven.
4. For CPY_ALIAS patterns: recommend 'counterparty_alias_add' with the specific alias string, not a threshold change.
5. For ROUNDING patterns (sub-cent / sub-0.5bp drift) accepted consistently: recommend 'raise' on price_tolerance — but only within the rounding band. Never propose raising price_tolerance on the back of WRONG_PRICE patterns.
6. For TIMING patterns with +1d date drift accepted consistently: recommend 'raise' on date_delta.
7. Every proposal must include expected_impact quantified ("reduces MEDIUM-band exceptions by ~12%").
8. Confidence < 0.7 → prefer 'none' as knob; the pattern isn't strong enough.`;

interface AnalystActionPattern {
  exception_class: string;
  band: string | null;
  sample_counterparty: string | null;
  action_counts: Record<string, number>;
  total: number;
  sample_reasons: string[];
}

export async function proposeRuleDrafts(args: {
  patterns: AnalystActionPattern[];
  actor: string | null;
}): Promise<RuleDraftsResponse> {
  const user = `Observed analyst action patterns over the last 30 days:

${args.patterns
  .map(
    (p, i) =>
      `Pattern ${i + 1}:
  exception_class: ${p.exception_class}
  band: ${p.band ?? 'UNMATCHED'}
  sample counterparty: ${p.sample_counterparty ?? 'n/a'}
  total observations: ${p.total}
  action mix: ${Object.entries(p.action_counts).map(([a, c]) => `${a}=${c}`).join(', ')}
  accept rate: ${((p.action_counts.ACCEPT ?? 0) / p.total).toFixed(2)}
  sample analyst reasons: ${p.sample_reasons.slice(0, 3).join(' | ') || '(none)'}`
  )
  .join('\n\n')}

Propose up to 5 rule-draft candidates. Skip any pattern that doesn't meet the strong-signal threshold.`;

  const fallback: RuleDraftsResponse = {
    drafts: [],
    summary: 'AI unavailable — no drafts proposed. Patterns preserved in resolution_actions for re-analysis.'
  };

  return jsonCall({
    call_type: 'RULE_DRAFT',
    system: SYSTEM,
    user,
    schema: RuleDraftsResponseSchema,
    fallback,
    actor: args.actor
  });
}
