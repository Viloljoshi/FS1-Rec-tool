# ReconAI — Complex Demo Pack

**Scenario.** You've cleared the slate. Three new broker/market-maker feeds
just dropped into your operations inbox, each with its own quirks. This pack
exists to answer one question honestly: **what kinds of unstructured or
semi-structured data can ReconAI ingest today, and where do we draw the
line?**

The Internal Blotter (1,806 trades across 10 brokers) is kept as-is. These
four files are new feeds you can upload through `/reconcile` or `/onboarding`.

---

## The four files

| File | Rows | Status | What it tests |
|---|---|---|---|
| `01-jane-street-mixed-formats.csv` | 30 | ✅ HANDLED | Four date formats in the same file, 3 direction codes (`B/S`, `BUY/SELL`, `1/2`), price with `$`, commas, scientific notation, quantity with commas, 4 CPY variants, a free-text memo column to ignore, 2 ragged rows (extra trailing commas), 1 zero-qty row |
| `02-virtu-json-metadata.csv` | 25 | ✅ HANDLED | JSON blob column (map as "ignore"), Unicode counterparty (`Société Générale`), semicolon-delimited multi-executing-broker CPY, malformed JSON in one row, empty JSON in another |
| `03-barclays-swift-raw.csv` | 20 | ❌ NOT HANDLED | Trade fields encoded as `:20C:`, `:36B:`, `:35B:` etc. SWIFT-style tags inside one `msg_block` column. Shows the limit — requires a pre-parser step we haven't built |
| `03-barclays-swift-flattened.csv` | 20 | ✅ HANDLED | Same data as above, but flattened into tabular form. Demonstrates the **upgrade path** for SWIFT feeds |

---

## What the system actually does — field by field

### Date parsing (`normalizeDate`)

All of these land on canonical `YYYY-MM-DD`:

| Input format | Example from file |
|---|---|
| ISO `YYYY-MM-DD` | `2026-04-07` |
| US `MM/DD/YYYY` | `04/07/2026` |
| UK `DD/MM/YYYY` | `07/04/2026` |
| Long `Mon D YYYY` | `Apr 7 2026` |
| SWIFT `DD-MMM-YYYY` | `07-APR-2026` |
| Packed `YYYYMMDD` | `20260407` |

If parsing fails for one row, it's skipped (not crashed) and counted in `rows_skipped`.

### Direction codes (`normalizeDirection`)

Accepts `B`, `BUY`, `Buy`, `BOT`, `BOUGHT`, `S`, `SELL`, `Sell`, `SLD`, `SOLD`.
FIX numeric `1`/`2` is handled by the schema inference layer (GPT-5.4 maps
`Side` → `direction` with the right semantics).

### Price and quantity (`normalizeDecimal`)

- Strips commas (`178,432.50` → `178432.50`)
- Strips currency prefix when mapped to a numeric field (`$178.43` → `178.43`)
- Parses scientific notation (`1.7843e2` → `178.43`)
- Uses `decimal.js` for exact arithmetic — no float drift on `qty × price`
- Zero-qty rows are kept but will always fail Fellegi-Sunter scoring (integrity veto demotes to LOW)

### Counterparty resolution

Three sequential strategies against the entity graph:

1. Exact match against `counterparty_entities.canonical_name` (case-insensitive)
2. Match against `counterparty_aliases.alias` (exact)
3. Match against `counterparty_aliases.normalized_alias` (punctuation-stripped)

After this PR: embeddings via `text-embedding-3-small` are populated at ingest. The matching engine uses them during similarity scoring for genuinely novel string variants.

### Free-text / memo / JSON columns

These are NOT actively parsed. In the mapping editor, map them as **"— ignore —"**. They stay in `trades_raw.payload` (full lineage preserved) but don't flow into canonical fields.

Want fields extracted from a JSON blob? That would need a small pre-processor step in `lib/canonical/normalize.ts` — ~30 min of work once you know the JSON shape.

---

## What the system CANNOT handle today

These require work you haven't paid for yet:

| Input shape | Why | Upgrade path |
|---|---|---|
| **PDF confirmations / statements** | No text extraction | Wire Docling (already scaffolded in roadmap) |
| **SWIFT MT541 / MT543 raw messages** | Fields are in `:TAG:value` blocks, not columns | Add a pre-parser that converts `msg_block` → flat CSV. Demo file `03-barclays-swift-flattened.csv` shows the target shape |
| **Email bodies with trade details in prose** | Would need an LLM extraction pre-step | Add `/api/ai/extract-from-email` — ~45 min |
| **Multi-sheet Excel with cross-sheet refs** | We parse sheet 1 only | Loop over `wb.SheetNames` — ~15 min |
| **Multi-leg swaps / paired trades** (buy + sell as two rows with a parent_id) | Matching engine assumes one-row-per-trade | New match_type handler — genuine product work |
| **FpML / FIXML XML** | No XML parser wired | npm `fast-xml-parser` + mapping layer — ~60 min |

---

## How to test

### Test 1 — The happy path (2 min)

1. `pnpm dev` → log in as `analyst@demo.co`
2. `/reconcile` → Side A = `Internal Blotter` (existing)
3. Side B = **Upload new file**, name `"Jane Street — Mixed Formats"`, kind `BROKER`, **drag-drop** `demo/complex/01-jane-street-mixed-formats.csv`
4. Click **Infer canonical mapping**. GPT-5.4 will propose:
   - `ID` → `source_ref`
   - `When` → `trade_date`
   - `Settle` → `settlement_date`
   - `Side` → `direction`
   - `Ticker` → `symbol`
   - `SecID_ISIN` → `isin`
   - `Qty` → `quantity`
   - `ExecPrice` → `price`
   - `Ccy` → `currency`
   - `Counterparty` → `counterparty`
   - `Book` → `account`
   - `InternalMemo` → (leave as `— ignore —`)
5. Click **Run Reconciliation**. Wait ~20s. Lands on `/workspace`.
6. Expected: ~25 clean HIGH matches + a handful of MEDIUM (CPY alias drift from the 5 JS variants) + 1 LOW (the zero-qty row hits the integrity veto)

### Test 2 — JSON metadata column (90s)

1. Repeat the `/reconcile` flow with `02-virtu-json-metadata.csv`
2. When mapping: set `metadata` → `— ignore —`
3. Note the Unicode CPY row (`Société Générale; Virtu`) ends up unmatched or in MEDIUM because the CPY graph doesn't know Société Générale — **this is correct behavior**, not a bug
4. The malformed-JSON row at index 10 still canonicalizes fine because we're ignoring that column

### Test 3 — What failure looks like (60s)

1. Upload `03-barclays-swift-raw.csv`
2. GPT-5.4 will propose mapping `msg_ref` → `source_ref` but have no confidence about `msg_block` (it's one blob containing all other fields)
3. Click Run anyway. Result: rows will be canonicalized with symbol=`UNK`, price=0, and most fields empty. Most will fail the integrity veto and land as LOW / UNMATCHED
4. This is the honest limit — our system flags the feed as incomplete rather than pretending. The fix is the pre-parser shown in `03-barclays-swift-flattened.csv`

### Test 4 — The upgrade path (60s)

1. Upload `03-barclays-swift-flattened.csv` (same data, flattened)
2. All fields map cleanly — results look like a normal Barclays feed

---

## SQL verify after each test

Paste into Supabase SQL editor to see the result:

```sql
SELECT
  fp.name AS feed,
  fp.version,
  (SELECT count(*) FROM trades_canonical tc
    WHERE tc.source_id = fp.id AND tc.source_version = fp.version) AS canonical,
  (SELECT count(*) FROM trades_canonical tc
    WHERE tc.source_id = fp.id AND tc.source_version = fp.version
      AND tc.counterparty_embedding IS NOT NULL) AS with_embedding,
  fp.created_at
FROM feed_profiles fp
WHERE fp.retired_at IS NULL
ORDER BY fp.created_at DESC;
```

Expected after all 4 test uploads: 4 new feed profile rows, one per file.
`canonical` counts should be close to row counts (minus zero-qty skips);
`with_embedding` should equal `canonical` once the ingest embedding pass
completes (~5 s post-upload).
