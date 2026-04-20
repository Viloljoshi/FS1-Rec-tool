# ReconAI — UX Workflows

**Status:** v1 — locked for MVP.

---

## Design principles

- **Bloomberg terminal density, not SaaS dashboard density.** 32 px row heights, tabular-nums, compact spacing.
- **Keyboard-first for power users.** Every primary action has a shortcut.
- **Decomposability visible.** Every score has a hover breakdown; every AI output carries a badge + model hover.
- **No bright branding.** Slate chrome, emerald / amber / rose for state, violet for AI-assisted.
- **Empty states ship with CTAs.** Never a dead screen.
- **Error boundaries ship with copyable IDs.** Every failure is reproducible for support.

---

## Global shell (every page)

- **Top bar**: workspace name (`ReconAI`), environment chip (`demo`), role badge, user menu, `Run Evals` (role-gated), `Cmd+K` hint
- **Sidebar**: `Onboarding`, `Matching`, `Exception Management`, `Reference Data`, `Audit`, `Dashboard`, `Cash` (stub), filtered by role
- **Breadcrumbs** under the top bar on every route
- **Command palette (`Cmd+K`)** opens from anywhere: jump to exception by ID, navigate, run actions, search counterparties

### Role-based landing after login

| Role | Lands on |
|------|----------|
| analyst | `/workspace` |
| manager | `/dashboard` |
| auditor | `/audit` |

---

## Flow 1 — Feed onboarding

**Route:** `/onboarding`
**Primary user:** analyst
**Goal:** Create or update a feed profile from a sample file in under 2 minutes.

### Steps

1. **Upload** — Drag-drop CSV/XLSX ≤ 10 MB. Preview of first 10 rows renders as a compact table.
2. **Infer** — Button `Infer canonical mapping`. GPT-4o-mini call; JSON-mode response with `{source_field, canonical_field, confidence, reasoning}` per column. Spinner ≤ 3 s. Every suggestion gets a violet `AI-assisted` chip.
3. **Map** — Two-column mapping editor. Left: detected source field + 3 sample values. Right: `Select` dropdown of canonical fields + confidence chip + `Why?` popover showing AI reasoning. Unmapped fields show an amber warning.
4. **Validate** — Button `Validate against full file`. Shows `{row_count, errors, sample_normalized}`. Errors displayed with row number + message, click to scroll to source row.
5. **Save** — Button `Save as v{n}`. Writes a new feed_profile version + field_mappings rows. Audit event written. Toast confirms with a link to Version history.

### Version history

`/onboarding?profile={id}` shows a timeline of versions. Each version is clickable → read-only diff viewer (before/after JSON with `jsondiffpatch`).

### Empty state

"No feed profiles yet. Start with a sample file." + upload button.

---

## Flow 2 — Matching cycle

**Route:** `/matching`
**Primary user:** analyst, manager
**Goal:** Run a matching cycle between two feed profiles for a date range.

### Steps

1. **Select feeds** — Two dropdowns: Feed A, Feed B (must differ).
2. **Date range** — From/To pickers. Default: last 7 days.
3. **Rules version** — Dropdown of active `matching_rules` versions. Default: latest active.
4. **Run** — Button `Run Matching Cycle`. Progress bar. Cycle writes to `matching_cycles`, `match_results`, `exceptions`.
5. **Land** — On completion, redirects to `/workspace?cycle={id}` with the cycle's exceptions pre-filtered.

### Cycle summary card

After running:
- Total pairs evaluated · HIGH · MEDIUM · LOW · UNMATCHED counts
- Duration + rules version used
- Shortcut buttons: `Open exceptions`, `See match results`, `View in audit`

### Cycle history

Same page shows the last 10 cycles as a table: started_at, feeds, counts, initiated_by, link.

---

## Flow 3 — Exception management (the hero screen)

**Route:** `/workspace`
**Primary user:** analyst
**Goal:** Resolve exceptions at 30+ per hour.

### Layout — 3 resizable panels

```
┌──────────────┬───────────────────────────────┬────────────┐
│  Queue (25%) │   Compare (50%)                │ Action(25%)│
│              │                                │            │
│ Filters      │  Trade A │ Trade B             │ [A] Accept │
│ - Band       │  ─────────                      │ [R] Reject │
│ - Age        │  Field       A     B   Δ  Score│ [E] Escal. │
│ - Feeds      │  symbol      AAPL  AAPL ✓ 1.00 │ Note       │
│ - Assignee   │  isin        US03… US03… ✓ 1.00│ Assign     │
│              │  quantity    500   500  ✓ 1.00 │            │
│ Rows         │  price       178.43 178.4250   │ ────────   │
│ — dense      │  counterparty GS   Goldman Sa… │ Activity   │
│ — virtualized│  account     A4421 ACCT-4421   │ Audit rows │
│              │                                 │ for this   │
│              │  Posterior:   ▓▓▓▓▓▓▓▓▒ 0.87   │ exception  │
│              │  Band: MEDIUM                   │            │
│              │                                 │            │
│              │  Score breakdown (top 3):       │            │
│              │  counterparty +2.4              │            │
│              │  price        +1.2              │            │
│              │  account      -0.6              │            │
│              │                                 │            │
│              │  [AI-assisted]                  │            │
│              │  Likely match. Counterparty     │            │
│              │  difference is a known alias.   │            │
└──────────────┴───────────────────────────────┴────────────┘
```

### Queue pane

- TanStack Table + TanStack Virtual
- Columns: ID (copyable), symbol (mono), counterparty (ellipsis), qty (money cell), amount, band chip, age (relative + absolute on hover), assignee avatar
- Filters in the header: band multi-select, feed pair, age slider, assignee, exception class
- Sort: clickable column headers
- Row click → selects the exception, loads Compare pane
- Multi-select with `Shift+Click` for bulk assign / escalate

### Compare pane

- Two horizontally-aligned cards: `Trade A` / `Trade B` with raw values
- Below: a comparison table — every canonical field in one row
- Row color: green (agree), amber (within tolerance), red (disagree), gray (null one side)
- Each row hovers a tooltip: raw score · weight · contribution
- Posterior probability bar at the top — thick, color by band
- `Score breakdown` collapsible card below, sorted by `|contribution|` descending
- `AI-assisted` explanation card at the bottom (collapsible) with the LLM verdict text and decisive fields highlighted

### Action panel

- Primary buttons with shortcuts: `[A]` Accept · `[R]` Reject · `[E]` Escalate · `Note` · `Assign`
- Keyboard nav: `J` next row, `K` previous row, `/` focus queue search
- Activity log for this exception: every resolution_action + audit_event as a vertical timeline
- Auditor role: all buttons disabled, activity log still visible

### Performance

- Row selection → Compare render ≤ 200 ms
- Keyboard nav feels instant — no network on `J/K` (data pre-fetched for +3/-3 neighbors)
- Virtualized queue handles 10 000 open exceptions smoothly

---

## Flow 4 — Reference data

**Route:** `/reference-data`
**Primary user:** analyst, manager, auditor
**Goal:** Explore counterparty + security entities and their alias chains.

### Layout

- Top: search input with entity-type switcher (Counterparty · Security)
- Left: result list (compact rows, canonical name + alias count)
- Right: Sigma.js force-directed graph, focused on the selected entity's cluster

### Interactions

- Type `JPM` → suggestions debounce 200 ms → click a result → graph pans + zooms to cluster
- Node click: entity → sidebar shows aliases, subsidiaries, recent trades, volume
- Node click: trade → navigates to exception detail (if still open) or match result
- Edge hover: shows relationship type (`ALIAS_OF`, `SUBSIDIARY_OF`, `TRADES_WITH {volume}`)

### Empty state

"Search for a counterparty or security to begin." + example queries.

---

## Flow 5 — Audit log

**Route:** `/audit`
**Primary user:** auditor (default), manager
**Goal:** Investigate any state change in the system.

### Layout

- Filter bar: actor, action, entity type, entity id, date range
- TanStack Table with columns: timestamp, actor, action, entity, reason, before/after diff button
- Click diff button → side sheet (`vaul`) with jsondiffpatch-rendered before/after
- Export CSV button in top right — streams via `ReadableStream`

### Append-only cue

Hovering any row shows a tooltip: "This row cannot be modified." Attempting a client-side `PATCH` triggers a toast: "Audit events are append-only at the database level."

---

## Flow 6 — Dashboard + Evals

**Route:** `/dashboard`
**Primary user:** manager (default), auditor
**Goal:** Operational glance + AI-quality trust.

### Layout

**Top row — 5 KPI tiles:**
- Auto-match rate (HIGH / total)
- Unresolved exception rate
- Median exception age
- AI suggestion acceptance
- **Evals latest** (P / R / F1, tap to deep-dive)

**Second row:**
- Exception-aging histogram (bar chart, buckets 0–1, 1–3, 3–7, 7+ days)
- Match-rate-by-feed line (last 7 cycles)

**`/dashboard/evals` deep-dive:**
- Last 10 eval runs table
- Confusion matrix card for the latest run
- Per-band P / R / F1 bar chart
- `Run Evals` button (manager / auditor)

---

## Flow 7 — Cash (stub)

**Route:** `/cash`
**Primary user:** any
**Goal:** Signal the product's extensibility.

Single page showing a wireframe of a cash reconciliation module with:
- "Cash module coming" banner
- Mocked queue preview (greyed out)
- Bullet list: "Same canonical matching engine. New asset class. Zero retraining."

---

## Keyboard shortcut reference

| Key | Action |
|---|---|
| `Cmd+K` | Open command palette |
| `/` | Focus queue search |
| `J` / `K` | Next / previous exception |
| `A` / `R` / `E` | Accept / Reject / Escalate current exception |
| `Cmd+\` | Toggle sidebar |
| `Cmd+E` | Export current table CSV |
| `Esc` | Close sheet / dialog |
| `?` | Show shortcuts help sheet |

---

## Responsive behavior

Desktop-first. Minimum supported width: 1280 px.
Below 1024 px, the 3-pane workspace collapses to a stacked view with a `Sheet` for compare/actions. Not a demo path — sufficient for mobile glance.

---

## Accessibility

- Every interactive has an ARIA label
- Focus rings visible, offset 2 px
- Color is not the only signal — every band also has a text label
- Contrast AA minimum on text against chrome
- `aria-live` on toast region for screen readers
