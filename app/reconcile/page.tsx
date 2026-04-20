import { AppShell } from '@/components/layout/AppShell';
import { ReconcileClient } from './ReconcileClient';
import { supabaseServer } from '@/lib/supabase/server';

export default async function ReconcilePage() {
  const sb = await supabaseServer();
  const { data: feeds } = await sb
    .from('feed_profiles')
    .select('id, name, kind, version, retired_at')
    .is('retired_at', null)
    .order('name');

  return (
    <AppShell>
      <div className="w-full px-6 xl:px-8 2xl:px-10 py-6">
        <div className="mb-6">
          <h1 className="text-xl font-semibold text-slate-900">Run a 2-Party Reconciliation</h1>
          <p className="text-sm text-slate-500 mt-1">
            Reconciliation compares two parties&rsquo; records of the same trades. Upload your side and the
            counterparty&rsquo;s side &mdash; or pick an existing feed profile &mdash; and run the matching
            pipeline in one click.
          </p>
        </div>
        <ReconcileClient existingFeeds={feeds ?? []} />
      </div>
    </AppShell>
  );
}
