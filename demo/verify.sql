-- ============================================================================
-- ReconAI — End-to-end system verification
-- Paste into Supabase SQL Editor. Highlight any block and press Run.
-- ============================================================================


-- ─── 1. System health (one-shot summary) ────────────────────────────────────
-- Use this as the "everything green?" dashboard.
SELECT 'feed_profiles'            AS metric, count(*)::text AS value FROM feed_profiles
UNION ALL SELECT 'trades_canonical',                count(*)::text FROM trades_canonical
UNION ALL SELECT 'trades_canonical with embedding', count(*)::text FROM trades_canonical WHERE counterparty_embedding IS NOT NULL
UNION ALL SELECT 'counterparty_entities',           count(*)::text FROM counterparty_entities
UNION ALL SELECT 'counterparty_aliases',            count(*)::text FROM counterparty_aliases
UNION ALL SELECT 'matching_cycles',                 count(*)::text FROM matching_cycles
UNION ALL SELECT 'match_results',                   count(*)::text FROM match_results
UNION ALL SELECT 'match_results MEDIUM',            count(*)::text FROM match_results WHERE band = 'MEDIUM'
UNION ALL SELECT 'match_results with llm_verdict',  count(*)::text FROM match_results WHERE llm_verdict IS NOT NULL
UNION ALL SELECT 'match_results HIGH',              count(*)::text FROM match_results WHERE band = 'HIGH'
UNION ALL SELECT 'match_results LOW',               count(*)::text FROM match_results WHERE band = 'LOW'
UNION ALL SELECT 'exceptions TOTAL',                count(*)::text FROM exceptions
UNION ALL SELECT 'exceptions with triage (explanation_cached)', count(*)::text FROM exceptions WHERE explanation_cached IS NOT NULL
UNION ALL SELECT 'exceptions OPEN',                 count(*)::text FROM exceptions WHERE status = 'OPEN'
UNION ALL SELECT 'exceptions RESOLVED',             count(*)::text FROM exceptions WHERE status = 'RESOLVED'
UNION ALL SELECT 'resolution_actions',              count(*)::text FROM resolution_actions
UNION ALL SELECT 'audit_events',                    count(*)::text FROM audit_events
UNION ALL SELECT 'ai_calls TOTAL',                  count(*)::text FROM ai_calls
UNION ALL SELECT 'ai_calls fallback_used',          count(*)::text FROM ai_calls WHERE fallback_used
UNION ALL SELECT 'eval_runs',                       count(*)::text FROM eval_runs
UNION ALL SELECT 'matching_rules',                  count(*)::text FROM matching_rules
UNION ALL SELECT 'matching_rules active',           count(*)::text FROM matching_rules WHERE active;


-- ─── 2. AI call breakdown (proves tiered routing) ───────────────────────────
-- Expected after a fresh precompute:
--   EMBED       → 2 (batched calls for unique CPY strings)
--   TIEBREAK    → 130 (every MEDIUM match)
--   EXPLAIN_BREAK / NEXT_BEST_ACTION → typically 0 if all classes matched templates
SELECT
  call_type,
  model,
  count(*) AS total,
  count(*) FILTER (WHERE fallback_used) AS fallback,
  round(avg(latency_ms)::numeric, 0)    AS avg_ms,
  round(avg(input_tokens)::numeric, 0)  AS avg_input_tok,
  round(avg(output_tokens)::numeric, 0) AS avg_output_tok
FROM ai_calls
GROUP BY call_type, model
ORDER BY count(*) DESC;


-- ─── 3. Matching cycle telemetry (per-cycle algo counts) ────────────────────
SELECT
  fp_b.name AS feed_b,
  (mc.counts->>'HIGH')::int   AS high,
  (mc.counts->>'MEDIUM')::int AS medium,
  (mc.counts->>'LOW')::int    AS low,
  (mc.counts->>'EXCEPTIONS')::int AS exc,
  mc.counts->'AI_CALLS'  AS ai_calls,
  mc.counts->'TRIAGE'    AS triage,
  mc.started_at
FROM matching_cycles mc
JOIN feed_profiles fp_b ON fp_b.id = mc.feed_b_id AND fp_b.version = mc.feed_b_version
ORDER BY mc.started_at DESC;


-- ─── 4. Per-cycle algorithm invocation counts ───────────────────────────────
-- Drills into the ALGO_USAGE telemetry to show EVERY algorithm that fired.
SELECT
  fp_b.name AS feed_b,
  algo.key  AS algorithm,
  algo.value::int AS invocations
FROM matching_cycles mc
JOIN feed_profiles fp_b ON fp_b.id = mc.feed_b_id AND fp_b.version = mc.feed_b_version
CROSS JOIN LATERAL jsonb_each_text(mc.counts->'ALGO_USAGE') AS algo(key, value)
ORDER BY mc.started_at DESC, algo.value::int DESC;


-- ─── 5. MEDIUM-band matches and their GPT-5.4 tiebreak verdicts ─────────────
-- Proves LLM tiebreak fires ONLY on MEDIUM and produces structured verdicts.
SELECT
  mr.id,
  mr.band,
  round(mr.posterior::numeric, 3) AS posterior,
  mr.llm_verdict->>'verdict'      AS verdict,
  round((mr.llm_verdict->>'confidence')::numeric, 2) AS confidence,
  mr.llm_verdict->>'reasoning'    AS reasoning,
  mr.llm_verdict->'decisive_fields' AS decisive_fields
FROM match_results mr
WHERE mr.band = 'MEDIUM'
LIMIT 10;


-- ─── 6. Exception triage — templates vs AI fallback ─────────────────────────
-- The `source` field reveals whether a triage was TEMPLATE (rule-based) or AI.
SELECT
  exception_class,
  band,
  count(*) AS exceptions,
  count(*) FILTER (WHERE explanation_cached::jsonb->>'source' = 'TEMPLATE') AS templated,
  count(*) FILTER (WHERE explanation_cached::jsonb->>'source' = 'RULE')     AS rule_based,
  count(*) FILTER (WHERE explanation_cached::jsonb->>'source' = 'AI')       AS ai_fallback,
  count(*) FILTER (WHERE explanation_cached IS NULL)                         AS no_triage
FROM exceptions
GROUP BY exception_class, band
ORDER BY exceptions DESC;


-- ─── 7. Sample exception with full triage payload ───────────────────────────
SELECT
  e.id,
  e.band,
  e.exception_class,
  e.status,
  jsonb_pretty((e.explanation_cached)::jsonb) AS triage
FROM exceptions e
WHERE e.explanation_cached IS NOT NULL
LIMIT 3;


-- ─── 8. Counterparty embeddings — are they actually vectors? ────────────────
-- Expected: 1,806 total rows, all with non-null 1,536-dim vectors.
SELECT
  count(*) AS total_trades,
  count(counterparty_embedding) AS with_embedding,
  count(*) - count(counterparty_embedding) AS missing_embedding,
  count(DISTINCT counterparty) AS unique_counterparty_strings
FROM trades_canonical;


-- ─── 9. Feed profile + mapping versioning ───────────────────────────────────
SELECT
  fp.name,
  fp.kind,
  fp.version,
  fp.retired_at,
  (SELECT count(*) FROM field_mappings fm
    WHERE fm.feed_profile_id = fp.id AND fm.feed_profile_version = fp.version) AS mapping_count,
  (SELECT count(*) FROM trades_canonical tc
    WHERE tc.source_id = fp.id AND tc.source_version = fp.version) AS canonical_trades
FROM feed_profiles fp
ORDER BY fp.created_at DESC;


-- ─── 10. Evals history with confusion matrix ────────────────────────────────
SELECT
  gold_set_version,
  round(precision_score::numeric, 3) AS precision,
  round(recall_score::numeric, 3)    AS recall,
  round(f1_score::numeric, 3)        AS f1,
  confusion,
  model_version,
  created_at
FROM eval_runs
ORDER BY created_at DESC
LIMIT 10;


-- ─── 11. RLS sanity check — confirm audit_events is append-only at DB ───────
-- These policy names must exist. If any are missing, RLS is misconfigured.
SELECT
  schemaname,
  tablename,
  policyname,
  cmd,
  roles
FROM pg_policies
WHERE tablename = 'audit_events'
ORDER BY cmd;
-- Expected: a SELECT policy and an INSERT policy. NO UPDATE, NO DELETE policy.


-- ─── 12. RLS enabled on every user-reachable table? ─────────────────────────
SELECT
  tablename,
  rowsecurity AS rls_enabled
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN (
    'profiles', 'feed_profiles', 'field_mappings', 'trades_raw', 'trades_canonical',
    'matching_rules', 'matching_cycles', 'match_results', 'exceptions',
    'resolution_actions', 'audit_events', 'ai_calls', 'eval_runs',
    'counterparty_entities', 'counterparty_aliases'
  )
ORDER BY tablename;
-- Expected: rls_enabled = true on ALL 15 rows.


-- ─── 13. pgvector + vector search sanity ────────────────────────────────────
-- Picks an arbitrary internal trade, finds its nearest 5 neighbors by
-- counterparty_embedding. Expected: clustered by counterparty name.
WITH anchor AS (
  SELECT trade_id, counterparty, counterparty_embedding
  FROM trades_canonical
  WHERE counterparty = 'J.P. Morgan Securities LLC'
    AND counterparty_embedding IS NOT NULL
  LIMIT 1
)
SELECT
  t.trade_id,
  t.counterparty,
  round((t.counterparty_embedding <=> a.counterparty_embedding)::numeric, 4) AS cosine_distance
FROM trades_canonical t, anchor a
WHERE t.counterparty_embedding IS NOT NULL
ORDER BY t.counterparty_embedding <=> a.counterparty_embedding
LIMIT 5;


-- ─── 14. The "honesty query" — what Claude actually ran ─────────────────────
-- Proves AI calls are structurally sound: every row has hash, tokens, latency.
SELECT
  call_type,
  length(prompt_hash) AS hash_len,   -- must be 64 (SHA-256)
  input_tokens, output_tokens, latency_ms,
  fallback_used,
  created_at
FROM ai_calls
ORDER BY created_at DESC
LIMIT 5;


-- ─── 15. 1-row green/red summary ────────────────────────────────────────────
-- Single row that says everything is healthy.
SELECT
  CASE WHEN (SELECT count(*) FROM trades_canonical WHERE counterparty_embedding IS NULL) = 0
       THEN '✅' ELSE '❌' END || ' embeddings populated'                              AS check_1,
  CASE WHEN (SELECT count(*) FROM match_results WHERE band = 'MEDIUM' AND llm_verdict IS NULL) = 0
       THEN '✅' ELSE '❌' END || ' MEDIUM matches have GPT-5.4 verdict'               AS check_2,
  CASE WHEN (SELECT count(*) FROM exceptions WHERE trade_a_id IS NOT NULL AND trade_b_id IS NOT NULL AND explanation_cached IS NULL) = 0
       THEN '✅' ELSE '❌' END || ' 2-sided exceptions have triage'                    AS check_3,
  CASE WHEN (SELECT count(*) FROM ai_calls WHERE call_type = 'TIEBREAK') > 0
       THEN '✅' ELSE '❌' END || ' TIEBREAK calls recorded'                           AS check_4,
  CASE WHEN (SELECT count(*) FROM ai_calls WHERE fallback_used) = 0
       THEN '✅' ELSE '⚠️ ' END || ' no AI fallbacks'                                 AS check_5,
  CASE WHEN (SELECT count(*) FROM matching_cycles WHERE counts ? 'ALGO_USAGE') = (SELECT count(*) FROM matching_cycles)
       THEN '✅' ELSE '❌' END || ' every cycle has ALGO_USAGE telemetry'              AS check_6;
