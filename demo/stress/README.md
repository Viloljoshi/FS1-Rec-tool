# ReconAI — Stress-Test CSVs

Three files designed to **exercise the matching engine and the ingest pipeline at their edges**. Unlike the clean broker files under `demo/*.csv` (which produce near-100% HIGH auto-matches), these produce the realistic exception mix an operations manager actually works with.

Use with **Side A = Internal Blotter** on `/reconcile` unless noted.

---

## 01-mixed-bands.csv — the demo star

**20 rows. Produces a rich band distribution (~50% HIGH / ~20% MEDIUM / ~15% LOW / ~10% CPY_ALIAS / ~5% UNMATCHED).**

| Row range | Perturbation | Expected band / class |
|---|---|---|
| BRK-3001..3008 | None — clean match to INT-00020x | HIGH |
| BRK-3009..3011 | Price drifted ~1.5% | MEDIUM (inside FX tol, outside Equities tol) |
| BRK-3012..3014 | Price drifted ~10% | LOW / veto |
| BRK-3015 | Quantity 1000 vs internal 750 (~33% off) | LOW / WRONG_QTY |
| BRK-3016..3017 | Counterparty = "MS Prime Brokerage" | MEDIUM / CPY_ALIAS |
| BRK-3018 | Quantity 502 vs internal 500 (<1% drift) | HIGH (inside tol) |
| BRK-3019..3020 | Trades that exist in internal blotter | HIGH / HIGH |
| (BRK-3020 COST is a fresh trade) | | UNMATCHED_B candidate depending on blotter |

**Use this one in the demo video.** It shows every triage path in one cycle.

---

## 02-counterparty-aliases.csv — KG story

**15 rows focused on counterparty resolution. Most trades align with the internal blotter; the variance is in the `Broker` column.**

Tests whether the Neo4j KG + Postgres alias map handle:

- Abbreviations (`MS & Co`, `MS LLC`, `MSCo`, `M.Stanley`)
- Case variations (`MORGAN STANLEY`, `Morgan Stanley Capital`)
- Punctuation (`Morgan Stanley, Inc.`)
- Unicode (`Société Générale` with/without diacritics)
- Other forms (`SocGen`, `VIRTU FINANCIAL, LLC`, `Virtu Financial`)
- A novel entity that does not exist anywhere (`Prime Broker X (new entity)`)

**Check the server log after ingest** — the `counterparty resolution breakdown` line shows which rows resolved via `pg-name`, `pg-alias`, `pg-norm`, `kg`, or `none`. For the demo, the "none" count proves the graph isn't omniscient — it's a bounded reference layer.

---

## 03-broken-data.csv — ingest resilience

**25 rows that should either parse-and-normalize, or be **skipped with a documented reason**.** Nothing in this file should cause a 500 from `/api/feeds/process`.

Categories:
- **Date formats**: `2026/04/06`, `06-04-2026`, `6-Apr-26`, `4/8/26` → should all normalize to `2026-04-08`
- **Number formats**: `1,000` qty, `$347.90` price, `60,2499` European decimal → normalized
- **Missing fields**: no settle-date (fills from trade-date), no direction (defaults BUY), missing ISIN (kept null)
- **Invalid rows** (skipped with reason): zero qty, negative qty, negative price, non-numeric price, unparseable date
- **Enum violations**: `HOLD` for direction, `XYZ` for currency → skipped or defaulted with log
- **Duplicates**: two identical rows → both ingested; matching engine flags DUPLICATE
- **Edge encoding**: Unicode CPY, comma inside quoted CPY, trailing comma ragged row, garbage `99/99/9999` dates

**Expected outcome after ingest:** ~15–18 rows land in `trades_canonical`, the rest show up in the `skipReasons` log block with a bump-counter per reason. The reconcile cycle then runs against what remains.

Use this to demonstrate **"we don't 500 on bad data — we skip, log, and show the operator what was dropped and why."** That is an enterprise-grade property most products don't have.

---

## Running them

1. Go to `/reconcile`.
2. Side A: pick **Internal Blotter**.
3. Side B: drag one of the files above into the dropzone.
4. For **01-mixed-bands**: map `trade_ref → source_ref`, `side → direction`, `qty → quantity`, everything else auto-matches.
5. For **02-counterparty-aliases**: map `Broker → counterparty`, `B_S → direction`, `Shares → quantity`, etc.
6. For **03-broken-data**: expect the mapping UI to show AI suggestions for the non-obvious columns. The `notes` column should remain unmapped.
7. **Run reconciliation.**
8. After landing on `/workspace`, check the server log (`pnpm dev` terminal) for:
   - `rows skipped during canonicalization` — the skip breakdown
   - `counterparty resolution breakdown` — KG vs Postgres paths

---

## Why these exist

Your clean demo CSVs prove the happy path works. These files prove the system doesn't crumble on the 5% of rows that are actually hard — which is the 95% of what reconciliation ops teams see in production.
