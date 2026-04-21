# ReconAI — Testing Plan for Pipeline Profiles + AI Suggester

> **Scope:** This doc is the test plan for everything shipped in commits
> `eb218f2`, `1c4010f`, `1051b6c`, `a03a702` and the sidebar/dashboard/roadmap
> polish after that. It is organised by layer: **automated (fast) → API
> smoke (middle) → DB integrity → UI manual (slow)**. Run top-to-bottom
> before every demo.
>
> **Rule of thumb:** a test is only useful if failing it blocks the demo.
> Everything here blocks.

---

## 0. One-shot green gate (run this first)

Single command that proves the build is healthy end-to-end:

```bash
cd recon-ai
pnpm typecheck && pnpm test && pnpm build
```

Must pass with:

- `tsc --noEmit` → no output (zero errors)
- Test files: **6 passed**, Tests: **57 passed**
- Next.js build: all 22 routes compile, `○ (Static)` + `ƒ (Dynamic)` counts match the previous green build

If any of these fail, stop. Don't fix forward — read the failure first.

---

## 1. Automated tests — what they cover

| Test file | What it proves |
|---|---|
| `tests/canonical/normalize.test.ts` (15) | Date/decimal/ID normalization is deterministic and format-agnostic. Uncovered bugs: SWIFT date parsing, leading-zero CUSIPs, direction enum coercion. |
| `tests/matching/similarity.test.ts` (11) | Per-field scorers (Jaro-Winkler, Levenshtein, numeric tolerance, date proximity) return expected shapes at boundary conditions. |
| `tests/matching/fellegi_sunter.test.ts` (7) | Posterior math is correct: same inputs → same posterior; extreme agreement → ~1.0; extreme disagreement → ~0.0. |
| `tests/matching/engine.test.ts` (5) | Top-level `runEngine` glue — clean pair auto-matches HIGH; wrong quantity demotes to LOW/no-match; deterministic hit is marked as such. |
| `tests/matching/pipeline_profile.test.ts` (8) | **Pipeline Profiles Phase 1 — tolerances + bands.** Proves that the price/qty/date tolerances passed into `scoreFields` actually change field scores end-to-end. Proves `bands: { high_min, medium_min }` change the band label without changing the posterior. |
| `tests/matching/pipeline_stages.test.ts` (11) | **Pipeline Profiles Phase 2 — structural config.** Proves blocking keys are honored (ISIN-keyed blocking separates AAPL trades that symbol-keyed blocking groups); proves `hash` stage skipping actually skips (no `DETERMINISTIC` count); proves `normalize` + `fellegi_sunter` can't be disabled even if the caller tries; proves the Zod `PipelineSuggestionSchema` rejects malformed AI output. |

**How to run a single file during debugging:**

```bash
pnpm vitest run tests/matching/pipeline_stages.test.ts
pnpm vitest --watch tests/matching/pipeline_stages.test.ts   # rerun on save
```

---

## 2. End-to-end cycle tests (engine against the real Supabase)

These run a live matching cycle against the real DB and assert on the counts.
They exercise the entire `run-cycle.ts` path including RLS, auth context,
versioned rules lookup, and matching_cycles insert.

### 2.1 Equities cycle (baseline)

```bash
cd recon-ai
npx tsx --env-file=.env.local scripts/rerun-broker-b-cycle.ts equities
```

**Expected output** (pipe this through `grep -E "cycle=|cycle rules resolved"`):

- `tolerances: { price_rel_tolerance: 0.01, quantity_rel_tolerance: 0.05, date_day_delta: 1 }`
- `bands: { high_min: 0.95, medium_min: 0.7 }`
- `enabledStages: ["normalize","hash","blocking","similarity","fellegi_sunter","hungarian","llm_tiebreak"]`
- `blockingKeys: ["symbol","trade_date","direction"]`
- `matchTypes: ["1:1"]`
- `llmTiebreakBand: "MEDIUM_ONLY"`
- Cycle counts should land in the neighborhood of `{"HIGH":~87,"MEDIUM":~5,"LOW":~3,"UNMATCHED_A":~5,"UNMATCHED_B":~5}`

**What this proves:** the Equities pipeline config is read from DB, passed
to the engine, and produces the expected band distribution.

### 2.2 Fixed Income cycle (the differentiation test)

```bash
npx tsx --env-file=.env.local scripts/rerun-broker-b-cycle.ts fi
```

**Expected:**

- `tolerances.price_rel_tolerance: 0.00001` (0.1bp, NOT 0.01)
- `bands.high_min: 0.97` (NOT 0.95)
- `blockingKeys: ["isin","trade_date","direction"]` (NOT symbol-based)
- `[Fixed Income] cycle=… matches=8 exceptions=1 counts={"HIGH":7,"MEDIUM":1,"LOW":0,"UNMATCHED_A":0,"UNMATCHED_B":0,"DETERMINISTIC":6}`

**What this proves:** tolerances + bands + blocking keys all change
*runtime behavior*, not just stored config. The 0.5%-drift BRK bond
correctly demotes to MEDIUM under FI's tight tolerance, while the sub-cent
GOOGL drift stays HIGH via deterministic hash.

### 2.3 Regression: Equities vs FI on same data

If you want to prove the pipelines produce *different* outputs on
*identical* inputs, run both against the equity Broker B feed. (FI config
applied to equity data is intentionally over-strict and will demote more
matches — that's the proof.)

```bash
# Takes two cycles, compares the band distribution
npx tsx --env-file=.env.local scripts/rerun-broker-b-cycle.ts equities
npx tsx --env-file=.env.local scripts/rerun-broker-b-cycle.ts "Fixed Income"
```

**Expected drift:** FI config on equity data should demote ~5 HIGH → MEDIUM
due to the tighter price cap. If both produce identical counts, the
tolerances aren't flowing and you've regressed.

---

## 3. DB integrity checks (read-only SQL against Supabase)

Run these in the Supabase SQL editor (or via `execute_sql` MCP if you have
the project connector). They verify the config is persisted consistently
across `pipelines`, `matching_rules`, and `matching_cycles`.

### 3.1 Every pipeline has exactly one active default rule

```sql
SELECT p.name,
       count(*) FILTER (WHERE mr.active AND mr.name='default') AS active_default
FROM pipelines p
LEFT JOIN matching_rules mr ON mr.pipeline_id = p.id
GROUP BY p.name
ORDER BY p.name;
```

**Expected:** every row has `active_default = 1`. Zero means a cycle against
that pipeline will fall back to DEFAULT_WEIGHTS — a silent correctness bug.

### 3.2 Every active rule has the full config shape

```sql
SELECT p.name,
       mr.tolerances ? 'blocking_keys'   AS has_blocking_keys,
       mr.tolerances ? 'enabled_stages'  AS has_enabled_stages,
       mr.tolerances ? 'match_types'     AS has_match_types,
       mr.tolerances ? 'llm_tiebreak_band' AS has_tiebreak,
       mr.tolerances -> 'bands' ? 'high_min' AS has_bands
FROM pipelines p
JOIN matching_rules mr ON mr.pipeline_id = p.id AND mr.active
ORDER BY p.name;
```

**Expected:** every boolean is `true` for every pipeline. A `false` means
the engine will fall back to DEFAULT_* for that field — works, but means
the pipeline doesn't truly differentiate on that stage.

### 3.3 Recent cycles are wired to the right pipeline + rule version

```sql
SELECT c.id, c.started_at, p.name AS pipeline, c.matching_rules_version,
       c.counts
FROM matching_cycles c
JOIN pipelines p ON p.id = c.pipeline_id
ORDER BY c.started_at DESC
LIMIT 10;
```

**Expected:** every row has a non-null `pipeline_id` and `matching_rules_version`.
A null `pipeline_id` means the cycle ran under global defaults — a gap in
the audit story. ADR-012 requires every cycle to point at a specific pipeline.

### 3.4 The audit log captured the Phase 2 changes

```sql
SELECT actor, action, entity_type, reason, created_at
FROM audit_events
WHERE action IN ('MATCHING_RULES_PUBLISH', 'PIPELINE_CREATE')
ORDER BY created_at DESC
LIMIT 20;
```

**Expected:** rows for every recent rule publish + pipeline creation,
each with a reason string. No rows = audit is silently broken.

### 3.5 AI suggester calls are logged

```sql
SELECT call_type, model, tokens_in, tokens_out, latency_ms, created_at
FROM ai_calls
WHERE call_type = 'PIPELINE_SUGGEST'
ORDER BY created_at DESC
LIMIT 10;
```

**Expected:** every "Suggest with AI" click writes one row. If the button
appears to work but this table has no matching row, the `ai_calls` audit
contract is broken — that's a CLAUDE.md hard rule violation.

### 3.6 FI seed data is there

```sql
SELECT source_id, count(*) AS n,
       min(trade_date) AS from_date, max(trade_date) AS to_date
FROM trades_canonical
WHERE source_id IN ('fb000001-0000-0000-0000-000000000001',
                    'fb000002-0000-0000-0000-000000000002')
GROUP BY source_id;
```

**Expected:** 8 rows per source. If zero, run the FI seed migration again
(the `ON CONFLICT DO NOTHING` means re-running is safe).

---

## 4. API smoke tests (cURL)

Use these to verify the endpoints respond correctly without clicking
through the UI. Replace `$APP_URL` with your local/deployed URL and
`$SESSION_COOKIE` with a logged-in manager's cookie (copy from browser
DevTools → Application → Cookies).

### 4.1 Suggest pipeline (AI seam)

```bash
curl -s -X POST $APP_URL/api/ai/suggest-pipeline \
  -H "Content-Type: application/json" \
  -H "Cookie: $SESSION_COOKIE" \
  -d '{"asset_class_hint":"FI"}' | jq .
```

**Expected:** `200` with a `{ suggestion: { ... } }` body whose shape
matches the `PipelineSuggestionSchema`. If you get `401` you're not logged
in as manager; `403` means the role check works.

### 4.2 Create new pipeline

```bash
curl -s -X POST $APP_URL/api/pipelines \
  -H "Content-Type: application/json" \
  -H "Cookie: $SESSION_COOKIE" \
  -d '{"name":"Test Pipeline","asset_class":"OTHER","description":"smoke test"}' | jq .
```

**Expected:** `200` with `{ pipeline_id, matching_rules_id }`. Re-run → `409 already exists`.
Clean up with SQL if needed:

```sql
DELETE FROM matching_rules WHERE pipeline_id = (SELECT id FROM pipelines WHERE name='Test Pipeline');
DELETE FROM pipelines WHERE name='Test Pipeline';
```

### 4.3 Publish matching rules (scoped to pipeline)

```bash
curl -s -X POST $APP_URL/api/pipeline/publish \
  -H "Content-Type: application/json" \
  -H "Cookie: $SESSION_COOKIE" \
  -d '{
    "pipeline_id":"7faa2acb-a39b-4f55-9514-7442179734cc",
    "preset":"CUSTOM",
    "bands":{"high_min":0.96,"medium_min":0.72},
    "tolerances":{"price_rel_tolerance":0.012,"quantity_rel_tolerance":0.05,"date_day_delta":1},
    "llm_tiebreak_band":"MEDIUM_ONLY",
    "blocking_keys":["symbol","trade_date","direction"],
    "enabled_stages":["normalize","hash","blocking","similarity","fellegi_sunter","hungarian","llm_tiebreak"],
    "match_types":["1:1"],
    "reason":"smoke test"
  }' | jq .
```

**Expected:** `200` with `{ id, version }` where `version` = previous active version + 1.
Verify with SQL that only ONE row is active for that pipeline after publish.

---

## 5. UI manual test — the demo walk

Go through the full demo script (`docs/DEMO_SCRIPT_V2.md` → Part B) end-to-end
on the live URL. At each beat, **validate the visible output against the
expectations below**.

| Beat | URL | Visible check |
|---|---|---|
| 1 | `/dashboard` | All 12 KPI tiles render with numbers. **Bottom charts (Exception aging + Match rate by recent cycle) render with bars/lines, not blank**. AI-assisted violet badge on narrative. |
| 2 | `/pipeline` | 7 stage cards render with tone colors. Click each → side sheet opens with algorithm detail. |
| 3 | `/pipeline?pipeline=Fixed%20Income` | Pipeline dropdown shows all 3 pipelines. Switching to FI changes Expert Mode: blocking keys show `isin`, price cap shows `0.00001`, HIGH band shows `0.97`. |
| 3b | `/pipeline?pipeline=FX` | `hash` chip in "Enabled stages" is gray (disabled), not emerald. |
| 3c | `/pipeline` | `New pipeline` button appears next to the pipeline tabs for manager role; hidden for auditor/analyst. |
| 4 | Expert Mode → "Suggest with AI" | Button shows spinner, returns populated fields. Last-suggestion summary appears under the button. Warnings list renders if present. |
| 4b | Expert Mode → Publish | Toast says "Published ruleset v<N>". New row appears in "Rule version history" below. |
| 5 | `/workspace` → V SELL | Compare pane shows internal/broker side-by-side. **Score breakdown tab shows per-field weights**. AI triage tab shows recommended action = ESCALATE. Exception class badge = `WRONG PRICE`. |
| 6 | `/reference-data` | Graph renders. Click J.P. Morgan node → aliases panel shows. |
| 7 | `/dashboard/evals` → Run Evals | Button shows progress, results populate within a few seconds. Per-class F1 bars render. |
| 8 | `/roadmap` | 6 phase cards render. Phase 0 + Phase 1 items all show ✅ Shipped badge. `/cash` URL redirects here (no 404). |

### UI visual regression smoke

- [ ] Sidebar: **no "Cash (soon)"** item. Instead: "Product Roadmap" under the Roadmap section.
- [ ] Dashboard: both bottom charts render. Resize the window → charts stay visible and resize.
- [ ] Pipeline page: Expert Mode shows the new **Blocking keys / Enabled stages / Match types** chip rows.
- [ ] V SELL row in /workspace: exception class = **WRONG PRICE** (not ROUNDING). If it says ROUNDING, the re-cycle hasn't run since the ADR-011 fix.

### Accessibility / keyboard

- [ ] `/workspace`: `J` / `K` cycles through exceptions. `A` accepts. `R` rejects. `E` escalates.
- [ ] `⌘K` opens command palette from any page.
- [ ] Every interactive element reachable by Tab with a visible focus ring.

---

## 6. Production deploy smoke (post-Netlify deploy)

After each Netlify deploy completes:

1. Open production URL → expect redirect `/` → `/login`
2. Log in as `manager@demo.co`
3. Run through Section 5 (UI manual test) on the production URL
4. Check **Netlify function logs** for any 500s on the `/api/ai/*` endpoints — those indicate a missing env var
5. Check **Supabase → Logs → API** for unusual error rates on `pipelines` or `matching_rules` queries

### Env-var sanity (the common production failure)

```bash
# Should list all 11 expected vars with values (sensitive ones masked)
npx netlify env:list
```

Must include: `OPENAI_API_KEY`, `OPENAI_MODEL`, `OPENAI_EMBED_MODEL`,
`SUPABASE_SERVICE_ROLE_KEY`, `NEO4J_URI`, `NEO4J_USERNAME`, `NEO4J_PASSWORD`,
`NEO4J_DATABASE`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
`NEXT_PUBLIC_APP_NAME`. Missing any → the app crashes at first request.

---

## 7. Demo-day dry-run (do this twice, the day before)

1. Wipe your browser cache / use incognito.
2. Hit the production URL.
3. Run the full demo script end-to-end, WITH the stopwatch, WITHOUT cheating
   (no pre-loading tabs, no "oh let me switch to localhost").
4. Time must fall between 4:30 and 5:30.
5. Note any screen that loaded slower than 500ms — those are the screens to
   pre-warm before the real demo by visiting them during the pre-script part.

---

## 8. What to do if something fails mid-demo

Script these responses so you never freeze:

| Symptom | Spoken response | Action |
|---|---|---|
| An API returns 500 | "This would be my Netlify function logs to check — env var drift is the usual culprit. Let me jump to localhost where I have a recent cycle cached." | Alt-tab to localhost. |
| AI suggester times out | "GPT latency varies — the fallback path returns safe equities defaults so the UI is never broken. Here's the pre-computed suggestion from yesterday's eval run." | Point to the cached one. |
| A chart is blank | "Recharts has a measurement race in strict mode — this happens on first paint occasionally. Refreshing, but meanwhile the underlying data is in the KPI tiles above." | ⌘R. |
| V SELL row shows ROUNDING | "Demo data is from a previous cycle; let me re-run the matching cycle to pick up the ADR-011 classifier fix." | Run cycle button or `scripts/rerun-broker-b-cycle.ts`. |

---

## 9. Gold-set eval — the regression trap

If any change to a prompt or matching rule lands, run the eval harness
BEFORE pushing:

```bash
curl -s -X POST $APP_URL/api/eval/run \
  -H "Cookie: $SESSION_COOKIE" | jq '.metrics'
```

**Expected** for the current gold set (33 pairs):

- Overall precision ≥ 0.95, recall ≥ 0.90, F1 ≥ 0.92
- Per-class WRONG_PRICE precision = 1.0 (the V SELL regression guard — pair G033 must classify correctly)
- Per-class ROUNDING recall ≥ 0.80

If any metric drops by more than 3pp from the previous `eval_runs` row,
**stop and investigate** before merging. That's the contract — evals are
a hard gate, not a report.
