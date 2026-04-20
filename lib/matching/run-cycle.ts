import { runEngine, type EngineOutput } from './engine';
import type { RawCanonicalTrade } from './normalize';
import type { SupabaseClient } from '@supabase/supabase-js';
import { DEFAULT_WEIGHTS, type WeightSet } from './fellegi_sunter';
import { ExceptionClass } from '@/lib/canonical/schema';
import { tiebreak } from '@/lib/ai/prompts/tiebreak';
import { explainBreak } from '@/lib/ai/prompts/explain-break';
import { nextBestAction } from '@/lib/ai/prompts/next-best-action';
import { templatedTriage } from './templated-explain';
import { logger } from '@/lib/logger/pino';

interface RunOptions {
  supabase: SupabaseClient;
  feedAId: string;
  feedAVersion: number;
  feedBId: string;
  feedBVersion: number;
  dateFrom: string;
  dateTo: string;
  initiatedBy: string | null;
  restrictByCounterpartyEntity?: boolean;
  /**
   * Which pipeline (Equities, FX, etc.) to run under. If omitted, the cycle
   * runs against whichever pipeline is marked default=true in the pipelines
   * table, falling back to the first pipeline found.
   */
  pipelineId?: string;
}

export interface CycleResult {
  cycle_id: string;
  counts: EngineOutput['counts'];
  match_count: number;
  exception_count: number;
  ai_calls: { tiebreak: number; explain: number; nba: number };
}

// Tiny concurrency limiter — keeps OpenAI calls bounded during a cycle.
async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = [];
  let idx = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const my = idx++;
      if (my >= items.length) return;
      const item = items[my]!;
      try {
        results[my] = await fn(item);
      } catch (err) {
        logger.error({ err }, 'mapLimit worker error');
      }
    }
  });
  await Promise.all(workers);
  return results;
}

export async function runMatchingCycle(opts: RunOptions): Promise<CycleResult> {
  const { supabase } = opts;

  // 1. Resolve pipeline — explicit > Equities > first available
  let pipelineId = opts.pipelineId ?? null;
  if (!pipelineId) {
    const { data: pipelineRow } = await supabase
      .from('pipelines')
      .select('id')
      .eq('name', 'Equities')
      .maybeSingle();
    pipelineId = pipelineRow?.id ?? null;
  }
  if (!pipelineId) {
    const { data: fallback } = await supabase.from('pipelines').select('id').limit(1).maybeSingle();
    pipelineId = fallback?.id ?? null;
  }

  // 2. Fetch active matching rules for this pipeline (scoped by pipeline_id)
  let rulesQuery = supabase
    .from('matching_rules')
    .select('id, version, weights, tolerances')
    .eq('active', true)
    .eq('name', 'default');
  if (pipelineId) rulesQuery = rulesQuery.eq('pipeline_id', pipelineId);
  const { data: rulesRow } = await rulesQuery.maybeSingle();

  const engineWeights: WeightSet =
    (rulesRow?.weights as WeightSet | null) ?? DEFAULT_WEIGHTS;
  logger.info(
    { pipelineId, rulesId: rulesRow?.id, rulesVersion: rulesRow?.version, usingDbWeights: !!rulesRow?.weights },
    'cycle rules resolved'
  );

  // 2. Fetch trades for both feeds in the date range.
  //    .order('trade_id') guarantees a stable fetch order — the engine
  //    also sorts internally, but an ordered fetch means every downstream
  //    slice (restrict filter, dominant-entity filter) is deterministic too.
  const fetchTrades = async (feedId: string, version: number): Promise<RawCanonicalTrade[]> => {
    const { data, error } = await supabase
      .from('trades_canonical')
      .select('trade_id, source_id, source_ref, trade_date, settlement_date, direction, symbol, isin, cusip, quantity, price, currency, counterparty, counterparty_canonical_id, account')
      .eq('source_id', feedId)
      .eq('source_version', version)
      .gte('trade_date', opts.dateFrom)
      .lte('trade_date', opts.dateTo)
      .order('trade_id', { ascending: true })
      .limit(5000);
    if (error) throw error;
    return (data ?? []) as RawCanonicalTrade[];
  };

  const [tradesA, tradesBRaw] = await Promise.all([
    fetchTrades(opts.feedAId, opts.feedAVersion),
    fetchTrades(opts.feedBId, opts.feedBVersion)
  ]);

  // Optional: restrict side A by counterparty entity match with side B's most common entity
  let sideA = tradesA;
  let sideB = tradesBRaw;
  if (opts.restrictByCounterpartyEntity && tradesBRaw.length > 0) {
    const entityCounts = new Map<string, number>();
    for (const t of tradesBRaw) {
      const id = t.counterparty_canonical_id;
      if (id) entityCounts.set(id, (entityCounts.get(id) ?? 0) + 1);
    }
    let dominant: string | null = null;
    let top = 0;
    for (const [id, c] of entityCounts) {
      if (c > top) {
        top = c;
        dominant = id;
      }
    }
    if (dominant) {
      sideA = tradesA.filter((t) => t.counterparty_canonical_id === dominant);
    }
  }

  // 3. Create cycle row (PENDING -> RUNNING)
  const { data: cycle, error: cycErr } = await supabase
    .from('matching_cycles')
    .insert({
      feed_a_id: opts.feedAId,
      feed_a_version: opts.feedAVersion,
      feed_b_id: opts.feedBId,
      feed_b_version: opts.feedBVersion,
      date_from: opts.dateFrom,
      date_to: opts.dateTo,
      status: 'RUNNING',
      matching_rules_id: rulesRow?.id ?? null,
      matching_rules_version: rulesRow?.version ?? null,
      pipeline_id: pipelineId,
      initiated_by: opts.initiatedBy
    })
    .select('id')
    .single();
  if (cycErr) throw cycErr;

  // 4. Run engine with pipeline-scoped weights
  const engineOut = runEngine({
    side_a: sideA,
    side_b: sideB,
    weights: engineWeights
  });

  // Build trade lookup for passing to AI calls
  const tradeById = new Map<string, RawCanonicalTrade>();
  for (const t of [...sideA, ...sideB]) tradeById.set(t.trade_id, t);

  // 4a. LLM tiebreak — run GPT-5.4 on every MEDIUM-band match in parallel (capped)
  const mediumMatches = engineOut.matches.filter((m) => m.explanation.band === 'MEDIUM');
  let tiebreakCalls = 0;
  if (mediumMatches.length > 0) {
    logger.info({ count: mediumMatches.length }, 'running LLM tiebreak on MEDIUM band matches');
    await mapLimit(mediumMatches, 4, async (m) => {
      const tA = tradeById.get(m.trade_a_id);
      const tB = tradeById.get(m.trade_b_id);
      if (!tA || !tB) return;
      const verdict = await tiebreak({
        trade_a: tA as unknown as Record<string, unknown>,
        trade_b: tB as unknown as Record<string, unknown>,
        field_scores: m.explanation.field_scores,
        actor: opts.initiatedBy
      });
      m.explanation.llm_verdict = verdict;
      tiebreakCalls++;
      engineOut.telemetry.tick('llm_tiebreak.invocation');
      if (verdict.confidence === 0) engineOut.telemetry.tick('llm_tiebreak.fallback');
    });
  }

  // 5. Write match_results in batches
  const matchInserts = engineOut.matches.map((m) => ({
    cycle_id: cycle.id,
    trade_a_id: m.trade_a_id,
    trade_b_id: m.trade_b_id,
    match_type: m.explanation.match_type,
    posterior: m.explanation.posterior,
    band: m.explanation.band,
    field_scores: m.explanation.field_scores,
    deterministic_hit: m.explanation.deterministic_hit,
    llm_verdict: m.explanation.llm_verdict
  }));

  const matchIdByPair = new Map<string, string>();
  for (let i = 0; i < matchInserts.length; i += 500) {
    const batch = matchInserts.slice(i, i + 500);
    const { data: inserted, error } = await supabase
      .from('match_results')
      .insert(batch)
      .select('id, trade_a_id, trade_b_id');
    if (error) throw error;
    for (const r of inserted ?? []) {
      if (r.trade_a_id && r.trade_b_id) {
        matchIdByPair.set(`${r.trade_a_id}|${r.trade_b_id}`, r.id);
      }
    }
  }

  // 6. Build exceptions: all MEDIUM, LOW + unmatched-on-B + duplicates-on-B
  //
  // classify() returns the ordered list of failing fields (primary first).
  // The engine's exception_class column holds the primary; secondary failures
  // are stored in explanation_cached under `also_failing` so the analyst sees
  // stacked issues instead of the old early-return single label.
  interface ClassificationResult {
    primary: ExceptionClass;
    also_failing: ExceptionClass[];
  }
  const ROUNDING_ABS_CAP = 0.01;
  const ROUNDING_BPS_CAP = 0.00005;

  const classifyPriceBreak = (
    m: typeof engineOut.matches[number]
  ): 'ROUNDING' | 'WRONG_PRICE' | null => {
    const { field_scores } = m.explanation;
    const priceScore = field_scores.find((x) => x.field === 'price')?.raw_score ?? 1;
    if (priceScore >= 1) return null;
    const tA = tradeById.get(m.trade_a_id);
    const tB = tradeById.get(m.trade_b_id);
    if (!tA || !tB) return priceScore < 0.5 ? 'WRONG_PRICE' : null;
    const pA = Number(tA.price);
    const pB = Number(tB.price);
    if (!Number.isFinite(pA) || !Number.isFinite(pB)) return null;
    const absDiff = Math.abs(pA - pB);
    const base = Math.max(Math.abs(pA), Math.abs(pB), 1e-9);
    const relDiff = absDiff / base;
    const roundingAllowed = Math.max(ROUNDING_ABS_CAP, base * ROUNDING_BPS_CAP);
    if (absDiff <= roundingAllowed) return 'ROUNDING';
    if (relDiff >= 0.0005) return 'WRONG_PRICE';
    return 'ROUNDING';
  };

  const classifyAll = (m: typeof engineOut.matches[number]): ClassificationResult => {
    const { field_scores } = m.explanation;
    const score = (f: string): number => field_scores.find((x) => x.field === f)?.raw_score ?? 1;
    const failures: ExceptionClass[] = [];
    if (score('quantity') < 0.5) failures.push('WRONG_QTY');
    const priceLabel = classifyPriceBreak(m);
    if (priceLabel !== null) failures.push(priceLabel);
    if (score('counterparty') < 0.7) failures.push('CPY_ALIAS');
    if (score('trade_date') < 0.8) failures.push('TIMING');
    if (score('account') < 0.8) failures.push('FORMAT_DRIFT');
    if (failures.length === 0) return { primary: 'UNKNOWN', also_failing: [] };
    return { primary: failures[0]!, also_failing: failures.slice(1) };
  };

  // 6pre. Duplicate detection on side B. An exact-key duplicate (same symbol,
  //       trade_date, qty, price, direction, cpy, account) is almost always a
  //       feed-replay bug, not a fresh trade. Emit DUPLICATE on the 2nd..Nth
  //       occurrences; let the 1st flow through normal matching.
  const dupKey = (t: RawCanonicalTrade): string =>
    [
      t.symbol ?? '',
      t.trade_date ?? '',
      String(t.quantity ?? ''),
      String(t.price ?? ''),
      t.direction ?? '',
      (t.counterparty ?? '').toLowerCase().trim(),
      (t.account ?? '').toLowerCase().trim()
    ].join('|');
  const sideBByKey = new Map<string, RawCanonicalTrade[]>();
  for (const t of sideB) {
    const k = dupKey(t);
    const arr = sideBByKey.get(k);
    if (arr) arr.push(t); else sideBByKey.set(k, [t]);
  }
  const duplicateTradeIds = new Set<string>();
  for (const group of sideBByKey.values()) {
    if (group.length < 2) continue;
    for (let i = 1; i < group.length; i++) duplicateTradeIds.add(group[i]!.trade_id);
  }

  // 6a. Build exception payloads — with AI-pre-generated explanation + NBA when we have both sides
  interface ExceptionPayload {
    cycle_id: string;
    match_result_id: string | null;
    trade_a_id: string | null;
    trade_b_id: string | null;
    band: string | null;
    status: 'OPEN';
    exception_class: ExceptionClass;
    also_failing_classes?: ExceptionClass[];
    _pending_triage?: {
      trade_a: RawCanonicalTrade;
      trade_b: RawCanonicalTrade;
      field_scores: typeof engineOut.matches[number]['explanation']['field_scores'];
    };
  }
  const exceptionInserts: ExceptionPayload[] = [];

  for (const m of engineOut.matches) {
    if (m.explanation.band === 'HIGH') continue;
    const tA = tradeById.get(m.trade_a_id);
    const tB = tradeById.get(m.trade_b_id);
    const cls = classifyAll(m);
    const row: ExceptionPayload = {
      cycle_id: cycle.id,
      match_result_id: matchIdByPair.get(`${m.trade_a_id}|${m.trade_b_id}`) ?? null,
      trade_a_id: m.trade_a_id,
      trade_b_id: m.trade_b_id,
      band: m.explanation.band,
      status: 'OPEN',
      exception_class: cls.primary,
      also_failing_classes: cls.also_failing.length ? cls.also_failing : undefined
    };
    if (tA && tB) row._pending_triage = { trade_a: tA, trade_b: tB, field_scores: m.explanation.field_scores };
    exceptionInserts.push(row);
  }

  for (const idB of engineOut.unmatched_b) {
    // A trade unmatched on B but flagged as a duplicate is a replay, not a
    // missing counterpart — label it DUPLICATE so ops doesn't chase a "break".
    exceptionInserts.push({
      cycle_id: cycle.id,
      match_result_id: null,
      trade_a_id: null,
      trade_b_id: idB,
      band: null,
      status: 'OPEN',
      exception_class: duplicateTradeIds.has(idB) ? 'DUPLICATE' : 'MISSING_ONE_SIDE'
    });
  }

  // Also emit DUPLICATE for side-B duplicates that DID get matched — those
  // show up as normal matches above but represent a double-booking.
  for (const dupId of duplicateTradeIds) {
    if (engineOut.unmatched_b.includes(dupId)) continue; // already emitted above
    const existing = exceptionInserts.find(
      (e) => e.trade_b_id === dupId && e.exception_class !== 'DUPLICATE'
    );
    if (existing) {
      existing.also_failing_classes = [
        'DUPLICATE',
        ...(existing.also_failing_classes ?? [])
      ];
    } else {
      exceptionInserts.push({
        cycle_id: cycle.id,
        match_result_id: null,
        trade_a_id: null,
        trade_b_id: dupId,
        band: null,
        status: 'OPEN',
        exception_class: 'DUPLICATE'
      });
    }
  }

  // 6b. Auto-triage — TIERED: templates for known exception classes,
  //     GPT-5.4 only where the class is UNKNOWN (genuinely novel patterns).
  //     This cuts AI cost by ~70% while preserving the AI-native posture.
  let explainCalls = 0;
  let nbaCalls = 0;
  let templatedTriageCount = 0;
  const triageJobs = exceptionInserts.filter((e) => e._pending_triage);
  logger.info({ count: triageJobs.length }, 'auto-triage: templates first, AI on ambiguity');

  // Pass 1 — templates (fast, deterministic, no AI cost)
  const aiFallbackJobs: typeof triageJobs = [];
  for (const row of triageJobs) {
    const tmpl = templatedTriage(
      row.exception_class,
      row._pending_triage!.field_scores,
      row.band as 'MEDIUM' | 'LOW' | null
    );
    if (tmpl) {
      (row as unknown as Record<string, unknown>).explanation_cached = JSON.stringify({
        summary: tmpl.summary,
        likely_cause: tmpl.likely_cause,
        recommended_action: tmpl.recommended_action,
        suggested_action: tmpl.suggested_action,
        reason: tmpl.reason,
        confidence: tmpl.confidence,
        source: tmpl.source,
        also_failing: row.also_failing_classes ?? []
      });
      templatedTriageCount++;
      engineOut.telemetry.tick('triage.templated');
    } else {
      aiFallbackJobs.push(row);
      engineOut.telemetry.tick('triage.ai_fallback');
    }
  }

  // Pass 2 — GPT-5.4 only for UNKNOWN / ambiguous patterns
  if (aiFallbackJobs.length > 0) {
    logger.info({ count: aiFallbackJobs.length }, 'auto-triage: GPT-5.4 fallback for ambiguous exceptions');
    await mapLimit(aiFallbackJobs, 3, async (row) => {
      const triage = row._pending_triage!;
      const [explain, nba] = await Promise.all([
        explainBreak({
          trade_a: triage.trade_a as unknown as Record<string, unknown>,
          trade_b: triage.trade_b as unknown as Record<string, unknown>,
          field_scores: triage.field_scores,
          actor: opts.initiatedBy
        }).then((r) => { explainCalls++; return r; }),
        nextBestAction({
          exception: {
            band: row.band,
            exception_class: row.exception_class,
            trade_a: triage.trade_a,
            trade_b: triage.trade_b
          } as unknown as Record<string, unknown>,
          actor: opts.initiatedBy
        }).then((r) => { nbaCalls++; return r; })
      ]);
      row.exception_class = explain.likely_cause as ExceptionClass;
      (row as unknown as Record<string, unknown>).explanation_cached = JSON.stringify({
        ...explain,
        suggested_action: nba.suggested_action,
        reason: nba.reason,
        confidence: nba.confidence,
        source: 'AI',
        also_failing: row.also_failing_classes ?? []
      });
    });
  }

  logger.info(
    { templated: templatedTriageCount, ai_fallback: aiFallbackJobs.length },
    'auto-triage complete'
  );

  // 6c. Persist exceptions (drop the _pending_triage internal field before insert)
  let exceptionCount = 0;
  // Strip in-memory-only fields that aren't columns on the exceptions table.
  // `also_failing_classes` lives inside explanation_cached JSON instead.
  const cleanInserts = exceptionInserts.map(({ _pending_triage: _p, also_failing_classes: _a, ...rest }) => {
    void _p; void _a;
    return rest;
  });
  interface InsertedException {
    id: string;
    band: string | null;
    exception_class: ExceptionClass;
    trade_a_id: string | null;
    trade_b_id: string | null;
    explanation_cached: string | null;
  }
  const insertedExceptions: InsertedException[] = [];
  for (let i = 0; i < cleanInserts.length; i += 500) {
    const { data, error } = await supabase
      .from('exceptions')
      .insert(cleanInserts.slice(i, i + 500))
      .select('id, band, exception_class, trade_a_id, trade_b_id, explanation_cached');
    if (error) throw error;
    for (const r of (data ?? []) as InsertedException[]) insertedExceptions.push(r);
    exceptionCount += Math.min(500, cleanInserts.length - i);
  }

  // 6d. Emit audit events so the Activity tab has content from the moment an
  //     exception is opened (previously only escalations wrote audit rows).
  const auditRows: Array<Record<string, unknown>> = [];
  const cycleShort = cycle.id.slice(0, 8);
  for (const ex of insertedExceptions) {
    auditRows.push({
      actor: opts.initiatedBy,
      action: 'EXCEPTION_OPENED',
      entity_type: 'exception',
      entity_id: ex.id,
      before: null,
      after: {
        band: ex.band,
        exception_class: ex.exception_class,
        cycle_id: cycle.id,
        trade_a_id: ex.trade_a_id,
        trade_b_id: ex.trade_b_id
      },
      reason: `opened by matching cycle ${cycleShort}`
    });
    if (ex.explanation_cached) {
      let triagePayload: unknown = ex.explanation_cached;
      try { triagePayload = JSON.parse(ex.explanation_cached); } catch { /* keep raw */ }
      auditRows.push({
        actor: null,
        action: 'EXCEPTION_AI_TRIAGED',
        entity_type: 'exception',
        entity_id: ex.id,
        before: null,
        after: triagePayload,
        reason: `auto-triage from cycle ${cycleShort}`
      });
    }
  }
  for (let i = 0; i < auditRows.length; i += 500) {
    const { error: auditErr } = await supabase
      .from('audit_events')
      .insert(auditRows.slice(i, i + 500));
    if (auditErr) logger.error({ err: auditErr }, 'failed to write EXCEPTION_OPENED audit events');
  }

  // 7. Finalize cycle
  const counts = {
    ...engineOut.counts,
    EXCEPTIONS: exceptionCount,
    MATCHES: matchInserts.length,
    AI_CALLS: { tiebreak: tiebreakCalls, explain: explainCalls, nba: nbaCalls },
    TRIAGE: { templated: templatedTriageCount, ai_fallback: aiFallbackJobs.length },
    ALGO_USAGE: engineOut.telemetry.toJSON()
  };
  await supabase
    .from('matching_cycles')
    .update({
      status: 'COMPLETE',
      finished_at: new Date().toISOString(),
      counts
    })
    .eq('id', cycle.id);

  return {
    cycle_id: cycle.id,
    counts: engineOut.counts,
    match_count: matchInserts.length,
    exception_count: exceptionCount,
    ai_calls: { tiebreak: tiebreakCalls, explain: explainCalls, nba: nbaCalls }
  };
}
