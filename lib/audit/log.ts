import { supabaseServer } from '@/lib/supabase/server';
import { supabaseService } from '@/lib/supabase/service';
import { logger } from '@/lib/logger/pino';

export interface AuditArgs {
  action: string;
  entity_type: string;
  entity_id: string;
  before?: unknown;
  after?: unknown;
  reason?: string;
  actor?: string | null;
}

export async function recordAudit(args: AuditArgs): Promise<void> {
  const supabase = await supabaseServer();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  const actor = args.actor ?? user?.id ?? null;

  try {
    const { error } = await supabase.from('audit_events').insert({
      actor,
      action: args.action,
      entity_type: args.entity_type,
      entity_id: args.entity_id,
      before: args.before ?? null,
      after: args.after ?? null,
      reason: args.reason ?? null
    });
    if (error) throw error;
  } catch (err) {
    logger.error({ err, args }, 'audit log failed, falling back to service role');
    const sb = supabaseService();
    await sb.from('audit_events').insert({
      actor,
      action: args.action,
      entity_type: args.entity_type,
      entity_id: args.entity_id,
      before: args.before ?? null,
      after: args.after ?? null,
      reason: args.reason ?? null
    });
  }
}

export async function recordAuditService(args: AuditArgs): Promise<void> {
  const sb = supabaseService();
  const { error } = await sb.from('audit_events').insert({
    actor: args.actor ?? null,
    action: args.action,
    entity_type: args.entity_type,
    entity_id: args.entity_id,
    before: args.before ?? null,
    after: args.after ?? null,
    reason: args.reason ?? null
  });
  if (error) {
    logger.error({ error, args }, 'service-role audit insert failed');
    throw error;
  }
}
