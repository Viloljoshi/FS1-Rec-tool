# ReconAI — Evals Harness

**Status:** v1 — binding for MVP.

---

## Why evals exist

Regulated buyers will not deploy AI they cannot measure. This document defines
**how ReconAI measures AI quality**, what it reports, and how regressions are
caught.

The evals harness is the trust layer. If the evals degrade, AI changes do not
ship — by convention, not by code.

---

## Gold set

### Location
`data/eval/gold.jsonl` — JSON-lines, one labeled pair per line.

### Shape
```jsonc
{
  "pair_id": "G001",
  "trade_a": "INT-000001",
  "trade_b": "BRKA-1001",
  "label": "MATCH" | "NO_MATCH" | "AMBIGUOUS",
  "exception_class": "CPY_ALIAS" | "ROUNDING" | "WRONG_PRICE" | "WRONG_QTY" | "FORMAT_DRIFT" | ...,
  "reason": "short human explanation",
  "curator": "product",
  "curated_at": "2026-04-19"
}
```

### Coverage (30 pairs)
| Segment | Count | Purpose |
|---|---|---|
| Clean matches | 10 | Deterministic and HIGH-band correctness |
| Genuine non-matches | 10 | Low-band specificity |
| Ambiguous | 10 | MEDIUM-band + LLM tiebreak quality |

Each segment contains at least one pair from every **exception class** to
ensure coverage across root causes.

### Rules
- Labels are authored by product, reviewed and committed.
- New pairs must come from real-looking scenarios derived from seed data.
- Pairs are immutable after review; new versions get a new `gold_set_version`.

---

## Metrics

### Overall
- **Precision** = TP / (TP + FP)
- **Recall** = TP / (TP + FN)
- **F1** = 2·P·R / (P + R)

`MATCH` label vs system verdict `HIGH or MEDIUM-accepted` is TP.
`NO_MATCH` label vs system verdict `HIGH or MEDIUM-accepted` is FP.

### Per band
Same P / R / F1 computed separately for HIGH, MEDIUM, LOW bands.

### Per exception class
P / R / F1 by `exception_class`. Highlights where a change helps or hurts.

### Confusion matrix
`{TP, FP, TN, FN}` reported in every run.

### AI-specific
Tiebreak accuracy: among MEDIUM-band pairs, the fraction where the LLM verdict
agrees with the gold label (before the analyst intervenes).

---

## Runner

### Location
- `lib/eval/run.ts` — orchestration
- `lib/eval/metrics.ts` — scoring
- `lib/eval/gold.ts` — loader
- `app/api/eval/run/route.ts` — kickoff endpoint (manager / auditor)

### Behavior
1. Load gold set from `data/eval/gold.jsonl`
2. For each pair, build a synthetic matching cycle context: pull the two
   canonical trades, run the full engine as if they were blocked together
3. Capture engine output: posterior, band, field_scores, deterministic_hit, llm_verdict
4. Compare to gold label → tally metrics
5. Write one row to `eval_runs`:
   ```ts
   {
     id, gold_set_version, precision, recall, f1,
     per_band: { HIGH, MEDIUM, LOW },
     per_class: { FORMAT_DRIFT, ROUNDING, ... },
     confusion: { tp, fp, tn, fn },
     model_version: string,
     matching_rules_version: int,
     created_at, initiated_by
   }
   ```
6. Refresh the dashboard evals tile

### Performance
30 pairs × 7 pipeline layers ~ 300 ms baseline, dominated by any LLM
tiebreak calls. Target < 30 s end-to-end including AI.

---

## Dashboard surface

### Evals tile (`/dashboard`)
- Latest F1 (large)
- P and R (small)
- Delta vs previous run (colored chip: ▲ green, ▼ red)
- Model version, rules version, timestamp in a hover

### Evals deep-dive (`/dashboard/evals`)
- Table of last 10 runs: timestamp, model, rules version, P, R, F1, initiated_by
- Confusion matrix card for the selected run
- Per-band F1 bar chart
- Per-class F1 bar chart
- Diff of changes against the previous run (which pairs flipped from TP→FP or FN→TN)

### Run evals action
Role-gated button (`manager`, `auditor`). Opens a confirmation, then triggers
the runner. Toast updates on completion. New row in the table.

---

## Regression policy

1. **Matching rules changes** — any new `matching_rules` activation must pass
   an evals run with F1 ≥ current active − 0.01. Enforced by convention in MVP;
   future: enforced by an API check before `active=true` toggle.
2. **Model upgrades** — `OPENAI_MODEL` env var change requires an evals run
   captured before deploy. The run timestamp is referenced in the deploy PR.
3. **Prompt changes** — same. Prompt hash change in `ai_calls.prompt_hash`
   visible in run comparison.
4. **Engine code changes** — unit tests + evals run required before merge.
   Engine tests live in `tests/matching/`.

---

## What we deliberately do NOT measure (in MVP)

- **LLM explanation quality** — no automatic grading of `explain-break` output.
  Subjective for now; human spot-check only. Roadmap: LLM-as-judge with a
  second model (e.g., `gpt-4o`) graded on a 5-point rubric.
- **Feed schema inference accuracy** — the mapping editor has a human-in-loop
  step, so inference precision is a UX metric (time-to-save, edits-per-session)
  rather than a correctness metric. Tracked post-MVP via product analytics.
- **End-to-end analyst throughput** — belongs in product analytics, not evals.

---

## Extending the gold set

Post-MVP workflow:
1. Analysts can flag ambiguous resolutions with a "Propose for gold set" action
2. Product reviews proposals weekly
3. Accepted proposals become new pairs with incremented `gold_set_version`
4. Next evals run uses the new set; dashboard notes version change

This closes the learning loop: real analyst judgment improves the bar the
system must clear.

---

## Failure modes and responses

| Failure | Detection | Response |
|---------|-----------|----------|
| F1 drop > 0.02 run-over-run | Dashboard alert | Block next prompt/rule change until investigated |
| LLM API 500s | `ai_calls.fallback_used = true` rate | Engine falls back to deterministic-only; runs continue |
| Gold pair becomes stale (schema change) | Evals run error for that pair | Pair quarantined, `curator` notified, new label authored |
| Evals runtime > 60 s | Runner timeout | Increase concurrency cap on LLM calls; consider caching tiebreak verdicts |

---

## Closing note for the PM deck

> "Every regulated buyer asks: how do you know the AI is right? We do not
> hope — we measure. Every engine change, every prompt change, every model
> change regresses against a curated gold set. The same discipline
> engineering uses for test suites, we apply to AI quality."
