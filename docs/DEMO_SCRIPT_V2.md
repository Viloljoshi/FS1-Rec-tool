# ReconAI — Demo Script (v2, pre-interview pack)

> **Use this file as:** the full narrative you walk into the room with.
> It has three parts:
>
> - **Part A — Before you start the screen share** (the "pre-script")
> - **Part B — The live walkthrough** (what you click, in what order, what you say)
> - **Part C — The Q&A armoury** (every tradeoff and why, so curveballs land soft)
>
> Target length: 5 minutes live, 20 minutes incl. Q&A.
> Audience: Senior PM interviewer at an enterprise reconciliation buyer.
> They know the domain — every word of vocabulary must be industry-correct.

---

## Part A — Before you start the screen share (pre-script)

Open with these three lines, spoken (not shown):

1. **"I built this in a weekend against a real Supabase + Neo4j backend, using real April 2026 equity prices pulled from Yahoo Finance. Nothing mocked."**
2. **"I want to give you a product argument first, then show the screens. If at any point you want me to jump ahead to a screen, interrupt me."**
3. **"Three things I want you to notice: vocabulary, audit, and how AI is bounded. Those are the choices that make this feel enterprise-grade rather than an AI toy."**

### The one-slide problem statement (spoken, not shown)

> Post-trade operations reconcile millions of trades daily across brokers, custodians, and internal systems. Onboarding a new feed takes 6–12 weeks. 40–70% of daily breaks need manual triage. Audit trails live in spreadsheets. We replace the spreadsheets with an AI-native pipeline where every decision is decomposable, versioned, and reviewable — and where AI is a leverage layer, not a money-decision-maker.

### The product argument (in the room, before demo)

There are four things I had to get right for this to feel like a real product, not a hackathon:

| Principle | What it means in the repo |
|---|---|
| **Vocabulary is locked** | The domain has been reconciled for 30 years. Using wrong terms (e.g. "source profile" instead of "feed profile", "break" instead of "exception") signals you haven't done the work. The repo's `CLAUDE.md` has a locked-vocabulary table; I banned the legacy terms in code, docs, and UI. |
| **Deterministic logic runs first, always** | Every money-touching decision has to be reproducible without AI. A deterministic composite-hash hit catches ~80% of matches in clean feeds before any probabilistic work. AI only runs on ambiguous residuals. |
| **Audit-first, not audit-afterthought** | Every state-changing action writes one immutable row to `audit_events`. Every AI call writes one row to `ai_calls`: prompt hash, model, tokens, latency, validated output. Zod validates every AI output at the boundary. No black boxes. |
| **AI is bounded to 6 seams** | Schema inference · counterparty semantic similarity · MEDIUM-band tiebreak · exception explanation · next-best-action · pipeline suggestion. That's it. No "AI does the reconciliation." Everywhere AI touches a decision, there's an `AI-assisted` badge in the UI. |

### Why these constraints matter commercially

Most AI-recon pitches fail in enterprise because the buyer can't answer three questions to their auditor:
1. **"Why did the system accept this trade?"** — needs a decomposable match score with per-field weights.
2. **"What would have happened under last quarter's rules?"** — needs versioned configs, not mutated knobs.
3. **"Did a model change cause this regression?"** — needs an eval harness with a gold set and per-band / per-class F1.

This repo answers all three. That's the pitch.

---

## Part B — The live walkthrough (5 minutes, 8 beats)

### Beat 1 — The hook (0:00 → 0:30)

**URL:** `/login` → `/dashboard`

Log in as `manager@demo.co`. Land on the dashboard.

**Say:**
> "I'm logged in as a manager. Notice the KPIs are ground-truth from a real cycle — 95 matches, 13 open exceptions, 87 HIGH-band auto-accepts. The narrative box at the top is AI-generated from the actual counts; every AI output in this app gets a violet `AI-assisted` badge so an analyst always knows when a model spoke."

**Point to:**
- "Open exceptions by class" chart → WRONG_PRICE, WRONG_QTY, CPY_ALIAS.
- "AI-assisted" badge on the narrative card.

---

### Beat 2 — The 7-stage pipeline (0:30 → 1:15)

**URL:** `/pipeline`

**Say:**
> "The pipeline has 7 stages in a fixed order. Deterministic logic first, probabilistic next, AI last and only where it creates leverage. This ordering is the whole product argument — I can explain every decision layer-by-layer to an auditor."

**Click each stage badge in sequence while narrating:**

1. **Normalize** — "Multi-format date parse, Decimal.js for money math, ISIN/CUSIP normalization. Eliminates float drift and format drift before anything touches it."
2. **Deterministic Hash** — "SHA-256 over `ID ‖ date ‖ qty ‖ price ‖ side ‖ account`. Catches 80% of matches in clean feeds at zero AI cost. This is the 'why Hungarian over fuzzy' answer — we auto-accept the easy stuff deterministically first."
3. **Blocking** — "Groups by `(symbol, trade_date, direction)`. Reduces 100k × 100k = 10B candidate pairs to ~3k. This is the single biggest performance decision."
4. **Field Similarity Ensemble** — "Here's where fuzzy matching lives — Jaro-Winkler + token-set ratio + double metaphone + embedding cosine on counterparties, Levenshtein on accounts. Every scorer is decomposable."
5. **Fellegi-Sunter Posterior** — "Classic probabilistic record linkage. Each field gets an agreement/disagreement weight based on `log₂(m/u)`. Sum, sigmoid, get a posterior. Auditable, no neural-net magic."
6. **Hungarian 1:1 Assignment** — "Optimal one-to-one matching within each block. Mathematical guarantee — no two internal trades claim the same broker-side fill."
7. **LLM Tiebreak** — "Only runs on the MEDIUM band (0.70–0.95 posterior). GPT sees both records + the field diff, returns a verdict. Analyst still has to confirm. This is the one AI-in-the-loop decision; everything else is AI-assisted."

---

### Beat 3 — Per-asset-class pipelines (1:15 → 2:00)

**URL:** `/pipeline` — click the **Pipeline** tabs at top (Equities · FX · Fixed Income)

**Say:**
> "A reconciliation engine that treats FX and fixed income like equities is a toy. Here I have three pipelines — same 7 stages, different configuration of each stage. Watch what changes when I switch."

**Click "Fixed Income"** — point to Expert Mode section:

- Blocking keys chips → `[isin, trade_date, direction]` (was `[symbol, trade_date, direction]` on equities)
- Price relative tolerance → `0.00001` (was `0.01`)
- HIGH band floor → `0.97` (was `0.95`)

**Click "FX"** — point out:
- `enabled_stages` chip for `hash` is **off** (gray). "FX RFQ IDs rarely match between sides — the deterministic hash would waste a stage."
- Blocking keys → `[symbol, settlement_date, direction, currency]`.

**Say:**
> "So 'per-asset-class pipeline' isn't marketing — the engine actually reads this config at runtime. Every choice is explainable and versioned. The DB has a `pipelines` table, each with its own versioned `matching_rules` row. A cycle's `matching_cycles.pipeline_id` + `matching_rules_version` point to the exact config it ran under — so 'what would have happened under last quarter's rules' is a single join."

---

### Beat 4 — AI Pipeline Suggester (2:00 → 2:30)

**URL:** `/pipeline` — click **"Suggest with AI"** in Expert Mode card

**Say:**
> "Here's the 6th AI seam. I give GPT the feed mapping, a sample of rows, and the asset class. It proposes tolerances + bands + blocking keys + stage enablement + match types, each with a one-sentence rationale. The analyst reviews and clicks Publish, which creates a new versioned `matching_rules` row with a manager audit entry."

Wait for the suggestion, then point:
- The per-field rationale ("1% cap — industry-standard equities tolerance").
- The "warnings" list if present.
- **Don't publish yet** (the interviewer might ask to see it happen).

**Say:**
> "AI proposes; human disposes. GPT doesn't touch the Fellegi-Sunter m/u priors — those are the probabilistic heart of the matcher and stay human-owned. AI is allowed to suggest thresholds, not the math."

---

### Beat 5 — The V SELL exception (2:30 → 3:30) — the money moment

**URL:** `/workspace`

Find the row `V · SELL · 500 @ $282.07 vs $286.30` (WRONG_PRICE band MEDIUM).

**Say:**
> "This is the single most important screen in the app. V SELL 500 shares. Internal side has $282.07, broker side has $286.30. Delta is $4.23 per share, about a $2,115 notional delta. Classifier tagged it WRONG_PRICE, band MEDIUM, posterior 1.00."

**Point to the "Scores" tab:**
> "Here's the decomposable score — every field's raw_score, weight, and contribution. Seven fields agree. One disagrees — price. The posterior is high because the overall agreement is overwhelming, but the classifier veto still surfaced this as an exception because the price delta is material."

**Point to the "AI triage" tab:**
> "AI-assisted explanation, cached. Recommended action is ESCALATE. The reasoning says 'material price break — money disagreement, not rounding.' If the analyst hits 'Accept match' anyway, that resolution_action gets audited with their user_id and reason."

**Say the punchline:**
> "Earlier in the build, this row was tagged ROUNDING with posterior 1.00 and the default action was 'Accept match'. An analyst hitting the `A` keystroke would have booked a materially wrong price. The fix was a 2-layer classifier split — ROUNDING for sub-cent drift, WRONG_PRICE for anything above `max($0.01, 0.5bp)`. That change is ADR-011 in the decisions log. This is exactly the kind of regression an eval harness catches, and every eval run since that fix has a gold case (`G033`) pinning the V SELL row to WRONG_PRICE. It can't regress silently."

---

### Beat 6 — The entity graph (3:30 → 4:00)

**URL:** `/reference-data`

**Say:**
> "This is the knowledge graph that powers counterparty alias resolution. 'J.P. Morgan Securities LLC' and 'J P MORGAN SECURITIES LLC' normalize to the same canonical entity. The graph is Neo4j — real graph DB, not JSON in Postgres. Traversals run through a typed Cypher interface at `lib/kg/queries.ts`. Reads on the matching hot path are cached — one lookup per unique counterparty per cycle."

Click a node (e.g. J.P. Morgan) → show its aliases + subsidiaries.

**Say:**
> "For Phase 2 I'd add security master traversal — ISIN/CUSIP cross-reference with corporate-action effective dates. The graph is the right shape for it; it's one Cypher query away."

---

### Beat 7 — Evals (4:00 → 4:30)

**URL:** `/dashboard/evals` — click **Run Evals**

**Say:**
> "The eval harness is the discipline that lets you ship AI into a regulated workflow. I have a hand-labelled gold set of 33 pairs — 10 clean matches, 10 genuine no-matches (different counterparty, same qty/date), and 13 ambiguous (typos, allocations, price drifts). Every cycle runs through the full pipeline and produces precision, recall, and F1 per band and per exception class. The V SELL classifier fix bumped precision on WRONG_PRICE from 0 to 1. When a prompt changes, the eval regresses visibly."

Wait for the bars → point to the per-class confusion matrix.

---

### Beat 8 — Roadmap close (4:30 → 5:00)

**URL:** `/roadmap`

**Say:**
> "Everything I've shown is Phase 0 and Phase 1. The roadmap is explicit about what's shipped, what's next, and why. Phase 2 is allocation + netting — pre-aggregation approach keeps Hungarian 1:1 and adds 1:N on top, which is a 3-hour change with zero rewrite to the existing flow. Phase 3 is ingestion expansion — PDF via Docling, SWIFT, FIX drop-copy. Phase 4 is cash recon — same canonical pattern, different schema. The matching engine doesn't change."

**Close with:**
> "Every item here has a rationale and a tradeoff documented in `docs/DECISIONS_LOG.md`. That file is append-only — no ADR is ever rewritten; we add a follow-up ADR if the original call was wrong. ADR-011 and ADR-012b in that log are examples: the V SELL classifier fix and the pipeline-config honesty closure."

---

## Part C — Q&A armoury (the "why did you choose X" pack)

> Every answer here is **≤ 3 sentences** and ends with a concrete file/line reference so you don't sound like you're generating on the fly.

### Why Fellegi-Sunter instead of a neural matcher?

F-S is **decomposable** — each field's contribution to the posterior is a `log₂(m/u)` weight an analyst can read. A neural net gives you a probability, not an explanation, and an auditor can't accept "the model thought so." For ambiguous residuals where pattern recognition helps, we use GPT on the MEDIUM band with a Zod-validated output; the F-S score is still the decision of record, GPT is a tiebreaker confirmation. `lib/matching/fellegi_sunter.ts`.

### Why Hungarian instead of just fuzzy matching?

Fuzzy matching is a **field scorer**, not a **pair selector**. Jaro-Winkler tells you "these two strings are 0.93 similar"; Hungarian tells you "across all candidate pairs, here's the one-to-one assignment that maximizes total posterior." Without Hungarian you'd have a symmetric matching problem where two internal trades might both claim the same broker fill — that's a double-booking bug waiting to happen. We use fuzzy matching *inside* Stage 4 (Jaro-Winkler + Levenshtein + Token-Set + Metaphone) as inputs to Fellegi-Sunter, then Hungarian as the assignment layer. `lib/matching/hungarian.ts`.

### Why not just fuzzy matching everywhere?

Three reasons.
1. **No one-to-one guarantee** — fuzzy alone lets both sides of a pair be claimed multiple times.
2. **No decomposition** — a combined fuzzy score hides which field drove the match; audits need per-field weights.
3. **No principled threshold** — Fellegi-Sunter's m/u priors come from Bayesian first principles; fuzzy thresholds are hand-tuned and drift silently.

### Why deterministic hash first?

Speed + cost + explainability. ~80% of matches in clean feeds are identity matches — same ISIN, date, quantity, price, side, account. A SHA-256 composite-key hit auto-accepts them with zero probabilistic work and zero LLM tokens. Only the ~20% residual goes through the expensive Stage 4–7 pipeline. `lib/matching/hash.ts`.

### Why blocking at all? Why not score every pair?

Scale. With 100k trades per side, scoring every pair is 10B comparisons. Blocking on `(symbol, trade_date, direction)` typically gives blocks of 10–30 trades, so we score ~3k pairs per block × ~3k blocks = 9M comparisons — a thousand times fewer. Alternative blocking strategies (LSH, Sorted Neighborhood) are on Phase 5 for 10M+ trade scale. `lib/matching/blocking.ts`.

### Why is price similarity capped at 1% (not 5%, not 0.1%)?

1% is industry-standard for equities cash settlement — above that, the operations team treats it as a real price break regardless of similarity. The cap is configurable per pipeline — FI uses 0.01% (0.1bp), FX uses 2%, Futures would use 0.01%. `matching_rules.tolerances.price_rel_tolerance`, published through the versioned-rules flow.

### Why AI only on MEDIUM band, not everywhere?

Cost + safety + determinism. HIGH band is already certain — spending GPT tokens to confirm it is waste. LOW band is already rejected — spending tokens on it is also waste. MEDIUM is the ambiguous tier where the analyst is about to make a call anyway; AI tiebreak nudges their review in seconds. The band is configurable per pipeline — `llm_tiebreak_band: MEDIUM_ONLY | ALL | NONE`. Futures pipelines set this to NONE (exchange-cleared, breaks are real).

### Why Next.js + Supabase instead of FastAPI + Postgres?

Three reasons.
1. **One language across the stack** — TypeScript strict everywhere; Zod at every boundary; the matching engine and the UI share types.
2. **RLS at the database, not the application layer** — Supabase's Postgres-native Row-Level Security means the DB enforces who can see which trade; no application-code escape hatch.
3. **Vercel/Netlify deploy is one command** — for a 4-hour sprint, the shortest path from commit to production URL matters.

Temporal / Redis / distributed queue were explicitly rejected for the MVP scope. Written in ADR-008 area.

### Why Neo4j for reference data instead of Postgres JSONB?

Graph traversals. Counterparty alias resolution is naturally a graph walk — find the entity, traverse aliases, traverse subsidiaries, collect all names. In Postgres you'd materialize this as recursive CTEs that get progressively less readable. Neo4j's Cypher makes `MATCH (e:Entity)-[:ALIAS_OF|SUBSIDIARY_OF*]->(canonical) RETURN canonical` a one-liner. Apache AGE on Supabase was the alternative but isn't on Supabase's supported-extensions list. ADR-009.

### Why only 5-now-6 AI seams, not "AI everywhere"?

Because every AI call has a failure mode that needs a deterministic fallback, a Zod schema, and an `ai_calls` audit row — that's expensive engineering per seam. Bounding AI to 6 seams means we can give each one real rigor: schema validation, prompt caching, fallback path, per-call cost tracking, and an eval case. "AI everywhere" in a regulated workflow is almost always AI-nowhere-rigorously. `lib/ai/openai.ts` enumerates the `AiCallType` union — every seam goes through one wrapper.

### Why is ROUNDING vs WRONG_PRICE a two-class split?

Because the actions differ. ROUNDING is `ACCEPT` (sub-cent precision artifact, no money impact). WRONG_PRICE is `ESCALATE` (material money break, human must confirm). Before the fix, both lived under ROUNDING and the default action was `ACCEPT` — an analyst hitting `A` would have booked a $2,115 notional error on the V SELL row. The threshold is `max($0.01, 0.5bp × price)` — codified in `lib/matching/run-cycle.ts` and governed by `tolerance_rounding_cap` in `lib/governance/rules.ts`. ADR-011.

### Why versioned configs? Why not just UPDATE a row?

Because "what would have happened under last quarter's rules" is a legal question, not an engineering one. Every change to `feed_profiles`, `field_mappings`, or `matching_rules` writes a new version row; old cycles reference the version they ran under via composite FK `(id, version)`. So you can re-run January's cycle with January's rules any time, and prove what it would have said. Mutating configs destroys that evidence.

### Why 1:1 Hungarian now and 1:N later?

Hungarian is mathematically 1:1 by definition — the assignment problem solves a bijection. Supporting 1:N allocations (one internal parent order → N broker child fills) requires either pre-aggregation (group side B by `(symbol, date, dir, account)` and match against the aggregated view) or a b-matching generalization. Pre-aggregation is Phase 2 and keeps the proven Hungarian path intact; b-matching is research territory. ADR-012b acknowledges this explicitly — match_types config accepts `['1:N']` but the engine stamps intent rather than pretending to emit it.

### Why was this repo ever 474 nodes in a knowledge graph?

During the Pipeline Profiles build I ran `/graphify` over the codebase to find dependency clusters before refactoring. The graph showed that all 7 matching stages + all 9 hardcoded parameters clustered in Community 0 with cohesion 0.07 — weakly interconnected, meaning each stage hardcoded its own config instead of sharing one. That low cohesion was the smell that drove the refactor to the `pipeline_profiles` concept. Knowledge-graph-first refactoring saved me from touching files in the wrong order. `graphify-out/GRAPH_REPORT.md` (not committed; local artifact).

### What would you build next if you had another day?

Three things in order.
1. **1:N pre-aggregation** — close the last honesty gap on match_types.
2. **A proper feed-schema inference demo** — currently the schema-inference AI seam is wired to the backend but the onboarding UI doesn't show the AI-suggested mapping with accept/reject per-field. It's a 2-hour polish that would be the strongest demo beat we don't have.
3. **Evals gated in CI** — fail the build if precision/recall regresses by >3% on the gold set. Turns the eval harness from a monitoring tool into a regression-preventer.

### What are the things you'd refuse to build, even if asked?

1. **AI auto-booking trades.** The whole product principle is AI-as-leverage, not AI-as-decision-maker. Analysts own resolution_actions.
2. **Mutating versioned configs.** See above — destroys the audit argument.
3. **"AI everywhere."** Every seam needs the Zod+fallback+audit rigor; without that, AI in a regulated workflow is a liability, not a feature.
4. **Removing the deterministic-first rule.** The moment you put probabilistic logic before deterministic, your reproducibility story dies.

---

## Appendix — Quick reference card for the live walkthrough

| Screen | Key thing to point at | Line to say |
|---|---|---|
| `/dashboard` | AI-assisted badge on narrative | "AI is always declared." |
| `/pipeline` | 7-stage row | "Deterministic first, AI last." |
| `/pipeline` (FI) | Blocking chips = ISIN | "Config, not code, per asset class." |
| `/pipeline` | Suggest with AI | "Proposes, doesn't decide." |
| `/workspace` V SELL | Scores tab | "Decomposable, auditable." |
| `/reference-data` | JPM graph | "Real graph DB, not JSON." |
| `/dashboard/evals` | per-class F1 | "Regression-safe AI." |
| `/roadmap` | Phase 2 1:N | "Honest deferral, not hidden gap." |

---

## Appendix — Numbers to memorize

| Number | What it is |
|---|---|
| **~80%** | share of matches caught by deterministic hash in clean feeds |
| **~0.5bp** | FI rounding-vs-price-break threshold |
| **1%** | equity price tolerance default |
| **5%** | equity quantity tolerance default |
| **0.70–0.95** | MEDIUM band range, default |
| **6** | AI seams, total |
| **7** | matching-engine stages, fixed order |
| **33** | hand-labelled gold eval pairs |
| **46 → 57** | tests (Phase 0 → Phase 1 final) |
| **$4.23** | per-share delta on the V SELL WRONG_PRICE row |
| **$2,115** | notional delta on that same row — the money moment |
