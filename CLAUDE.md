# ReconAI — Claude Code Operating Manual

> Source of truth for Claude Code sessions on this repository. Read this first,
> every session, before writing any code.

---

## Mission

Build an **AI-native securities trade reconciliation** MVP in a 4-hour weekend
sprint that feels enterprise-grade. This is a portfolio artifact for a Senior
Product Manager role in fintech reconciliation.

The platform must:

1. Ingest unstructured inputs from multiple sources (CSV, XLSX; PDF via Docling on roadmap)
2. Transform them into canonical trade representations
3. Apply layered **deterministic + probabilistic** matching with AI tiebreak
4. Orchestrate **human-in-the-loop** exception management
5. Preserve **full auditability** via append-only audit + versioned configs
6. Ground reference data in a **knowledge graph**, not a lookup table

Product principle: **AI is a leverage layer that reduces ambiguity, effort, and
time-to-resolution — it is not a money-decision-maker.**

---

## Locked vocabulary (industry-standard, no vendor-specific terms)

| Term | Meaning |
|------|---------|
| **Feed profile** | Versioned definition of how one incoming source's file maps to the canonical trade |
| **Field mapping** | A single `source_field → canonical_field` binding inside a feed profile (versioned) |
| **Canonical trade** | The internal normalized trade representation |
| **Matching cycle** | One end-to-end execution of the pipeline between two feeds over a date range |
| **Match result** | The output pair (trade_a, trade_b, posterior, band, field_scores) for a single candidate |
| **Match type** | 1:1 · 1:N · N:1 · N:M |
| **Exception** | An open item requiring analyst resolution (MEDIUM, LOW, or UNMATCHED) |
| **Exception class** | FORMAT_DRIFT · ROUNDING · WRONG_PRICE · TIMING · WRONG_QTY · MISSING_ONE_SIDE · DUPLICATE · CPY_ALIAS · ID_MISMATCH · UNKNOWN |
| **Resolution action** | The analyst's action on an exception (ACCEPT, REJECT, ESCALATE, NOTE, ASSIGN) |
| **Reference data** | The counterparty + security master, held in the Neo4j knowledge graph |
| **Entity graph** | The Neo4j reference-data subgraph (counterparties, aliases, subsidiaries, securities) |
| **Eval run** | One execution of the gold-set evaluation producing precision / recall / F1 |

Do not use: "source profile", "recon run", "break workspace", "break type",
"analyst action". Those legacy terms are banned in code, docs, and UI.

---

## Non-negotiables

1. **The demo script is the spec.** See `docs/DEMO_SCRIPT.md`. If a feature does
   not appear in the demo, do not build it.
2. **AI is bounded to 5 seams.** Schema inference, counterparty semantic
   similarity, MEDIUM-band tiebreak, exception explanation, next-best-action.
3. **Deterministic logic runs first, always.** Probabilistic matching only on
   the residuals.
4. **Every state-changing action writes to `audit_events`.** Append-only,
   immutable, actor + before/after + reason. No exceptions.
5. **Versioned configs only.** `feed_profiles`, `field_mappings`,
   `matching_rules` are never mutated — a new version row is written.
6. **Every AI output is Zod-validated and logged to `ai_calls`.** No black boxes.
7. **Every match score is decomposable.** Per-field weights exposed in the UI.
8. **Immutability in application code.** No in-place mutation of objects or
   arrays. Return new values.
9. **RBAC enforced at the database.** Postgres Row-Level Security, not
   application-layer checks.
10. **Neo4j is the reference-data system.** All counterparty / security master
    queries go through `lib/kg/*`. Postgres holds projected IDs only; the graph
    is authoritative for alias resolution, subsidiary traversal, and security
    identifier cross-references.

---

## Roles (Supabase Auth + Postgres RLS)

| Role | Can do |
|------|--------|
| `analyst` | Read trades/exceptions, run matching cycles, write `resolution_actions`, read audit log |
| `manager` | Everything analyst can + approve rule drafts, see all dashboards, run evals |
| `auditor` | Read-only access to everything, including audit log and AI call log |

Role is stored in `profiles.role` and enforced by RLS policies on every table.

---

## Tech stack (locked — do not swap without a `DECISIONS_LOG.md` entry)

- **Next.js 15** App Router + **React 19** + **TypeScript strict**
- **Tailwind** + **shadcn/ui** + **Radix** + **lucide-react**
- **TanStack Table v8** + **TanStack Virtual** for every data grid
- **Supabase** — Postgres, Auth, Storage, RLS, pgvector
- **Neo4j AuraDB** (free tier) + `neo4j-driver` — reference knowledge graph
- **Neo4j MCP** (`mcp-neo4j-cypher`) — dev-time Cypher access
- **OpenAI** — `gpt-4o-mini` (JSON mode), `text-embedding-3-small`
- **Zod** at every boundary (API, forms, AI responses)
- **React Hook Form** + `@hookform/resolvers/zod` for every form
- **Recharts** for dashboard; **react-sigma** + **graphology** for the entity graph
- **cmdk** (Cmd+K command palette), **react-hotkeys-hook**, **sonner**, **vaul**
- **zustand** for client-only workspace state
- **papaparse** (CSV), **xlsx** (XLSX), **Docling** (PDF — roadmap only)
- **natural** (Jaro-Winkler + Double Metaphone), **fastest-levenshtein**
- **munkres-js** for Hungarian assignment
- **decimal.js** for all money math
- **date-fns** + **date-fns-tz** for timezone-safe dates
- **jsondiffpatch** for audit before/after rendering
- **yahoo-finance2** for real-price seed data
- **pino** structured logging on every API route
- **Vercel** for deploy

---

## Canonical trade

```ts
CanonicalTrade {
  trade_id: string                            // internal UUID
  source_id: string                           // FK → feed_profiles
  source_ref: string                          // original ID from file
  trade_date: ISODate
  settlement_date: ISODate
  direction: 'BUY' | 'SELL'
  symbol: string
  isin: string | null
  cusip: string | null
  quantity: Decimal
  price: Decimal
  gross_amount: Decimal
  currency: ISO4217
  counterparty: string                        // raw from source
  counterparty_canonical_id: string | null    // FK → KG entity
  counterparty_embedding: vector(1536) | null
  account: string
  asset_class: 'EQUITY' | 'FI' | 'FX' | 'FUTURE' | 'OTHER'
  lineage: { raw_row_id: string, profile_version: int, mapping_version: int }
}
```

Full schema in `docs/CANONICAL_SCHEMA.md`.

---

## Matching pipeline (fixed order, fully decomposable)

1. **Normalize** — trim, uppercase IDs, ISO dates, Decimal-safe numbers
2. **Deterministic hash** — SHA-256(ID‖date‖qty‖price‖side‖account). Hit → HIGH band
3. **Blocking** — group by `(symbol, trade_date, direction)` to bound candidate pairs
4. **Field similarity (ensemble)** —
   - IDs (ISIN/CUSIP/symbol): exact
   - Dates: absolute day-delta
   - Numeric (qty, price): relative tolerance `|a-b|/max(|a|,|b|)`
   - Counterparty: `max(JaroWinkler, TokenSetRatio, JW+Metaphone, JW+embedding cosine)`
   - Account: Levenshtein
5. **Fellegi-Sunter probabilistic linkage** —
   - `m_i` = P(field agrees | true match), `u_i` = P(field agrees | not match)
   - Agreement weight `w_i = log₂(m_i / u_i)`
   - Disagreement weight `= log₂((1 − m_i) / (1 − u_i))`
   - Total = Σ weights → sigmoid → posterior probability
6. **Hungarian assignment** — one-to-one optimal within blocks for 1:1 match types
7. **LLM tiebreak** — MEDIUM band only (0.70 ≤ posterior < 0.95).
   `gpt-4o-mini` sees both records + field diff, returns structured
   `{ verdict, confidence, reasoning, decisive_fields }`. Analyst still confirms.

Every candidate emits:
```ts
MatchExplanation {
  posterior: number
  band: 'HIGH' | 'MEDIUM' | 'LOW'
  match_type: '1:1' | '1:N' | 'N:1' | 'N:M'
  field_scores: Array<{ field, raw_score, weight, contribution }>
  deterministic_hit: boolean
  llm_verdict: LLMVerdict | null
}
```

Full derivation and defaults in `docs/MATCHING_ENGINE.md`.

---

## AI call contract

Every OpenAI call:

1. Goes through `lib/ai/openai.ts` — no other module imports `openai` directly
2. Uses JSON mode or tool calling for structured output
3. Zod-validates the response before use
4. Writes a row to `ai_calls` (prompt hash, model, tokens, latency, output)
5. Has a deterministic fallback if the call fails
6. Surfaces an **AI-assisted** badge in the UI — never hides AI origin

---

## Knowledge graph contract

- All graph queries live in `lib/kg/queries.ts`; no component imports `neo4j-driver` directly
- Graph is seeded once at build time from public SEC CRD + security master data
- Mutations to the graph happen only in projection steps after a matching cycle
  (adding `Trade` nodes and `:MATCHED_WITH` edges for cluster analysis)
- Reads from the graph on the trade-matching hot path are capped: one lookup
  per unique counterparty string in a cycle, cached per-cycle

---

## Evals harness

- `data/eval/gold.jsonl` — 30 hand-labeled pairs (10 HIGH, 10 LOW, 10 MEDIUM-ambiguous)
- `lib/eval/run.ts` — feeds gold set through full pipeline, computes
  precision / recall / F1 overall and per confidence band
- Results written to `eval_runs` table, latest shown on `/dashboard`
- **Run Evals** button (manager / auditor only) triggers fresh run

Details in `docs/EVALS.md`.

---

## Folder structure

```
/app
  /(auth)/login
  /onboarding                → feed profile creation + mapping editor
  /matching                  → matching cycle runner + history
  /workspace                 → exception management 3-pane
  /reference-data            → entity graph + search
  /audit                     → log viewer
  /dashboard                 → KPI tiles + evals tile + charts
  /dashboard/evals           → eval history + confusion matrix
  /cash                      → stub page ("Cash module coming")
  /api
    /feeds                   → feed profile + mapping CRUD (versioned)
    /ingest                  → upload + parse
    /canonical               → normalize
    /matching                → run cycle
    /exceptions              → queue + resolution actions
    /audit                   → read
    /kg                      → entity search + graph slice
    /ai
      /infer-schema          → GPT-4o-mini + JSON mode
      /embed                 → counterparty embeddings
      /tiebreak              → MEDIUM band verdict
      /explain-break         → reasoning card
      /next-best-action      → analyst suggestion
    /eval
      /run                   → kick eval run
/lib
  /matching
    normalize.ts
    hash.ts
    blocking.ts
    similarity.ts
    fellegi_sunter.ts
    hungarian.ts
    match_types.ts
    engine.ts
  /canonical
    schema.ts                → Zod
    normalize.ts
  /ai
    openai.ts
    prompts/
  /kg
    neo4j.ts                 → driver singleton
    queries.ts               → typed Cypher
    seed.ts
  /eval
    run.ts
    metrics.ts
    gold.ts
  /supabase
    client.ts
    server.ts
  /audit
    log.ts                   → single write path
  /rbac
    roles.ts
  /logger
    pino.ts
/components
  /ui                        → shadcn primitives
  /layout                    → Shell, Sidebar, TopBar, CommandPalette
  /onboarding                → UploadDropzone, MappingEditor, VersionHistory
  /workspace                 → QueueTable, ComparePane, ScoreBreakdown,
                               AiExplanationCard, ActionPanel
  /reference-data            → EntitySearch, SigmaGraph, AliasList
  /audit                     → AuditTable, DiffViewer
  /dashboard                 → KpiTile, AgingHistogram, MatchRateLine, EvalsTile
  /shared                    → AiAssistedBadge, ConfidenceChip, MoneyCell,
                               DateCell, CopyableId
/docs
  DEMO_SCRIPT.md             ← source of truth
  PRODUCT_PRD.md
  SYSTEM_ARCHITECTURE.md
  CANONICAL_SCHEMA.md
  MATCHING_ENGINE.md
  UX_WORKFLOWS.md
  GOVERNANCE_RULES.md
  EVALS.md
  DATA_PROVENANCE.md
  BUILD_PLAN.md
  DECISIONS_LOG.md
/data
  /seed                      → internal.json, broker-a.csv, broker-b.csv, custodian.csv
  /eval                      → gold.jsonl
  /kg                        → counterparty_seed.json, security_seed.json
/supabase
  /migrations                → SQL migrations (versioned)
/scripts
  seed-supabase.ts
  seed-neo4j.ts
  fetch-real-prices.ts
```

---

## Build behaviour (every session)

1. Read `docs/DEMO_SCRIPT.md` and `docs/BUILD_PLAN.md`
2. State the demo beat being built
3. List the files you will touch
4. Implement
5. Update `docs/DECISIONS_LOG.md` on any deviation
6. Tick the checkbox in `docs/BUILD_PLAN.md`

---

## What NOT to do

- No FastAPI, no Python at runtime (only `uvx` for the Neo4j MCP dev tool)
- No Temporal, no Redis, no distributed queue
- No PDF ingestion wired in MVP (Docling interface stubbed only)
- No rule-builder UI (read-only list of 3 canned rules)
- No split / merge actions (accept / reject / escalate / note / assign only)
- No dashboard visuals beyond 4 KPI tiles + evals tile + 2 charts
- No tests for UI components — unit-test matching engine + evals harness only
- No comments describing what the code does
- No bypassing the deterministic layer for speed
- No calling OpenAI outside `lib/ai/openai.ts`
- No calling `neo4j-driver` outside `lib/kg/*`
- No writing audit records outside `lib/audit/log.ts`
- No mutating `feed_profiles`, `field_mappings`, `matching_rules` — new versions only
- No vendor-specific vocabulary (TLM, Aurora, RDU, or competitor names)

---

## Output discipline

- Short status updates, no over-explanation
- When a module lands: one sentence + next step
- If blocked: state the blocker + the decision needed, do not guess silently
