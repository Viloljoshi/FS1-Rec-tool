import { describe, it, expect } from 'vitest';
import {
  jaroWinkler,
  levenshteinSimilarity,
  tokenSetRatio,
  metaphoneEqual,
  dateProximity,
  quantityScore,
  priceScore,
  counterpartySimilarity
} from '@/lib/matching/similarity';

describe('similarity primitives', () => {
  it('JW identical strings → 1', () => {
    expect(jaroWinkler('AAPL', 'AAPL')).toBe(1);
  });

  it('JW close strings → high', () => {
    expect(jaroWinkler('Goldman Sachs', 'Goldman')).toBeGreaterThan(0.85);
  });

  it('Levenshtein similarity on small edits', () => {
    expect(levenshteinSimilarity('A4421', 'ACCT4421')).toBeGreaterThan(0.5);
  });

  it('token-set ratio ignores word order', () => {
    expect(tokenSetRatio('Morgan Stanley Co', 'Co Morgan Stanley')).toBe(1);
  });

  it('Double Metaphone catches phonetic variants', () => {
    expect(metaphoneEqual('Goldman', 'Goldmann')).toBe(true);
  });

  it('date proximity zero days = 1', () => {
    expect(dateProximity('2026-04-07', '2026-04-07')).toBe(1);
  });

  it('date proximity 3+ days = 0', () => {
    expect(dateProximity('2026-04-07', '2026-04-11')).toBe(0);
  });

  it('quantity score full agreement = 1', () => {
    expect(quantityScore('500', '500')).toBe(1);
  });

  it('quantity score beyond 5% relative = 0', () => {
    expect(quantityScore('500', '600')).toBe(0);
  });

  it('price score tiny drift < 1% stays positive', () => {
    const s = priceScore('178.4250', '178.43');
    expect(s).toBeGreaterThan(0.95);
  });

  it('counterparty similarity handles aliasing', () => {
    const s = counterpartySimilarity(
      'J.P. Morgan Securities LLC',
      'JPM Securities LLC'
    );
    expect(s).toBeGreaterThan(0.6);
  });
});
