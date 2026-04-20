/**
 * Deterministic templates for exception explanations + next-best-action.
 * Used in place of AI for known exception classes to keep matching cycles
 * cheap, fast, and reproducible. AI is only invoked when the class is UNKNOWN
 * or when the field-score pattern doesn't match any template cleanly.
 */
import type { FieldScore, ExceptionClass, ResolutionActionType } from '@/lib/canonical/schema';

export interface TemplatedTriage {
  summary: string;
  likely_cause: ExceptionClass;
  recommended_action: ResolutionActionType;
  suggested_action: ResolutionActionType;
  reason: string;
  confidence: number;
  source: 'TEMPLATE' | 'RULE';
}

const findScore = (scores: FieldScore[], field: string): number | undefined =>
  scores.find((s) => s.field === field)?.raw_score;

const fmtPct = (x: number): string => `${(x * 100).toFixed(1)}%`;

/**
 * Returns a templated triage, or null if the class/pattern doesn't fit a
 * template well — caller should fall back to GPT-5.4.
 */
export function templatedTriage(
  exception_class: ExceptionClass,
  scores: FieldScore[],
  band: 'MEDIUM' | 'LOW' | null
): TemplatedTriage | null {
  switch (exception_class) {
    case 'WRONG_QTY': {
      const q = findScore(scores, 'quantity') ?? 0;
      return {
        summary: `Quantity differs beyond the 5% tolerance (field score ${fmtPct(q)}). This is a material break — the two records disagree on how many units traded. The counterparty may have posted an allocation incorrectly, or an internal split is out of sync.`,
        likely_cause: 'WRONG_QTY',
        recommended_action: 'ESCALATE',
        suggested_action: 'ESCALATE',
        reason: 'Wrong quantity is always escalated — money disagreement.',
        confidence: 0.95,
        source: 'RULE'
      };
    }

    case 'CPY_ALIAS': {
      const cp = findScore(scores, 'counterparty') ?? 0;
      return {
        summary: `Counterparty string differs (field score ${fmtPct(cp)}) but every other field agrees. This is almost certainly a known alias of the same legal entity — abbreviation, DBA, or internal short-code — resolved by the entity graph.`,
        likely_cause: 'CPY_ALIAS',
        recommended_action: band === 'MEDIUM' ? 'ACCEPT' : 'NOTE',
        suggested_action: band === 'MEDIUM' ? 'ACCEPT' : 'NOTE',
        reason: 'Counterparty alias with all other fields agreeing — safe to accept.',
        confidence: 0.88,
        source: 'RULE'
      };
    }

    case 'ROUNDING': {
      const p = findScore(scores, 'price') ?? 0;
      return {
        summary: `Sub-cent price drift within rounding tolerance (field score ${fmtPct(p)}). Typical when one side posts full-precision execution price and the other rounds to 2dp at confirmation time.`,
        likely_cause: 'ROUNDING',
        recommended_action: 'ACCEPT',
        suggested_action: 'ACCEPT',
        reason: 'Price drift is rounding — accept with a note on the analyst audit.',
        confidence: 0.9,
        source: 'RULE'
      };
    }

    case 'WRONG_PRICE': {
      const p = findScore(scores, 'price') ?? 0;
      return {
        summary: `Material price disagreement beyond rounding tolerance (field score ${fmtPct(p)}). The two sides booked the trade at different prices — this is a money break, not a display artifact. Possible causes: wrong fill posted by the broker, price-adjustment not yet applied, or a partial-fill attributed to the wrong parent order.`,
        likely_cause: 'WRONG_PRICE',
        recommended_action: 'ESCALATE',
        suggested_action: 'ESCALATE',
        reason: 'Material price break — escalate; analyst must confirm correct fill before resolving.',
        confidence: 0.92,
        source: 'RULE'
      };
    }

    case 'TIMING': {
      const d = findScore(scores, 'trade_date') ?? 0;
      return {
        summary: `Trade date differs by roughly one business day (field score ${fmtPct(d)}). Typical of T+1 confirmation delay where the broker's timestamp is next-day settlement rather than execution.`,
        likely_cause: 'TIMING',
        recommended_action: 'ACCEPT',
        suggested_action: 'ACCEPT',
        reason: 'Timing drift is a known T+1 convention — accept.',
        confidence: 0.85,
        source: 'RULE'
      };
    }

    case 'FORMAT_DRIFT': {
      const a = findScore(scores, 'account') ?? 0;
      return {
        summary: `Non-material format drift detected (account score ${fmtPct(a)}). The underlying identifier is the same — different prefix convention between feeds.`,
        likely_cause: 'FORMAT_DRIFT',
        recommended_action: 'ACCEPT',
        suggested_action: 'ACCEPT',
        reason: 'Format drift (account prefix) — same underlying account, accept.',
        confidence: 0.88,
        source: 'RULE'
      };
    }

    case 'DUPLICATE': {
      return {
        summary: 'Same trade appears twice on one side — likely a retry or allocation doubling. Verify the other side has only one copy, then reject the duplicate.',
        likely_cause: 'DUPLICATE',
        recommended_action: 'REJECT',
        suggested_action: 'REJECT',
        reason: 'Duplicate on one side — reject the second copy.',
        confidence: 0.92,
        source: 'RULE'
      };
    }

    case 'MISSING_ONE_SIDE': {
      return {
        summary: 'The counterparty feed includes a trade that does not appear on the internal blotter (or vice versa). Could be a late-posted confirmation, an unrecorded execution, or an entirely different trade attributed to the wrong counterparty.',
        likely_cause: 'MISSING_ONE_SIDE',
        recommended_action: 'ESCALATE',
        suggested_action: 'ESCALATE',
        reason: 'One-sided trade — escalate to ops to confirm original execution.',
        confidence: 0.9,
        source: 'RULE'
      };
    }

    case 'ID_MISMATCH': {
      return {
        summary: 'Trade identifiers do not reconcile across the two feeds. Fields may look similar by symbol/date/qty but the underlying security IDs diverge — possibly an attribution error.',
        likely_cause: 'ID_MISMATCH',
        recommended_action: 'ESCALATE',
        suggested_action: 'ESCALATE',
        reason: 'ID mismatch — escalate to ops for attribution review.',
        confidence: 0.9,
        source: 'RULE'
      };
    }

    // UNKNOWN class → return null so caller falls back to GPT-5.4
    case 'UNKNOWN':
    default:
      return null;
  }
}
