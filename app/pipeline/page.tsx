import { AppShell } from '@/components/layout/AppShell';
import { PipelineClient } from './PipelineClient';
import { supabaseServer } from '@/lib/supabase/server';
import { getCurrentUser } from '@/lib/rbac/server';

export default async function PipelinePage({
  searchParams
}: {
  searchParams: Promise<{ pipeline?: string }>;
}) {
  const sp = await searchParams;
  const user = await getCurrentUser();
  const canEdit = user?.role === 'manager';
  const sb = await supabaseServer();

  const { data: pipelines } = await sb
    .from('pipelines')
    .select('id, name, asset_class, description, active')
    .eq('active', true)
    .order('name');

  const requestedPipeline =
    (pipelines ?? []).find((p) => p.id === sp.pipeline || p.name === sp.pipeline) ??
    (pipelines ?? []).find((p) => p.name === 'Equities') ??
    (pipelines ?? [])[0] ??
    null;

  let rulesQuery = sb
    .from('matching_rules')
    .select('id, name, version, active, weights, tolerances, created_at, pipeline_id')
    .order('version', { ascending: false });
  if (requestedPipeline) rulesQuery = rulesQuery.eq('pipeline_id', requestedPipeline.id);
  const { data: rules } = await rulesQuery;

  let latestCycleQuery = sb
    .from('matching_cycles')
    .select('id, started_at, finished_at, counts, feed_a_id, feed_b_id, matching_rules_version, pipeline_id')
    .eq('status', 'COMPLETE')
    .order('started_at', { ascending: false })
    .limit(1);
  if (requestedPipeline) latestCycleQuery = latestCycleQuery.eq('pipeline_id', requestedPipeline.id);
  const { data: latestCycleRows } = await latestCycleQuery;
  const latestCycle = latestCycleRows?.[0] ?? null;

  const { data: feeds } = await sb.from('feed_profiles').select('id, name, version');

  return (
    <AppShell>
      <div className="w-full px-6 xl:px-8 2xl:px-10 py-6 space-y-6">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-slate-400 font-mono">
            Matching Engine
          </div>
          <h1 className="text-xl font-semibold text-slate-900 mt-0.5">
            Pipeline &mdash; 7 stages, fully decomposable
          </h1>
          <p className="text-sm text-slate-500 mt-1 max-w-2xl">
            Every match decision flows through these stages in fixed order. Deterministic work runs first; AI runs last and only where it creates leverage.
            Click any stage to inspect its algorithms, configuration, and last-cycle metrics.
          </p>
        </div>
        <PipelineClient
          rules={rules ?? []}
          latestCycle={latestCycle ?? null}
          feeds={feeds ?? []}
          canEdit={canEdit}
          pipelines={pipelines ?? []}
          activePipelineId={requestedPipeline?.id ?? null}
        />
      </div>
    </AppShell>
  );
}
