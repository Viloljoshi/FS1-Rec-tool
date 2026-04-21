import { normalizeTrade, type NormalizedTrade, type RawCanonicalTrade } from './normalize';
import { compositeHash } from './hash';
import { blockBoth, type BlockingField, DEFAULT_BLOCKING_KEYS } from './blocking';
import { scoreFields, type FieldScores, type EngineTolerances } from './similarity';
import { computePosterior, DEFAULT_WEIGHTS, DEFAULT_BANDS, type WeightSet, type BandThresholds } from './fellegi_sunter';
import { optimalAssign, type Candidate } from './hungarian';
import { AlgoTelemetry } from './telemetry';
import type { MatchExplanation, LLMVerdict, MatchType, MatchBand } from '@/lib/canonical/schema';

export type PipelineStageId =
  | 'normalize'
  | 'hash'
  | 'blocking'
  | 'similarity'
  | 'fellegi_sunter'
  | 'hungarian'
  | 'llm_tiebreak';

export const DEFAULT_ENABLED_STAGES: PipelineStageId[] = [
  'normalize',
  'hash',
  'blocking',
  'similarity',
  'fellegi_sunter',
  'hungarian',
  'llm_tiebreak'
];

export type SupportedMatchType = '1:1' | '1:N' | 'N:1' | 'N:M';

/**
 * Integrity veto: quantity or price disagreement beyond tolerance is a
 * material break regardless of how strongly other fields (IDs) agree.
 * Demotes the probabilistic band to reflect ops reality.
 */
function applyIntegrityVeto(raw: FieldScores, band: MatchBand): MatchBand {
  if (raw.quantity < 0.5 && band === 'HIGH') return 'LOW';
  if (raw.quantity < 0.1) return 'LOW';
  if (raw.price < 0.5 && band === 'HIGH') return 'MEDIUM';
  return band;
}

export interface EngineInput {
  side_a: RawCanonicalTrade[];
  side_b: RawCanonicalTrade[];
  weights?: WeightSet;
  embeddings?: Map<string, number[]>;
  tolerances?: EngineTolerances;
  bands?: BandThresholds;
  blocking_keys?: BlockingField[];
  /**
   * Which stages to run. Stages listed here are executed in the fixed order;
   * stages omitted are skipped. `normalize` + `fellegi_sunter` are always
   * executed (they are not truly optional — the whole engine assumes
   * normalized inputs and every match needs a posterior).
   */
  enabled_stages?: PipelineStageId[];
  /**
   * Match types this pipeline accepts. The engine currently only emits 1:1
   * assignments; if `1:N`/`N:M` are configured, the engine still runs 1:1
   * but the field is stamped on each result so downstream consumers (UI,
   * exception classifier) know the config intent. Full 1:N support is a
   * separate workstream in Hungarian — tracked in ADR-012.
   */
  match_types?: SupportedMatchType[];
}

export interface CandidateResult {
  trade_a_id: string;
  trade_b_id: string;
  explanation: MatchExplanation;
  raw_scores: FieldScores;
}

export interface EngineOutput {
  matches: CandidateResult[];
  unmatched_a: string[];
  unmatched_b: string[];
  counts: Record<MatchBand | 'UNMATCHED_A' | 'UNMATCHED_B' | 'DETERMINISTIC', number>;
  telemetry: AlgoTelemetry;
}

export function runEngine(input: EngineInput): EngineOutput {
  const weights = input.weights ?? DEFAULT_WEIGHTS;
  const tolerances = input.tolerances;
  const bands = input.bands ?? DEFAULT_BANDS;
  const blockingKeys = input.blocking_keys ?? DEFAULT_BLOCKING_KEYS;
  const enabledSet = new Set<PipelineStageId>(input.enabled_stages ?? DEFAULT_ENABLED_STAGES);
  // normalize + fellegi_sunter are load-bearing; force them on even if caller omitted them.
  enabledSet.add('normalize');
  enabledSet.add('fellegi_sunter');
  const hashEnabled = enabledSet.has('hash');
  const blockingEnabled = enabledSet.has('blocking');
  const hungarianEnabled = enabledSet.has('hungarian');
  const primaryMatchType: MatchType = (input.match_types?.[0] ?? '1:1') as MatchType;
  const telemetry = new AlgoTelemetry();
  // Sort inputs by trade_id up front so the entire engine is deterministic.
  // Two cycles with identical inputs must produce identical output — without
  // this, Postgres row-order fluctuations leak into block iteration, and
  // Hungarian tie-breaks flip between runs.
  const sortedA = [...input.side_a].sort((a, b) => a.trade_id.localeCompare(b.trade_id));
  const sortedB = [...input.side_b].sort((a, b) => a.trade_id.localeCompare(b.trade_id));
  const normA = sortedA.map((t) => {
    telemetry.tick('normalize.date_parse', 2);
    telemetry.tick('normalize.decimal', 2);
    telemetry.tick('normalize.id_normalize', 2);
    telemetry.tick('normalize.enum_map');
    return normalizeTrade(t);
  });
  const normB = sortedB.map((t) => {
    telemetry.tick('normalize.date_parse', 2);
    telemetry.tick('normalize.decimal', 2);
    telemetry.tick('normalize.id_normalize', 2);
    telemetry.tick('normalize.enum_map');
    return normalizeTrade(t);
  });

  // Deterministic pass (stage: hash)
  const consumedA = new Set<string>();
  const consumedB = new Set<string>();
  const matches: CandidateResult[] = [];
  let deterministic = 0;

  if (hashEnabled) {
    const hashA = new Map<string, NormalizedTrade>();
    const hashB = new Map<string, NormalizedTrade>();
    for (const t of normA) hashA.set(compositeHash(t), t);
    for (const t of normB) hashB.set(compositeHash(t), t);

    for (const [h, a] of hashA) {
      const b = hashB.get(h);
      if (!b) {
        telemetry.tick('hash.composite_miss');
        continue;
      }
      telemetry.tick('hash.composite_hit');
      const raw_scores = scoreFields(a, b, null, null, telemetry, tolerances);
      const pr = computePosterior(raw_scores, weights, bands);
      telemetry.tick('fellegi_sunter.score');
      matches.push({
        trade_a_id: a.trade_id,
        trade_b_id: b.trade_id,
        raw_scores,
        explanation: {
          posterior: Math.max(pr.posterior, 0.99),
          band: 'HIGH',
          match_type: primaryMatchType,
          field_scores: pr.field_scores,
          deterministic_hit: true,
          llm_verdict: null
        }
      });
      consumedA.add(a.trade_id);
      consumedB.add(b.trade_id);
      deterministic += 1;
    }
  } else {
    telemetry.tick('hash.skipped');
  }

  // Probabilistic pass (stage: blocking + similarity + hungarian)
  const remainingA = normA.filter((t) => !consumedA.has(t.trade_id));
  const remainingB = normB.filter((t) => !consumedB.has(t.trade_id));
  const blocks = blockingEnabled
    ? blockBoth(remainingA, remainingB, blockingKeys)
    : new Map([['__all__', { a: remainingA, b: remainingB }]]);
  telemetry.tick(blockingEnabled ? 'blocking.standard' : 'blocking.skipped', blocks.size);

  for (const block of blocks.values()) {
    if (block.a.length === 0 || block.b.length === 0) continue;
    const candidates: Candidate[] = [];
    const scores: FieldScores[] = [];
    const indexToPair = new Map<string, FieldScores>();

    for (let i = 0; i < block.a.length; i++) {
      for (let j = 0; j < block.b.length; j++) {
        const a = block.a[i]!;
        const b = block.b[j]!;
        const embA = input.embeddings?.get(a.counterparty);
        const embB = input.embeddings?.get(b.counterparty);
        const raw = scoreFields(a, b, embA ?? null, embB ?? null, telemetry, tolerances);
        const pr = computePosterior(raw, weights, bands);
        telemetry.tick('fellegi_sunter.score');
        candidates.push({ a_index: i, b_index: j, posterior: pr.posterior });
        scores.push(raw);
        indexToPair.set(`${i}|${j}`, raw);
      }
    }

    // Stage: hungarian. If disabled, greedily take each pair whose posterior
    // clears 0.5 threshold (no one-to-one guarantee). Useful for N:M regimes
    // and as an escape hatch when Hungarian's cost is prohibitive.
    let assignments: { a_index: number; b_index: number }[];
    if (hungarianEnabled) {
      assignments = optimalAssign(block.a.length, block.b.length, candidates, 0.5);
      telemetry.tick('hungarian.block_solved');
      telemetry.tick('hungarian.assigned', assignments.length);
    } else {
      assignments = candidates
        .filter((c) => c.posterior >= 0.5)
        .map(({ a_index, b_index }) => ({ a_index, b_index }));
      telemetry.tick('hungarian.skipped');
    }

    for (const asn of assignments) {
      const a = block.a[asn.a_index]!;
      const b = block.b[asn.b_index]!;
      const raw_scores = indexToPair.get(`${asn.a_index}|${asn.b_index}`)!;
      const pr = computePosterior(raw_scores, weights, bands);
      const band = applyIntegrityVeto(raw_scores, pr.band);
      if (band !== pr.band && raw_scores.quantity < 0.5) telemetry.tick('fellegi_sunter.veto_qty');
      if (band !== pr.band && raw_scores.price < 0.5 && raw_scores.quantity >= 0.5) telemetry.tick('fellegi_sunter.veto_price');
      matches.push({
        trade_a_id: a.trade_id,
        trade_b_id: b.trade_id,
        raw_scores,
        explanation: {
          posterior: pr.posterior,
          band,
          match_type: primaryMatchType,
          field_scores: pr.field_scores,
          deterministic_hit: false,
          llm_verdict: null
        }
      });
      consumedA.add(a.trade_id);
      consumedB.add(b.trade_id);
    }
  }

  const unmatched_a = normA.filter((t) => !consumedA.has(t.trade_id)).map((t) => t.trade_id);
  const unmatched_b = normB.filter((t) => !consumedB.has(t.trade_id)).map((t) => t.trade_id);

  const counts = {
    HIGH: matches.filter((m) => m.explanation.band === 'HIGH').length,
    MEDIUM: matches.filter((m) => m.explanation.band === 'MEDIUM').length,
    LOW: matches.filter((m) => m.explanation.band === 'LOW').length,
    UNMATCHED_A: unmatched_a.length,
    UNMATCHED_B: unmatched_b.length,
    DETERMINISTIC: deterministic
  };

  return { matches, unmatched_a, unmatched_b, counts, telemetry };
}

/**
 * Attaches an LLM verdict to MEDIUM-band matches.
 */
export function attachLLMVerdicts(
  matches: CandidateResult[],
  verdicts: Map<string, LLMVerdict>
): CandidateResult[] {
  return matches.map((m) => {
    if (m.explanation.band !== 'MEDIUM') return m;
    const v = verdicts.get(`${m.trade_a_id}|${m.trade_b_id}`);
    if (!v) return m;
    return {
      ...m,
      explanation: { ...m.explanation, llm_verdict: v }
    };
  });
}
