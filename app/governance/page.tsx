import { AppShell } from '@/components/layout/AppShell';
import { supabaseServer } from '@/lib/supabase/server';
import { GovernanceClient } from './GovernanceClient';

export default async function GovernancePage() {
  const sb = await supabaseServer();

  const [{ data: rules }, { data: aiCalls }, { data: auditStats }] = await Promise.all([
    sb
      .from('matching_rules')
      .select('id, name, version, active, weights, tolerances, created_at')
      .order('version', { ascending: false }),
    sb
      .from('ai_calls')
      .select('call_type, model, fallback_used, created_at')
      .order('created_at', { ascending: false })
      .limit(500),
    sb
      .from('audit_events')
      .select('action, created_at')
      .order('created_at', { ascending: false })
      .limit(100)
  ]);

  return (
    <AppShell>
      <div className="w-full px-6 xl:px-8 2xl:px-10 py-6 space-y-6">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-slate-400 font-mono">Governance &amp; Guardrails</div>
          <h1 className="text-xl font-semibold text-slate-900 mt-0.5">Governance posture</h1>
          <p className="text-sm text-slate-500 mt-1 max-w-3xl">
            The complete set of rules, guardrails, and policies currently enforced on this workspace. Some are
            editable by manager role and create new ruleset versions on change; others are hard-coded at the
            database or application layer and require an engineering change to modify.
          </p>
        </div>
        <GovernanceClient
          rules={rules ?? []}
          aiCalls={aiCalls ?? []}
          auditStats={auditStats ?? []}
        />
      </div>
    </AppShell>
  );
}
