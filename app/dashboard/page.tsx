import { AppShell } from '@/components/layout/AppShell';
import { DashboardClient } from './DashboardClient';
import { supabaseServer } from '@/lib/supabase/server';

export default async function DashboardPage() {
  const sb = await supabaseServer();

  const [
    cyclesRes,
    matchesRes,
    exceptionsRes,
    actionsRes,
    evalsRes,
    matchResultsRes,
    tradesRes,
    aiCallsRes,
    auditRes
  ] = await Promise.all([
    sb
      .from('matching_cycles')
      .select('id, feed_a_id, feed_b_id, counts, started_at, finished_at')
      .order('started_at', { ascending: false })
      .limit(50),
    sb
      .from('match_results')
      .select('band', { count: 'exact' })
      .limit(1),
    sb
      .from('exceptions')
      .select('id, status, opened_at, updated_at, exception_class, band, trade_a_id, trade_b_id, match_result_id, cycle_id')
      .order('opened_at', { ascending: false })
      .limit(1000),
    sb
      .from('resolution_actions')
      .select('id, action, created_at, exception_id')
      .order('created_at', { ascending: false })
      .limit(1000),
    sb
      .from('eval_runs')
      .select('id, precision_score, recall_score, f1_score, created_at, model_version, matching_rules_version, per_band, confusion')
      .order('created_at', { ascending: false })
      .limit(10),
    sb
      .from('match_results')
      .select('id, band, llm_verdict')
      .not('llm_verdict', 'is', null)
      .limit(1000),
    sb
      .from('trades_canonical')
      .select('trade_id, source_id')
      .limit(5000),
    sb
      .from('ai_calls')
      .select('model, input_tokens, output_tokens, created_at')
      .order('created_at', { ascending: false })
      .limit(2000),
    sb
      .from('audit_events')
      .select('entity_id, action, created_at')
      .eq('entity_type', 'exception')
      .order('created_at', { ascending: false })
      .limit(2000)
  ]);

  const feedsRes = await sb.from('feed_profiles').select('id, name');

  return (
    <AppShell>
      <div className="w-full px-6 xl:px-8 2xl:px-10 py-6 space-y-6">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Dashboard</h1>
          <p className="text-sm text-slate-500 mt-1">
            Operational KPIs · matching quality evals · aging · per-feed health.
          </p>
        </div>
        <DashboardClient
          cycles={cyclesRes.data ?? []}
          matchesCount={matchesRes.count ?? 0}
          exceptions={exceptionsRes.data ?? []}
          actions={actionsRes.data ?? []}
          evals={evalsRes.data ?? []}
          feeds={feedsRes.data ?? []}
          matchResults={matchResultsRes.data ?? []}
          trades={tradesRes.data ?? []}
          aiCalls={aiCallsRes.data ?? []}
          auditEvents={auditRes.data ?? []}
        />
      </div>
    </AppShell>
  );
}
