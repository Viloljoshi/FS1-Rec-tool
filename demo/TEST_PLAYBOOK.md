# ReconAI — Test Playbook

**Complete end-to-end tests using the demo pack.** Each path exercises a specific
capability and verifies both the happy path and auditability. If any step
deviates from expected output, the "what to check" column tells you exactly
where to look.

---

## Pre-flight (do once before testing)

1. **Env vars** in `recon-ai/.env.local` must be set:
   - `OPENAI_API_KEY`, `OPENAI_MODEL=gpt-5.4`
   - `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
   - `NEO4J_URI`, `NEO4J_USERNAME=<your-aura-instance-id>`, `NEO4J_PASSWORD`, `NEO4J_DATABASE=<your-aura-instance-id>`
2. **Dev server**: `cd recon-ai && pnpm dev` — open the URL it prints.
3. **Demo data present**: verify `demo/` folder contains the 4 CSVs + `README.md`.

---

## Path 1 — Role-based login (4 minutes)

**Goal**: confirm RBAC enforcement at both UI and database layers.

| Step | Action | What to check |
|------|--------|---------------|
| 1 | Visit `/login`, click **`analyst@demo.co`** quick-login chip, click **Sign in** | Lands on `/workspace`. Sidebar shows: Reconcile · Exception Mgmt · Matching Cycles · Pipeline · Feed Onboarding · Reference Data · Audit · Cash. Role badge reads **ANALYST**. |
| 2 | Try to navigate to `/dashboard` directly via URL bar | No error — page loads (client-side), but dashboard data relies on manager/auditor role. Analyst gets empty/degraded view. |
| 3 | Sign out, sign in as `manager@demo.co` | Lands on `/dashboard`. Role badge reads **MANAGER**. **"Run Evals"** button appears in top bar. |
| 4 | Sign out, sign in as `auditor@demo.co` | Lands on `/audit`. Role badge reads **AUDITOR**. Sidebar hides `Feed Onboarding` and `Reconcile (2-party)` — both are write-ish. |
| 5 | As auditor, open an exception in `/workspace` and click **Accept match** | `403 Forbidden: auditor is read-only`. Check `audit_events` table — no new row was written. RLS held. |

---

## Path 2 — Feed onboarding, single broker (2 minutes)

**Goal**: AI-inferred schema mapping + auto-running matching cycle.

| Step | Action | What to check |
|------|--------|---------------|
| 1 | Sign in as `analyst@demo.co`. Click **Feed Onboarding** in sidebar. | Stepper shows 4 stages: Upload · Infer · Map · Save. |
| 2 | Drag `demo/02-jefferies-april-2026.csv` into the dropzone | Auto-fills feed name as "02-jefferies-april-2026". Preview table shows 8 cols, 29 rows. Advances to step 2. |
| 3 | Change feed name to `"Jefferies — April 2026"`, set kind to `BROKER`, click **Infer canonical mapping with AI** | Within 3–8 seconds, mappings populate: `ClOrdID → source_ref` (~0.95), `TransactTime → trade_date` (~0.88), `SettlementDate → settlement_date`, `Side → direction`, `Symbol → symbol`, `SecurityID → cusip`, `OrderQty → quantity`, `LastPx → price`, `Counterparty → counterparty`, `Account → account`. Each row has a confidence % chip. |
| 4 | Click any "Why?" popover | AI reasoning appears (e.g. "FIX protocol tag typically used for client order identifier"). |
| 5 | Click **Save & Run Matching Cycle** | Progress spinner. Toast: "Ingested 29 trades · matching cycle started". Auto-redirects to `/workspace?cycle=<id>` within ~15 seconds. |
| 6 | Inspect the new cycle's counts via `/matching` | New row at top. Counts include H/M/L bands. Broker B (Jefferies) trades are in Internal's JPM bucket so matching is restrict-by-entity; you'll see a handful of MEDIUM bands from the seeded CPY drifts. |
| 7 | Open Supabase SQL: `SELECT count(*) FROM trades_raw WHERE feed_profile_id = '<new feed id>'` | Returns 29. Raw rows persisted for lineage. |
| 8 | Check `ai_calls` table for an `INFER_SCHEMA` row with `fallback_used = false` and model `gpt-5.4` | Prompt hash logged. Tokens logged. Latency logged. |

---

## Path 3 — Two-party reconciliation via `/reconcile` (2 minutes)

**Goal**: symmetric two-party workflow; dual upload; AI auto-mapping.

| Step | Action | What to check |
|------|--------|---------------|
| 1 | Sign in as analyst. Click **Reconcile (2-party)** in sidebar. | Page shows two columns: "YOUR SIDE" (slate accent) and "COUNTERPARTY SIDE" (violet accent), a centered recon arrow, a date range, and a big **Run Reconciliation** button. |
| 2 | Leave Side A on default `Pick existing feed = Internal Blotter`. | Footer of Side A reads "Ready". |
| 3 | Side B: keep toggle on `Upload new file`, name it `Morgan Stanley — April 2026`, set kind `BROKER`. Drop `demo/01-morgan-stanley-april-2026.csv`. | File parses, row count shown (35). Infer button appears. |
| 4 | Click **Infer canonical mapping**. | Mappings populate: `ms_trade_id → source_ref`, `trade_dt → trade_date`, `sett_dt → settlement_date`, `side → direction`, `security → symbol`, `isin → isin`, `nominal → quantity`, `execution_px → price`, `ccy → currency`, `cpy → counterparty`, `account_ref → account`. Confidence chips visible. |
| 5 | Set date range `2026-04-01 → 2026-04-30`. Click **Run Reconciliation**. | ~20 second wait (because LLM tiebreak runs on MEDIUM band matches + auto-triage generates explanation + next-best-action for every exception). Lands on `/workspace?cycle=<id>`. |
| 6 | In the workspace queue, find an exception labeled `CPY_ALIAS` | Its `counterparty` on Side B is `MS` or `Morgan Stanley Co`. Row has band `MEDIUM`. |
| 7 | Click it. In compare pane, confirm: | <ul><li>Trade cards show **"Internal Blotter"** (source of truth) and **"Morgan Stanley — April 2026"** (counterparty view) — not generic "Side A / Side B"</li><li>Posterior probability bar</li><li>Field-by-field table with per-row color: green/amber/red</li><li>Per-field **raw score × weight = contribution** columns</li><li>**LLM tiebreak** card below (violet) — GPT-5.4 verdict with decisive_fields badges</li><li>**Analyst explanation** card — pre-generated at cycle time (no "Generate" click needed)</li></ul> |
| 8 | Press `A` on keyboard | Exception closes, toast confirms, row disappears from queue. Next row auto-selects. |
| 9 | Navigate to `/audit`, filter actor = `analyst@demo.co`, action = `EXCEPTION_ACCEPT` | Row present with before `{status: 'OPEN'}` and after `{status: 'RESOLVED'}`. |

---

## Path 4 — Pipeline inspection (90 seconds)

**Goal**: verify every matching algorithm is visible, configurable, and version-controlled.

| Step | Action | What to check |
|------|--------|---------------|
| 1 | Navigate to **Pipeline** in sidebar | AI narrative card at top (violet, Sparkles icon) summarizing the last cycle — "auto-resolved X%, N candidates went to LLM tiebreak". Below: 7 horizontally-arranged stage cards (Normalize → Hash → Blocking → Similarity → Fellegi-Sunter → Hungarian → LLM Tiebreak). |
| 2 | Click **Stage 4 · Field Similarity** | Side sheet opens showing: purpose paragraph, last-cycle metrics, 8 algorithms (Jaro-Winkler, Levenshtein, Double Metaphone, Token Set Ratio, Embedding Cosine, Relative tolerance, Day delta, ID exact). Each algorithm has an enabled/disabled dot, detail, and "applies to" badge. Embedding Cosine has an `AI-assisted` chip with model `text-embedding-3-small`. |
| 3 | Close sheet. Click **Stage 7 · LLM Tiebreak**. | Sheet shows: GPT-5.4 as active algorithm. AI-assisted chip on the card itself. "Configuration lives in matching_rules — manager role can propose and activate new versions." |
| 4 | Scroll down to **Ruleset versions** table | Shows `default v1 ACTIVE`, timestamp. |

---

## Path 5 — Reference data graph (60 seconds)

**Goal**: verify Neo4j is the authoritative entity store.

| Step | Action | What to check |
|------|--------|---------------|
| 1 | Navigate to **Reference Data** | Search input, list of entities, cluster detail. |
| 2 | Type `JPM` in search | Results narrow to J.P. Morgan entries (live Cypher query against Neo4j). |
| 3 | Click `J.P. Morgan Securities LLC` | Detail card shows LEI, SEC CRD `79`, country `US`. Aliases card lists: `JPM Securities`, `JPM Sec.`, `JPMorgan Sec LLC`, `J P MORGAN SECURITIES LLC`, `JPMCB`, `JPMorgan`. Subsidiary/Parent card shows JPMorgan Chase & Co. Graph preview SVG renders with central node + alias + subsidiary layout. |
| 4 | Open Supabase SQL: `SELECT count(*) FROM counterparty_aliases` | Returns 42 aliases across 10 canonical entities (mirror of Neo4j). |

---

## Path 6 — Dashboard + Evals (2 minutes)

**Goal**: verify AI quality is measured, not asserted.

| Step | Action | What to check |
|------|--------|---------------|
| 1 | Sign in as `manager@demo.co`. Land on `/dashboard`. | 5 KPI tiles (auto-match rate, unresolved, median age, resolution rate, evals F1). 2 charts (exception aging, match rate by cycle). Evals history table. |
| 2 | Click **Run Evals** in top bar | Toast "Running evaluation against gold set...". ~15-30 s wait. Toast updates with F1 score. New row appears in evals table. |
| 3 | Inspect latest row's confusion matrix | TP/FP/TN/FN visible. Current expected F1 ≥ 0.85 on 30-pair gold set. |
| 4 | Open Supabase SQL: `SELECT count(*) FROM ai_calls WHERE call_type = 'TIEBREAK'` | Should be > 0 if any MEDIUM-band matches exist from prior cycles. |

---

## Path 7 — Audit reproduction (90 seconds)

**Goal**: every state change is recoverable with before/after.

| Step | Action | What to check |
|------|--------|---------------|
| 1 | Sign in as `auditor@demo.co`. Land on `/audit`. | Full append-only event log. Filter bar at top. Export CSV button. |
| 2 | Filter action = `EXCEPTION_ACCEPT` | Every accept-match event from analysts. |
| 3 | Click the eye icon on any row | Side sheet opens with: event UUID, before JSON (e.g. `{status: 'OPEN', assignee: null, band: 'MEDIUM'}`), after JSON, reason. |
| 4 | Try to modify via URL/API: `curl -X PATCH /api/audit/...` | Endpoint doesn't exist. Postgres RLS has no UPDATE or DELETE policy on `audit_events`. |
| 5 | Click **Export CSV**. Check downloaded file. | CSV with timestamp, actor email, action, entity, reason. Suitable for SIEM import. |

---

## Path 8 — Full AI trace (end-to-end, ~5 minutes)

**Goal**: prove AI is bounded, logged, and decomposable at every step.

| Step | Action | What to check |
|------|--------|---------------|
| 1 | Open Supabase SQL: `SELECT call_type, count(*), avg(latency_ms), bool_or(fallback_used) AS any_fallback FROM ai_calls GROUP BY call_type ORDER BY call_type;` | Expected rows: `INFER_SCHEMA` (from every onboarding), `EMBED` (seed time), `TIEBREAK` (MEDIUM band), `EXPLAIN_BREAK` (auto-triage), `NEXT_BEST_ACTION` (auto-triage). All with model `gpt-5.4` except `EMBED` (`text-embedding-3-small`). |
| 2 | Sample a row: `SELECT prompt_hash, output FROM ai_calls WHERE call_type='TIEBREAK' LIMIT 1;` | `prompt_hash` is a 64-char SHA-256. `output` is a JSON blob matching the Zod schema: `{verdict, confidence, reasoning, decisive_fields}`. Raw prompt is NOT stored (privacy). |
| 3 | Force a failure: set `OPENAI_API_KEY=invalid`, restart dev, try onboarding upload | Inference falls back to empty mapping. Row in `ai_calls` has `fallback_used = true`. The UI doesn't crash. Restore key. |

---

## Path 9 — Performance sanity check

| Measure | Expected | Where to check |
|---------|----------|----------------|
| Login → `/workspace` render | < 2 s | Visual / browser devtools Network panel |
| Onboarding infer-schema call | ≤ 5 s p95 | `ai_calls.latency_ms` |
| Full `/reconcile` cycle (upload + ingest + match + auto-triage) | 15–30 s for ~30 trades | End-to-end timing |
| Workspace row select → compare pane render | < 300 ms | Feels instant |
| Evals run | 20–40 s for 30 pairs | `eval_runs.created_at` before/after |

---

## Known expected states after a full test run

- `feed_profiles`: 4 seeded + 1 or more created in tests (versioned)
- `trades_raw`: ~1,836 + 29 or 35 per upload
- `trades_canonical`: same
- `match_results`: ~195 seeded + new from each cycle
- `exceptions`: ~16 seeded + new from each cycle
- `ai_calls`: N entries per upload + per cycle
- `audit_events`: grows with every action
- `eval_runs`: 1 seeded + manual runs

---

## Rollback / reset

To fully reset the demo state:
```sql
TRUNCATE matching_cycles, match_results, exceptions, resolution_actions RESTART IDENTITY CASCADE;
DELETE FROM feed_profiles WHERE name NOT IN ('Internal Blotter', 'Broker A — Goldman', 'Broker B — J.P. Morgan', 'Custodian');
```
Then `pnpm seed:precompute` rebuilds the seeded cycles.

---

## What to show first if time is short (90-second demo)

1. Log in as analyst → `/workspace` (15s): "Pre-computed queue. Every exception already has an AI explanation and a suggested action."
2. Click one MEDIUM exception (20s): "Look — GPT-5.4 tiebreak verdict, Fellegi-Sunter field scores, LLM explanation, all rendered. Analyst just confirms."
3. Go to `/pipeline` (25s): "Every algorithm visible. Seven stages. Toggleable. Versioned."
4. Go to `/audit` (15s): "Every action is RLS-append-only. Auditor can export for SIEM."
5. Go to `/dashboard` (15s): "Evals F1 measured on a gold set — AI quality is not asserted, it's proven."
