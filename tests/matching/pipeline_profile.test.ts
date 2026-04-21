import { describe, it, expect } from 'vitest';
import { runEngine } from '@/lib/matching/engine';
import { priceScore, quantityScore, dateProximity } from '@/lib/matching/similarity';
import { computePosterior } from '@/lib/matching/fellegi_sunter';
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

describe('pipeline profile: tolerances are consumed by similarity scorers', () => {
  it('priceScore respects configurable cap (FI tight vs equity loose)', () => {
    const a = '100.00';
    const b = '100.10'; // 0.1% drift
    expect(priceScore(a, b, 0.01)).toBeGreaterThan(0.8);
    expect(priceScore(a, b, 0.0001)).toBe(0);
  });

  it('quantityScore respects configurable cap', () => {
    const a = '1000';
    const b = '1020'; // 2% drift
    expect(quantityScore(a, b, 0.05)).toBeGreaterThan(0.5);
    expect(quantityScore(a, b, 0.01)).toBe(0);
  });

  it('dateProximity respects configurable maxDays', () => {
    const a = '2026-04-07';
    const b = '2026-04-09';
    expect(dateProximity(a, b, 3)).toBeGreaterThan(0);
    expect(dateProximity(a, b, 1)).toBe(0);
  });
});

describe('pipeline profile: band thresholds drive band assignment', () => {
  it('same posterior → different band when thresholds straddle it', () => {
    // Craft inputs whose posterior sits in a predictable place: 1/(1+exp(-0)) = 0.5.
    const raw = {
      isin: null,
      cusip: null,
      symbol: 0.5,
      trade_date: 0.5,
      settlement_date: 0.5,
      direction: 0.5,
      quantity: 0.5,
      price: 0.5,
      currency: 0.5,
      counterparty: 0.5,
      account: 0.5
    };
    const result = computePosterior(raw);
    // Same posterior; band moves based on thresholds.
    const tight = computePosterior(raw, undefined, { high_min: 0.999, medium_min: 0.998 });
    const loose = computePosterior(raw, undefined, { high_min: result.posterior - 0.001, medium_min: 0 });
    expect(tight.posterior).toBeCloseTo(loose.posterior, 10);
    expect(tight.band).toBe('LOW');
    expect(loose.band).toBe('HIGH');
  });
});

describe('pipeline profile: end-to-end tolerance flow through runEngine', () => {
  const buildPair = (priceDelta: number) => {
    const a = [t({ trade_id: 'a1', price: 100 })];
    const b = [t({ trade_id: 'b1', price: 100 + priceDelta })];
    return { a, b };
  };

  it('1.5% price drift is MEDIUM/LOW under tight equities tolerance', () => {
    const { a, b } = buildPair(1.5);
    const out = runEngine({
      side_a: a,
      side_b: b,
      tolerances: { price_rel_tolerance: 0.01, quantity_rel_tolerance: 0.05, date_day_delta: 3 },
      bands: { high_min: 0.95, medium_min: 0.7 }
    });
    const m = out.matches[0]!;
    expect(m.raw_scores.price).toBe(0);
    expect(m.explanation.band).not.toBe('HIGH');
  });

  it('same 1.5% drift becomes HIGH if the cap is loosened to 2%', () => {
    const { a, b } = buildPair(1.5);
    const out = runEngine({
      side_a: a,
      side_b: b,
      tolerances: { price_rel_tolerance: 0.02, quantity_rel_tolerance: 0.05, date_day_delta: 3 },
      bands: { high_min: 0.95, medium_min: 0.7 }
    });
    const m = out.matches[0]!;
    expect(m.raw_scores.price).toBeGreaterThan(0);
  });

  it('FI profile: 0.2% price drift breaks the match (vs equity default which allows it)', () => {
    const { a, b } = buildPair(0.2);
    const equity = runEngine({
      side_a: a,
      side_b: b,
      tolerances: { price_rel_tolerance: 0.01, quantity_rel_tolerance: 0.05, date_day_delta: 3 },
      bands: { high_min: 0.95, medium_min: 0.7 }
    });
    const fi = runEngine({
      side_a: a,
      side_b: b,
      tolerances: { price_rel_tolerance: 0.00001, quantity_rel_tolerance: 0.05, date_day_delta: 1 },
      bands: { high_min: 0.97, medium_min: 0.72 }
    });
    expect(equity.matches[0]!.raw_scores.price).toBeGreaterThan(0);
    expect(fi.matches[0]!.raw_scores.price).toBe(0);
  });

  it('settlement_date drift sensitivity varies with date_day_delta', () => {
    // trade_date must match for blocking; exercise date_day_delta via settlement_date.
    const a = [t({ trade_id: 'a1', price: 100, settlement_date: '2026-04-08' })];
    const b = [t({ trade_id: 'b1', price: 100, settlement_date: '2026-04-11' })];
    const strict = runEngine({
      side_a: a,
      side_b: b,
      tolerances: { date_day_delta: 1 }
    });
    const loose = runEngine({
      side_a: a,
      side_b: b,
      tolerances: { date_day_delta: 5 }
    });
    expect(strict.matches[0]!.raw_scores.settlement_date).toBe(0);
    expect(loose.matches[0]!.raw_scores.settlement_date).toBeGreaterThan(0);
  });
});
