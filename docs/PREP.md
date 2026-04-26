# ReconAI — Interview Prep: The 7-Layer Matching Engine

> Your cheat sheet for the technical depth questions. Read this the morning of the demo.

---

## The one-line answer

> "We run seven cooperating algorithms in a fixed, deterministic order. Every layer reduces the problem space before handing off to the next. AI is last, and only on the residual ambiguity that mathematics could not resolve."

---

## Why this specific pipeline?

Trade reconciliation is a **record linkage problem** — the same economic event described twice by two systems with different vocabulary, formats, and tolerances. The field has 40 years of published research on this:

- **Fellegi-Sunter (1969)** is the canonical probabilistic framework used by national statistical bureaus for census linkage. It has direct application to trade matching because both problems share the same structure: two databases, imperfect agreement on fields, need for a principled confidence score.
- **Hungarian algorithm (Kuhn-Munkres, 1955)** solves the optimal assignment problem. In recon, you cannot assign the same trade-A to two trade-Bs — this is a one-to-one constraint that greedy matching violates in corner cases.
- **Blocking** is a standard scalability technique from the record linkage literature (Hernandez & Stolfo, 1995). Without it, `n × m` pair enumeration at millions of trades is computationally impractical.

The innovation in ReconAI is not inventing new math — it is **composing proven layers in the right order** and inserting AI exactly where it adds leverage: at the residual ambiguity that statistics cannot resolve alone (counterparty name variants, contextual reasoning across multiple fields simultaneously).

What we deliberately did NOT do:
- No end-to-end ML black box that can't explain a decision to a compliance officer
- No AI on the clean matches (wasteful, no upside)
- No AI on the clear non-matches (same)
- No rule engine that requires a human to enumerate every edge case upfront

---

## The 7 layers — what each one does and why

---

### Layer 1 — Normalization

**What it does:**
Converts every raw trade field into a canonical, format-agnostic representation before any comparison runs.

| Raw input | After normalization |
|-----------|-------------------|
| `04/08/2026` or `8-Apr-26` | `2026-04-08` (ISO-8601) |
| `Buy`, `B`, `buy`, `BUY` | `BUY` |
| `Goldman, Sachs & Co.` | `GOLDMAN SACHS` (for comparison only — original retained) |
| `1,500` or `1500.00` | `Decimal("1500")` |
| `US4781601046 ` (trailing space) | `US4781601046` |

**Why this layer exists:**
Without normalization, two records representing the same trade would fail every comparison purely because of format differences. Normalization is the cheapest possible win — it eliminates false negatives that are artifacts of data entry convention, not real disagreements. It also has to be idempotent (running it twice produces the same result) so the pipeline is deterministic across re-runs.

**The key insight:**
We normalize for comparison but preserve the original for display. An analyst should see what the broker actually sent, not our cleaned version. This is both a UX and an audit requirement.

---

### Layer 2 — Deterministic Hash (SHA-256)

**What it does:**
Computes a composite SHA-256 key from six normalized fields for every trade on both sides:

```
hash = SHA-256(
  preferred_identifier (ISIN > CUSIP > symbol),
  trade_date_iso,
  quantity (6 decimal places),
  price (6 decimal places),
  direction,
  account_normalized
)
```

If two trades share the same hash → they are an AUTO-HIGH match. No further processing needed.

**Why this layer exists:**
The majority of trades in a clean feed pair will agree exactly on all material fields. Running the full probabilistic pipeline on these is expensive and unnecessary. The hash acts as a fast-path filter that removes ~70-80% of the candidate space in microseconds. In the seed data, this layer alone resolves roughly 850 out of 1,000 trades.

**Why SHA-256 specifically:**
- Collision probability is negligible for our data volumes (2^-256 per pair)
- Deterministic: same inputs always produce the same hash across re-runs, which means the audit trail is reproducible
- Cheap: a single hash call per trade, no pairwise comparison needed

**Important nuance:**
Price is rounded to 6 decimal places before hashing. This is deliberate — micro-precision differences (e.g., `$154.130000` vs `$154.130001`) from floating-point serialization should not prevent an exact match. Six decimal places is more precision than any real security price needs.

---

### Layer 3 — Blocking

**What it does:**
Groups both feeds by a blocking key and only compares pairs within the same group.

**Blocking key:** `(symbol, trade_date, direction)`

Example: All BUY trades in AAPL on 2026-04-08 from feed A are only compared against BUY trades in AAPL on 2026-04-08 from feed B. A SELL in AAPL never gets compared against a BUY in AAPL.

**Why this layer exists:**
Without blocking, a 1,000-trade feed and a 250-trade feed would require 250,000 pairwise comparisons. With blocking, the realistic candidate space drops to ~1-5 pairs per block (because symbol + date + direction is highly selective). This is a 100–1,000× reduction in compute, which is what makes real-time reconciliation feasible.

**The edge case — timing drift:**
A secondary blocking pass uses `trade_date ± 1 day` to catch late-posted confirmations. A broker may record the trade on the execution date; a custodian may record it on the booking date (next business day). Without this, a real match would be blocked out of consideration entirely.

**Why `(symbol, trade_date, direction)` and not something else:**
- ISIN/CUSIP would be ideal but are often missing or inconsistent across feeds
- Symbol is almost always present and matches after normalization
- Trade date limits the block to one day's trades — keeps blocks small
- Direction is non-negotiable: a BUY and SELL of the same security should never be compared (they represent opposite sides of the same economic event if it's a cross, but that's a 1:1 internal break, not a reconciliation pair)

---

### Layer 4 — Field Similarity Ensemble

**What it does:**
For every candidate pair inside a block, scores each canonical field independently on a `[0, 1]` scale.

| Field | Metric | Rationale |
|-------|--------|-----------|
| `isin` / `cusip` | Exact match | These are standardized identifiers — partial match means corruption |
| `symbol` | Exact match | Same — exchange suffixes already stripped in Layer 1 |
| `trade_date` | `1 - day_delta / 3` | 0 days = 1.0, 1 day = 0.67, 3+ days = 0 |
| `quantity` | `1 - relative_diff / 0.05` | 5% tolerance cap; rounding and partial fills handled |
| `price` | `1 - relative_diff / 0.01` | Tighter 1% cap; price is highly precise |
| `counterparty` | `max(JaroWinkler, TokenSet, Phonetic, Embedding)` | See below |
| `account` | `1 - Levenshtein / max_len` | Short codes, edit-distance works well |

**Counterparty scoring is the most complex field.**
Four metrics compete; we take the maximum:
1. **Jaro-Winkler** — handles character-level typos ("JPMorgam" vs "JPMorgan")
2. **Token Set Ratio** — handles word-order variations ("J.P. Morgan Securities LLC" vs "Securities LLC J.P. Morgan")
3. **Double Metaphone** — handles phonetic variants ("Goldman" vs "Goldmann")
4. **Embedding cosine** — handles semantic equivalence ("GS" vs "Goldman Sachs") that neither string metric nor phonetics can catch

Taking the maximum means we trust whichever metric sees through the specific garbling pattern in this pair. We don't average — averaging would dilute a strong signal from one metric with noise from metrics that are less relevant to this specific variation.

---

### Layer 5 — Fellegi-Sunter Probabilistic Linkage

**What it does:**
Takes the per-field similarity scores from Layer 4 and computes a single posterior probability that the pair is a true match.

**The math:**
For each field `i`, we have two parameters calibrated on historical data:
- `m_i` = probability that field `i` agrees, **given** the pair is a true match
- `u_i` = probability that field `i` agrees, **given** the pair is NOT a match

When field `i` agrees (score ≥ threshold):
```
weight_i = log₂(m_i / u_i)   → positive (evidence FOR a match)
```

When field `i` disagrees:
```
weight_i = log₂((1−m_i) / (1−u_i))   → negative (evidence AGAINST)
```

Sum all weights, sigmoid-transform → posterior probability ∈ (0, 1).

**Why log-likelihood weights?**
Because they are additive across independent fields. You can literally read off "ISIN match adds +13.3 bits of evidence; counterparty mismatch subtracts 2.1 bits." This decomposability is what powers the score breakdown UI — analysts see exactly which fields drove the score and by how much.

**The seeded weight values and why:**
- ISIN: `m=0.99, u=0.00001` — when an ISIN matches, it's almost certain to be a real match. When it matches by chance (non-match), it's astronomically unlikely. This field alone can swing the posterior to 0.99.
- Counterparty: `m=0.88, u=0.02` — counterparties agree less often on true matches (because of aliases) and agree more often on non-matches (because there are few major banks). Lower discriminating power than identifiers, but still meaningful.
- Direction: `u=0.5` — for a random non-matching pair from the same block (symbol + date), BUY vs BUY is 50/50. So direction agreement on a non-match is not surprising. It carries less weight than you'd expect.

**Band classification:**
- **HIGH (≥ 0.95):** Near-certain match. Auto-suggest accept. Green chip.
- **MEDIUM (0.70–0.95):** Probable but uncertain. LLM tiebreak fires. Amber chip.
- **LOW (< 0.70):** Unlikely match. Shown to analyst as a candidate only. Red chip.

**Integrity veto (non-standard addition):**
We add one rule not in the original Fellegi-Sunter formulation: if quantity differs by more than 50%, we demote the band from HIGH to LOW regardless of the posterior. This is an operational constraint — a position controller will not accept a "HIGH confidence" match where the quantities disagree materially, even if all other fields are perfect. It represents a WRONG_QTY exception class. The posterior can lie about the band label; the veto corrects it.

---

### Layer 6 — Hungarian Assignment

**What it does:**
Within each block, finds the optimal one-to-one assignment of trades from feed A to trades from feed B — maximizing the sum of posteriors across the block.

**Why we need this:**
Without optimal assignment, a greedy approach would assign trade A1 to B1 (high posterior), but that might "steal" B1 from A2 where A2-B1 is actually the correct pair at an even higher posterior. The Hungarian algorithm guarantees the globally optimal assignment across the entire block, not just local greedy optima.

**Implementation:**
Negate posteriors → minimize (Hungarian is a minimization algorithm) → invert back. The `munkres-js` package provides the O(n³) implementation. For our block sizes (typically 2-10 pairs), this is trivial.

**When it's skipped:**
For `1:N` match types (allocations, where one internal trade corresponds to multiple broker legs), Hungarian doesn't apply — we use graph connected-components instead. For `N:M` (fully entangled clusters), we flag for analyst review.

---

### Layer 7 — LLM Tiebreak (MEDIUM band only)

**What it does:**
For each MEDIUM-band pair (posterior 0.70–0.95), sends both canonical trade records plus the field diff to `gpt-4o-mini` in JSON mode and gets back:

```ts
{
  verdict: 'LIKELY_MATCH' | 'LIKELY_NO_MATCH' | 'UNCERTAIN',
  confidence: 0.0–1.0,
  reasoning: "1-2 sentence analyst-readable explanation",
  decisive_fields: ["counterparty", "account"]
}
```

**Why MEDIUM band only?**
- HIGH: Mathematics already resolved it. AI adds cost, no value.
- LOW: The pair probably isn't a match. Analyst sees it as a low-priority candidate. Spending AI tokens here is wasteful and creates noise.
- MEDIUM: This is exactly the zone where statistics are uncertain but context could resolve it. "JPMorgan Sec LLC" vs "J.P. Morgan Securities LLC" — Jaro-Winkler gives 0.78, which puts posterior at 0.81 (MEDIUM). An LLM can recognize these as the same entity.

**What the AI output is used for:**
The verdict is **surfaced to the analyst, never used as the match decision.** It appears as an AI-assisted explanation card in the compare pane. The analyst still clicks Accept or Reject. This is the product principle in action: AI reduces ambiguity and effort, it does not make the decision.

**Why gpt-4o-mini:**
- The task is structured reasoning on two JSON objects — well within gpt-4o-mini's capability
- Tiebreak runs on ~100-200 pairs per cycle. Cost discipline matters.
- JSON mode + Zod validation at the boundary means the output is always machine-parseable

**Auditability of AI:**
Every call logs: prompt SHA-256 hash, model version, input tokens, output tokens, latency, full output JSON. If a regulator asks "why did you match these two trades?", you can produce the exact prompt that was sent, the exact reasoning returned, and the analyst who confirmed it.

**Fallback:**
If the AI call fails (timeout, API error), the verdict defaults to `UNCERTAIN` and the exception is created anyway with empty AI reasoning. The matching cycle never fails because of an AI failure.

---

## The integrity veto — why it's not in the literature

Standard Fellegi-Sunter would let a high ISIN match dominate and push a pair into HIGH band even if quantities differ by 3x. That is statistically correct but operationally wrong — a reconciliation team would never auto-accept a match with a major quantity break. The veto rule encodes operational domain knowledge that the math alone cannot represent. This is a deliberate deviation from the textbook algorithm, documented in `DECISIONS_LOG.md`.

---

## Numbers to know for the demo

| Metric | Value |
|--------|-------|
| Trades in internal feed | ~1,000 |
| Trades in Broker B feed | ~99 |
| Deterministic hits (Layer 2) | ~70-80% of matched pairs |
| MEDIUM band pairs (Layer 7 fires) | ~10-20% of matched pairs |
| LLM calls per cycle | ~20-40 |
| Pipeline latency (skipAi=true) | ~3-5 seconds |
| Eval F1 score | 0.851 |
| Per-band HIGH F1 | 1.00 |
| Per-band MEDIUM F1 | ~0.82 |

---

## Interview questions and how to answer them

---

**Q: Why not just use a machine learning model trained on historical matches?**

A: Three reasons. First, the cold-start problem — you need labeled historical data to train a supervised model. A bank onboarding a new counterparty pair has no labeled data. Fellegi-Sunter requires only calibrated `m` and `u` parameters, which can be set from domain knowledge and tuned over time. Second, explainability — a compliance officer needs to understand *why* two trades matched. "The model said 0.87" is not an acceptable answer in a regulated environment. Our score breakdown shows the contribution of every field. Third, maintenance — a neural model requires retraining when counterparty formats change. Our pipeline degrades gracefully and the weights can be updated without a model retrain.

---

**Q: Why SHA-256 for the deterministic hash — isn't exact matching too strict?**

A: The hash is deliberately strict. Its purpose is to cheaply identify the easy cases — trades that agree exactly on all material fields after normalization. If a pair doesn't hash-match, it falls through to the probabilistic pipeline where tolerances are applied. The two layers serve different purposes and the strict/lenient split is intentional. The price rounding to 6 decimal places is the one explicit tolerance baked into the hash — anything looser would create false positives that an auditor would flag.

---

**Q: The Hungarian algorithm is O(n³). Does that scale?**

A: At demo scale (blocks of 2-10 trades), it's trivial — microseconds. Even at production scale, the blocking step ensures blocks are small — typically fewer than 20 trades per block for daily equity reconciliation. O(n³) on n=20 is negligible. For genuinely large allocations (1 internal trade → 50 broker legs), we'd switch to Jonker-Volgenant (faster in practice) or move the matching to a message queue. The interface contract (input: two trade lists, output: assignment array) is the same regardless of the algorithm behind it.

---

**Q: What happens if both feeds have the same ISIN but different CUSIPs?**

A: ISIN takes priority in the hash key (`ISIN > CUSIP > symbol`). The hash will match on ISIN. In the similarity scoring, both ISIN and CUSIP get their own field scores — ISIN exact match scores 1.0, CUSIP mismatch scores 0.0. The Fellegi-Sunter weights are calibrated so that an ISIN match alone is sufficient evidence to push the posterior to HIGH band. The CUSIP mismatch is recorded in the field scores and visible to the analyst as a potential data quality issue, but it doesn't prevent the match from being HIGH confidence.

---

**Q: Why is counterparty the hardest field and what did you do about it?**

A: Counterparty names are free-text entered by humans across multiple systems with no enforced standard. The same entity appears as "GS", "Goldman Sachs", "Goldman, Sachs & Co.", "GOLDMAN SACHS & CO. LLC", "Goldman Sachs International" — all referring to the same legal entity. No single string metric handles all of these:
- Jaro-Winkler handles character typos
- Token Set Ratio handles word reordering and abbreviations
- Double Metaphone handles phonetic variants
- Embedding cosine handles semantic equivalence (abbreviations like "GS" → Goldman Sachs)

We take the maximum score across all four. Additionally, the knowledge graph (Neo4j) stores canonical entities and their aliases — if we resolve a counterparty string to a canonical entity ID on both sides, it becomes an exact match on `counterparty_canonical_id`, bypassing the string metrics entirely.

---

**Q: How do you prevent the AI from making a match decision?**

A: Architecture, not policy. The LLM tiebreak route returns a structured verdict that is stored on the exception record. The exception status can only be changed by an analyst clicking Accept/Reject/Escalate in the UI or calling the `POST /api/exceptions/[id]/actions` endpoint. That endpoint requires a human actor (`user.id` from auth), validates the action enum, and writes an immutable audit row. There is no code path where the LLM verdict directly changes an exception status. The separation is enforced in the data model, not just in the UI.

---

**Q: What's the prior probability in your Bayesian model and why 0.5?**

A: We use a uniform prior (0.5) for the MVP, which means we don't assume anything about the base rate of matches. In practice, for a daily equity reconciliation between two parties who traded with each other, the true match rate is much higher (>80%). Using a 0.5 prior slightly depresses our posteriors, which means our HIGH-band threshold is conservative — we're less likely to auto-match something that shouldn't be matched. For production, the prior should be calibrated from historical cycle match rates. The evaluation harness (`data/eval/gold.jsonl`) is the mechanism for doing that calibration over time.

---

**Q: You said AI is bounded to the MEDIUM band. What if MEDIUM is too strict or too loose?**

A: The band thresholds (0.70 / 0.95) are parameters in `matching_rules`, which are versioned. A manager role can propose a new version with different thresholds. The eval harness immediately shows the impact on precision/recall/F1 against the gold set. This is the governance loop: thresholds are tunable, every change is versioned and audited, and the quality impact is measured before any change goes live. We specifically chose 0.95 for the HIGH boundary because at that posterior, our eval data shows the false positive rate is below 2% — acceptable for auto-suggestion (not auto-acceptance — the analyst still clicks).

---

**Q: How does this compare to what the big recon vendors do (SmartStream, Broadridge)?**

A: The algorithms are the same — Fellegi-Sunter and blocking have been in enterprise recon tools since the late 1990s. The differences are: (1) AI tiebreak is newer and not standard in legacy tools; (2) full score decomposability (field-level contributions to the posterior) is often buried or absent in legacy UIs; (3) the reference knowledge graph (Neo4j for counterparty aliases, subsidiary chains) replaces static alias tables that require manual maintenance. The architectural argument is that the intelligence layer should be modular and measurable — the eval harness is the mechanism, not a product brochure claim.

---

## The "why you built this" answer

> "I picked trade reconciliation specifically because it's a domain where the matching problem is genuinely hard — format drift, counterparty alias proliferation, rounding conventions, timing differences — but where the failure mode is regulated and audited. That combination forces every design decision to be defensible: you can't say 'the model decided.' I used it as a vehicle to demonstrate that AI works best not as a replacement for domain logic but as a final layer that handles the residual ambiguity that deterministic and probabilistic methods leave behind."

---

*Last updated: 2026-04-26*
