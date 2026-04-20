# ReconAI — System Architecture

**Status:** v0.1, MVP

---

## 1. High-level shape

```
┌─────────────────────────────────────────────────────────────────┐
│                          Browser (Next.js)                       │
│                                                                  │
│  Login · Onboarding · Matching · Exception Mgmt · Ref Data ·     │
│  Audit · Dashboard                                               │
│                                                                  │
│  shadcn/ui · Tailwind · TanStack Table/Virtual · Recharts ·      │
│  react-sigma · cmdk · sonner · zustand                           │
└────────────────────────┬─────────────────────────────────────────┘
                         │ (Next.js App Router)
┌────────────────────────▼─────────────────────────────────────────┐
│                      Next.js Server (RSC + API routes)           │
│                                                                  │
│  /api/sources · /api/ingest · /api/canonical · /api/recon ·      │
│  /api/exceptions · /api/audit · /api/eval · /api/kg ·            │
│  /api/ai/{infer-schema,embed,tiebreak,explain-break,next-best}   │
│                                                                  │
│  lib/matching   ← normalize → hash → blocking → similarity →     │
│                   fellegi_sunter → hungarian → bands → LLM       │
│  lib/ai         ← single OpenAI wrapper with logging             │
│  lib/kg         ← Neo4j driver + typed Cypher queries            │
│  lib/audit      ← single audit write path                        │
│  lib/rbac       ← role guards for server actions                 │
└────────┬───────────────────────┬───────────────────────┬─────────┘
         │                       │                       │
  ┌──────▼──────┐         ┌──────▼──────┐         ┌──────▼──────┐
  │  Supabase   │         │  Neo4j Aura │         │   OpenAI    │
  │  Postgres   │         │ (free tier) │         │ gpt-4o-mini │
  │  + Auth     │         │             │         │ embed-3     │
  │  + RLS      │         │  Entities   │         │             │
  │  + pgvector │         │  + aliases  │         │  via JSON   │
  │  + Storage  │         │  + links    │         │  mode only  │
  └─────────────┘         └─────────────┘         └─────────────┘
```

---

## 2. Service boundaries

### 2.1 Next.js app (the only app)

- Route-based code splitting via App Router
- React Server Components for all reads; Client Components only where interactivity demands it
- API routes for mutations and AI calls
- Middleware at the edge for auth redirects
- No FastAPI, no separate backend process

### 2.2 Supabase Postgres (transactional source of truth)

Holds: **feed profiles**, **field mappings** (both versioned), **raw trades**,
**canonical trades**, **matching cycles**, **match results**, **exceptions**,
**resolution actions**, **audit events**, **AI calls**, **eval runs**,
**matching rules**, **profiles (users + role)**.

- Row-Level Security policies on every table (see `GOVERNANCE_RULES.md`)
- `pgvector` extension for counterparty embeddings (1536-d)
- Append-only enforcement on `audit_events` via RLS
- Versioning convention: `(natural_key, version)` compound unique; never update

### 2.3 Neo4j AuraDB (reference knowledge graph)

Holds: **Counterparty entities**, **aliases**, **subsidiary links**,
**securities master**, **exchange/issuer links**, **trade→entity projections**.

- Read-heavy, small write volume (rebuild on ingest, not on every trade)
- Cypher queries via `neo4j-driver` in server code only
- Dev-time introspection via `mcp-neo4j-cypher` MCP server
- NOT on the critical trade path — matching engine reads it only for counterparty resolution

### 2.4 OpenAI (bounded AI surface)

Five API endpoints, each with a single responsibility:

| Endpoint | Model | Input | Output | Used in |
|---|---|---|---|---|
| `/api/ai/infer-schema` | `gpt-4o-mini` (JSON mode) | headers + 5 rows | field-by-field canonical mapping + confidence | Onboarding |
| `/api/ai/embed` | `text-embedding-3-small` | counterparty string | 1536-d vector | Canonicalization + KG seeding |
| `/api/ai/tiebreak` | `gpt-4o-mini` (JSON mode) | two canonical trades + field diff | `{verdict, confidence, reasoning}` | Matching, MEDIUM band only |
| `/api/ai/explain-break` | `gpt-4o-mini` (JSON mode) | exception + match explanation | human-readable paragraph | Exception Management, cached |
| `/api/ai/next-best-action` | `gpt-4o-mini` (JSON mode) | open exception + analyst context | suggested action + reason | Exception Management |

All calls go through `lib/ai/openai.ts`. No other module imports the OpenAI SDK.

---

## 3. Data flow — ingestion to resolution

```
  Upload → Parse → Validate → Normalize → Persist (raw + canonical)
     │
     │   During onboarding only: infer-schema AI call,
     │   analyst confirms, feed_profile + field_mappings versioned
     │
     ▼
  Matching Cycle (server action)
     │
     │   1. Pull canonical trades for both feeds in date range
     │   2. Normalize (idempotent, pure)
     │   3. Deterministic hash bucket — O(n)
     │   4. Standard Blocking by (symbol, date, side) — O(n·k)
     │   5. Field similarity ensemble per candidate pair
     │   6. Fellegi-Sunter log-likelihood → posterior
     │   7. Hungarian one-to-one optimal assignment within blocks
     │   8. Band assignment (HIGH/MEDIUM/LOW)
     │   9. For MEDIUM band only: AI tiebreak
     │  10. Persist match_results + open exceptions
     │  11. Write audit_event for the cycle
     │  12. Project trade→entity edges into Neo4j for break clustering
     │
     ▼
  Exception Management (analyst action)
     │
     │   Action → analyst_actions row + audit_event row + exceptions.status update
     │   All three in one DB transaction
     │
     ▼
  Audit + Evals + Dashboard (read-only projections)
```

---

## 4. Storage strategy

### 4.1 Files
- Demo: uploaded CSV/XLSX stored in Supabase Storage, bucket `feed-uploads`
- Signed URLs with TTL; service role only for writes
- Raw bytes retained for lineage; canonical rows link back by `raw_row_id`

### 4.2 Vectors
- `counterparty_embedding vector(1536)` on `trades_canonical`
- Cached per unique CPY string in a dedupe table to avoid re-embedding
- IVF_FLAT or HNSW index via pgvector (added post-seed)

### 4.3 Graph
- One Neo4j instance, single database
- Nightly in real life, on-demand during demo
- Batched writes via `UNWIND` to reduce round-trips

### 4.4 Audit
- `audit_events` table, append-only via RLS
- Before/after captured as `jsonb`; diffed in UI by `jsondiffpatch`
- CSV export endpoint streams via `ReadableStream`

---

## 5. Frontend architecture

### 5.1 Route structure
```
/(auth)/login                 → magic-link flow
/                             → role-aware redirect
/onboarding                   → feed profile stepper
/matching                     → cycle runner + history
/workspace                    → exception management (3-pane)
/reference-data               → Sigma graph + entity search
/audit                        → append-only log viewer
/dashboard                    → KPI tiles + charts + evals sub-page
/dashboard/evals              → eval history + confusion matrix
```

### 5.2 State management
- Server state: RSC + `@tanstack/react-query` for client mutations
- Workspace state (selection, filters, keyboard mode): `zustand` store
- Form state: `react-hook-form` + `zod`
- No Redux, no Jotai, no Recoil — the stack is already large enough

### 5.3 Component layering
```
components/
  ui/                 ← shadcn primitives (generated)
  layout/             ← Shell, Sidebar, TopBar, CommandPalette
  onboarding/         ← UploadDropzone, MappingEditor, ProfileVersionList
  workspace/          ← QueueTable, ComparePane, ScoreBreakdown,
                        AiExplanationCard, ActionPanel
  reference-data/     ← EntitySearch, SigmaGraph, AliasList
  audit/              ← AuditTable, DiffViewer
  dashboard/          ← KpiTile, AgingHistogram, MatchRateLine, EvalsTile
  shared/             ← AiAssistedBadge, ConfidenceChip, MoneyCell,
                        DateCell, CopyableId
```

---

## 6. Security model

- **Auth**: Supabase magic-link for MVP; JWT in HttpOnly cookie
- **Roles**: `analyst` · `manager` · `auditor`, stored in `profiles.role`
- **Enforcement**: Postgres RLS on every user-reachable table
- **Secrets**: `.env.local` only; never in repo; `SUPABASE_SERVICE_ROLE` on server only
- **AI prompts**: hashed before logging to avoid storing full raw PII in `ai_calls`
- **Uploads**: MIME-sniffed server-side; size cap 10 MB; XLSX opened in safe mode
- **Output escaping**: all user strings rendered via React (no `dangerouslySetInnerHTML`)

---

## 7. Observability

- `pino` structured logs on every API route with `request_id` correlator
- Every AI call writes a row to `ai_calls` with `prompt_hash`, `tokens`, `latency_ms`
- Every matching cycle writes `recon_jobs.counts` jsonb summarizing band distribution
- Dev: logs stream to console; Prod: Vercel log drain

---

## 8. Non-functional targets

| Dimension | Target |
|---|---|
| Page TTI | < 1.5s p50 on Vercel edge |
| Matching cycle | 1,000 × 1,000 trade pairs in < 5s (demo-scale) |
| AI infer-schema | < 3s p95 |
| Exception open → compare render | < 200ms |
| Audit log page | < 1s for 10k rows (virtualized) |
| Type safety | Zero `any`; Zod at every boundary |

---

## 9. Deployment topology

```
Vercel                          Supabase (managed)          Neo4j Aura (free)
  Next.js edge + serverless      Postgres + Auth +           Aura Free
    │                            Storage + RLS                  │
    │ reads/writes via SSR ─────▶ │                             │
    │ reads via SSR ──────────────────────────────────────────▶ │
    │
    │ outbound ───▶ api.openai.com
```

One `.env.local` → Vercel environment variables via GitHub integration. One
migration folder applied to Supabase via MCP. Neo4j connection string + password
in env only.

---

## 10. What this architecture explicitly rejects

- Microservices (one app, one DB + one graph)
- Async job queues (server actions + RSC streaming suffice at demo scale)
- Microfrontends
- Multi-tenant sharding (single workspace)
- SSR caching of user-specific data (simpler + safer for MVP)
- Client-side SDK calls to OpenAI (all server-side)

Each rejection is a speed decision for the 4-hour budget. The canonical schema
and the matching pipeline are designed so any of them can be added later
without rewriting business logic.
