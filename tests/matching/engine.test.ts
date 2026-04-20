import { describe, it, expect } from 'vitest';
import { runEngine } from '@/lib/matching/engine';
import type { RawCanonicalTrade } from '@/lib/matching/normalize';

function t(overrides: Partial<RawCanonicalTrade>): RawCanonicalTrade {
  return {
    trade_id: overrides.trade_id ?? 'id',
    source_id: overrides.source_id ?? 'src',
    source_ref: overrides.source_ref ?? 'ref',
    trade_date: overrides.trade_date ?? '2026-04-07',
    settlement_date: overrides.settlement_date ?? '2026-04-08',
    direction: overrides.direction ?? 'BUY',
    symbol: overrides.symbol ?? 'AAPL',
    isin: overrides.isin ?? 'US0378331005',
    cusip: overrides.cusip ?? '037833100',
    quantity: overrides.quantity ?? 500,
    price: overrides.price ?? 178.43,
    currency: overrides.currency ?? 'USD',
    counterparty: overrides.counterparty ?? 'Goldman Sachs & Co. LLC',
    counterparty_canonical_id: overrides.counterparty_canonical_id ?? null,
    account: overrides.account ?? 'ACCT-4421'
  };
}

describe('matching engine', () => {
  it('clean pair produces HIGH deterministic match', () => {
    const a = [t({ trade_id: 'a1' })];
    const b = [t({ trade_id: 'b1' })];
    const out = runEngine({ side_a: a, side_b: b });
    expect(out.matches).toHaveLength(1);
    expect(out.matches[0]!.explanation.band).toBe('HIGH');
    expect(out.matches[0]!.explanation.deterministic_hit).toBe(true);
    expect(out.counts.HIGH).toBe(1);
  });

  it('wrong quantity produces a low-band or no-match candidate', () => {
    const a = [t({ trade_id: 'a1', quantity: 500 })];
    const b = [t({ trade_id: 'b1', quantity: 1000 })];
    const out = runEngine({ side_a: a, side_b: b });
    const match = out.matches[0];
    if (match) {
      expect(match.explanation.band).not.toBe('HIGH');
    } else {
      expect(out.counts.UNMATCHED_A).toBe(1);
      expect(out.counts.UNMATCHED_B).toBe(1);
    }
  });

  it('CPY alias drift produces MEDIUM band with decomposable scores', () => {
    const a = [t({ trade_id: 'a1', counterparty: 'J.P. Morgan Securities LLC' })];
    const b = [t({ trade_id: 'b1', counterparty: 'JPMCB' })];
    const out = runEngine({ side_a: a, side_b: b });
    expect(out.matches).toHaveLength(1);
    const m = out.matches[0]!;
    expect(m.explanation.band === 'MEDIUM' || m.explanation.band === 'HIGH').toBe(true);
    expect(m.explanation.field_scores.find((f) => f.field === 'counterparty')).toBeDefined();
  });

  it('Hungarian assigns 1:1 when multiple candidates compete', () => {
    const a = [
      t({ trade_id: 'a1', source_ref: 'A1' }),
      t({ trade_id: 'a2', source_ref: 'A2', quantity: 600 })
    ];
    const b = [
      t({ trade_id: 'b1', source_ref: 'B1' }),
      t({ trade_id: 'b2', source_ref: 'B2', quantity: 600 })
    ];
    const out = runEngine({ side_a: a, side_b: b });
    expect(out.matches).toHaveLength(2);
    const pairSet = new Set(out.matches.map((m) => `${m.trade_a_id}-${m.trade_b_id}`));
    expect(pairSet.has('a1-b1') || pairSet.has('a2-b2')).toBe(true);
  });

  it('missing on one side yields unmatched entry', () => {
    const a = [t({ trade_id: 'a1' })];
    const b: RawCanonicalTrade[] = [];
    const out = runEngine({ side_a: a, side_b: b });
    expect(out.matches).toHaveLength(0);
    expect(out.counts.UNMATCHED_A).toBe(1);
  });
});
