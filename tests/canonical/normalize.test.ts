import { describe, it, expect } from 'vitest';
import {
  parseNumericLoose,
  tryNormalizeDate,
  tryNormalizeDirection,
  normalizeDate,
  normalizeDirection,
  normalizeDecimal
} from '@/lib/canonical/normalize';

describe('parseNumericLoose', () => {
  it('returns null for null/undefined/empty', () => {
    expect(parseNumericLoose(null)).toBeNull();
    expect(parseNumericLoose(undefined)).toBeNull();
    expect(parseNumericLoose('')).toBeNull();
    expect(parseNumericLoose('   ')).toBeNull();
  });

  it('parses plain numbers and numeric strings', () => {
    expect(parseNumericLoose(42)).toBe(42);
    expect(parseNumericLoose('42')).toBe(42);
    expect(parseNumericLoose('42.5')).toBe(42.5);
  });

  it('strips currency symbols and commas', () => {
    expect(parseNumericLoose('$119.78')).toBeCloseTo(119.78);
    expect(parseNumericLoose('$178,432.50')).toBeCloseTo(178432.5);
    expect(parseNumericLoose('USD 1,250.00')).toBeCloseTo(1250);
    expect(parseNumericLoose('€999.99')).toBeCloseTo(999.99);
  });

  it('handles parenthesized negatives', () => {
    expect(parseNumericLoose('(123.45)')).toBeCloseTo(-123.45);
    expect(parseNumericLoose('($500)')).toBeCloseTo(-500);
  });

  it('returns null for garbage rather than NaN', () => {
    expect(parseNumericLoose('abc')).toBeNull();
    expect(parseNumericLoose('N/A')).toBeNull();
    expect(parseNumericLoose('--')).toBeNull();
  });

  it('rejects NaN / Infinity on numeric input', () => {
    expect(parseNumericLoose(Number.NaN)).toBeNull();
    expect(parseNumericLoose(Number.POSITIVE_INFINITY)).toBeNull();
  });
});

describe('normalizeDirection', () => {
  it('accepts FIX codes 1 and 2', () => {
    expect(normalizeDirection('1')).toBe('BUY');
    expect(normalizeDirection('2')).toBe('SELL');
  });

  it('accepts common abbreviations', () => {
    expect(normalizeDirection('B')).toBe('BUY');
    expect(normalizeDirection('BOT')).toBe('BUY');
    expect(normalizeDirection('Bought')).toBe('BUY');
    expect(normalizeDirection('sell to close')).toBe('SELL');
    expect(normalizeDirection('SLD')).toBe('SELL');
  });

  it('throws on truly unknown directions', () => {
    expect(() => normalizeDirection('XYZ')).toThrow();
  });

  it('tryNormalizeDirection returns null instead of throwing', () => {
    expect(tryNormalizeDirection('XYZ')).toBeNull();
    expect(tryNormalizeDirection('')).toBeNull();
    expect(tryNormalizeDirection(null)).toBeNull();
    expect(tryNormalizeDirection('1')).toBe('BUY');
  });
});

describe('normalizeDate', () => {
  it('handles MMM d yyyy (Apr 7 2026)', () => {
    expect(normalizeDate('Apr 7 2026')).toBe('2026-04-07');
    expect(normalizeDate('Apr 07 2026')).toBe('2026-04-07');
  });

  it('handles yyyyMMdd packed format', () => {
    expect(normalizeDate('20260407')).toBe('2026-04-07');
  });

  it('handles M/d/yyyy with single-digit', () => {
    expect(normalizeDate('4/7/2026')).toBe('2026-04-07');
  });

  it('tryNormalizeDate returns null on garbage', () => {
    expect(tryNormalizeDate('not-a-date')).toBeNull();
    expect(tryNormalizeDate('')).toBeNull();
    expect(tryNormalizeDate(null)).toBeNull();
    expect(tryNormalizeDate('2026-04-07')).toBe('2026-04-07');
  });
});

describe('normalizeDecimal', () => {
  it('handles currency-prefixed strings via cleaner', () => {
    expect(normalizeDecimal('$119.78')).toBe('119.780000');
    expect(normalizeDecimal('178,432.50')).toBe('178432.500000');
  });
});
