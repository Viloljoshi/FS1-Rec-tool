/**
 * Per-cycle algorithm usage telemetry. Threaded through the engine so every
 * algorithm that fires bumps a counter. At cycle end, the counts are persisted
 * on matching_cycles.counts.algo_usage so the UI can show exactly which
 * algorithms contributed to this cycle's decisions.
 */

export type AlgoKey =
  | 'normalize.date_parse'
  | 'normalize.decimal'
  | 'normalize.id_normalize'
  | 'normalize.enum_map'
  | 'hash.composite_hit'
  | 'hash.composite_miss'
  | 'hash.skipped'
  | 'blocking.standard'
  | 'blocking.loose_date'
  | 'blocking.skipped'
  | 'hungarian.skipped'
  | 'similarity.jaro_winkler'
  | 'similarity.levenshtein'
  | 'similarity.double_metaphone'
  | 'similarity.token_set'
  | 'similarity.embedding_cosine'
  | 'similarity.numeric_tolerance'
  | 'similarity.date_delta'
  | 'similarity.id_exact'
  | 'fellegi_sunter.score'
  | 'fellegi_sunter.veto_qty'
  | 'fellegi_sunter.veto_price'
  | 'hungarian.block_solved'
  | 'hungarian.assigned'
  | 'llm_tiebreak.invocation'
  | 'llm_tiebreak.fallback'
  | 'triage.templated'
  | 'triage.ai_fallback';

export class AlgoTelemetry {
  private counts = new Map<AlgoKey, number>();

  tick(key: AlgoKey, n = 1): void {
    this.counts.set(key, (this.counts.get(key) ?? 0) + n);
  }

  get(key: AlgoKey): number {
    return this.counts.get(key) ?? 0;
  }

  toJSON(): Record<string, number> {
    return Object.fromEntries(this.counts);
  }

  merge(other: AlgoTelemetry): void {
    for (const [k, v] of other.counts.entries()) {
      this.tick(k, v);
    }
  }
}
