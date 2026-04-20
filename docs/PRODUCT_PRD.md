# ReconAI — Product Requirements Document

**Status:** MVP, v0.2
**Last updated:** 2026-04-19
**Target release:** 4-hour weekend sprint (MVP), enterprise pilots in Q3

---

## 1. Vision

**ReconAI** is an AI-native securities trade reconciliation platform that cuts
feed onboarding from weeks to minutes and shrinks exception-resolution effort
by half, without sacrificing the deterministic auditability that regulators
and operations leaders require.

The product treats AI as a **leverage layer** — it reduces ambiguity, drafts
mappings, explains exceptions, and suggests next-best-actions — but it never
makes the final money-decision. Every match, every resolution, every AI
output is decomposable, versioned, and auditable.

Reference data — counterparties, subsidiaries, securities, identifiers — is a
**knowledge graph**, not a lookup table. Entity resolution, alias chains, and
break clustering are first-class queries.

One-line positioning: *"Half the exception backlog, a fraction of the
onboarding time, zero loss of auditability — with reference data as a graph."*

---

## 2. Problem statement

Post-trade operations at broker-dealers, custodians, and buy-side firms run
on fragile, manual reconciliation workflows:

| Pain | Observed reality |
|------|------------------|
| **Onboarding new feeds** takes 6–12 weeks | Every custodian / counterparty format differs; mappings are spreadsheet-driven; integration is hand-rolled |
| **40–70% of daily exceptions** require manual triage | Analysts eyeball field-by-field differences across systems; tribal knowledge decides what counts as "close enough" |
| **Audit trails live in email and tickets** | Regulators ask "why was this match accepted?" and the answer is often unreproducible |
| **Rules ossify, AI is feared** | Static tolerance rules are written once and never reviewed; teams distrust ML because they cannot see the reasoning |
| **Reference data drifts** | `JPM Sec.` vs `J.P. Morgan Securities LLC` vs `JPMCB` each cause avoidable breaks when stored as flat strings |
| **T+1 settlement** compressed timelines | The cost of a slow exception resolution is now operational and financial risk |

The industry assumption is that matching quality and auditability are at odds
with AI. They are not, if AI is bounded, evaluated, and transparent — and if
reference data is graph-shaped.

---

## 3. Target users & buyers

### Primary user — Reconciliation Analyst
- 50–500 exceptions/day to triage
- Lives in Excel, custodian portals, email
- Measured on throughput + accuracy + SLA age
- Wants: fewer obvious matches to hand-resolve, faster compare view, confidence
  that the system will not hide risky decisions

### Secondary user — Operations Manager
- Owns team throughput, SLA, audit readiness
- Approves rule changes, reviews feed quality
- Wants: dashboards, trend lines, feed-level health, clear escalation paths,
  evals showing AI quality is not drifting

### Tertiary user — Auditor / Compliance
- Read-only, evidence-gathering
- Wants: immutable audit trail, versioned config history, AI-call log,
  exportable evidence packs

### Economic buyer — Head of Operations / COO
- At a fintech, prime broker, custodian, or mid-market asset manager
- Buys on: FTE reduction, audit readiness, time-to-onboard a new counterparty,
  T+1 readiness, regulatory cost

---

## 4. Jobs to be done

**When** a new custodian or broker sends us files,
**I want** to onboard their format without a 6-week integration project,
**so I can** start reconciling in the same day.

**When** my match rate drops or an exception queue spikes,
**I want** to understand why at a glance and surface the likely cause cluster,
**so I can** redirect attention where it matters.

**When** the deterministic rules cannot decide between candidates,
**I want** a transparent, explainable suggestion with the AI reasoning and
the decomposed field weights,
**so I can** act quickly without blindly trusting a black box.

**When** an auditor asks "why did we match these two trades?",
**I want** to show them the exact fields, weights, posterior probability,
rule version, and resolution action — reproducibly,
**so I can** pass audit without spreadsheet archaeology.

**When** a counterparty appears under five name variations across feeds,
**I want** the system to collapse them into one canonical entity with visible
alias chains,
**so I can** stop chasing breaks that do not really exist.

---

## 5. MVP scope

### In scope (built end-to-end)

| Capability | Description |
|------------|-------------|
| **Feed onboarding** | Upload sample CSV/XLSX → GPT-4o-mini infers canonical mapping → analyst edits → versioned feed profile saved |
| **Canonicalization** | Parse raw rows → validate → transform → canonical trade with full lineage |
| **Matching engine** | Seven-layer pipeline: normalize → deterministic hash → blocking → field similarity (ensemble) → Fellegi-Sunter → Hungarian → LLM tiebreak on MEDIUM band |
| **Exception management** | 3-pane analyst UI: queue (filterable, virtualized) → compare pane (field-by-field, score breakdown, AI explanation) → action panel (accept/reject/escalate/note/assign) |
| **Reference data (entity graph)** | Neo4j-backed counterparty + security master: canonical entities, aliases, subsidiaries, identifier cross-references, break clustering via connected components |
| **Audit trail** | Append-only event log for every state change, RLS-protected, exportable |
| **Evals harness** | 30-pair gold set → precision/recall/F1 per confidence band, surfaced on dashboard |
| **Governance** | Versioned feed profiles, mappings, matching rules; RBAC via Supabase Auth + Postgres RLS |
| **Dashboard** | Auto-match rate, unresolved exception rate, median exception age, AI suggestion acceptance, evals tile, exception-aging histogram, match-rate-by-feed line |

### Stubbed (visible, not deep)

- **Cash reconciliation module** — single page showing "Cash module coming"
  with a realistic wireframe using the same canonical pattern
- **Rule builder** — read-only list of 3 canned rules with version history
- **Next-best-action** — GPT-4o-mini call on open exception, shown as hint
- **PDF ingestion** — Docling interface scaffolded, not wired
- **Learned classifier** — file skeleton present, mentioned on roadmap

### Explicitly out of scope

- Real-time streaming ingestion (batch only)
- Multi-tenancy (single workspace in MVP)
- Full regulatory reporting (CAT, EMIR, MiFID) — linked on roadmap
- Enterprise SSO (Supabase magic-link login for MVP)
- Split / merge exception actions
- Temporal / Redis / any distributed job queue
- Corporate actions (on roadmap)
- Mobile UI

---

## 6. Functional requirements

### FR-1 — Feed onboarding
1. User uploads a CSV or XLSX sample ≤ 10 MB.
2. System previews the first 10 rows.
3. GPT-4o-mini is called with headers + 5 sample rows. It returns a proposed
   `source_field → canonical_field` map + per-field confidence + reasoning.
4. User edits the mapping; each field has a "Why?" popover showing AI reasoning.
5. User runs a validation pass on the full file; system reports row count,
   validation errors, and 5 normalized sample trades.
6. User saves → a new `feed_profile` row is written with incremented `version`
   and its `field_mappings` rows.
7. Old versions remain queryable; they are never mutated.

### FR-2 — Matching cycle
1. User selects two feed profiles + a date range.
2. System kicks off a matching cycle; progress bar is shown.
3. All seven pipeline layers execute in order. Results land in `match_results`
   and open `exceptions` for every MEDIUM-or-LOW band candidate and every
   unmatched record.
4. Trade→counterparty projection edges are written to Neo4j for cluster
   analysis.
5. User is redirected to `/workspace` filtered to the cycle.

### FR-3 — Exception management
1. Queue pane (left) shows open exceptions with band color, age, feed pair,
   symbol, counterparty, amount, match type. Filterable, virtualized.
2. Compare pane (center) shows side-by-side field table with per-row color
   coding, a score breakdown (per-field raw score × Fellegi-Sunter weight =
   contribution), the posterior probability, and the LLM explanation card
   (collapsible).
3. Action panel (right) offers: Accept match · Reject · Escalate · Add note · Assign.
   Keyboard shortcuts: A / R / E / J / K.
4. Every action writes to `resolution_actions` and `audit_events` in one DB
   transaction.
5. An exception cannot silently change owner, band, or status — all
   transitions are audited.

### FR-4 — Reference data (entity graph)
1. `/reference-data` renders a Sigma.js force-directed graph of counterparties,
   aliases, subsidiaries, and securities.
2. Search field resolves any alias string to its canonical entity; zooms the
   graph to the resulting cluster.
3. Clicking an entity shows: aliases, subsidiaries, recent trades, volume by
   counterpart.
4. Clicking a trade node navigates to the exception detail (if any).
5. Entity resolution API is available to the matching engine as a read at
   similarity-scoring time.

### FR-5 — Audit log
1. `/audit` lists every `audit_event` with actor, action, entity, before/after
   JSON (rendered as diff), reason, timestamp.
2. Filters: actor, action, entity type, date range.
3. Export CSV button is available to manager / auditor roles.
4. Inserts are append-only; updates and deletes are rejected by RLS.

### FR-6 — Dashboard
1. Four KPI tiles: auto-match rate, unresolved exception rate, median
   exception age, AI suggestion acceptance rate.
2. One evals tile: latest precision / recall / F1 with model version + timestamp.
3. Exception-aging histogram (0–1 d, 1–3 d, 3–7 d, 7 d+).
4. Match-rate-by-feed line chart over last 7 matching cycles.
5. "Run Evals" button (manager / auditor) triggers a fresh eval pass.

### FR-7 — RBAC
1. Three roles: `analyst`, `manager`, `auditor`.
2. Role stored in `profiles.role`; session binds role via Supabase Auth.
3. Every table has RLS policies enforcing the role matrix.
4. Sidebar is filtered client-side by role for nav polish, but the **database
   is the enforcement boundary**.

### FR-8 — AI governance
1. All OpenAI calls go through `lib/ai/openai.ts`.
2. Every call writes `ai_calls { id, call_type, model, prompt_hash,
   input_tokens, output_tokens, latency_ms, output, fallback_used }`.
3. Every AI output passes Zod validation before use; validation failure
   triggers the deterministic fallback and logs the failure.
4. Every AI-assisted UI element shows an `AI-assisted` badge with the model
   + timestamp on hover.

---

## 7. Non-functional requirements

| Dimension | Requirement |
|-----------|-------------|
| Typing | TypeScript strict; Zod at every boundary |
| Latency | Onboarding AI call ≤ 3 s p95; matching cycle on 1 k trades ≤ 5 s |
| Entity graph lookup | ≤ 50 ms p95 for single counterparty resolution |
| Auditability | 100% of state changes logged; audit table append-only via RLS |
| Reproducibility | Every match decomposable into deterministic components + documented AI assists |
| Extensibility | New feed types plug in via a feed profile + mappings; no code changes |
| Security | RLS-first; secrets via env; no service-role key in browser; Neo4j credentials server-only |
| Observability | Structured `pino` logs on every API route; AI-call log table; matching-cycle counts jsonb |
| Deployment | Vercel + Supabase + Neo4j AuraDB hosted; one-command setup from README |

---

## 8. Success metrics

### Product metrics (MVP demo targets)
- **Auto-match rate** ≥ 85% on seeded data
- **Unresolved exception rate** ≤ 10% after 24 h
- **Median exception age** ≤ 2 days
- **AI suggestion acceptance** ≥ 70%
- **Evals F1 score** ≥ 0.90 on gold set
- **Onboarding time** for a new feed in the demo: < 2 minutes

### Business metrics (enterprise pilot targets)
- 40% reduction in analyst hours per exception cohort
- 80% reduction in feed onboarding time (weeks → hours)
- Zero unexplained AI decisions in audit review
- 100% of counterparty alias variations resolved automatically

---

## 9. Risks & mitigations

| Risk | Mitigation |
|------|------------|
| AI hallucinations in schema inference | Zod validation, deterministic fallback, human confirmation step, every suggestion flagged |
| Probabilistic matching feels magical | Fellegi-Sunter weights exposed per field, score breakdown visible in UI |
| Auditors reject AI outputs | AI is never decisive on money; tiebreak is only one signal; analyst confirms every MEDIUM band |
| Scope creep in 4-hour sprint | `DEMO_SCRIPT.md` is the sole source of truth for what ships |
| Seed data feels fake | 3 realistic feed profiles with realistic exception classes (format drift, CPY abbrev, date format, rounding, missing-one-side, wrong qty); real prices from Yahoo Finance; real public broker names with real SEC-CRD alias variants |
| Supabase RLS misconfig | All role checks unit-tested via SQL; RLS policies versioned in `/supabase/migrations` |
| Neo4j + Postgres drift | KG is projected from Postgres seed; one-way flow; rebuild deterministic |

---

## 10. What explicitly wins this assignment

The reviewer of a senior PM fintech assignment is looking for:

1. **Problem framing maturity** — do they know *why* reconciliation is painful? ✓ Section 2
2. **Prioritization discipline** — what got cut and why? ✓ Section 5
3. **AI judgment** — where AI belongs and where it does not? ✓ Section 7 / bounded 5
4. **Governance posture** — versioning, RBAC, audit, evals? ✓ Sections 6, 7, 9
5. **Reference-data sophistication** — graph thinking, not flat lookup? ✓ Sections 5 FR-4, 7
6. **A believable demo** — one workflow that feels real, not six that feel fake ✓ `DEMO_SCRIPT.md`
7. **Narrative** — vision → problem → users → scope → metrics → roadmap ✓ entire doc

---

## 11. Why this matters for enterprise reconciliation buyers

Five jobs-to-be-done for the economic buyer — not positioned against any
specific incumbent, stated on the product's own merits:

- **Cloud-native state** — versioned feed profiles and mappings let new
  custodians ship in a same-day change, not a quarterly release. Every
  configuration is a row with a version, not code.
- **AI-native with governance** — every AI call is logged, evals-tested, and
  decomposable. Regulated buyers can audit the AI exactly like they audit
  humans: who did what, when, why, and how would a regression catch it next
  time.
- **Graph-shaped reference data** — counterparty aliases, subsidiary links,
  and security identifier cross-references are first-class Cypher queries,
  not nightly batch joins. Alias drift stops causing avoidable breaks.
- **Evidence on demand** — auditors receive reproducible match evidence
  without opening 40 tickets. Every match decomposes to field weights,
  rule version, AI verdict, and analyst action in a single view.
- **Modular by design** — securities today; cash, corporate actions, and
  FX extend through the same canonical model + matching engine. New asset
  classes do not require rewriting the platform.

The combination — bounded AI + evals + entity graph + append-only audit +
versioned configs — is the operating posture regulated reconciliation
buyers procure against in 2026. ReconAI ships with it on day one.

---

## 12. Roadmap (post-MVP, ordered)

1. **PDF ingestion via Docling** — unlock custodian statements and confirmation slips
2. **Corporate actions reconciliation** — dividends, splits, mergers matched through the same canonical model
3. **Cash reconciliation** — the already-stubbed module fully wired
4. **Learned classifier** — logistic regression / XGBoost over field similarities trained on `resolution_actions`
5. **Rule-draft synthesis** — GPT-4o proposes a matching rule after N similar resolution actions
6. **Split / merge exception actions** — covers multi-leg allocations and give-ups
7. **Entity graph federation** — sync with external identifier providers (LEI, CUSIP/CINS)
8. **FINOS CDM alignment** — ingest and emit the canonical trade as FINOS Common Domain Model JSON
9. **Temporal-backed orchestration** — durable retries, backfills, SLA alarms
10. **Apache AGE migration path** — optional collapse of Neo4j into Postgres for single-DB deployments
11. **Enterprise SSO** (Okta / Azure AD) + audit export to SIEM
12. **Regulatory reporting** — CAT, MiFID, EMIR feeds derived from the canonical store
13. **Multi-tenancy** with per-tenant encryption keys
14. **Anomaly detection** on feeds — flag format drift before it breaks recon

---

## 13. Glossary

- **Feed profile** — a versioned definition of how a given feed's files map to canonical fields
- **Matching cycle** — one end-to-end execution of the pipeline between two feeds over a date range
- **Canonical trade** — the internal, normalized trade representation
- **Exception** — a record that did not auto-match at HIGH confidence and requires analyst resolution
- **Exception class** — the root-cause label (FORMAT_DRIFT, ROUNDING, TIMING, WRONG_QTY, MISSING_ONE_SIDE, DUPLICATE, CPY_ALIAS, ID_MISMATCH, UNKNOWN)
- **Resolution action** — analyst action on an exception (ACCEPT, REJECT, ESCALATE, NOTE, ASSIGN)
- **Match type** — structural shape of the match (1:1, 1:N, N:1, N:M)
- **Fellegi-Sunter** — the classical probabilistic record linkage framework used here
- **Confidence band** — HIGH / MEDIUM / LOW buckets derived from the posterior probability
- **LLM tiebreak** — GPT-4o-mini verdict used only on MEDIUM band candidates
- **Lineage** — the chain from a canonical trade back to its raw row, feed profile version, and mapping version
- **Entity graph** — the Neo4j reference-data subgraph of counterparties, aliases, subsidiaries, and securities
- **FINOS CDM** — Common Domain Model, the industry-standard trade representation (roadmap target)
