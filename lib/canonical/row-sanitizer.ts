import { z } from 'zod';

/**
 * Coerces an arbitrary record (from papaparse, XLSX, or direct API callers)
 * into a Record<string, string> suitable for the canonicalizer.
 *
 * - Drops `__parsed_extra` (papaparse's orphaned-fields-from-ragged-rows bucket)
 * - Stringifies numbers, booleans, dates
 * - Joins array values with commas (graceful degradation for unexpected shapes)
 * - Empties nulls / undefineds
 */
export function sanitizeRow(r: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(r)) {
    if (k === '__parsed_extra') continue;
    if (v === null || v === undefined) {
      out[k] = '';
    } else if (Array.isArray(v)) {
      out[k] = v.map((x) => (x === null || x === undefined ? '' : String(x))).join(',');
    } else if (typeof v === 'object') {
      out[k] = JSON.stringify(v);
    } else {
      out[k] = String(v);
    }
  }
  return out;
}

export function sanitizeRows(rows: Array<Record<string, unknown>>): Array<Record<string, string>> {
  return rows.map(sanitizeRow);
}

/**
 * Zod schema that accepts ANY record shape and coerces it to
 * Record<string, string> at validation time. Use this in API route schemas
 * instead of `z.record(z.string(), z.string())` to stay robust against
 * papaparse / XLSX / third-party-caller quirks.
 */
export const SanitizedRowSchema = z
  .record(z.string(), z.unknown())
  .transform((r) => sanitizeRow(r as Record<string, unknown>));
