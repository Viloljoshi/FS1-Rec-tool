import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';
import { getCurrentUser } from '@/lib/rbac/server';

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
): Promise<Response> {
  interface AuditEventRow {
    id: string;
    created_at: string;
    actor: string | null;
    action: string;
    before: unknown;
    after: unknown;
    reason: string | null;
  }
  interface ProfileRow {
    id: string;
    email: string | null;
    role: string | null;
  }

  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }

  const { id: exceptionId } = await context.params;
  const supabase = await supabaseServer();

  // Pull audit events for this specific exception, newest first.
  const { data: events, error } = await supabase
    .from('audit_events')
    .select('id, created_at, actor, action, before, after, reason')
    .eq('entity_type', 'exception')
    .eq('entity_id', exceptionId)
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Enrich actor with email + role. Safe lookup — if profile is missing we
  // still return the event (DB-enforced audit integrity means actors may no
  // longer exist but the event must still render).
  const typedEvents = (events ?? []) as AuditEventRow[];
  const actorIds = Array.from(new Set(typedEvents.map((e: AuditEventRow) => e.actor).filter((actor): actor is string => Boolean(actor))));
  let actorMap = new Map<string, { email: string | null; role: string | null }>();
  if (actorIds.length > 0) {
    const { data: profs } = await supabase
      .from('profiles')
      .select('id, email, role')
      .in('id', actorIds as string[]);
    actorMap = new Map(
      ((profs ?? []) as ProfileRow[]).map((p: ProfileRow) => [p.id, { email: p.email, role: p.role }])
    );
  }

  const enriched = typedEvents.map((e: AuditEventRow) => ({
    id: e.id,
    ts: e.created_at,
    action: e.action,
    reason: e.reason,
    before: e.before,
    after: e.after,
    actor: {
      id: e.actor,
      email: e.actor ? actorMap.get(e.actor)?.email ?? null : null,
      role: e.actor ? actorMap.get(e.actor)?.role ?? null : null
    }
  }));

  return NextResponse.json({ events: enriched });
}
