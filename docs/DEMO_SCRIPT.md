# ReconAI — Demo Script

**Purpose:** This is the spine of the build. Every feature in this repo exists
to serve one of the 8 beats below. If a capability is not in this script, it
does not ship in the MVP.

**Length target:** 5 minutes live walkthrough.

**Audience:** Senior PM interviewer at an enterprise reconciliation buyer.
They know the domain — vocabulary must be industry-correct.

---

## Beats

### Beat 1 — The hook (0:00 → 0:30)

> "Post-trade operations reconcile millions of trades daily across brokers,
> custodians, and internal systems. Onboarding a new feed takes 6 to 12 weeks.
> 40 to 70 percent of daily breaks need manual triage. Audit trails live in
> email. I built ReconAI to attack all three problems — with AI bounded to
> where it creates leverage, not where it creates risk."

**Screen**: `/dashboard` showing seeded KPIs. Freeze on the evals tile — foreshadow the trust story.

### Beat 2 — Log in, role matters (0:30 → 0:45)

Log out, log in as **Analyst** (`analyst@demo.co`). Sidebar shows
Onboarding · Matching · Exception Management · Reference Data — nothing else.

Log out, log back in as **Manager**. Dashboard, Audit, Run Evals appear.
Log out, log in as **Auditor**. Everything is read-only.

**Why this matters**: RBAC is enforced at the database, not the UI. Postgres
Row-Level Security. Auditors can't edit anything even via the API.

**Screen**: sidebar diff across three logins.

### Beat 3 — Onboard a new feed in 2 minutes (0:45 → 1:45)

Navigate to `/onboarding`. Drop `broker-b.csv` onto the dropzone. 250 trades parse.

GPT-4o-mini is called with the headers and 5 sample rows. It returns a proposed
mapping from source fields to the canonical trade schema, with confidence
scores per field.

Mapping editor shows 13 of 14 fields auto-mapped. Hover the "Why?" popover on
`ExternalTradeRef → source_ref` — AI reasoning is shown. The one missing field
(`Counterparty`) gets a confidence chip of 0.61 with an ambiguous suggestion —
click the dropdown, pick `counterparty`.

Click **Validate**. Run against the full file. 248 of 250 rows pass; 2 fail
with `missing ISIN`. Click **Save as v1**. Feed profile versioned to the DB.

> "An analyst onboarded a new custodian format in 90 seconds. The AI is
> bounded: it proposes, a human confirms, every call is logged with a prompt
> hash, tokens used, latency, and output. Look at the `AI-assisted` chip — it
> appears everywhere AI touched the UI."

**Screen**: onboarding stepper → mapping editor → validation report → version history.

### Beat 4 — Start a matching cycle (1:45 → 2:00)

Navigate to `/recon`. Select **Internal ↔ Broker-B** and the trading date range.
Click **Run Matching Cycle**. Progress bar. Results load.

**Summary card**:
- 847 deterministic matches (HIGH band) via SHA-256 composite-key hash
- 96 candidates in MEDIUM band (0.70–0.95 posterior)
- 7 candidates in LOW band
- 50 unmatched

> "Seven layers of logic ran in order. Deterministic first, probabilistic
> second, AI last. The AI only ran on the 96 MEDIUM-band candidates — not on
> the clean matches, not on the no-match pairs."

**Screen**: cycle summary + distribution histogram.

### Beat 5 — Exception management, the analyst's daily job (2:00 → 3:30)

Navigate to `/workspace`. Left pane: filterable queue of 150 open exceptions.
Columns: ID, symbol, counterparty, qty, amount, band chip, age, assignee.

Click a row labeled "AAPL · JPM Sec. ↔ J.P. Morgan Securities LLC · MEDIUM":

- **Center pane — Compare**
  - Two cards side by side, raw values from each side
  - Field-by-field table: green where fields agree, amber where within tolerance, red where disagree
  - **Score breakdown** — every field shows its raw similarity, its Fellegi-Sunter weight, and its contribution. Sorted by contribution.
  - **Posterior probability bar** at top: 0.87
  - **AI-assisted card** below with the LLM tiebreak verdict: "Likely match. The counterparty difference is a known alias variation — J.P. Morgan Securities LLC doing business as JPM Sec."

- **Right pane — Actions**
  - Accept (A) · Reject (R) · Escalate (E) · Note · Assign
  - Keyboard: `A` accepts. Toast confirms. Exception closes.

Press `J` to move to the next row. Press `K` to go back. Press `/` to search by symbol.

> "This is the screen where a reconciliation analyst lives all day. Dense like
> Bloomberg. Keyboard-first. Every score is decomposable to the field. Every
> AI output is flagged. Every action writes an immutable audit row."

**Screen**: full 3-pane workspace, keyboard-driven navigation.

### Beat 6 — The reference data graph (3:30 → 4:00)

Navigate to `/reference-data`. Neo4j-backed force-directed graph of entities.
Type "J.P. Morgan" in the search.

The graph zooms to a cluster: one canonical entity with seven alias nodes
(`JPM Sec.`, `JPMorgan Sec LLC`, `J P Morgan Securities LLC`, `JPMCB`, etc.),
two subsidiary edges, and a cloud of trade nodes.

Click one trade node → flies to the exception detail.

> "Reference data is a graph, not a lookup table. Counterparty aliases,
> subsidiary links, securities-identifier cross-references — all first-class
> queries. The entity graph stopped two break classes that a lookup table
> alone would not catch."

**Screen**: Sigma.js force graph with entity cluster visible.

### Beat 7 — Evals, the trust layer (4:00 → 4:30)

Navigate to `/dashboard/evals`. 30-pair gold set, last 5 eval runs, confusion
matrix.

Current run:
- Precision 0.94
- Recall 0.88
- F1 0.91
- Per-band: HIGH 1.00, MEDIUM 0.82, LOW 0.67

Click **Run Evals**. New row appears within 20s.

> "This is the part every regulated buyer asks about. How do you know the AI
> is right? We don't hope — we measure. Every matching change, every prompt
> change, every model change regresses against this gold set. The same
> pattern that engineering uses for regression tests, we apply to AI quality."

**Screen**: evals dashboard, confusion matrix, per-band F1.

### Beat 8 — Audit, the evidence layer (4:30 → 4:50)

Navigate to `/audit`. Every state change in the system. Filter by actor =
`analyst@demo.co`. Click the row showing the AAPL accept from Beat 5.

Shows: actor, action, entity, **before JSON**, **after JSON**, reason, timestamp.

Try to delete it. Postgres RLS rejects — append-only table.

Click **Export CSV**. 1,200 rows download.

> "Auditors get reproducible evidence without opening 40 tickets. The audit
> table is append-only at the database level. Managers cannot edit it.
> Auditors cannot edit it. This is the compliance posture a bank procurement
> team will validate on day one."

**Screen**: audit log, before/after diff, RLS rejection, CSV export.

### Closing (4:50 → 5:00)

> "Built in one weekend. Seven matching algorithms. AI bounded to five
> explicit seams, each evaluated against a gold set. Reference data as a
> graph. Audit at the database layer. Extensible to cash, corporate actions,
> and PDF ingestion. That's ReconAI."

Land on `/dashboard`.

---

## What is NOT in the demo (and therefore not in the build)

- Split/merge exception actions
- Rule-builder UI (read-only list only)
- PDF ingestion (Docling scaffolded, not wired)
- Learned classifier training (file stub only)
- Cash recon (one-page stub with wireframe only)
- Corporate actions (roadmap slide only)

If any of those are mentioned by the reviewer, the roadmap slide addresses
them. No live functionality claim.

---

## Demo-day checklist

- [ ] Vercel URL loads cold in under 3 seconds
- [ ] All three role accounts log in successfully
- [ ] Onboarding flow completes for `broker-b.csv`
- [ ] Matching cycle completes for Internal ↔ Broker-B
- [ ] Exception queue shows > 100 open exceptions
- [ ] At least 5 "showcase" exception rows are present (CPY alias, qty error,
      format drift, rounding, missing-on-one-side)
- [ ] Neo4j graph loads and renders the J.P. Morgan cluster
- [ ] Evals dashboard shows F1 >= 0.85
- [ ] Audit log loads < 1s and exports CSV
- [ ] No console errors in browser devtools during the full run
