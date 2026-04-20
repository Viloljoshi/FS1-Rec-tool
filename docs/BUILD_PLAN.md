# ReconAI — Build Plan

**Time budget:** 4 hours, single weekend session
**Goal:** Shippable MVP for Senior PM interview, live demo URL
**Non-goal:** Feature completeness — the demo script is the spec

---

## Operating rules

1. **Demo script drives the build.** Each block below serves one or more beats
   in `docs/DEMO_SCRIPT.md`.
2. **Time-box ruthlessly.** If a block overruns by 15 min, drop its stretch goals.
3. **Seed first, UI second, polish last.** Every demo beat must be reachable
   via seeded data before the code for that beat ships.
4. **No commits without an updated `DECISIONS_LOG.md`** when any deviation from
   the plan happens.

---

## Phase map (4 hours)

| # | Block | Time | Cumulative |
|---|-------|------|------------|
| 0 | Foundation — docs, scaffold, Supabase, shadcn | 15 min | 0:15 |
| 1 | Data layer — schema, RLS, seed, pre-computed recon job | 25 min | 0:40 |
| 2 | App shell — layout, sidebar, RBAC, login | 20 min | 1:00 |
| 3 | Onboarding flow — upload → GPT schema infer → mapping editor → versioned save | 60 min | 2:00 |
| 4 | Matching engine — 6 layers, pure functions, unit tests on Fellegi-Sunter | 45 min | 2:45 |
| 5 | Exception workspace — 3-pane UI, compare, actions, audit | 45 min | 3:30 |
| 6 | Evals + audit log + dashboard | 15 min | 3:45 |
| 7 | Polish, Loom, README, deploy | 15 min | 4:00 |

---

## Phase 0 — Foundation (0:00 → 0:15)

### Deliverables
- [ ] `recon-ai/` repo init, `git init`, `.gitignore`
- [ ] `CLAUDE.md` + all `docs/*.md` present (PRD, Demo Script, Schema, Matching Engine, UX, Governance, Evals, Build Plan, Decisions Log, Architecture)
- [ ] Next.js 14 App Router scaffold with TypeScript strict
- [ ] Tailwind + shadcn/ui initialized (button, card, input, dialog, sheet, table, badge, tabs, dropdown-menu, sonner, resizable, separator, tooltip)
- [ ] Supabase project created, URL + anon key + service key in `.env.local`
- [ ] pgvector extension enabled
- [ ] `@supabase/ssr`, `@supabase/supabase-js` wired (`lib/supabase/client.ts`, `lib/supabase/server.ts`)
- [ ] OpenAI SDK installed, `lib/ai/openai.ts` skeleton
- [ ] Zod, React Hook Form, TanStack Table, Recharts, date-fns, decimal.js, papaparse, xlsx, fast-jaro-winkler, fastest-levenshtein, natural installed

### Acceptance
- `pnpm dev` boots to a blank page with shadcn styling at `http://localhost:3000`

---

## Phase 1 — Data layer (0:15 → 0:40)

### Deliverables
- [ ] `supabase/migrations/0001_init.sql` — all tables:
  - `profiles(id, email, role)`
  - `source_profiles(id, name, version, created_by, created_at)`
  - `field_mappings(id, source_profile_id, source_field, canonical_field, confidence, version)`
  - `trades_raw(id, source_profile_id, row_index, payload jsonb, uploaded_at)`
  - `trades_canonical(id, source_id, source_ref, trade_date, settlement_date, direction, symbol, isin, cusip, quantity numeric, price numeric, gross_amount numeric, currency, counterparty, counterparty_embedding vector(1536), account, lineage jsonb, created_at)`
  - `recon_jobs(id, source_a, source_b, date_from, date_to, status, started_at, finished_at, counts jsonb)`
  - `match_results(id, job_id, trade_a_id, trade_b_id, posterior, band, field_scores jsonb, deterministic_hit bool, llm_verdict jsonb, created_at)`
  - `exceptions(id, job_id, trade_a_id, trade_b_id, band, status, assignee, age_seconds, created_at, updated_at)`
  - `analyst_actions(id, exception_id, actor, action, reason, created_at)`
  - `audit_events(id, actor, action, entity_type, entity_id, before jsonb, after jsonb, reason, created_at)` — append-only via RLS
  - `ai_calls(id, call_type, model, prompt_hash, input_tokens, output_tokens, latency_ms, output jsonb, fallback_used bool, created_at)`
  - `matching_rules(id, name, weights jsonb, version, active bool, created_by, created_at)`
  - `eval_runs(id, f1 numeric, precision numeric, recall numeric, per_band jsonb, model_version, created_at)`
- [ ] `supabase/migrations/0002_rls.sql` — RLS policies per role
- [ ] `data/seed/broker-a.csv` (250 rows, canonical-ish)
- [ ] `data/seed/broker-b.csv` (250 rows, different field names, date format, CPY abbrev)
- [ ] `data/seed/custodian.csv` (250 rows, third format, some rounding drift)
- [ ] `data/seed/internal.json` (source of truth, 1000 trades)
- [ ] `data/eval/gold.jsonl` (30 labeled pairs)
- [ ] `scripts/seed.ts` — loads all three sources + pre-computes one recon job so `/workspace` is populated before any live code runs
- [ ] 3 users created: `analyst@demo.co`, `manager@demo.co`, `auditor@demo.co`

### Acceptance
- Supabase table editor shows populated data
- `/workspace` would have content to display if UI existed
- RLS verified: `analyst` cannot read `audit_events.before/after` for others' actions

---

## Phase 2 — App shell + RBAC (0:40 → 1:00)

### Deliverables
- [ ] `app/(auth)/login/page.tsx` — Supabase magic-link
- [ ] Middleware: redirects to `/login` if unauthenticated
- [ ] `components/layout/TopBar.tsx` — workspace name, role badge, user menu, "Run Evals" (role-gated)
- [ ] `components/layout/Sidebar.tsx` — Onboarding · Recon · Workspace · Audit · Dashboard, filtered by role
- [ ] `app/layout.tsx` with shell
- [ ] `lib/rbac/roles.ts` — types + `requireRole(role)` helper for server components
- [ ] Three role-based landing redirects (analyst → workspace, manager → dashboard, auditor → audit)

### Acceptance
- Login with each of the three seeded users
- Sidebar nav differs per role
- Hitting a forbidden route server-side returns 403, not a broken page

---

## Phase 3 — Onboarding flow (1:00 → 2:00)

### Deliverables
- [ ] `app/onboarding/page.tsx` — stepper (Upload → Map → Validate → Save)
- [ ] `components/onboarding/UploadDropzone.tsx` — CSV + XLSX parsing via papaparse / xlsx
- [ ] `app/api/ai/infer-schema/route.ts` — calls `gpt-4o-mini` with tool use; input = headers + 5 rows; output = `{ field, canonical_field, confidence, reasoning }[]`
- [ ] `components/onboarding/MappingEditor.tsx` — two-col table, editable canonical dropdown, confidence chip, "Why?" popover
- [ ] `app/api/canonical/validate/route.ts` — runs mapping against full file, returns `{ row_count, errors, sample_normalized }`
- [ ] `app/api/sources/route.ts` — POST creates `source_profile` v1; subsequent edits create v2+ (never mutate)
- [ ] `components/onboarding/VersionHistory.tsx` — list of profile versions
- [ ] Audit writes on every save

### Acceptance
- Upload `data/seed/broker-b.csv` → mapping editor loads with ≥ 10/14 AI-inferred mappings → edit 2 → save → row appears in `/onboarding` version history
- `ai_calls` table has a row
- `audit_events` has a row

---

## Phase 4 — Matching engine (2:00 → 2:45)

### Deliverables
- [ ] `lib/matching/normalize.ts` — trim, uppercase IDs, ISO dates, Decimal
- [ ] `lib/matching/hash.ts` — SHA-256 composite-key hasher
- [ ] `lib/matching/blocking.ts` — `(symbol, trade_date, direction)` bucketing
- [ ] `lib/matching/similarity.ts` — Jaro-Winkler, Levenshtein, Metaphone, numeric relative tolerance, date day-delta, embedding cosine (stub if time short)
- [ ] `lib/matching/fellegi_sunter.ts` — `m`/`u` default weights, per-field agreement + disagreement weights, total → sigmoid → posterior
- [ ] `lib/matching/engine.ts` — orchestrates the 6 layers, returns `MatchExplanation[]`
- [ ] `app/api/ai/tiebreak/route.ts` — only called on MEDIUM band; `gpt-4o-mini` with JSON mode
- [ ] `app/api/ai/embed/route.ts` — `text-embedding-3-small` for counterparty; cached to DB
- [ ] `app/api/recon/run/route.ts` — selects trades, runs engine, writes `match_results` + `exceptions`
- [ ] `tests/matching/fellegi_sunter.test.ts` — 5 test cases
- [ ] `tests/matching/engine.test.ts` — 3 end-to-end cases

### Acceptance
- `pnpm test` passes
- Hitting `/api/recon/run` on seeded data produces sensible band distribution (roughly: 70% HIGH via deterministic, 15% MEDIUM, 10% LOW, 5% unmatched)
- Every `match_result.field_scores` is a JSON array of `{ field, raw_score, weight, contribution }`

---

## Phase 5 — Exception workspace (2:45 → 3:30)

### Deliverables
- [ ] `app/workspace/page.tsx` — 3-pane shadcn `resizable-panels`
- [ ] `components/workspace/QueueTable.tsx` — TanStack Table: ID, symbol, counterparty, qty, amount, band chip, age, assignee; filters: band, source-pair, age, assignee
- [ ] `components/workspace/ComparePane.tsx` — two-card side-by-side; field table with agree/tolerance/disagree coloring; posterior progress bar; score breakdown sorted by contribution
- [ ] `components/workspace/AiExplanationCard.tsx` — renders `llm_verdict.reasoning` in collapsible with AI-assisted badge
- [ ] `components/workspace/ActionPanel.tsx` — Accept / Reject / Escalate / Note / Assign; keyboard shortcuts A/R/E/J/K
- [ ] `app/api/exceptions/[id]/actions/route.ts` — POST analyst actions; writes `analyst_actions` + `audit_events` + updates `exceptions.status`
- [ ] `app/api/ai/explain-break/route.ts` — called once per exception when first opened; output cached on `exceptions.explanation`
- [ ] `app/api/ai/next-best-action/route.ts` — GPT suggestion shown in action panel

### Acceptance
- Full open-an-exception flow: row click → compare loads → explanation renders → Accept button writes action + audit + closes exception
- `J` / `K` navigate rows
- Auditor role sees compare pane but actions are disabled

---

## Phase 6 — Evals + audit + dashboard (3:30 → 3:45)

### Deliverables
- [ ] `lib/eval/gold.ts` — loads `data/eval/gold.jsonl`
- [ ] `lib/eval/metrics.ts` — precision, recall, F1, per-band breakdown
- [ ] `lib/eval/run.ts` — runs engine on gold pairs, writes `eval_runs` row
- [ ] `app/api/eval/run/route.ts` — POST (manager/auditor only)
- [ ] `app/dashboard/page.tsx` — 4 KPI tiles + evals tile + 2 Recharts (break-aging histogram, match-rate-by-source line)
- [ ] `app/audit/page.tsx` — TanStack Table of `audit_events`, filters by actor/action/date, CSV export
- [ ] "Run Evals" button wired to `/api/eval/run`

### Acceptance
- Dashboard renders with seeded + live values
- Clicking Run Evals adds a row and updates the tile within 30s
- Audit log is filterable and exports a CSV

---

## Phase 7 — Polish, Loom, deploy (3:45 → 4:00)

### Deliverables
- [ ] README with: what this is, architecture diagram reference, setup (env vars + `pnpm seed` + `pnpm dev`), demo credentials, links to all docs
- [ ] Vercel deploy with Supabase env vars
- [ ] Seed the production Supabase with the same data
- [ ] 5-minute Loom walkthrough following `docs/DEMO_SCRIPT.md`
- [ ] Final pass on `docs/DECISIONS_LOG.md`

### Acceptance
- Live URL loads
- All 3 demo users can log in
- Loom link pasted into README

---

## Stretch goals (only if a phase ends early)

| Stretch | Phase unlock | Effort |
|---------|--------------|--------|
| Counterparty embeddings wired end-to-end (currently stub) | Phase 4 | +15 min |
| Rule-draft proposal after analyst action | Phase 5 | +15 min |
| LLM-as-judge second eval metric | Phase 6 | +10 min |
| Source quality tile with drift warning | Phase 6 | +10 min |
| Keyboard-only walkthrough mode | Phase 7 | +10 min |

**Rule: never steal time from a later phase to finish a stretch goal in an earlier one.**

---

## Drop-list (if behind schedule, in this order)

1. Next-best-action API (Phase 5)
2. Match-rate-by-source line chart (Phase 6)
3. Embeddings entirely — keep Jaro-Winkler only (Phase 4)
4. Eval history sub-page (Phase 6)
5. Version history UI for source profiles (Phase 3) — keep backend versioning, skip UI
6. LLM tiebreak — keep deterministic-only on MEDIUM band

If item 6 gets dropped, the demo narrative changes: emphasize the
Fellegi-Sunter decomposition as the AI-native differentiator instead of the
LLM tiebreak.

---

## Definition of Done

- [ ] All three demo users log in to their correct landing page
- [ ] Every demo beat in `docs/DEMO_SCRIPT.md` is reachable without code edits
- [ ] Seed data tells a realistic story (format drift, CPY variants, date drift, rounding)
- [ ] `pnpm test` passes
- [ ] Evals tile shows F1 ≥ 0.85
- [ ] Live Vercel URL works
- [ ] Loom recording uploaded
- [ ] README has one-command setup
- [ ] `DECISIONS_LOG.md` captures every deviation from this plan
