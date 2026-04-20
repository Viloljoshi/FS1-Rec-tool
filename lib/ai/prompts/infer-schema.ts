import { jsonCall } from '@/lib/ai/openai';
import {
  InferSchemaResponseSchema,
  CANONICAL_FIELDS,
  type InferSchemaResponse
} from '@/lib/canonical/schema';

const SYSTEM = `You are a senior integration engineer onboarding a new securities trading data feed into a canonical trade schema. You must propose a mapping from source fields to the canonical fields below.

Canonical fields (with semantics):
- trade_date: the date the trade was executed
- settlement_date: the date the trade settles (usually T+1)
- direction: BUY or SELL
- symbol: the ticker symbol
- isin: 12-character ISIN
- cusip: 9-character CUSIP
- quantity: number of units
- price: per-unit price
- currency: 3-letter ISO 4217
- counterparty: the trading counterparty name
- account: the client or internal account identifier
- source_ref: the source-system identifier for the trade

Rules:
1. Return JSON only, matching the schema exactly.
2. Every source field must be emitted exactly once.
3. Use null for canonical_field when there is no good match.
4. confidence in [0,1], reasoning is one short sentence.
5. Never invent fields not present in the sample.`;

export async function inferSchema(args: {
  headers: string[];
  samples: Record<string, string>[];
  actor: string | null;
}): Promise<InferSchemaResponse> {
  const user = `Source headers:\n${args.headers.join(', ')}\n\nSample rows (first 5):\n${args.samples
    .slice(0, 5)
    .map((r, i) => `  Row ${i + 1}: ${JSON.stringify(r)}`)
    .join('\n')}\n\nRespond as JSON: { "mappings": [ { "source_field": string, "canonical_field": one of ${CANONICAL_FIELDS.join(
    ' | '
  )} or null, "confidence": number, "reasoning": string } ] }`;

  const fallback: InferSchemaResponse = {
    mappings: args.headers.map((h) => ({
      source_field: h,
      canonical_field: null,
      confidence: 0,
      reasoning: 'fallback: ai call failed'
    }))
  };

  return jsonCall({
    call_type: 'INFER_SCHEMA',
    system: SYSTEM,
    user,
    schema: InferSchemaResponseSchema,
    fallback,
    actor: args.actor
  });
}
