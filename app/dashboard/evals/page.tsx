import { AppShell } from '@/components/layout/AppShell';
import { EvalsClient } from './EvalsClient';
import { supabaseService } from '@/lib/supabase/service';

export default async function EvalsPage() {
  const sb = supabaseService();
  const { data: runs } = await sb
    .from('eval_runs')
    .select('id, gold_set_version, precision_score, recall_score, f1_score, per_band, per_class, confusion, model_version, matching_rules_version, initiated_by, created_at')
    .order('created_at', { ascending: false })
    .limit(20);

  return (
    <AppShell>
      <EvalsClient initialRuns={runs ?? []} />
    </AppShell>
  );
}
