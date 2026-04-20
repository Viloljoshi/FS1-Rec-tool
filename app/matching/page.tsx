import { AppShell } from '@/components/layout/AppShell';
import { MatchingClient } from './MatchingClient';
import { supabaseServer } from '@/lib/supabase/server';

export default async function MatchingPage() {
  const sb = await supabaseServer();
  const [{ data: cycles }, { data: feeds }] = await Promise.all([
    sb
      .from('matching_cycles')
      .select('id, feed_a_id, feed_b_id, date_from, date_to, status, started_at, finished_at, counts')
      .order('started_at', { ascending: false })
      .limit(20),
    sb.from('feed_profiles').select('id, name, kind, version, retired_at').is('retired_at', null)
  ]);

  return (
    <AppShell>
      <div className="w-full px-6 xl:px-8 2xl:px-10 py-6 space-y-6">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Matching Cycles</h1>
          <p className="text-sm text-slate-500 mt-1">
            Run a new matching cycle between two feed profiles, or browse past runs.
          </p>
        </div>
        <MatchingClient cycles={cycles ?? []} feeds={feeds ?? []} />
      </div>
    </AppShell>
  );
}
