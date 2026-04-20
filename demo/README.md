# ReconAI — Demo Pack

**Scenario:** It's May 1st, 2026. Your firm has just closed April. Three of
your executing brokers have sent their monthly confirmation files. Your job,
as the reconciliation analyst, is to reconcile each one against your internal
blotter before month-end reporting.

Each file is from a **different broker**, with **a different format
convention**, and each contains a mix of:

- **Clean trades** that will match deterministically (HIGH band)
- **Format-drift trades** (CPY aliases, account code changes) — AI catches these
- **Material breaks** (wrong quantity, price outside tolerance) — genuine exceptions
- **Missing confirmations** (broker didn't send, or we don't have)

---

## The 4 files

| File | Represents | Format character | Rows |
|------|-----------|------------------|------|
| `00-internal-blotter-april-2026.csv` | **Your side** — our firm's internal blotter extract | Clean canonical — shown for completeness; already seeded into the DB | 120 |
| `01-morgan-stanley-april-2026.csv` | **Morgan Stanley** confirmation file | ISO 15022 / settlement style: `DD-MMM-YYYY` dates, `B/S` side codes, `nominal` + `execution_px` field names, account stripped of `ACCT-` prefix | 35 |
| `02-jefferies-april-2026.csv` | **Jefferies** execution report | FIX 4.4 style: `ClOrdID`, `TransactTime` with HHmmss, `Side=1/2` (numeric), `SecurityID` = CUSIP only | 29 |
| `03-barclays-april-2026.csv` | **Barclays** trade file | UK convention: `DD/MM/YYYY` dates, `BUY`/`SELL` uppercase, "Client Account Code" full name | 30 |

---

## Break patterns seeded

These are the exceptions the reviewer will see in the `/workspace` queue after
running each cycle. Each is a documented class in `docs/MATCHING_ENGINE.md`.

### `01-morgan-stanley-april-2026.csv`
| Row | Break class | What happened |
|-----|-------------|---------------|
| Index 2 | `WRONG_QTY` | Broker recorded 200 units more than internal |
| Index 6 | `WRONG_QTY` | Broker recorded 100 units less — material break |
| Index 10 | `CPY_ALIAS` | Counterparty = `MS` (short-form alias) |
| Index 14 | `CPY_ALIAS` | Counterparty = `Morgan Stanley Co` (missing LLC) |
| Index 18 | `TIMING` | Trade date +1 day (T+1 confirm delay) |
| Index 22 | `ROUNDING` | Price drift 1.8% — beyond 1% tolerance |
| Bottom row | `MISSING_ONE_SIDE` | Broker has a KO trade we don't — should show as unmatched on A side |

### `02-jefferies-april-2026.csv`
| Row | Break class | What happened |
|-----|-------------|---------------|
| Index 4 | `WRONG_QTY` | +50 units |
| Index 8 | `CPY_ALIAS` | Typo: `Jeferies` → Double Metaphone catches phonetic equivalence |
| Index 12 | `CPY_ALIAS` | `JEFF LLC` — informal internal alias |
| Index 16 | `TIMING` | Trade date +1 day |
| Index 20 | `FORMAT_DRIFT` | Account prefix stripped (`4421` vs `ACCT-4421`) |

### `03-barclays-april-2026.csv`
| Row | Break class | What happened |
|-----|-------------|---------------|
| Index 3 | `WRONG_QTY` | Doubled — looks like an allocation was posted twice |
| Index 5 | `DUPLICATE` | Same trade listed twice in the file |
| Index 7 | `CPY_ALIAS` | `BARC` |
| Index 11 | `CPY_ALIAS` | `Barclays Cap` |
| Index 15 | `ROUNDING` | Price 2% below internal |

---

## How to demo

### Fast path (90 seconds) — Single broker end-to-end

1. Log in as `analyst@demo.co` / `ReconAI-Demo-2026!`
2. Go to **Feed Onboarding**
3. Drop `demo/01-morgan-stanley-april-2026.csv` into the upload zone
4. Click **Infer canonical mapping with AI** — GPT-4o-mini proposes mappings
   - Notice: `ms_trade_id → source_ref`, `execution_px → price`, `nominal → quantity`, `cpy → counterparty`
   - Every mapping has an `AI-assisted` chip; click "Why?" to see reasoning
5. Adjust anything that looks wrong, click **Save & Run Matching Cycle**
6. Land on `/workspace` filtered to this cycle
7. Click the exception labeled `AAPL · MORGAN STANLEY CO LLC` with `WRONG_QTY` band
8. Show the compare pane: Side A = internal blotter, Side B = MS confirmation
9. Point at the **field-by-field score breakdown** and the **Fellegi-Sunter weights**
10. Press `A` to accept the clean match; press `R` to reject the wrong-qty one

### Full story (5 minutes) — Three brokers in sequence

Repeat the above for each file in order:
1. `01-morgan-stanley-april-2026.csv` — watch AI map an unfamiliar settlement format
2. `02-jefferies-april-2026.csv` — watch AI map FIX tags (`ClOrdID` → `source_ref`)
3. `03-barclays-april-2026.csv` — watch AI map UK date convention

Then navigate to **Matching Cycles** → see three completed cycles in history,
each a 2-party reconciliation, each with its own exception queue.

### Two-party simultaneous demo (optional)

Use the `/reconcile` page (if built) — two upload zones, one for each party.
Drop `00-internal-blotter-april-2026.csv` on the left and any broker file on the
right. One click runs the full pipeline. This is the cleanest visual
expression of "reconciliation = comparing two parties' records of the same
trades."

---

## What to say during the demo

> *"Reconciliation happens between two parties. Each keeps their own record of
> the same trades. The platform's job is to find every disagreement and let a
> human resolve it — with AI helping where it creates leverage and full audit
> for every decision.*
>
> *Here are three brokers who sent us files this morning. Three different
> formats, three different counterparty naming conventions, three different
> date formats. Watch what happens when I upload each one."*

Then upload. Watch the AI map. Click into an exception. Show the score
breakdown. Point at the **`AI-assisted`** chip. Resolve it. Move on.

Nothing about this requires you to narrate any technical internals — the UI
shows its own work. The Fellegi-Sunter weights, the Neo4j-resolved alias
chains, and the deterministic fallbacks are all visible in the compare pane
for anyone who asks.

---

## Provenance

Every ticker, ISIN, CUSIP, and broker name is real public data. Prices are
derived from public historical levels. The **pairing** between internal and
broker files is synthesized (no paired recon dataset exists publicly — by
design; see `docs/DATA_PROVENANCE.md`). Format-drift patterns are modeled on
real industry specs (DTCC ITP, SWIFT MT541/543, FIX 4.4).
