import { z } from 'zod';
import { jsonCall } from '@/lib/ai/openai';
import { MatchBand, ExceptionClass } from '@/lib/canonical/schema';

export const SearchFilterSchema = z.object({
  band: MatchBand.nullable(),
  exception_class: ExceptionClass.nullable(),
  counterparty_contains: z.string().nullable(),
  symbol: z.string().nullable(),
  amount_min: z.number().nullable(),
  amount_max: z.number().nullable(),
  age_days_min: z.number().int().nullable(),
  age_days_max: z.number().int().nullable(),
  status: z.enum(['OPEN', 'RESOLVED', 'ESCALATED', 'CLOSED']).nullable(),
  sort: z.enum(['newest', 'oldest', 'highest_amount', 'lowest_posterior']).nullable()
});

export const SearchResponseSchema = z.object({
  filters: SearchFilterSchema,
  explanation: z.string(),
  confidence: z.number().min(0).max(1)
});

export type SearchFilter = z.infer<typeof SearchFilterSchema>;
export type SearchResponse = z.infer<typeof SearchResponseSchema>;

const SYSTEM = `You convert natural-language reconciliation queries into structured filter objects for an exception management workspace.

Rules:
1. Return JSON only — no prose, no markdown fences.
2. Schema: {
     filters: {
       band: "HIGH" | "MEDIUM" | "LOW" | null,
       exception_class: "FORMAT_DRIFT" | "ROUNDING" | "WRONG_PRICE" | "TIMING" | "WRONG_QTY" | "MISSING_ONE_SIDE" | "DUPLICATE" | "CPY_ALIAS" | "ID_MISMATCH" | "UNKNOWN" | null,
       counterparty_contains: string | null (used as case-insensitive substring match),
       symbol: string | null (ticker, uppercased),
       amount_min: number | null (USD),
       amount_max: number | null (USD),
       age_days_min: int | null,
       age_days_max: int | null,
       status: "OPEN" | "RESOLVED" | "ESCALATED" | "CLOSED" | null,
       sort: "newest" | "oldest" | "highest_amount" | "lowest_posterior" | null
     },
     explanation: string (one short sentence describing the filters applied),
     confidence: 0..1
   }
3. Use null for any filter not mentioned.
4. Parse currency freely: "$1M" → 1000000, "500k" → 500000, "1.5 million" → 1500000.
5. Recognize counterparty abbreviations as substrings: "JPM" stays "JPM"; "Goldman" stays "Goldman".
6. "recent" → age_days_max: 7; "this week" → 7; "today" → age_days_max: 1; "old" → age_days_min: 7.
7. "wrong qty" / "quantity breaks" → exception_class: "WRONG_QTY".
8. "missing" / "one-sided" → exception_class: "MISSING_ONE_SIDE".
9. "alias" / "counterparty name" → exception_class: "CPY_ALIAS".
10. Default to status: "OPEN" when unspecified. Default sort: "newest".`;

export async function parseSearchQuery(args: {
  query: string;
  actor: string | null;
}): Promise<SearchResponse> {
  const fallback: SearchResponse = {
    filters: {
      band: null,
      exception_class: null,
      counterparty_contains: null,
      symbol: null,
      amount_min: null,
      amount_max: null,
      age_days_min: null,
      age_days_max: null,
      status: 'OPEN',
      sort: 'newest'
    },
    explanation: 'Unable to parse query — showing all open exceptions.',
    confidence: 0
  };

  return jsonCall({
    call_type: 'SEARCH_PARSE',
    system: SYSTEM,
    user: `Query: ${args.query}`,
    schema: SearchResponseSchema,
    fallback,
    actor: args.actor
  });
}
