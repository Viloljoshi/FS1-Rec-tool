# ReconAI — Governance Rules

**Status:** v1 — binding for MVP.

---

## 1. Decision classes

Every material action in the system falls into one of four decision classes.
Each class has its own confidence policy, approval path, and audit depth.

| Class | Examples | Who decides | Audit depth |
|-------|----------|-------------|-------------|
| **Automatic (HIGH)** | Deterministic hash match, exact-ID match with all-agree fields | System | cycle-level |
| **Suggested (MEDIUM)** | Posterior 0.70–0.95 with LLM tiebreak | Analyst confirms | per-exception |
| **Manual (LOW / UNMATCHED)** | Posterior <0.70, missing-one-side, wrong-qty | Analyst | per-exception |
| **Escalated** | Analyst-flagged ambiguity | Manager | per-exception + manager review |

**No MEDIUM band auto-resolves.** Analyst confirmation is required regardless
of how confident the LLM or Fellegi-Sunter score is. This is a posture, not a
threshold. It does not change by rule.

---

## 2. Confidence policies (seeded defaults)

### Band thresholds
| Band | Posterior range | Visible to analyst | Auto-suggest |
|------|-----------------|--------------------|--------------|
| HIGH | ≥ 0.95 | yes (as suggestion, one-click accept) | yes |
| MEDIUM | 0.70 – 0.95 | yes (with LLM tiebreak card) | no — analyst confirms |
| LOW | < 0.70 | hidden by default, visible on "see all candidates" | no |

### Field tolerances (matching_rules v1)
| Field | Tolerance |
|-------|-----------|
| price | ±1% relative |
| quantity | ±5% relative (flag as WRONG_QTY if exceeded) |
| trade_date | ±1 day |
| settlement_date | ±1 day |

### Changes
Tolerance or band-threshold changes create a new `matching_rules` version. The
old version remains queryable. Past matching cycles always show the rules
version they ran against in their summary.

---

## 3. Approval thresholds

| Action | Required role | Additional gate |
|--------|---------------|-----------------|
| Create feed profile | analyst | — |
| Update feed profile (new version) | analyst | — |
| Run matching cycle | analyst | — |
| Accept HIGH-band match | analyst | — (default auto-suggestion) |
| Accept MEDIUM-band match | analyst | confirmation click |
| Reject any match | analyst | reason required |
| Escalate | analyst | reason optional |
| Assign | analyst | — |
| Activate new matching_rules version | manager | — |
| Run evals | manager or auditor | — |
| Read audit | all three roles | — |
| Modify audit | **nobody** | enforced by RLS |

---

## 4. Versioning rules

| Entity | Versioning strategy |
|--------|---------------------|
| `feed_profiles` | `(id, version)` unique. New version row per change. `retired_at` marks superseded. |
| `field_mappings` | `(feed_profile_id, version, source_field)` unique. Versioned together with profile. |
| `matching_rules` | `(name, version)` unique. `active` bool. Only one `active=true` per name. |
| `trades_canonical` | Not versioned — lineage JSON references the profile+mapping version used at canonicalization time. |
| `match_results` | Not versioned — immutable once written. Rerun requires new cycle. |
| `exceptions` | Row mutated in-place for `status` and `assignee`, but every mutation writes an audit event capturing before/after. |

**Never mutate**: feed_profiles, field_mappings, matching_rules, match_results,
audit_events, ai_calls, resolution_actions, eval_runs.

---

## 5. Audit logging requirements

### What is logged
Every write that changes user-visible state. Specifically:
- feed_profile created / new version
- field_mapping created / updated
- matching_rules activated / deactivated / new version
- trades_raw uploaded
- matching_cycle started / completed / failed
- exception status change
- resolution_action created
- ai_call made (separate table, also auditable)

### How it is logged
Single write path: `lib/audit/log.ts` exposes `recordAudit(actor, action, entity, before, after, reason)`. Every API route that changes state calls this helper inside the same transaction as the primary write.

### Row shape
```ts
{
  id, actor, action, entity_type, entity_id,
  before: jsonb, after: jsonb,
  reason: string,
  created_at: timestamptz
}
```

### RLS enforcement
```sql
-- audit_events
CREATE POLICY "insert for authenticated"
  ON audit_events FOR INSERT TO authenticated
  WITH CHECK (actor = auth.uid());

CREATE POLICY "select by role"
  ON audit_events FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid()
            AND p.role IN ('analyst','manager','auditor'))
  );

-- UPDATE, DELETE: no policies → denied by default
```

No `UPDATE` or `DELETE` policy exists on `audit_events`. Supabase service role
must not be used from the client. Server-side operations use `auth.uid()` via
the cookie session; service role is reserved for migrations and seed scripts.

---

## 6. RBAC matrix

| Table | analyst | manager | auditor |
|-------|---------|---------|---------|
| `profiles` | self only | all | all |
| `feed_profiles` | R, W insert | R, W | R |
| `field_mappings` | R, W insert | R, W | R |
| `matching_rules` | R | R, W, toggle active | R |
| `trades_raw` | R, W insert | R, W | R |
| `trades_canonical` | R, W insert | R, W | R |
| `matching_cycles` | R, W insert | R, W | R |
| `match_results` | R | R | R |
| `exceptions` | R, W (own + assigned) | R, W (all) | R |
| `resolution_actions` | R, W insert (own) | R, W insert | R |
| `audit_events` | R (own entity chain) | R (all) | R (all) |
| `ai_calls` | R (own) | R | R |
| `eval_runs` | R | R, W insert | R, W insert |

R = SELECT, W = INSERT/UPDATE unless noted.

---

## 7. AI governance

### Bounded surface
AI is permitted only in the 5 seams listed in `CLAUDE.md §2`. Any new seam
requires a `DECISIONS_LOG.md` entry and an updated `EVALS.md`.

### Call contract
Every AI call:
1. Routes through `lib/ai/openai.ts`
2. Uses JSON mode or tool calling
3. Zod-validates output
4. Writes `ai_calls` row
5. Has a deterministic fallback
6. Shows an `AI-assisted` badge in the UI

### Prompt privacy
Raw prompts are NOT stored — only `SHA-256(prompt)` in `ai_calls.prompt_hash`.
Reasoning output IS stored for explainability.

### Model version discipline
- `OPENAI_MODEL` env var is the canonical model identifier
- Model upgrades require an `eval_run` pass at F1 ≥ current-1.0 before merge
- `ai_calls.model` records the exact model used for every call

---

## 8. Data lineage

Every canonical trade traces back to:
- Its raw row (`trades_raw.id`)
- The feed profile version at canonicalization
- The mapping version at canonicalization

Every match result traces back to:
- Both canonical trades
- The matching_cycle
- The matching_rules version in effect
- The AI call (if any) that produced the tiebreak

Every resolution action traces back to:
- The exception
- The match result (if any)
- The actor
- The audit event

Auditors following the chain can reach raw file bytes from any resolution
without leaving the system.

---

## 9. Secret hygiene

- All secrets live in `.env.local` (gitignored) or Vercel env vars
- `SUPABASE_SERVICE_ROLE_KEY` is never imported in any file under `/app` or `/components`
- OpenAI API key is only imported in `lib/ai/openai.ts`
- Neo4j credentials only in `lib/kg/neo4j.ts` and the MCP config
- Any accidental commit of `.env.local` triggers immediate key rotation

---

## 10. Escalation and overrides

- An analyst can **escalate** any exception to a manager with a reason. Escalation is itself a resolution_action and is audited.
- A manager can **reassign** any exception, **deactivate** a matching rule, or **activate** a new rules version.
- Neither analyst nor manager can modify or delete an audit event. Corrections are handled by writing a new audit event that references the one being corrected in its `reason` field (link-by-reference, never overwrite).

---

## 11. Regulator-ready posture

- Every AI decision class is documented (Section 1)
- Every AI call is logged with hash + output + latency + tokens
- Every matching cycle captures the rules version it used
- Every configuration change is versioned and reproducible
- Every user-reachable state change has an audit row
- Audit table is provably append-only via RLS policies, not application code
- Evals demonstrate measured AI quality, not asserted quality
- Secrets isolated to server-side wrappers with explicit import paths

This is the posture a bank procurement team will examine on day one.
