import { describe, it, expect } from 'vitest';
import { runEngine } from '@/lib/matching/engine';
import { blockingKey, blockBoth, DEFAULT_BLOCKING_KEYS } from '@/lib/matching/blocking';
import { normalizeTrade, type RawCanonicalTrade } from '@/lib/matching/normalize';
import { PipelineSuggestionSchema } from '@/lib/ai/schemas/pipeline-suggestion';

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

describe('blocking keys: different key sets produce different blocks', () => {
  it('default (symbol+trade_date+direction) groups two AAPL BUY trades together', () => {
    const a = normalizeTrade(t({ trade_id: 'a', symbol: 'AAPL', direction: 'BUY' }));
    const b = normalizeTrade(t({ trade_id: 'b', symbol: 'AAPL', direction: 'BUY' }));
    const blocks = blockBoth([a], [b], DEFAULT_BLOCKING_KEYS);
    expect(blocks.size).toBe(1);
    const block = Array.from(blocks.values())[0]!;
    expect(block.a).toHaveLength(1);
    expect(block.b).toHaveLength(1);
  });

  it('ISIN-keyed blocking (FI-style) separates two symbol-different but ISIN-different trades', () => {
    const a = normalizeTrade(t({ trade_id: 'a', symbol: 'AAPL', isin: 'US0000000001' }));
    const b = normalizeTrade(t({ trade_id: 'b', symbol: 'AAPL', isin: 'US0000000002' }));
    const blocks = blockBoth([a], [b], ['isin', 'trade_date', 'direction']);
    expect(blocks.size).toBe(2);
  });

  it('same trade with two different key configs produces different keys', () => {
    const x = normalizeTrade(t({ symbol: 'AAPL', isin: 'US0378331005' }));
    const byDefault = blockingKey(x);
    const byIsin = blockingKey(x, ['isin', 'trade_date', 'direction']);
    expect(byDefault).not.toBe(byIsin);
  });
});

describe('stage enablement: disabled stages are actually skipped', () => {
  it('disabling hash prevents deterministic-hit matches (forces probabilistic path)', () => {
    const a = [t({ trade_id: 'a1', price: 100 })];
    const b = [t({ trade_id: 'b1', price: 100 })]; // exact match would hit hash
    const withHash = runEngine({
      side_a: a,
      side_b: b,
      enabled_stages: ['normalize', 'hash', 'blocking', 'similarity', 'fellegi_sunter', 'hungarian']
    });
    const withoutHash = runEngine({
      side_a: a,
      side_b: b,
      enabled_stages: ['normalize', 'blocking', 'similarity', 'fellegi_sunter', 'hungarian']
    });
    expect(withHash.counts.DETERMINISTIC).toBe(1);
    expect(withoutHash.counts.DETERMINISTIC).toBe(0);
    // Both should still produce a match — just via different paths
    expect(withHash.matches).toHaveLength(1);
    expect(withoutHash.matches).toHaveLength(1);
    expect(withHash.matches[0]!.explanation.deterministic_hit).toBe(true);
    expect(withoutHash.matches[0]!.explanation.deterministic_hit).toBe(false);
  });

  it('blocking enabled: different symbols land in different blocks (no cross-scoring)', () => {
    const a = t({ trade_id: 'a1', symbol: 'AAPL', isin: 'US0000000001', cusip: '000000001' });
    const b = t({ trade_id: 'b1', symbol: 'MSFT', isin: 'US0000000002', cusip: '000000002' });
    const out = runEngine({
      side_a: [a],
      side_b: [b],
      enabled_stages: ['normalize', 'hash', 'blocking', 'similarity', 'fellegi_sunter', 'hungarian']
    });
    expect(out.matches).toHaveLength(0);
  });

  it('blocking disabled: pairs in different blocks still get scored', () => {
    // Two unrelated trades: different symbol, ISIN, CUSIP, direction, quantity, price,
    // counterparty, account — essentially nothing in common. With blocking disabled,
    // the engine still attempts to score them (which is the feature under test),
    // even though Hungarian may or may not accept the pair.
    const a = t({
      trade_id: 'a1',
      symbol: 'AAPL',
      isin: 'US0378331005',
      cusip: '037833100',
      direction: 'BUY',
      quantity: 500,
      price: 178.43,
      counterparty: 'Goldman Sachs',
      account: 'ACCT-1'
    });
    const b = t({
      trade_id: 'b1',
      symbol: 'MSFT',
      isin: 'US5949181045',
      cusip: '594918104',
      direction: 'SELL',
      quantity: 10,
      price: 402.11,
      counterparty: 'Morgan Stanley',
      account: 'ACCT-2'
    });
    const out = runEngine({
      side_a: [a],
      side_b: [b],
      enabled_stages: ['normalize', 'similarity', 'fellegi_sunter', 'hungarian']
    });
    // Primary assertion: the pair was scored (blocking didn't prune it).
    const scored = out.telemetry.get('fellegi_sunter.score');
    expect(scored).toBeGreaterThan(0);
  });

  it('normalize + fellegi_sunter cannot be turned off even if caller omits them', () => {
    const a = [t({ trade_id: 'a1', price: 100 })];
    const b = [t({ trade_id: 'b1', price: 100 })];
    // Caller tries to disable the load-bearing stages; engine forces them back on.
    const out = runEngine({
      side_a: a,
      side_b: b,
      enabled_stages: ['hash', 'blocking', 'hungarian']
    });
    expect(out.matches).toHaveLength(1);
    expect(out.matches[0]!.explanation.posterior).toBeGreaterThan(0);
  });
});

describe('match_types: engine stamps the primary type on results', () => {
  it('passing match_types = [1:N] stamps 1:N on each match even though engine emits 1:1', () => {
    const a = [t({ trade_id: 'a1', price: 100 })];
    const b = [t({ trade_id: 'b1', price: 100 })];
    const out = runEngine({
      side_a: a,
      side_b: b,
      match_types: ['1:N']
    });
    expect(out.matches[0]!.explanation.match_type).toBe('1:N');
  });
});

describe('PipelineSuggestionSchema: AI output shape', () => {
  it('accepts a well-formed suggestion', () => {
    const sample = {
      summary: 'Equities cash settlement, clean feed',
      asset_class: 'EQUITY' as const,
      tolerances: {
        price_rel_tolerance: 0.01,
        quantity_rel_tolerance: 0.05,
        date_day_delta: 1,
        bands: { high_min: 0.95, medium_min: 0.7 }
      },
      rationale_per_field: {
        price: '1% is the industry-standard cash tolerance.',
        quantity: '5% covers allocation rounding.',
        date: '1d handles T+1 confirmation drift.',
        bands: 'Balanced defaults.',
        blocking_keys: 'Standard equities blocking.',
        enabled_stages: 'All 7 stages for full fidelity.',
        match_types: '1:1 — no allocations in sample.'
      },
      llm_tiebreak_band: 'MEDIUM_ONLY' as const,
      blocking_keys: ['symbol', 'trade_date', 'direction'],
      enabled_stages: [
        'normalize',
        'hash',
        'blocking',
        'similarity',
        'fellegi_sunter',
        'hungarian',
        'llm_tiebreak'
      ],
      match_types: ['1:1'],
      warnings: []
    };
    const parsed = PipelineSuggestionSchema.safeParse(sample);
    expect(parsed.success).toBe(true);
  });

  it('rejects a suggestion missing blocking_keys', () => {
    const sample = {
      summary: 'x',
      asset_class: 'EQUITY' as const,
      tolerances: {
        price_rel_tolerance: 0.01,
        quantity_rel_tolerance: 0.05,
        date_day_delta: 1,
        bands: { high_min: 0.95, medium_min: 0.7 }
      },
      rationale_per_field: {},
      llm_tiebreak_band: 'MEDIUM_ONLY' as const,
      enabled_stages: ['normalize', 'fellegi_sunter'],
      match_types: ['1:1'],
      warnings: []
    };
    const parsed = PipelineSuggestionSchema.safeParse(sample);
    expect(parsed.success).toBe(false);
  });

  it('rejects an empty enabled_stages array', () => {
    const sample = {
      summary: 'x',
      asset_class: 'EQUITY' as const,
      tolerances: {
        price_rel_tolerance: 0.01,
        quantity_rel_tolerance: 0.05,
        date_day_delta: 1,
        bands: { high_min: 0.95, medium_min: 0.7 }
      },
      rationale_per_field: {},
      llm_tiebreak_band: 'MEDIUM_ONLY' as const,
      blocking_keys: ['symbol'],
      enabled_stages: [],
      match_types: ['1:1'],
      warnings: []
    };
    const parsed = PipelineSuggestionSchema.safeParse(sample);
    expect(parsed.success).toBe(false);
  });
});
