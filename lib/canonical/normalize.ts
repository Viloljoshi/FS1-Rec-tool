import Decimal from 'decimal.js';
import { parse, format, isValid } from 'date-fns';

const DATE_FORMATS = [
  'yyyy-MM-dd',
  'yyyyMMdd',
  'MM/dd/yyyy',
  'M/d/yyyy',
  'dd/MM/yyyy',
  'd/M/yyyy',
  'dd-MM-yyyy',
  'yyyy/MM/dd',
  'dd MMM yyyy',
  'd MMM yyyy',
  'dd-MMM-yyyy',
  'MMM d yyyy',
  'MMM dd yyyy',
  'MMMM d yyyy',
  'MMMM dd yyyy'
];

export function normalizeDate(input: string | Date | number): string {
  if (input instanceof Date) {
    return format(input, 'yyyy-MM-dd');
  }
  if (typeof input === 'number') {
    return format(new Date(input), 'yyyy-MM-dd');
  }
  const trimmed = input.trim().replace(/\s+/g, ' ');
  for (const fmt of DATE_FORMATS) {
    const parsed = parse(trimmed, fmt, new Date());
    if (isValid(parsed)) {
      return format(parsed, 'yyyy-MM-dd');
    }
  }
  const fallback = new Date(trimmed);
  if (isValid(fallback)) {
    return format(fallback, 'yyyy-MM-dd');
  }
  throw new Error(`Cannot parse date: ${input}`);
}

export function tryNormalizeDate(input: string | Date | number | null | undefined): string | null {
  if (input === null || input === undefined) return null;
  if (typeof input === 'string' && input.trim() === '') return null;
  try {
    return normalizeDate(input);
  } catch {
    return null;
  }
}

export function normalizeDirection(input: string): 'BUY' | 'SELL' {
  const v = input.trim().toUpperCase();
  // FIX protocol: 1 = BUY, 2 = SELL
  if (['B', 'BUY', 'BOT', 'BOUGHT', '1', 'BUY TO OPEN', 'BUY TO COVER', 'LONG'].includes(v)) return 'BUY';
  if (['S', 'SELL', 'SLD', 'SOLD', '2', 'SELL TO CLOSE', 'SELL SHORT', 'SHORT'].includes(v)) return 'SELL';
  throw new Error(`Unknown direction: ${input}`);
}

export function tryNormalizeDirection(input: string | null | undefined): 'BUY' | 'SELL' | null {
  if (input === null || input === undefined) return null;
  if (input.trim() === '') return null;
  try {
    return normalizeDirection(input);
  } catch {
    return null;
  }
}

export function normalizeIdentifier(input: string | null | undefined): string | null {
  if (!input) return null;
  return input.trim().toUpperCase().replace(/\s+/g, '') || null;
}

export function normalizeSymbol(input: string): string {
  return input.trim().toUpperCase().replace(/\.[NO]$/, '');
}

export function normalizeDecimal(input: string | number): string {
  if (typeof input === 'number') return new Decimal(input).toFixed(6);
  const parsed = parseNumericStrict(input);
  if (parsed.value === null) {
    throw new Error(`Cannot normalize decimal: ${input} (${parsed.reason})`);
  }
  return new Decimal(parsed.value).toFixed(6);
}

/**
 * Strip non-digit decoration: currency symbols, ISO codes, whitespace, plus
 * sign, parenthesized negatives. Does NOT touch `,` or `.` — separator logic
 * is handled by `parseNumericStrict` so ambiguous formats are rejected, not
 * silently reinterpreted (e.g. "60,2499" must NOT become 602499).
 */
function stripNumericDecoration(raw: string): string {
  let s = raw.trim();
  if (!s) return '';
  // Accounting-style negative: "(123.45)" → "-123.45". Unwrap iteratively
  // so "((1))" ends as "1" (cancelled double-negative), not "-(1)" which
  // breaks downstream parsing.
  let negate = false;
  while (/^\(.+\)$/.test(s)) {
    const inner = s.slice(1, -1).trim();
    if (!inner) break;
    s = inner;
    negate = !negate;
  }
  if (negate) s = `-${s}`;
  s = s.replace(/[$£€¥₹]/g, '');
  s = s.replace(/\b(USD|EUR|GBP|JPY|CHF|CAD|AUD|HKD|SGD|CNY|INR)\b/gi, '');
  s = s.replace(/\s+/g, '');
  s = s.replace(/^\+/, '');
  return s;
}

export type NumericParseFailure =
  | 'empty'
  | 'non_numeric'
  | 'ambiguous_decimal'
  | 'not_finite';

export interface NumericParseResult {
  value: number | null;
  reason: NumericParseFailure | null;
  strategy: 'us' | 'eu' | 'integer' | 'plain' | null;
}

/**
 * Strict-but-practical numeric parser. Accepts formats real ops pipelines
 * see; rejects the ones that can't be interpreted without guessing.
 *
 * Accepted:
 *   "60.25"         → 60.25
 *   "60,25"         → 60.25   (EU decimal: exactly 2 digits after lone comma)
 *   "1,000"         → 1000    (US thousand sep: exactly 3 digits)
 *   "1,000,000"     → 1000000
 *   "1,000.50"      → 1000.50 (US: commas are groups, dot is decimal)
 *   "1.000,50"      → 1000.50 (EU: dots are groups, comma is decimal)
 *   "$347.90"       → 347.90
 *   "(12.50)"       → -12.50
 *
 * Rejected (reason='ambiguous_decimal'):
 *   "60,2499"       — 4 digits after lone comma: could be EU decimal or
 *                     thousand-grouped 602,499. Ambiguous. Reject.
 *   "1,2"           — 1 digit after lone comma. Also ambiguous. Reject.
 */
export function parseNumericStrict(
  input: string | number | null | undefined
): NumericParseResult {
  if (input === null || input === undefined) return { value: null, reason: 'empty', strategy: null };
  if (typeof input === 'number') {
    return Number.isFinite(input)
      ? { value: input, reason: null, strategy: 'plain' }
      : { value: null, reason: 'not_finite', strategy: null };
  }
  const s = stripNumericDecoration(input);
  if (!s) return { value: null, reason: 'empty', strategy: null };

  const hasDot = s.includes('.');
  const hasComma = s.includes(',');

  let cleaned = s;
  let strategy: NumericParseResult['strategy'] = 'integer';

  if (hasDot && hasComma) {
    const lastDot = s.lastIndexOf('.');
    const lastComma = s.lastIndexOf(',');
    if (lastDot > lastComma) {
      cleaned = s.replace(/,/g, '');
      strategy = 'us';
    } else {
      cleaned = s.replace(/\./g, '').replace(',', '.');
      strategy = 'eu';
    }
  } else if (hasComma && !hasDot) {
    const parts = s.split(',');
    if (!parts.every((p) => /^-?\d+$/.test(p))) {
      return { value: null, reason: 'non_numeric', strategy: null };
    }
    const tail = parts[parts.length - 1]!;
    if (tail.length === 3 && parts.length >= 2) {
      cleaned = parts.join('');
      strategy = 'us';
    } else if (tail.length === 2 && parts.length === 2) {
      cleaned = parts.join('.');
      strategy = 'eu';
    } else {
      return { value: null, reason: 'ambiguous_decimal', strategy: null };
    }
  } else if (hasDot) {
    const parts = s.split('.');
    if (parts.length === 2) {
      strategy = 'plain';
    } else if (parts.every((p) => /^-?\d+$/.test(p))) {
      const tail = parts[parts.length - 1]!;
      if (tail.length === 3) {
        cleaned = parts.join('');
        strategy = 'eu';
      } else {
        return { value: null, reason: 'ambiguous_decimal', strategy: null };
      }
    } else {
      return { value: null, reason: 'non_numeric', strategy: null };
    }
  }

  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) {
    return { value: null, reason: 'non_numeric', strategy: null };
  }
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return { value: null, reason: 'not_finite', strategy: null };
  return { value: n, reason: null, strategy };
}

/**
 * Legacy-compatible wrapper — returns the value or null. Prefer
 * `parseNumericStrict` when you need the failure reason for logging.
 */
export function parseNumericLoose(input: string | number | null | undefined): number | null {
  return parseNumericStrict(input).value;
}

// ISO-4217 common currencies. Expand as new desks come online.
const ISO_4217_ALLOWED = new Set([
  'USD', 'EUR', 'GBP', 'JPY', 'CHF', 'CAD', 'AUD', 'HKD', 'SGD',
  'CNY', 'CNH', 'INR', 'KRW', 'TWD', 'BRL', 'MXN', 'ZAR', 'SEK',
  'NOK', 'DKK', 'NZD', 'PLN', 'TRY', 'ILS', 'THB', 'AED'
]);

/**
 * Legacy-compatible currency normalizer. Uppercases + trims, silently slices
 * to 3 chars. Retained so existing happy-path callers don't break; new code
 * should prefer `tryNormalizeCurrency` which REJECTS non-ISO-4217 strings
 * instead of silently keeping bogus values like "XYZ" in canonical trades.
 */
export function normalizeCurrency(input: string): string {
  return input.trim().toUpperCase().slice(0, 3);
}

/**
 * Strict currency parser. Returns null for empty, non-3-char, or non-ISO-4217
 * inputs so the ingest pipeline can skip the row with a documented reason
 * rather than storing "XYZ" as the currency of a canonical trade.
 */
export function tryNormalizeCurrency(input: string | null | undefined): string | null {
  if (input === null || input === undefined) return null;
  const v = input.trim().toUpperCase();
  if (v.length !== 3) return null;
  if (!ISO_4217_ALLOWED.has(v)) return null;
  return v;
}

export function normalizeCounterparty(input: string): string {
  return input.trim().replace(/\s+/g, ' ');
}

export function counterpartyCompareKey(input: string): string {
  return input
    .toUpperCase()
    .replace(/[.,&]/g, ' ')
    .replace(/\b(LLC|INC|LTD|LP|LLP|CORP|CO|SA|NV|GMBH|PLC|LIMITED)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeAccount(input: string): string {
  return input.trim().toUpperCase().replace(/[-\s]/g, '');
}

export function relativeDiff(a: string | number, b: string | number): number {
  const da = new Decimal(a);
  const db = new Decimal(b);
  if (da.isZero() && db.isZero()) return 0;
  const max = Decimal.max(da.abs(), db.abs());
  if (max.isZero()) return 0;
  return da.sub(db).abs().div(max).toNumber();
}

export function dayDelta(a: string, b: string): number {
  const da = new Date(a);
  const db = new Date(b);
  const ms = Math.abs(da.getTime() - db.getTime());
  return Math.round(ms / 86_400_000);
}
