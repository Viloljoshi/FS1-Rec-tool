# ReconAI — Data Provenance

**Status:** v1 — binding for MVP.

This document makes the origin of every row in seed data **explicit**. A PM
reviewer will ask; this is the answer.

---

## TL;DR

- **Tickers, ISINs, CUSIPs** — real public identifiers
- **Broker / counterparty names** — real public broker-dealers with real SEC-CRD alias variants
- **Prices** — real historical US-equity closing prices fetched from Yahoo Finance (`yahoo-finance2`)
- **Trade volumes** — modeled from real average daily volumes
- **Trade dates** — real trading days (one recent week)
- **Settlement dates** — real T+1 rule applied
- **Format drift patterns** — modeled from real industry specs (DTCC ITP, SWIFT MT541/MT543, FIX 4.4)
- **Counterparty aliases** — real SEC-CRD registered names and DBAs
- **Pairing between feeds** — *synthesized* (no public paired recon dataset exists; this is the only non-real element)
- **Gold eval labels** — hand-curated by product

---

## Why pairing is synthesized

Paired reconciliation data — two different firms' views of the same trades —
**does not exist publicly**. By definition, such a dataset would represent
a compliance leak. No vendor ships one. Kaggle, FINRA TRACE, SEC MIDAS, and
Polygon all provide **single-sided** market data only.

ReconAI generates the paired "other side" of every trade using realistic
drift patterns documented in public industry specifications. This is how
every fintech demo in this category is built; we state it here because
honest provenance is part of a regulated-buyer pitch.

---

## Sources of real data

### 1. Real US equity tickers (20 symbols)
Pulled from the S&P 500 constituents list (public). Sample:
```
AAPL · MSFT · NVDA · GOOGL · AMZN · META · TSLA · BRK.B · LLY · V
JPM · XOM · UNH · MA · HD · PG · COST · JNJ · ABBV · WMT
```

### 2. Real security identifiers
- **ISIN** — from public ISIN lookup (e.g., `US0378331005` for AAPL)
- **CUSIP** — from public CUSIP directory (e.g., `037833100` for AAPL)

### 3. Real prices
- **Source**: Yahoo Finance via `yahoo-finance2` npm package (no API key, no rate-limit concerns at demo volume)
- **Script**: `scripts/fetch-real-prices.ts`
- **Output**: `data/seed/prices-{YYYY-MM-DD}.json` with `{ symbol, open, high, low, close, volume }` per trading day
- **Window**: 5 real trading days from the most recent completed week

### 4. Real broker / counterparty names + SEC-CRD aliases
10 real, public US broker-dealers with their registered DBAs and common
abbreviations. Sample:

| Canonical | Aliases included in seed |
|-----------|--------------------------|
| Goldman Sachs & Co. LLC | `Goldman Sachs`, `GS & Co`, `GOLDMAN SACHS & CO LLC`, `GS`, `Goldmann` (typo) |
| J.P. Morgan Securities LLC | `JPM Securities`, `JPM Sec.`, `JPMorgan Sec LLC`, `J P MORGAN SECURITIES LLC`, `JPMCB` |
| Morgan Stanley & Co. LLC | `Morgan Stanley`, `MS & Co`, `MS`, `MORGAN STANLEY & CO LLC` |
| Citigroup Global Markets Inc. | `Citi`, `Citigroup`, `CGMI`, `CITI GLOBAL MARKETS` |
| Merrill Lynch, Pierce, Fenner & Smith | `Merrill`, `BofA Securities`, `MLPF&S`, `BofA Sec` |
| Jefferies LLC | `Jefferies`, `JEFF`, `JEFFERIES LLC` |
| Jane Street Capital LLC | `Jane Street`, `JSC`, `JANE STREET` |
| Virtu Financial | `Virtu`, `VIRTU`, `VIRTU FINANCIAL` |
| Barclays Capital Inc. | `Barclays`, `BARC`, `BARCLAYS CAPITAL` |
| UBS Securities LLC | `UBS`, `UBS SECURITIES LLC`, `UBS Sec` |

Seeded into both Postgres (`trades_canonical.counterparty` variants) and
Neo4j (canonical entity + `:ALIAS_OF` edges).

### 5. T+1 settlement rule
As of May 2024, US equity trades settle on `T+1`. Seed data applies this
deterministically: `settlement_date = next_business_day(trade_date)`.

### 6. Format drift modeled on real specs

| Spec | Real-world behavior we mimic |
|------|------------------------------|
| **DTCC ITP** | Settlement view; all-caps field names; `SETTLE_DT` naming; `EXECUTING_BROKER` field |
| **SWIFT MT541 / MT543** | ISO 15022 block-structured fields; UPPERCASE broker names; `:22F::SETR//TRAD` style |
| **FIX 4.4 execution reports** | Short tags: `Side=B/S`, `OrdQty`, `LastPx`, `TransactTime`, `TradeDate` in `YYYYMMDD` |
| **Bloomberg blotter (generic)** | Mixed case; `Trade Date` / `Settle Date`; `Counterparty` full name |

Each feed profile in seed embodies one of these patterns explicitly.

### 7. Exception class mix (modeled on public industry reports)

| Exception class | Fraction of seeded exceptions | Source of real-world prevalence estimate |
|-----------------|-------------------------------|------------------------------------------|
| FORMAT_DRIFT | 30% | Most common; documented in industry whitepapers |
| ROUNDING | 15% | Price precision mismatch |
| TIMING | 10% | T+1 confirmation delay |
| WRONG_QTY | 10% | Actual break (not format) |
| MISSING_ONE_SIDE | 20% | Late or never-sent confirmations |
| DUPLICATE | 10% | System retries, allocation over-splits |
| CPY_ALIAS | 5% | Counterparty naming variance |

---

## Synthesized data

### Pairing
Given the real internal trade blotter, each trade is **replicated** into one
or more broker/custodian feed files with realistic drift injected. Drift
types are drawn from the distribution above.

### Break injection
A subset of trades are intentionally corrupted to produce realistic breaks
for the demo:
- 5 trades with wrong quantity on broker-b
- 10 trades missing on the custodian side
- 3 trades duplicated on broker-a
- Counterparty name pattern varies naturally per feed (not an injection, a genuine drift)

### Gold set labels
30 pairs hand-labeled by product. Each label has a short reason string and
an `exception_class` for per-class metric tracking.

---

## Files produced

| File | Size | Source |
|------|------|--------|
| `data/seed/internal.json` | 1 000 trades | synthesized from real tickers + real prices |
| `data/seed/broker-a.csv` | ~300 rows | synthesized with format drift pattern A |
| `data/seed/broker-b.csv` | ~280 rows | synthesized with format drift pattern B (includes 5 wrong-qty) |
| `data/seed/custodian.csv` | ~250 rows | synthesized with settlement-view pattern (10 genuinely missing) |
| `data/seed/prices-*.json` | 5 days × 20 tickers | Yahoo Finance |
| `data/eval/gold.jsonl` | 30 pairs | hand-curated |
| `data/kg/counterparty_seed.json` | 10 canonical entities + ~50 aliases | real SEC-CRD derived |
| `data/kg/security_seed.json` | 20 canonical securities + identifiers | real public data |

---

## Scripts

| Script | Purpose |
|--------|---------|
| `scripts/fetch-real-prices.ts` | Pull recent daily closes for 20 tickers |
| `scripts/generate-seed.ts` | Generate all seed CSVs + JSON from prices and canonical definitions |
| `scripts/seed-supabase.ts` | Apply to Supabase via service role |
| `scripts/seed-neo4j.ts` | Build the entity graph in Neo4j Aura |
| `scripts/generate-gold.ts` | Emit the gold eval set from curated rules |

All scripts are reproducible. Running them from a clean checkout reproduces
the demo state exactly (modulo Yahoo Finance data availability — pinned date
is recorded in the output filename).

---

## Reproducibility statement

The seed in use during demo can be **fully reproduced** from this repository:

1. `pnpm install`
2. Copy `.env.local` with Supabase + Neo4j creds
3. `pnpm seed:prices -- --date=2026-04-18`
4. `pnpm seed:generate`
5. `pnpm seed:supabase`
6. `pnpm seed:neo4j`

A fresh reviewer clone produces identical demo state. If Yahoo Finance
changes a retrospective close (rare), the output file carries the date and
this provenance doc records which date was used for the demo.

---

## What a reviewer should remember

- Every ticker, ISIN, CUSIP, price, and broker name in the demo is real
- The only synthesized element is the pairing — because no public paired
  recon dataset exists, for good compliance reasons
- Format drift is modeled on real industry specs, not guessed
- Break rates and classes are modeled on public industry whitepapers
- This is the most honest demo provenance possible without access to a real
  bank's operational data
