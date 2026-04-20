# ReconAI — Vercel Deploy Guide

Single-command deploy. The app is framework-detected by Vercel (Next.js 15).
Everything server-side works on Vercel serverless functions. The `natural`
package pulls in `lapack` which is webpack-aliased to `false` via
`next.config.mjs` — no native binaries ship.

---

## Prerequisites

- A Vercel account (free tier is fine for the demo)
- Logged-in Vercel CLI:
  ```bash
  pnpm dlx vercel login
  ```
- Supabase project is already set up (URL, anon key, service_role key).
- Neo4j AuraDB free instance is already set up.
- OpenAI API key with access to `gpt-5.4` and `text-embedding-3-small`.

---

## Environment variables to add in Vercel

Before the first deploy, add these in **Vercel Project Settings → Environment
Variables** (Production + Preview + Development):

| Variable | Example / source |
|----------|------------------|
| `OPENAI_API_KEY` | `sk-proj-…` from OpenAI dashboard |
| `OPENAI_MODEL` | `gpt-5.4` |
| `OPENAI_EMBED_MODEL` | `text-embedding-3-small` |
| `NEXT_PUBLIC_SUPABASE_URL` | `https://<ref>.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | anon JWT from Supabase Settings → API |
| `SUPABASE_SERVICE_ROLE_KEY` | service_role JWT — **mark as sensitive** |
| `NEO4J_URI` | `neo4j+s://<instance>.databases.neo4j.io` |
| `NEO4J_USERNAME` | Aura free instance ID (8-char hex from your Aura console) — **not `neo4j`** |
| `NEO4J_PASSWORD` | from the credentials file Aura showed at creation |
| `NEO4J_DATABASE` | same as username for Aura free tier |
| `NEXT_PUBLIC_APP_NAME` | `ReconAI` |

> ⚠️ **Never** paste the service_role key or OpenAI key anywhere other than
> Vercel's env UI or your local `.env.local`. Rotate after the demo.

---

## One-shot deploy

From the project root:

```bash
cd recon-ai
pnpm dlx vercel --prod
```

On first run Vercel will:
1. Detect Next.js 15
2. Ask for project name (accept `recon-ai` or your preferred)
3. Ask if you want to link to an existing project — choose **No** first time
4. Upload, install, build, and deploy

Output will include a production URL like `https://recon-ai-<hash>.vercel.app`.

---

## After first deploy

### 1. Update demo-account redirect URLs in Supabase
- Go to **Supabase Auth → URL Configuration**
- Add to "Site URL" and "Redirect URLs":
  `https://recon-ai-<hash>.vercel.app`
- Without this, magic-link and email callbacks can bounce back to localhost.

### 2. (Optional) Map a custom domain
Vercel dashboard → Project → Settings → Domains. Add a subdomain. TLS is
auto-provisioned.

### 3. Seed the hosted DB (if you haven't already)
Seed runs from your local machine but hits the hosted Supabase + Neo4j via
the same env vars:
```bash
pnpm seed:all         # prices → generate → supabase → neo4j → precompute
```
You can skip this if you already seeded during development — the same
Supabase + Neo4j instances are used in dev and prod.

---

## Verify the deploy

After it goes live, hit these URLs in order:

| URL | Expected |
|-----|----------|
| `/login` | Login form with 3 demo accounts listed |
| `/dashboard` (as manager) | AI narrative card at top, 5 KPI tiles, 2 charts, evals history table |
| `/pipeline` (any role) | 7-stage canvas + Expert Mode with preset buttons |
| `/pipeline` (as manager) | Expert Mode editable, Publish button visible |
| `/workspace` (as analyst) | Tabbed compare pane on exception select |
| `/governance` (any role) | 5-tab governance view with guardrails, AI seams, RBAC matrix |
| `/audit` | Append-only event log with CSV export |
| `/reference-data` | Neo4j-backed counterparty graph |
| `/reconcile` | 2-party upload workflow |

### Production smoke test
Sign in as `manager@demo.co`, open `/pipeline`, select the **Strict** preset,
click **Publish as new version**. A toast confirms, the Ruleset versions
table shows a new row `default v2 ACTIVE`, and `/audit` shows a
`MATCHING_RULES_PUBLISH` event.

---

## Rollback

Vercel keeps every deploy. To roll back:
- Vercel dashboard → Project → Deployments → pick a previous healthy deploy → **Promote to Production**.
- DB rollback: use Supabase backups. Matching rule versions don't overwrite —
  previous versions stay queryable; activate one by setting `active = true`
  on the intended row (manager role, via SQL or via the Pipeline UI).

---

## Cost notes

- Vercel Hobby: free (good for demo)
- Supabase Free: 500 MB DB + 5 GB egress — fine for the demo
- Neo4j AuraDB Free: perpetual, 200k nodes + 400k relationships
- OpenAI `gpt-5.4` via Responses API: ~$0.02 per typical matching cycle
  (auto-triage is tiered, only ~20% of exceptions hit the AI path)

Set a monthly hard cap on the OpenAI dashboard before going live.

---

## Known considerations for production

- **Sydney region**: the demo Supabase is in `ap-southeast-2`. For a
  US-based reviewer, consider creating a new Supabase project closer to the
  Vercel edge before a production pilot.
- **Cold starts**: first request after idle may take 3–5 s. Consider the
  Vercel Pro plan for always-warm functions if this matters.
- **Secret rotation**: every secret in this guide should be rotated after
  the demo period ends. The `.env.local` in the repo is already gitignored.
