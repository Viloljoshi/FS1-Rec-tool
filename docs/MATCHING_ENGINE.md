# ReconAI — Matching Engine

**Status:** v1 — locked for MVP.

---

## Executive summary

Seven cooperating algorithms run in a fixed order on every matching cycle.
Deterministic logic runs first. Probabilistic scoring is second. AI is last
and only on ambiguous pairs. Every score is decomposable to the field.

```
1. Normalize            (pure, idempotent)
2. Deterministic hash   (SHA-256 composite key)
3. Blocking             (Standard Blocking by symbol+date+direction)
4. Field similarity     (ensemble per pair)
5. Fellegi-Sunter       (log-likelihood → posterior probability)
6. Hungarian assignment (optimal 1:1 within blocks)
7. LLM tiebreak         (MEDIUM band only; GPT-4o-mini JSON mode)
```

---

## Layer 1 — Normalization

All inputs are canonicalized to eliminate format-only differences before
any comparison runs. Pure functions, unit-tested, idempotent.

| Input | Rule |
|---|---|
| Trade dates | Parse any common format → ISO-8601 (`YYYY-MM-DD`); timezone-aware via `date-fns-tz` |
| Direction | `B/BUY/Buy/buy` → `BUY`; `S/SELL/Sell/sell/SLD` → `SELL` |
| ISIN / CUSIP | Upper-case, strip whitespace; validate checksum (ISIN Luhn mod-10-style, CUSIP mod-10) |
| Symbol | Upper-case, strip whitespace, strip exchange suffixes (`.N`, `.O`) |
| Quantity / Price | Parse to `Decimal` (decimal.js); reject commas silently; preserve precision |
| Currency | Upper-case ISO 4217 only |
| Counterparty | Upper-case, strip punctuation, collapse whitespace, strip common suffixes (`LLC`, `INC`, `LTD`, `CO`, `&`) only for comparison — original retained |
| Account | Upper-case, strip dashes/spaces |

Location: `lib/matching/normalize.ts`

---

## Layer 2 — Deterministic hash

Composite key → SHA-256 → hex. If two trades from different feeds share the
same hash, they are an auto-HIGH match, no further scoring needed.

```
hash = SHA-256(
  ISIN or CUSIP or SYMBOL,
  trade_date_iso,
  quantity_decimal,
  price_decimal_rounded(6),
  direction,
  account_normalized
)
```

Notes:
- `ISIN or CUSIP or SYMBOL` means the preferred identifier in that order
- `price_decimal_rounded(6)` handles micro-precision differences
- `account_normalized` uses the same normalization as the matching step

Hash collisions are resolved by falling through to layer 4. This is rare and
defensive.

Location: `lib/matching/hash.ts`

---

## Layer 3 — Blocking

Naive `O(n*m)` pair enumeration is impractical. We group both feeds by a
**blocking key** and only compare pairs inside the same block.

**Blocking key:** `(symbol, trade_date_iso, direction)`

This reduces candidate pairs by 100–1000x without losing true matches,
because a true counterpart almost always shares all three.

Edge cases — if blocking feels too strict, a secondary pass uses
`(symbol, trade_date ± 1 day, direction)` for candidates only — this catches
timing drift (e.g., late-posted broker confirmations). Gated behind a rule.

Location: `lib/matching/blocking.ts`

---

## Layer 4 — Field similarity

Per candidate pair, every canonical field is scored independently. Scores
are in `[0, 1]`. Higher = more similar.

| Field | Metric | Notes |
|---|---|---|
| `trade_date` | `1 - min(day_delta, 3)/3` | 0 days → 1.0; 1 day → 0.67; ≥3 days → 0 |
| `settlement_date` | same | |
| `direction` | exact | 0 or 1 |
| `symbol` | exact | 0 or 1 |
| `isin` | exact | 0 or 1; null on either side → treated neutral |
| `cusip` | exact | same |
| `quantity` | `1 - min(relative_diff, 0.05)/0.05` | 0 rel-diff → 1.0; >5% → 0 |
| `price` | same with 0.01 cap | 0 rel-diff → 1.0; >1% → 0 |
| `currency` | exact | 0 or 1 |
| `counterparty` | `max(JaroWinkler, TokenSetRatio, 0.6*JaroWinkler + 0.4*Metaphone_hit, 0.7*JaroWinkler + 0.3*embedding_cosine)` | Ensemble captures typos, word-order, phonetic, and semantic |
| `account` | `1 - Levenshtein / max(len)` | Short codes, edit-distance normalized |

Counterparty scoring is the densest: we run JW, token-set ratio, Double
Metaphone, and embedding cosine, then take the maximum ensemble score.
Rationale: different feeds garble names in different ways — trust whichever
metric sees through the garbling.

Location: `lib/matching/similarity.ts`

---

## Layer 5 — Fellegi-Sunter probabilistic linkage

Each field's agreement or disagreement contributes a log-likelihood weight.
Weights sum to a total score, which is sigmoid-transformed to a posterior
probability.

### The math

For field *i*:
- `m_i` = P(field *i* agrees | the two records are a true match)
- `u_i` = P(field *i* agrees | the two records are NOT a match)

**Agreement weight** when the field agrees (score ≥ agree_threshold):
```
w_agree_i = log₂(m_i / u_i)
```

**Disagreement weight** when the field disagrees:
```
w_disagree_i = log₂((1 - m_i) / (1 - u_i))
```

**Partial agreement** when `0 < score < agree_threshold`:
```
w_partial_i = score * w_agree_i + (1 - score) * w_disagree_i
```

**Total score:**
```
W = Σ w_i  (across all fields)
```

**Posterior probability** (assuming prior 0.5 for MVP):
```
posterior = sigmoid(W) = 1 / (1 + 2^(-W))
```

### Default seeded weights (v1, in `matching_rules`)

| Field | m (agree given match) | u (agree given non-match) | agree_threshold |
|---|---:|---:|---:|
| `isin` | 0.99 | 0.00001 | 1.0 |
| `cusip` | 0.99 | 0.00001 | 1.0 |
| `symbol` | 0.99 | 0.01 | 1.0 |
| `trade_date` | 0.95 | 0.02 | 0.66 |
| `settlement_date` | 0.93 | 0.02 | 0.66 |
| `direction` | 0.99 | 0.5 | 1.0 |
| `quantity` | 0.95 | 0.001 | 0.9 |
| `price` | 0.95 | 0.001 | 0.9 |
| `currency` | 0.99 | 0.3 | 1.0 |
| `counterparty` | 0.88 | 0.02 | 0.8 |
| `account` | 0.92 | 0.001 | 0.9 |

These are industry-defensible starting points derived from public record
linkage literature for financial datasets. They can be retuned by a manager
role via a new `matching_rules` version; the old version remains queryable.

### Bands

| Band | Posterior range | UX behavior |
|---|---|---|
| HIGH | ≥ 0.95 | Green chip, auto-suggest, one-click accept |
| MEDIUM | 0.70 – 0.95 | Amber chip, LLM tiebreak fires, analyst confirms |
| LOW | < 0.70 | Red chip, hidden by default, shown on "see all candidates" |

Location: `lib/matching/fellegi_sunter.ts`

---

## Layer 6 — Hungarian assignment

Within a block, multiple candidates may compete. We must not assign
one trade-A to several trade-Bs (bad for 1:1 reconciliation). The Hungarian
algorithm finds the **optimal one-to-one assignment** that maximizes the sum
of posteriors across the block.

Implementation: negate posteriors → run Hungarian to minimize → invert. ~40
lines, pure JS. We use the `munkres-js` package or hand-rolled.

When the match-type is `1:N` or `N:M` (allocations, splits), Hungarian is
skipped in favor of graph connected-components (see `Match Types` below).

Location: `lib/matching/hungarian.ts`

---

## Layer 7 — LLM tiebreak (MEDIUM band only)

For candidates in the MEDIUM band (posterior 0.70–0.95), we run a single AI
call:

- Model: `gpt-4o-mini`
- Mode: JSON mode (structured output)
- Input: two canonical trades + field-level diff
- Output (Zod-validated):
  ```ts
  {
    verdict: 'LIKELY_MATCH' | 'LIKELY_NO_MATCH' | 'UNCERTAIN',
    confidence: number,       // 0..1
    reasoning: string,        // 1-2 sentences, analyst-readable
    decisive_fields: string[] // field names that drove the verdict
  }
  ```

The verdict is **surfaced to the analyst, not used as a match decision**. It
appears in the compare pane as an AI-assisted explanation card; the analyst
still clicks Accept or Reject.

Prompt hashing: the raw prompt is SHA-256-hashed and the hash is logged in
`ai_calls`. Reasoning is logged. Tokens logged. Latency logged. Fallback on
call failure = `UNCERTAIN` with empty reasoning.

Location: `lib/ai/prompts/tiebreak.ts`, `app/api/ai/tiebreak/route.ts`

---

## Match types

| Type | Definition | Handling |
|---|---|---|
| `1:1` | One trade-A ↔ one trade-B | Hungarian assignment |
| `1:N` | One trade-A ↔ many trade-Bs (allocation) | Connected components + quantity sum check |
| `N:1` | Many trade-As ↔ one trade-B (consolidation) | Mirror of `1:N` |
| `N:M` | Cross-matched cluster | Flagged for analyst review |

MVP handles `1:1` fully. `1:N / N:1` are detected via graph connected
components after posterior scoring and flagged with a `match_type` label
in the UI. Actions on these types are limited to `ESCALATE` in MVP.

Location: `lib/matching/match_types.ts`

---

## End-to-end pipeline

```ts
engine.run({
  cycle_id,
  feed_a,
  feed_b,
  rules_version,
  date_range,
}): {
  matches: MatchResult[],
  exceptions: Exception[],
  counts: { high, medium, low, unmatched },
  audit_payload: AuditEvent,
}
```

Single entry point in `lib/matching/engine.ts`. No intermediate side effects;
all writes happen at the API route that wraps it, inside one DB transaction.

---

## Testing discipline

Unit tests live in `tests/matching/`. Coverage targets:
- `normalize.ts`: 100%
- `fellegi_sunter.ts`: 100%
- `hungarian.ts`: 100% (path coverage)
- `engine.ts`: 5 scenario tests (clean match, CPY drift, rounding, wrong-qty,
  missing-one-side)

No UI tests. No fuzzing of AI. AI is covered by the eval harness.

---

## Performance notes

Demo scale (1,000 × 250 pairs, ~250k candidate enumerations after blocking):
- Layer 1-4: in-memory, ~400ms on M-class hardware
- Layer 5: 250k · 11 fields · scalar math = ~50ms
- Layer 6: Hungarian on small blocks is trivial
- Layer 7: triggered on ~100-200 pairs → serialized OpenAI calls, ~30-60s
  total with concurrency cap of 5

For production scale (millions of trades), move to: `splink` (DuckDB-based
Fellegi-Sunter), LSH or Sorted Neighborhood for blocking, a proper message
queue for tiebreak concurrency. Interface stays the same.

---

## What the PM should say about this engine

> "Reconciliation matching is a well-studied problem. What is new is the
> discipline of applying all of it together with AI as the tiebreaker rather
> than the decider. The auditor sees the Fellegi-Sunter weights; the analyst
> sees the LLM reasoning. Both see the same posterior. Both can override."
