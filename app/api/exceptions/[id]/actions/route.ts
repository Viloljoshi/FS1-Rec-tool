import { NextResponse } from 'next/server';
import { z } from 'zod';
import { friendlyZodError } from '@/lib/api/errors';
import { supabaseServer } from '@/lib/supabase/server';
import { getCurrentUser } from '@/lib/rbac/server';
import { recordAudit } from '@/lib/audit/log';
import { ResolutionActionType } from '@/lib/canonical/schema';

const ActionSchema = z.object({
  action: ResolutionActionType,
  reason: z.string().max(1000).optional(),
  payload: z.record(z.string(), z.unknown()).optional()
});

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id: exceptionId } = await context.params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  if (user.role === 'auditor') {
    return NextResponse.json({ error: 'forbidden: auditor is read-only' }, { status: 403 });
  }

  const body = await request.json();
  const parsed = ActionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(friendlyZodError(parsed.error), { status: 400 });
  }

  const supabase = await supabaseServer();

  const { data: before, error: befErr } = await supabase
    .from('exceptions')
    .select('id, status, assignee, band, exception_class')
    .eq('id', exceptionId)
    .single();
  if (befErr || !before) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  // Idempotency guard: don't allow transitions that would no-op. This prevents
  // the "three rapid clicks → three identical audit rows" bug. The analyst can
  // still ADD a NOTE or ASSIGN on a terminal record — those are additive — but
  // repeating ACCEPT/REJECT/ESCALATE on an already-final record is rejected.
  const targetStatus = mapActionToStatus(parsed.data.action, before.status);
  const isAdditive = parsed.data.action === 'NOTE' || parsed.data.action === 'ASSIGN';
  const isTerminal = before.status === 'RESOLVED' || before.status === 'ESCALATED';
  if (!isAdditive && isTerminal && targetStatus === before.status) {
    return NextResponse.json(
      {
        error: 'already_in_target_state',
        message: `Exception is already ${before.status}. No change made.`,
        current_status: before.status
      },
      { status: 409 }
    );
  }

  const { error: actErr } = await supabase.from('resolution_actions').insert({
    exception_id: exceptionId,
    actor: user.id,
    action: parsed.data.action,
    reason: parsed.data.reason ?? null,
    payload: parsed.data.payload ?? null
  });
  if (actErr) return NextResponse.json({ error: actErr.message }, { status: 500 });

  const patch: Record<string, unknown> = { status: targetStatus, updated_at: new Date().toISOString() };
  if (parsed.data.action === 'ASSIGN' && parsed.data.payload?.assignee) {
    patch.assignee = parsed.data.payload.assignee as string;
  }

  const { data: after, error: updErr } = await supabase
    .from('exceptions')
    .update(patch)
    .eq('id', exceptionId)
    .select('id, status, assignee, band, exception_class')
    .single();
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });

  await recordAudit({
    action: `EXCEPTION_${parsed.data.action}`,
    entity_type: 'exception',
    entity_id: exceptionId,
    before,
    after,
    reason: parsed.data.reason
  });

  return NextResponse.json({ exception: after });
}

function mapActionToStatus(action: string, current: string): string {
  if (action === 'ACCEPT' || action === 'REJECT') return 'RESOLVED';
  if (action === 'ESCALATE') return 'ESCALATED';
  return current;
}
