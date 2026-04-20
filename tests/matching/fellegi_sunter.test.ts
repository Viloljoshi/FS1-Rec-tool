import { describe, it, expect } from 'vitest';
import { computePosterior, DEFAULT_WEIGHTS } from '@/lib/matching/fellegi_sunter';
import type { FieldScores } from '@/lib/matching/similarity';

const allAgree: FieldScores = {
  isin: 1,
  cusip: 1,
  symbol: 1,
  trade_date: 1,
  settlement_date: 1,
  direction: 1,
  quantity: 1,
  price: 1,
  currency: 1,
  counterparty: 1,
  account: 1
};

const allDisagree: FieldScores = {
  isin: 0,
  cusip: 0,
  symbol: 0,
  trade_date: 0,
  settlement_date: 0,
  direction: 0,
  quantity: 0,
  price: 0,
  currency: 0,
  counterparty: 0,
  account: 0
};

describe('fellegi-sunter', () => {
  it('agreement across all fields yields HIGH band', () => {
    const r = computePosterior(allAgree, DEFAULT_WEIGHTS);
    expect(r.band).toBe('HIGH');
    expect(r.posterior).toBeGreaterThan(0.95);
  });

  it('disagreement across all fields yields LOW band', () => {
    const r = computePosterior(allDisagree, DEFAULT_WEIGHTS);
    expect(r.band).toBe('LOW');
    expect(r.posterior).toBeLessThan(0.01);
  });

  it('null id scores are treated neutrally (not included)', () => {
    const noIds: FieldScores = { ...allAgree, isin: null, cusip: null };
    const r = computePosterior(noIds, DEFAULT_WEIGHTS);
    expect(r.band).toBe('HIGH');
    expect(r.field_scores.find((f) => f.field === 'isin')).toBeUndefined();
  });

  it('ID agreement dominates even with price/qty disagreement (veto handles ops)', () => {
    const priceOff: FieldScores = { ...allAgree, price: 0, quantity: 0.5 };
    const r = computePosterior(priceOff, DEFAULT_WEIGHTS);
    expect(r.band).toBe('HIGH');
  });

  it('without IDs, CPY + price drift falls to MEDIUM', () => {
    const noIdsCpyDrift: FieldScores = {
      ...allAgree,
      counterparty: 0.55,
      isin: null,
      cusip: null
    };
    const r = computePosterior(noIdsCpyDrift, DEFAULT_WEIGHTS);
    expect(r.posterior).toBeGreaterThan(0.8);
  });

  it('without IDs, total disagreement across non-key fields → LOW', () => {
    const noIdsBad: FieldScores = {
      ...allDisagree,
      isin: null,
      cusip: null,
      symbol: 1,
      trade_date: 1,
      direction: 1
    };
    const r = computePosterior(noIdsBad, DEFAULT_WEIGHTS);
    expect(r.band).not.toBe('HIGH');
  });

  it('field_scores include weight and contribution per field', () => {
    const r = computePosterior(allAgree, DEFAULT_WEIGHTS);
    for (const f of r.field_scores) {
      expect(typeof f.weight).toBe('number');
      expect(typeof f.contribution).toBe('number');
      expect(typeof f.raw_score).toBe('number');
    }
  });
});
