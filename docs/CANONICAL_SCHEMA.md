# ReconAI — Canonical Schema

**Status:** v1 — locked for MVP. Changes require a `DECISIONS_LOG.md` entry
and a new schema migration; the canonical shape does not evolve in place.

---

## Design principles

1. **One canonical trade, many feeds.** Every incoming row from any feed is
   transformed into the same shape.
2. **Decimal-safe numbers.** All monetary and quantity fields use numeric
   types; never floats.
3. **ID diversity.** Symbol / ISIN / CUSIP (and future SEDOL) coexist;
   matching uses whichever are present.
4. **Lineage is first-class.** Every canonical trade can be traced back to
   its raw row, feed profile version, and mapping version.
5. **Versioning, never mutation.** Feed profiles, field mappings, and
   matching rules are versioned — a new version is written, the old row stays.
6. **Append-only audit.** `audit_events` captures every state change;
   enforced by RLS.

---

## 1. Canonical trade

```ts
CanonicalTrade {
  trade_id: UUID                           // internal
  source_id: UUID                          // FK → feed_profiles.id
  source_ref: string                       // original ID from the source row
  trade_date: ISODate                      // e.g. "2026-04-07"
  settlement_date: ISODate                 // e.g. "2026-04-08"
  direction: 'BUY' | 'SELL'
  symbol: string                           // e.g. "AAPL"
  isin: string | null                      // 12 chars
  cusip: string | null                     // 9 chars
  quantity: Decimal                        // units
  price: Decimal                           // per-unit, full precision
  gross_amount: Decimal                    // qty * price, computed
  currency: ISO4217                        // "USD"
  counterparty: string                     // raw from source, pre-resolution
  counterparty_canonical_id: UUID | null   // FK → kg entity resolved
  counterparty_embedding: vector(1536)     // cached semantic vector
  account: string
  asset_class: 'EQUITY' | 'FI' | 'FX' | 'FUTURE' | 'OTHER'  // EQUITY only in MVP
  lineage: {
    raw_row_id: UUID
    profile_version: int
    mapping_version: int
    uploaded_at: ISODateTime
  }
  created_at: ISODateTime
}
```

---

## 2. Feed profile (versioned)

Represents one incoming source: a broker, a custodian, an internal system.

```ts
FeedProfile {
  id: UUID
  name: string                             // "Broker B — confirmations"
  kind: 'BROKER' | 'CUSTODIAN' | 'INTERNAL' | 'OTHER'
  version: int                             // 1, 2, 3, ...; new row per change
  created_by: UUID                         // FK → profiles (user)
  created_at: ISODateTime
  retired_at: ISODateTime | null           // latest version has null
  notes: string
}
```

Uniqueness: `(id, version)` compound unique. Updates forbidden; clone + bump.

---

## 3. Field mappings (versioned, child of feed profile)

One row per source-field → canonical-field assignment.

```ts
FieldMapping {
  id: UUID
  feed_profile_id: UUID                    // FK
  version: int                             // matches FeedProfile.version at creation
  source_field: string                     // "trd_dt"
  canonical_field: CanonicalFieldName      // enum, see below
  transform: TransformSpec | null          // optional parse/normalize recipe
  confidence: float                        // from AI at inference, 0..1
  ai_reasoning: string                     // from AI at inference
  confirmed_by: UUID                       // human who saved
  created_at: ISODateTime
}
```

`CanonicalFieldName` enum:
```
trade_date · settlement_date · direction · symbol · isin · cusip ·
quantity · price · currency · counterparty · account · source_ref
```

`TransformSpec` examples:
```ts
{ kind: 'DATE_FORMAT', from: 'MM/DD/YYYY', to: 'ISO' }
{ kind: 'ENUM_MAP', map: { 'B': 'BUY', 'S': 'SELL' } }
{ kind: 'PREFIX_STRIP', pattern: '^A-?' }
{ kind: 'UPPER' }
{ kind: 'TRIM' }
```

---

## 4. Raw + canonical trade pair

```ts
TradeRaw {
  id: UUID
  feed_profile_id: UUID
  row_index: int
  payload: jsonb                           // full original row verbatim
  uploaded_at: ISODateTime
}

TradeCanonical  // as Section 1
```

Every `TradeCanonical.lineage.raw_row_id` references one `TradeRaw.id`.

---

## 5. Matching cycle

```ts
MatchingCycle {
  id: UUID
  feed_a_id: UUID
  feed_b_id: UUID
  date_from: ISODate
  date_to: ISODate
  status: 'PENDING' | 'RUNNING' | 'COMPLETE' | 'FAILED'
  started_at: ISODateTime
  finished_at: ISODateTime | null
  counts: jsonb                            // { matched, medium, low, unmatched, ... }
  matching_rules_version: int
  initiated_by: UUID
}
```

---

## 6. Match result

```ts
MatchResult {
  id: UUID
  cycle_id: UUID
  trade_a_id: UUID
  trade_b_id: UUID
  match_type: '1:1' | '1:N' | 'N:1' | 'N:M'
  posterior: float                         // 0..1
  band: 'HIGH' | 'MEDIUM' | 'LOW'
  field_scores: jsonb                      // FieldScore[] (see below)
  deterministic_hit: bool
  llm_verdict: jsonb | null                // { verdict, confidence, reasoning }
  created_at: ISODateTime
}

FieldScore {
  field: CanonicalFieldName
  raw_score: float                         // 0..1, similarity metric output
  weight: float                             // Fellegi-Sunter log-weight
  contribution: float                       // raw_score * weight
}
```

---

## 7. Exception (open item for analyst)

```ts
Exception {
  id: UUID
  cycle_id: UUID
  match_result_id: UUID | null             // nullable: unmatched case
  trade_a_id: UUID | null
  trade_b_id: UUID | null
  band: 'MEDIUM' | 'LOW' | 'UNMATCHED'
  status: 'OPEN' | 'RESOLVED' | 'ESCALATED' | 'CLOSED'
  exception_class: ExceptionClass          // enum below
  assignee: UUID | null
  opened_at: ISODateTime
  updated_at: ISODateTime
  explanation_cached: string | null        // from explain-break, cached on first open
}
```

`ExceptionClass`:
```
FORMAT_DRIFT · ROUNDING · WRONG_PRICE · TIMING · WRONG_QTY ·
MISSING_ONE_SIDE · DUPLICATE · CPY_ALIAS · ID_MISMATCH · UNKNOWN
```

Price-break dichotomy:
- `ROUNDING` — absolute price delta ≤ `max($0.01, 0.5bp × price)`; precision / display artifact, safe to accept.
- `WRONG_PRICE` — delta above the rounding cap; material money break, always escalate.

---

## 8. Resolution action (analyst action on exception)

```ts
ResolutionAction {
  id: UUID
  exception_id: UUID
  actor: UUID
  action: 'ACCEPT' | 'REJECT' | 'ESCALATE' | 'NOTE' | 'ASSIGN'
  reason: string | null
  payload: jsonb                           // action-specific
  created_at: ISODateTime
}
```

Every ResolutionAction writes a twin row to `audit_events`.

---

## 9. Audit event (append-only)

```ts
AuditEvent {
  id: UUID
  actor: UUID
  action: string                           // e.g. "EXCEPTION_ACCEPT", "FEED_PROFILE_CREATE"
  entity_type: string
  entity_id: UUID
  before: jsonb | null
  after: jsonb | null
  reason: string | null
  created_at: ISODateTime
}
```

RLS: `INSERT` allowed for authenticated users; `UPDATE`/`DELETE` denied for all.

---

## 10. AI call log

```ts
AiCall {
  id: UUID
  call_type: 'INFER_SCHEMA' | 'EMBED' | 'TIEBREAK' | 'EXPLAIN_BREAK' | 'NEXT_BEST_ACTION'
  model: string
  prompt_hash: string                      // SHA-256 of the input prompt
  input_tokens: int
  output_tokens: int
  latency_ms: int
  output: jsonb                            // parsed, validated response
  fallback_used: bool
  request_id: string                       // log correlator
  actor: UUID | null
  created_at: ISODateTime
}
```

Full prompts are NOT stored — only their hash. Reasoning output is stored.

---

## 11. Matching rules (versioned)

```ts
MatchingRule {
  id: UUID
  name: string
  version: int
  active: bool
  weights: jsonb                           // Fellegi-Sunter m/u per field
  tolerances: jsonb                        // price_rel_tolerance, date_day_delta, ...
  created_by: UUID
  created_at: ISODateTime
}
```

Default seeded rule `v1` with documented defaults (see `MATCHING_ENGINE.md`).

---

## 12. Eval runs

```ts
EvalRun {
  id: UUID
  gold_set_version: string
  precision: float
  recall: float
  f1: float
  per_band: jsonb                          // { HIGH: {P, R, F1}, MEDIUM: ..., LOW: ... }
  confusion: jsonb                         // TP, FP, TN, FN
  model_version: string
  matching_rules_version: int
  created_at: ISODateTime
  initiated_by: UUID
}
```

---

## 13. Profile (user + role)

```ts
Profile {
  id: UUID                                 // = auth.users.id
  email: string
  role: 'analyst' | 'manager' | 'auditor'
  created_at: ISODateTime
}
```

---

## 14. Knowledge graph (Neo4j, mirrored reference)

Transactional tables above hold the truth. Neo4j holds the entity graph for
fast reference-data queries.

```cypher
(:Counterparty {
  id, canonical_name, lei, sec_crd, country, asset_classes
})
-[:ALIAS_OF]->(:Counterparty)
-[:SUBSIDIARY_OF]->(:Counterparty)
-[:TRADES_WITH {volume, last_seen}]->(:Counterparty)

(:Security {
  id, symbol, isin, cusip, sedol, asset_class, name
})
-[:ISSUED_BY]->(:Issuer)
-[:LISTED_ON]->(:Exchange)

(:Trade {trade_id, source_id})
-[:WITH_COUNTERPARTY]->(:Counterparty)
-[:OF_SECURITY]->(:Security)
-[:MATCHED_WITH {posterior, band}]->(:Trade)
```

Indexes:
- `CREATE INDEX FOR (c:Counterparty) ON (c.canonical_name)`
- `CREATE INDEX FOR (s:Security) ON (s.isin)`
- `CREATE INDEX FOR (s:Security) ON (s.cusip)`
- `CREATE INDEX FOR (t:Trade) ON (t.trade_id)`

Consistency: `Counterparty.id` = `Postgres counterparty_entities.id`. Backfill
one-way (Postgres → Neo4j) on seed and on entity updates.

---

## 15. FINOS CDM alignment (roadmap note)

The canonical trade maps cleanly onto a subset of the FINOS Common Domain
Model (CDM) `TradeState`. The MVP does not ingest or emit CDM JSON, but the
field names and types are intentionally compatible. Post-MVP, `/api/canonical/cdm`
can expose the shape without rework.

| Canonical field | CDM path (approx) |
|---|---|
| `trade_date` | `tradeDate` |
| `settlement_date` | `settlementTerms.settlementDate` |
| `direction` | `buyerSeller` (derived) |
| `symbol` / `isin` / `cusip` | `product.security.productIdentifier[*]` |
| `quantity` | `tradeLot.priceQuantity.quantity.value` |
| `price` | `tradeLot.priceQuantity.price.value` |
| `currency` | `tradeLot.priceQuantity.price.unit.currency` |
| `counterparty` | `party[role=Counterparty].partyId.identifier` |
| `account` | `account.accountNumber.value` |
