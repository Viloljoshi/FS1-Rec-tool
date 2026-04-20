import type { WeightSet } from '@/lib/matching/fellegi_sunter';

export interface PipelineAlgorithm {
  id: string;
  name: string;
  detail: string;
  enabled: boolean;
  roadmap?: boolean;
  appliesTo?: string;
  model?: string;
  ai?: boolean;
}

export interface PipelineStage {
  id: string;
  order: number;
  name: string;
  shortDesc: string;
  longDesc: string;
  tone: 'slate' | 'emerald' | 'amber' | 'rose' | 'violet';
  aiDriven: boolean;
  algorithms: PipelineAlgorithm[];
  configKey?: keyof PipelineConfigView;
}

export interface PipelineConfigView {
  bands: { high_min: number; medium_min: number };
  weights: WeightSet;
  tolerances: {
    price_rel_tolerance: number;
    quantity_rel_tolerance: number;
    date_day_delta: number;
  };
  llm_tiebreak_band: 'MEDIUM_ONLY' | 'ALL' | 'NONE';
}

export const PIPELINE_STAGES: PipelineStage[] = [
  {
    id: 'normalize',
    order: 1,
    name: 'Normalize',
    shortDesc: 'Canonicalize every field before anything touches it',
    longDesc:
      'Parses dates in any common format to ISO-8601. Uppercases identifiers. Validates ISIN/CUSIP checksums. Converts numbers through Decimal.js to eliminate float drift. Strips ambient punctuation from counterparty names while preserving the original for display.',
    tone: 'slate',
    aiDriven: false,
    algorithms: [
      { id: 'date_parse', name: 'Multi-format date parser', detail: 'ISO, US MM/DD, UK DD/MM, SWIFT DD-MMM, YYYYMMDD', enabled: true },
      { id: 'decimal_safe', name: 'Decimal.js arithmetic', detail: 'Zero float drift on price × quantity', enabled: true },
      { id: 'id_normalize', name: 'ID upper-case + whitespace strip', detail: 'ISIN/CUSIP/symbol normalization', enabled: true },
      { id: 'enum_map', name: 'Direction enum mapping', detail: 'B/S/Buy/Sell/SLD → BUY/SELL', enabled: true }
    ]
  },
  {
    id: 'hash',
    order: 2,
    name: 'Deterministic Hash',
    shortDesc: 'SHA-256 composite-key fast path',
    longDesc:
      'Composite key = primary identifier (ISIN or CUSIP or symbol), trade_date, quantity, price (rounded to 6dp), direction, account. Both sides hashed. A hit is an auto-HIGH match. Catches ~80% of matches in clean feeds before any expensive similarity work.',
    tone: 'emerald',
    aiDriven: false,
    algorithms: [
      { id: 'sha256', name: 'SHA-256 composite', detail: 'ID ‖ date ‖ qty ‖ price ‖ side ‖ acct', enabled: true }
    ]
  },
  {
    id: 'blocking',
    order: 3,
    name: 'Blocking',
    shortDesc: 'Reduce O(n²) candidate space by 100–1000×',
    longDesc:
      'Groups both sides by (symbol, trade_date, direction). Only pairs inside the same block are considered for probabilistic matching. Without blocking, 1,000 × 100 trades would enumerate 100,000 candidate pairs; with blocking, typically 300–3,000.',
    tone: 'slate',
    aiDriven: false,
    algorithms: [
      { id: 'standard', name: 'Standard Blocking', detail: '(symbol, trade_date, direction)', enabled: true },
      { id: 'loose_date', name: 'Loose-date pass', detail: '±1 day fallback for timing-drift cases', enabled: false, appliesTo: 'TIMING class' },
      { id: 'snm', name: 'Sorted Neighborhood Method', detail: 'Alternative for boundary pairs', enabled: false, roadmap: true },
      { id: 'lsh', name: 'Locality Sensitive Hashing', detail: 'MinHash for multi-million scale', enabled: false, roadmap: true }
    ]
  },
  {
    id: 'similarity',
    order: 4,
    name: 'Field Similarity',
    shortDesc: 'Ensemble of 7 algorithms scoring each field pair',
    longDesc:
      'Per candidate pair, every canonical field is scored independently. Strings use a max-ensemble of Jaro-Winkler, Levenshtein, Token-Set Ratio, Double Metaphone, and (for counterparty) OpenAI embedding cosine. Numeric fields use relative tolerance. Dates use absolute day-delta. IDs are exact-or-null.',
    tone: 'slate',
    aiDriven: true,
    algorithms: [
      { id: 'jw', name: 'Jaro-Winkler distance', detail: 'Primary string metric for counterparty names', enabled: true, appliesTo: 'counterparty' },
      { id: 'lev', name: 'Levenshtein similarity', detail: '1 − edits / max(len) — catches typos in short codes', enabled: true, appliesTo: 'account' },
      { id: 'dm', name: 'Double Metaphone', detail: 'Phonetic equivalence — catches "Goldmann" ≈ "Goldman"', enabled: true, appliesTo: 'counterparty' },
      { id: 'tsr', name: 'Token Set Ratio', detail: 'Word-order-insensitive — "Morgan Stanley Co" ≈ "Co Morgan Stanley"', enabled: true, appliesTo: 'counterparty' },
      { id: 'embed', name: 'Embedding cosine', detail: 'OpenAI text-embedding-3-small, 1536-d, cached in pgvector', enabled: true, appliesTo: 'counterparty', model: 'text-embedding-3-small', ai: true },
      { id: 'numeric_tol', name: 'Relative tolerance', detail: '|a−b| / max(|a|,|b|) with per-field caps', enabled: true, appliesTo: 'quantity (5%), price (1%)' },
      { id: 'date_delta', name: 'Day delta proximity', detail: 'Linear falloff over 3 days', enabled: true, appliesTo: 'trade_date, settlement_date' },
      { id: 'id_exact', name: 'Identifier exact match', detail: 'ISIN/CUSIP — null on either side = neutral', enabled: true, appliesTo: 'isin, cusip' }
    ]
  },
  {
    id: 'fellegi_sunter',
    order: 5,
    name: 'Fellegi-Sunter',
    shortDesc: 'Probabilistic record linkage — textbook',
    longDesc:
      'Per field: m = P(field agrees | true match), u = P(field agrees | non-match). Agreement weight = log₂(m/u). Disagreement weight = log₂((1−m)/(1−u)). Partial agreement blends. Total weight → sigmoid → posterior probability. Bands: HIGH ≥ 0.95, MEDIUM 0.70–0.95, LOW < 0.70. Integrity veto demotes to LOW if quantity disagrees beyond 5% tolerance, regardless of other fields.',
    tone: 'slate',
    aiDriven: false,
    algorithms: [
      { id: 'fs_v1', name: 'Fellegi-Sunter v1 weights', detail: '11 fields, seeded from published record-linkage literature for financial data', enabled: true },
      { id: 'veto_qty', name: 'Integrity veto (quantity)', detail: 'Wrong qty is always LOW, regardless of ID agreement', enabled: true },
      { id: 'veto_price', name: 'Integrity veto (price)', detail: 'Price >1% drift demotes HIGH → MEDIUM', enabled: true }
    ],
    configKey: 'weights'
  },
  {
    id: 'hungarian',
    order: 6,
    name: 'Hungarian Assignment',
    shortDesc: 'Optimal 1:1 assignment within each block',
    longDesc:
      'Within a block, many candidates may compete. The Hungarian algorithm (Munkres) finds the assignment that maximizes total posterior across the block — guaranteeing no trade is matched twice and the best pairs are chosen. Critical for N × N blocks where greedy assignment would double-count.',
    tone: 'slate',
    aiDriven: false,
    algorithms: [
      { id: 'munkres', name: 'Munkres / Hungarian', detail: 'Minimizes (1 − posterior) as cost matrix', enabled: true }
    ]
  },
  {
    id: 'llm_tiebreak',
    order: 7,
    name: 'LLM Tiebreak',
    shortDesc: 'A reasoning model adjudicates MEDIUM-band only',
    longDesc:
      'Only the MEDIUM band (posterior 0.70–0.95) is sent to a reasoning model via a structured-output API. The model sees both canonical records and the field diff, and returns a structured verdict: LIKELY_MATCH / LIKELY_NO_MATCH / UNCERTAIN with a confidence, a one-sentence reason, and the decisive fields. The verdict is displayed — never decisive. The analyst still clicks Accept or Reject.',
    tone: 'violet',
    aiDriven: true,
    algorithms: [
      { id: 'llm_tiebreak', name: 'Structured verdict (LLM)', detail: 'Responses API · JSON validated with Zod · prompt hash logged', enabled: true, ai: true },
      { id: 'zod_validate', name: 'Zod validation', detail: 'Invalid responses trigger deterministic fallback (UNCERTAIN)', enabled: true },
      { id: 'fallback', name: 'Deterministic fallback', detail: 'Never blocks the cycle on AI errors', enabled: true }
    ],
    configKey: 'llm_tiebreak_band'
  }
];

export interface StageMetrics {
  input_pairs: number;
  output_pairs: number;
  matches_produced: number;
  exceptions_produced: number;
}

export function metricsFromCycle(counts: Record<string, number> | null | undefined): Record<string, StageMetrics> {
  const m = counts ?? {};
  const high = m.HIGH ?? 0;
  const medium = m.MEDIUM ?? 0;
  const low = m.LOW ?? 0;
  const matches = m.MATCHES ?? high + medium + low;
  const deterministic = m.DETERMINISTIC ?? 0;
  const unmatchedA = m.UNMATCHED_A ?? 0;
  const unmatchedB = m.UNMATCHED_B ?? 0;

  return {
    normalize: { input_pairs: matches + unmatchedA + unmatchedB, output_pairs: matches + unmatchedA + unmatchedB, matches_produced: 0, exceptions_produced: 0 },
    hash: { input_pairs: matches, output_pairs: matches - deterministic, matches_produced: deterministic, exceptions_produced: 0 },
    blocking: { input_pairs: matches, output_pairs: matches, matches_produced: 0, exceptions_produced: 0 },
    similarity: { input_pairs: matches, output_pairs: matches, matches_produced: 0, exceptions_produced: 0 },
    fellegi_sunter: { input_pairs: matches, output_pairs: matches, matches_produced: high, exceptions_produced: medium + low },
    hungarian: { input_pairs: matches, output_pairs: matches, matches_produced: matches, exceptions_produced: 0 },
    llm_tiebreak: { input_pairs: medium, output_pairs: medium, matches_produced: 0, exceptions_produced: medium }
  };
}
