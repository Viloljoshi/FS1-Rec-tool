import type { AppRole } from '@/lib/rbac/roles';

export interface AiSeam {
  id: string;
  name: string;
  stage: string;
  model: string;
  calledOn: string;
  fallback: string;
  enabled: boolean;
  canDisable: boolean;
  auditedIn: string;
}

export const AI_SEAMS: AiSeam[] = [
  {
    id: 'INFER_SCHEMA',
    name: 'Feed schema inference',
    stage: 'Onboarding',
    model: 'Reasoning model (Responses API)',
    calledOn: 'Every new feed upload — AI proposes canonical mapping for arbitrary source fields',
    fallback: 'Empty mapping — analyst maps manually',
    enabled: true,
    canDisable: true,
    auditedIn: 'ai_calls (call_type = INFER_SCHEMA)'
  },
  {
    id: 'EMBED',
    name: 'Counterparty embedding',
    stage: 'Field similarity (stage 4)',
    model: 'Embedding model (1536-d)',
    calledOn: 'Every unique counterparty string at canonicalization',
    fallback: 'Empty vector — matching degrades to lexical only',
    enabled: true,
    canDisable: true,
    auditedIn: 'ai_calls (call_type = EMBED)'
  },
  {
    id: 'TIEBREAK',
    name: 'LLM tiebreak',
    stage: 'Stage 7 — MEDIUM band only',
    model: 'Reasoning model (Responses API)',
    calledOn: 'Only matches with posterior 0.70–0.95 (genuine ambiguity)',
    fallback: 'verdict = UNCERTAIN, analyst confirms manually',
    enabled: true,
    canDisable: true,
    auditedIn: 'ai_calls (call_type = TIEBREAK)'
  },
  {
    id: 'EXPLAIN_BREAK',
    name: 'Exception explanation',
    stage: 'Auto-triage (post-match)',
    model: 'Reasoning model (Responses API) — only for UNKNOWN class',
    calledOn: 'Exceptions where the class is UNKNOWN / novel (template handles 80%)',
    fallback: 'Templated summary per exception_class (no AI call)',
    enabled: true,
    canDisable: true,
    auditedIn: 'ai_calls (call_type = EXPLAIN_BREAK)'
  },
  {
    id: 'NEXT_BEST_ACTION',
    name: 'Next-best-action',
    stage: 'Auto-triage (post-match)',
    model: 'Reasoning model (Responses API) — only for UNKNOWN class',
    calledOn: 'Exceptions where class is UNKNOWN / ambiguous',
    fallback: 'Rule-based suggestion per exception_class',
    enabled: true,
    canDisable: true,
    auditedIn: 'ai_calls (call_type = NEXT_BEST_ACTION)'
  }
];

export interface Guardrail {
  id: string;
  name: string;
  category: 'AI' | 'MATCHING' | 'AUDIT' | 'RBAC' | 'DATA';
  enforcedAt: 'CODE' | 'DATABASE' | 'CONFIG';
  currentValue: string;
  canEdit: boolean;
  editableBy: AppRole | 'NONE';
  rationale: string;
}

export const GUARDRAILS: Guardrail[] = [
  {
    id: 'ai_bounded_5',
    name: 'AI is bounded to 5 seams',
    category: 'AI',
    enforcedAt: 'CODE',
    currentValue: 'Schema-infer · Embed · Tiebreak · Explain · NBA',
    canEdit: false,
    editableBy: 'NONE',
    rationale: 'A new AI seam requires a DECISIONS_LOG.md entry and engineering review. UI cannot add new AI surfaces at runtime.'
  },
  {
    id: 'ai_never_decisive',
    name: 'AI never resolves money-decisions automatically',
    category: 'AI',
    enforcedAt: 'CODE',
    currentValue: 'ENFORCED',
    canEdit: false,
    editableBy: 'NONE',
    rationale: 'MEDIUM-band tiebreak verdict is shown to analyst but NEVER auto-accepts. Analyst must click Accept/Reject.'
  },
  {
    id: 'ai_fallback_deterministic',
    name: 'Every AI call has a deterministic fallback',
    category: 'AI',
    enforcedAt: 'CODE',
    currentValue: 'ENFORCED',
    canEdit: false,
    editableBy: 'NONE',
    rationale: 'Every lib/ai/prompts/* function declares a fallback. AI errors never block a matching cycle.'
  },
  {
    id: 'ai_zod_validated',
    name: 'Every AI output passes Zod validation',
    category: 'AI',
    enforcedAt: 'CODE',
    currentValue: 'ENFORCED',
    canEdit: false,
    editableBy: 'NONE',
    rationale: 'Invalid AI responses trigger the fallback and are logged with fallback_used = true.'
  },
  {
    id: 'ai_prompt_hash_only',
    name: 'Raw prompts are NOT stored — only SHA-256 hash',
    category: 'AI',
    enforcedAt: 'CODE',
    currentValue: 'ENFORCED',
    canEdit: false,
    editableBy: 'NONE',
    rationale: 'Privacy posture. Inputs can contain PII-adjacent trade data. Hash preserves auditability without storing content.'
  },
  {
    id: 'band_high',
    name: 'HIGH band threshold',
    category: 'MATCHING',
    enforcedAt: 'CONFIG',
    currentValue: 'posterior ≥ 0.95',
    canEdit: true,
    editableBy: 'manager',
    rationale: 'Above this, the system auto-suggests; analyst one-click accept. Lower = more auto-matches but higher risk of false positives.'
  },
  {
    id: 'band_medium',
    name: 'MEDIUM band floor',
    category: 'MATCHING',
    enforcedAt: 'CONFIG',
    currentValue: 'posterior 0.70 – 0.95',
    canEdit: true,
    editableBy: 'manager',
    rationale: 'LLM tiebreak fires in this range. Below: LOW band (not auto-suggested). Above: HIGH band.'
  },
  {
    id: 'veto_qty',
    name: 'Quantity integrity veto',
    category: 'MATCHING',
    enforcedAt: 'CODE',
    currentValue: 'qty_score < 0.5 → demote to LOW band regardless of other fields',
    canEdit: false,
    editableBy: 'NONE',
    rationale: 'Wrong quantity is a material break. IDs agreeing is not enough to rescue it.'
  },
  {
    id: 'veto_price',
    name: 'Price integrity veto',
    category: 'MATCHING',
    enforcedAt: 'CODE',
    currentValue: 'price_score < 0.5 → demote HIGH to MEDIUM',
    canEdit: false,
    editableBy: 'NONE',
    rationale: 'Price disagreement above 1% tolerance warrants analyst review even if everything else matches.'
  },
  {
    id: 'tolerance_price',
    name: 'Price relative tolerance',
    category: 'MATCHING',
    enforcedAt: 'CONFIG',
    currentValue: '1%',
    canEdit: true,
    editableBy: 'manager',
    rationale: 'Outer band for the price-similarity scoring function. Above this the price score collapses to zero and the match is demoted. Tighter = more exceptions, looser = more auto-matches.'
  },
  {
    id: 'tolerance_rounding_cap',
    name: 'Rounding-vs-price-break threshold',
    category: 'MATCHING',
    enforcedAt: 'CODE',
    currentValue: 'max($0.01, 0.5bp × price)',
    canEdit: false,
    editableBy: 'NONE',
    rationale: 'Separates ROUNDING (sub-cent display drift, safe to accept) from WRONG_PRICE (material money break, must escalate). Below the cap → ROUNDING; above → WRONG_PRICE.'
  },
  {
    id: 'tolerance_qty',
    name: 'Quantity relative tolerance',
    category: 'MATCHING',
    enforcedAt: 'CONFIG',
    currentValue: '5%',
    canEdit: true,
    editableBy: 'manager',
    rationale: 'Beyond this, quantity disagrees materially — WRONG_QTY exception class.'
  },
  {
    id: 'tolerance_date',
    name: 'Date delta tolerance',
    category: 'MATCHING',
    enforcedAt: 'CONFIG',
    currentValue: '±1 business day',
    canEdit: true,
    editableBy: 'manager',
    rationale: 'T+1 confirmations commonly land with one-day timing drift — this tolerates it.'
  },
  {
    id: 'audit_append_only',
    name: 'Audit table is append-only',
    category: 'AUDIT',
    enforcedAt: 'DATABASE',
    currentValue: 'ENFORCED via RLS (no UPDATE, no DELETE policy on audit_events)',
    canEdit: false,
    editableBy: 'NONE',
    rationale: 'Regulator-required posture. Corrections are new audit rows referencing the old one, never overwrites.'
  },
  {
    id: 'audit_actor_required',
    name: 'Every audit row has actor = auth.uid()',
    category: 'AUDIT',
    enforcedAt: 'DATABASE',
    currentValue: 'ENFORCED via RLS INSERT CHECK',
    canEdit: false,
    editableBy: 'NONE',
    rationale: 'Users cannot write audit rows attributed to someone else. Server-side trigger enforces via auth.uid().'
  },
  {
    id: 'config_versioned',
    name: 'Configuration changes always create new versions',
    category: 'MATCHING',
    enforcedAt: 'CODE',
    currentValue: 'ENFORCED',
    canEdit: false,
    editableBy: 'NONE',
    rationale: 'feed_profiles / field_mappings / matching_rules never UPDATE — only INSERT new versions. Prior rows retire but stay queryable.'
  },
  {
    id: 'rls_all_tables',
    name: 'RLS enabled on every user-reachable table',
    category: 'RBAC',
    enforcedAt: 'DATABASE',
    currentValue: 'ENFORCED (15/15 tables have RLS policies)',
    canEdit: false,
    editableBy: 'NONE',
    rationale: 'Authorization is at the data layer, not the app. Even a compromised service key cannot bypass role rules from a browser session.'
  },
  {
    id: 'rbac_3_roles',
    name: 'Role matrix',
    category: 'RBAC',
    enforcedAt: 'DATABASE',
    currentValue: 'analyst · manager · auditor',
    canEdit: false,
    editableBy: 'NONE',
    rationale: 'Fixed in MVP. Post-MVP: arbitrary roles via metadata.'
  },
  {
    id: 'llm_tiebreak_band',
    name: 'LLM tiebreak band policy',
    category: 'AI',
    enforcedAt: 'CONFIG',
    currentValue: 'MEDIUM_ONLY (posterior 0.70–0.95)',
    canEdit: true,
    editableBy: 'manager',
    rationale: 'Restricts GPT to ambiguous pairs. Can widen to ALL bands (expensive, slow) or disable (NONE — analyst judges all MEDIUM without AI verdict).'
  },
  {
    id: 'tier_template_first',
    name: 'Templates before AI in auto-triage',
    category: 'AI',
    enforcedAt: 'CODE',
    currentValue: 'ENFORCED — reasoning model only when exception_class = UNKNOWN',
    canEdit: false,
    editableBy: 'NONE',
    rationale: 'Cost + latency control. Templated triage covers 80% of exception classes deterministically.'
  }
];

export const RBAC_MATRIX: Array<{
  table: string;
  analyst: string;
  manager: string;
  auditor: string;
}> = [
  { table: 'feed_profiles',       analyst: 'R, W insert',          manager: 'R, W',                    auditor: 'R' },
  { table: 'field_mappings',      analyst: 'R, W insert',          manager: 'R, W',                    auditor: 'R' },
  { table: 'trades_raw',          analyst: 'R, W insert',          manager: 'R, W',                    auditor: 'R' },
  { table: 'trades_canonical',    analyst: 'R, W insert',          manager: 'R, W',                    auditor: 'R' },
  { table: 'matching_rules',      analyst: 'R',                    manager: 'R, W, toggle active',     auditor: 'R' },
  { table: 'matching_cycles',     analyst: 'R, W insert',          manager: 'R, W',                    auditor: 'R' },
  { table: 'match_results',       analyst: 'R',                    manager: 'R',                       auditor: 'R' },
  { table: 'exceptions',          analyst: 'R, W (own/assigned)',  manager: 'R, W (all)',              auditor: 'R' },
  { table: 'resolution_actions',  analyst: 'R, W insert (own)',    manager: 'R, W insert',             auditor: 'R' },
  { table: 'audit_events',        analyst: 'R (INSERT only)',      manager: 'R (INSERT only)',         auditor: 'R (INSERT only)' },
  { table: 'ai_calls',            analyst: 'R (own)',              manager: 'R',                       auditor: 'R' },
  { table: 'eval_runs',           analyst: 'R',                    manager: 'R, W insert',             auditor: 'R, W insert' },
  { table: 'counterparty_entities', analyst: 'R',                  manager: 'R, W insert',             auditor: 'R' },
  { table: 'counterparty_aliases', analyst: 'R',                   manager: 'R, W insert',             auditor: 'R' }
];
