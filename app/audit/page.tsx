import { AppShell } from '@/components/layout/AppShell';
import { AuditClient } from './AuditClient';
import { supabaseServer } from '@/lib/supabase/server';

export default async function AuditPage() {
  const sb = await supabaseServer();
  const { data: events } = await sb
    .from('audit_events')
    .select('id, actor, action, entity_type, entity_id, before, after, reason, created_at')
    .order('created_at', { ascending: false })
    .limit(500);

  const { data: profiles } = await sb.from('profiles').select('id, email, role');

  return (
    <AppShell>
      <div className="w-full px-6 xl:px-8 2xl:px-10 py-6 space-y-4">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-xl font-semibold text-slate-900">Audit Log</h1>
            <p className="text-sm text-slate-500 mt-1">
              Every state change in the system. Append-only at the database level (enforced by RLS).
            </p>
          </div>
        </div>
        <AuditClient events={events ?? []} profiles={profiles ?? []} />
      </div>
    </AppShell>
  );
}
