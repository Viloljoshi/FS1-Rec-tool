# ReconAI

**AI-native securities trade reconciliation platform — MVP for the demo purpose.

Built in a 4-hour weekend sprint as a portfolio artifact for a Senior PM role
in fintech reconciliation. Feels enterprise-grade; AI is bounded to five
specific seams; every match decision is decomposable and auditable.

- 📄 [Product PRD](docs/PRODUCT_PRD.md)
- 🎬 [Demo Script](docs/DEMO_SCRIPT.md)
- 🏛 [System Architecture](docs/SYSTEM_ARCHITECTURE.md)
- 🔢 [Canonical Schema](docs/CANONICAL_SCHEMA.md)
- ⚙️ [Matching Engine](docs/MATCHING_ENGINE.md)
- 🎨 [UX Workflows](docs/UX_WORKFLOWS.md)
- 🛡️ [Governance Rules](docs/GOVERNANCE_RULES.md)
- ✅ [Evals](docs/EVALS.md)
- 📚 [Data Provenance](docs/DATA_PROVENANCE.md)
- 📋 [Build Plan](docs/BUILD_PLAN.md)
- 📝 [Decisions Log](docs/DECISIONS_LOG.md)

## What this is

- **Ingest** unstructured inputs (CSV, XLSX; PDF via Docling on roadmap)
- **Canonicalize** trades into a versioned, lineage-tracked internal schema
- **Match** using a 7-layer pipeline: deterministic → probabilistic → AI tiebreak
- **Manage exceptions** in a 3-pane Bloomberg-terminal-density analyst workspace
- **Reference data** as a Neo4j knowledge graph (counterparties, aliases, securities)
- **Audit** every state change in an append-only, RLS-enforced log
- **Evaluate** AI quality against a curated gold set; precision / recall / F1

## Stack

Next.js 15 · TypeScript strict · Supabase (Postgres + Auth + RLS + pgvector) ·
Neo4j AuraDB · OpenAI (`gpt-4o-mini`, `text-embedding-3-small`) · shadcn/ui ·
TanStack Table & Virtual · Recharts · Sigma.js · Zod · React Hook Form.

See `CLAUDE.md` for the complete tech stack.

## Local setup

```bash
# 1. Install dependencies
pnpm install

# 2. Copy env template and fill in keys
cp .env.local.example .env.local
#   Fill: OPENAI_API_KEY, NEXT_PUBLIC_SUPABASE_URL,
#         NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY,
#         NEO4J_URI, NEO4J_USERNAME, NEO4J_PASSWORD

# 3. Apply DB schema + seed both databases
pnpm seed:all

# 4. Run
pnpm dev
```

Visit http://localhost:3000 and log in with one of the seeded demo users:
- `analyst@demo.co`   → exception management
- `manager@demo.co`   → dashboard + evals
- `auditor@demo.co`   → audit log

## Scripts

| Command | Purpose |
|---------|---------|
| `pnpm dev` | Run the app in development |
| `pnpm build` | Production build |
| `pnpm typecheck` | Strict TypeScript check |
| `pnpm test` | Unit tests (matching engine + evals) |
| `pnpm seed:prices` | Fetch real historical prices from Yahoo Finance |
| `pnpm seed:generate` | Generate 3 feed files + gold eval set |
| `pnpm seed:supabase` | Apply schema + insert seed rows to Supabase |
| `pnpm seed:neo4j` | Build the entity graph in Neo4j |
| `pnpm seed:all` | All of the above, in order |

## The five AI seams

1. **Feed schema inference** — GPT-4o-mini proposes canonical mappings from sample rows
2. **Counterparty embeddings** — semantic similarity for alias resolution
3. **MEDIUM-band tiebreak** — GPT verdict on ambiguous candidate pairs
4. **Exception explanation** — analyst-readable rationale for why a match is suggested
5. **Next-best-action** — suggested resolution for open exceptions

Every AI call is Zod-validated, prompt-hashed, logged to `ai_calls`, shows an
**AI-assisted** badge in the UI, and has a deterministic fallback.

## The 7-layer matching pipeline

```
Normalize → Deterministic hash → Blocking → Field similarity (ensemble) →
Fellegi-Sunter posterior → Hungarian 1:1 assignment → LLM tiebreak (MEDIUM only)
```

Every score is decomposable to the field. See `docs/MATCHING_ENGINE.md`.

## License

Private portfolio project. Not for redistribution.
