# ReconAI — Decisions Log

An append-only record of material architectural, product, and scoping
decisions made during the build. New entries go at the top.

---

## 2026-04-21 — ADR-012 — Pipeline Profiles: per-asset-class pipeline configuration + AI suggester

**Context:** The matching pipeline has 7 fixed stages (normalize → hash →
blocking → similarity → Fellegi-Sunter → Hungarian → LLM tiebreak). The
*sequence* is universal; the *configuration* of each stage (price tolerance,
quantity tolerance, date proximity, band thresholds, tiebreak band) must
vary by asset class — FI needs 0.1bp price sensitivity, equities ~1%, FX
in pips.

Before this change, `matching_rules.tolerances` was stored in the DB but
silently ignored: `similarity.ts` hardcoded `priceScore(cap=0.01)` and
`fellegi_sunter.ts` hardcoded band thresholds at `0.95 / 0.70`. A
`pipelines` table with Equities and FX rows existed but was decorative —
switching pipelines did not change engine output.

**Decision:** Make the existing infra honest.

1. `scoreFields` now accepts `tolerances: EngineTolerances` and threads
   `price_rel_tolerance`, `quantity_rel_tolerance`, `date_day_delta`
   through to `priceScore`, `quantityScore`, `dateProximity`.
2. `computePosterior` now accepts `bands: BandThresholds`. Default stays
   at `{high_min: 0.95, medium_min: 0.7}`.
3. `runMatchingCycle` reads `matching_rules.tolerances.bands` and
   `matching_rules.tolerances.{price_rel_tolerance,...}` and passes them
   into `runEngine`.
4. New **6th AI seam** — `PIPELINE_SUGGEST`. Given feed mapping +
   sample rows + asset class hint, GPT proposes a tolerances + bands JSON
   with per-field rationale and warnings. Zod-validated, `ai_calls`
   audited, falls back to equities defaults on failure.
5. **UI**: "Suggest with AI" button in the existing `/pipeline` page's
   Expert Mode — populates the form with GPT's proposal; the analyst
   publishes it via the existing versioned-rules flow.
6. **Seeded Fixed Income pipeline** with `price_rel_tolerance: 0.00001`
   (0.1bp), band `{0.97, 0.72}`.

**Verification:** Same Broker B data, run twice.

| Pipeline | HIGH | MEDIUM | LOW | Exceptions |
|---|---|---|---|---|
| Equities (1%, 0.95/0.70) | 87 | 5 | 3 | 13 |
| Fixed Income (0.1bp, 0.97/0.72) | **82** | **10** | 3 | **18** |

5 trades correctly demoted from HIGH → MEDIUM under FI semantics. The
tolerances now *actually* change engine behavior, end-to-end.

**Alternatives rejected:**
- **New `pipeline_profiles` table**: the existing `pipelines` +
  `matching_rules (weights, tolerances, pipeline_id)` already had the
  right shape. Adding a parallel table would have duplicated the
  versioning pattern and broken existing FKs on `matching_cycles`.
- **Per-stage enablement flags**: deferred. The current 7 stages are
  universally valid; skipping Hungarian or LLM tiebreak for specific
  use cases can be a Phase 2 feature.
- **Let AI write `weights` not just `tolerances`**: too risky without
  evals — the m/u priors are what makes Fellegi-Sunter principled. AI
  can tune thresholds; humans own the probabilistic priors.

**Consequence:** Adding a new asset class is now an ops task (seed one
`pipelines` row + one `matching_rules` row), not a code change. The AI
suggester gives the first-draft of the config. The 6th seam joins the
existing 5 in `CLAUDE.md`'s "AI is bounded" rule.

**Files:**
- `lib/matching/similarity.ts`, `fellegi_sunter.ts`, `engine.ts`, `run-cycle.ts`
- `lib/ai/openai.ts` (new `AiCallType: 'PIPELINE_SUGGEST'`)
- `lib/ai/prompts/suggest-pipeline.ts` (new)
- `app/api/ai/suggest-pipeline/route.ts` (new)
- `components/pipeline/ExpertMode.tsx` (Suggest with AI button)
- `app/pipeline/PipelineClient.tsx` (pass asset class + feed to ExpertMode)
- `tests/matching/pipeline_profile.test.ts` (new — 8 tests)
- DB: `INSERT INTO pipelines ('Fixed Income', 'FI', ...)` + matching_rules row

---

## 2026-04-20 — ADR-011 — Split ROUNDING into ROUNDING + WRONG_PRICE

**Context:** The classifier in `lib/matching/run-cycle.ts` labelled every
price-score < 0.5 exception as `ROUNDING`, regardless of the actual price
delta. On real trade data (V SELL 500 @ $282.07 vs $286.30 — 1.5% drift,
~$2,115 notional delta) this produced a `ROUNDING` tag with posterior 1.00
and a default `Accept match` action — i.e. the UI was one keystroke away
from booking a materially wrong price.

**Decision:** Split the price-break class into two:
- `ROUNDING` — absolute price delta ≤ `max($0.01, 0.5bp × price)`. Precision
  / display artifact. Recommended action: `ACCEPT`.
- `WRONG_PRICE` — anything above that cap. Material money break.
  Recommended action: `ESCALATE`.

Classification uses the raw prices of the two matched trades (available via
`tradeById` in `run-cycle.ts`), not just the similarity score — because the
price similarity function caps at 1% relative diff, a score of 0.8 could
mean either a $0.002 rounding or a $0.20 genuine break.

**Affected:**
- `lib/canonical/schema.ts` — enum extended
- `lib/matching/run-cycle.ts` — `classifyPriceBreak()` added; called from
  `classifyAll()`
- `lib/matching/templated-explain.ts` — WRONG_PRICE template added
- `lib/ai/prompts/{explain-break,next-best-action,rule-drafts,search}.ts` —
  prompts updated so GPT-5.4 can emit `WRONG_PRICE` and rule-drafts will
  not propose auto-accepting it
- `lib/governance/rules.ts` — new `tolerance_rounding_cap` governance row
- `scripts/generate-seed.ts` — bucket 6 retuned to sub-cent for genuine
  ROUNDING; 1.5%-drift bucket relabelled to `PRICE_BREAK_MATERIAL` →
  `WRONG_PRICE` in gold mapping
- `data/eval/gold.jsonl` — G027/G028 flipped (ROUNDING → WRONG_PRICE);
  G031/G032 added for genuine ROUNDING; G033 added for the V SELL case

**Alternatives rejected:**
- Tighten the price similarity cap from 1% → 0.5bp: would under-score real
  matches with tiny drift and re-introduce the problem on the other side.
- Keep one class, disambiguate in UI: hides the problem from the audit log
  and the eval harness.

**Consequence:** Any future price-break analysis must consult the raw
prices of the two trades, not the similarity score alone. Existing open
`ROUNDING` rows in the DB with delta > rounding cap are legacy; next
matching cycle will reclassify them.

---

## 2026-04-19 — ADR-010 — `.mcp.json` is gitignored for MVP

**Context:** `.mcp.json` contains the Neo4j password inline.
**Decision:** Add `.mcp.json` to `.gitignore` for the MVP sprint. Provide a
`.mcp.json.example` template post-MVP for other contributors.
**Consequence:** Anyone cloning the repo must recreate their own `.mcp.json`.
Trade-off accepted for the 4-hour sprint.

---

## 2026-04-19 — ADR-009 — Neo4j AuraDB for the entity graph

**Context:** The knowledge graph needs real graph-DB primitives (traversal,
connected components, pattern matching), not JSON hacks in Postgres.
**Decision:** Use **Neo4j AuraDB free tier** as a second datastore alongside
Supabase. Apache AGE on Supabase would have worked but is not in Supabase's
supported extensions list. `mcp-neo4j-cypher` MCP server gives dev-time
Cypher access during the build.
**Alternatives rejected:**
- Apache AGE — blocked by Supabase extension policy
- In-memory `graphology` only — loses persistence and scale story
- Obsidian — not an application database
**Consequence:** Two datastores to manage. Acceptable because KG is read-heavy
and loosely coupled. `neo4j-driver` is the only runtime dependency.

---

## 2026-04-19 — ADR-008 — Vocabulary is industry-standard, not incumbent-flavored

**Context:** We debated SmartStream-specific language (TLM, Aurora, RDU).
**Decision:** Use **industry-standard** reconciliation vocabulary only: feed
profile, matching cycle, exception management, match types (1:1, 1:N, N:M, N:1),
canonical trade, resolution action. No references to specific vendor products.
**Consequence:** Build stands as an independent product a PM candidate
designed. Domain literacy is shown through the vocabulary and industry
standards cited (SWIFT MT541/543, FIX 4.4, DTCC ITP, FINOS CDM), not through
name-dropping an employer's product line.

---

## 2026-04-19 — ADR-007 — AI bounded to five seams

**Context:** "AI-native" can easily drift into "LLM for everything".
**Decision:** AI is permitted in exactly five places:
1. Feed schema inference (onboarding)
2. Counterparty embeddings for semantic similarity
3. MEDIUM-band tiebreak (analyst-visible, non-decisive)
4. Break explanation (cached, cosmetic)
5. Next-best-action suggestion (hint, not decision)
**Alternatives rejected:** LLM-based match decisions, LLM auto-resolution of
exceptions, LLM-driven rule changes.
**Consequence:** Deterministic path is always the source of truth. Every AI
call is Zod-validated, prompt-hashed, logged, and has a deterministic fallback.

---

## 2026-04-19 — ADR-006 — Single-app architecture (no FastAPI)

**Context:** Original plan included a Python FastAPI service.
**Decision:** Use **Next.js API routes** for all server logic. No Python.
**Rationale:** 4-hour budget, strict TS end-to-end, one deployable, zero
inter-service infra, Vercel-native.
**Consequence:** Pandas / Polars not available. Matching engine is hand-rolled
in TypeScript with `decimal.js` for numbers. Trade-off accepted; performance
targets are still met at demo scale.

---

## 2026-04-19 — ADR-005 — Fellegi-Sunter is the probabilistic core

**Context:** "Fuzzy match" alone is not PM-credible. We needed a textbook,
decomposable probabilistic framework.
**Decision:** Implement **Fellegi-Sunter log-likelihood record linkage** as
the probabilistic scoring layer. Per-field m/u probabilities, log₂-weighted,
sigmoid to posterior, three-band output.
**Alternatives rejected:** Pure fuzzy score sum, learned classifier in MVP,
LLM-only scoring.
**Consequence:** Scores are decomposable to the field; weights are versioned;
analysts and auditors can trace any match decision end-to-end.

---

## 2026-04-19 — ADR-004 — Seven algorithms in fixed order

**Context:** The matching pipeline must beat "fuzzy match" for pitch
credibility.
**Decision:** Fixed pipeline, documented in `MATCHING_ENGINE.md`:
normalize → hash → blocking → field similarity (5-metric ensemble for CPY) →
Fellegi-Sunter → Hungarian → LLM tiebreak (MEDIUM only).
**Consequence:** Each layer has a pure-function module, unit-tested. No
layer may be skipped for "speed" without a rule change.

---

## 2026-04-19 — ADR-003 — Append-only audit enforced by RLS, not app code

**Context:** Audit tables are the compliance deliverable; app-level checks
are not defensible.
**Decision:** `audit_events` has **RLS policies that reject UPDATE and
DELETE for every role, including service_role callers from the UI**.
`INSERT` is allowed for authenticated users.
**Consequence:** Auditors can trust the table. Bulk cleanup requires a
migration, which is itself auditable.

---

## 2026-04-19 — ADR-002 — Versioned configs, never mutated

**Context:** Feed profiles, field mappings, and matching rules change over
time. Mutation breaks reproducibility of past matching cycles.
**Decision:** `(natural_key, version)` compound keys. New version on every
change. Old rows stay queryable. `retired_at` marks superseded rows.
**Consequence:** Past matching cycles always reproduce against the exact
profile / mapping / rules they ran against.

---

## 2026-04-19 — ADR-001 — MVP is US equities + CSV/XLSX only

**Context:** The assignment spec mentioned PDF, FX, multi-asset. The 4-hour
budget forced a scope cut.
**Decision:** MVP ships **US equities, CSV + XLSX** only. Canonical schema
has `asset_class` but only `EQUITY` is populated. PDF/Docling interface is
scaffolded but not wired.
**Consequence:** `FI` / `FX` / `FUTURE` extend via the same schema. The
canonical model is not redesigned later; only ingestion and normalization
need additions.

---

## Template

```
## YYYY-MM-DD — ADR-NNN — Title
**Context:** why this came up
**Decision:** what we chose
**Alternatives rejected:** what we didn't choose and why
**Consequence:** what follows
```
