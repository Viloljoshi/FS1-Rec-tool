import { NextResponse, after } from 'next/server';
import { z } from 'zod';
import { friendlyZodError } from '@/lib/api/errors';
import { supabaseService } from '@/lib/supabase/service';
import { getCurrentUser } from '@/lib/rbac/server';
import { runMatchingCycle } from '@/lib/matching/run-cycle';
import { logger } from '@/lib/logger/pino';

const BodySchema = z.object({
  feed_a_id: z.string().uuid(),
  feed_b_id: z.string().uuid(),
  date_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  date_to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  pipeline_id: z.string().uuid().optional(),
  restrict_by_counterparty_entity: z.boolean().optional(),
  force: z.boolean().optional()
});

const DEDUP_WINDOW_MS = 60_000;

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  if (user.role === 'auditor') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const parsed = BodySchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(friendlyZodError(parsed.error), { status: 400 });
  }

  const service = supabaseService();

  const { data: feedA } = await service
    .from('feed_profiles')
    .select('id, version')
    .eq('id', parsed.data.feed_a_id)
    .order('version', { ascending: false })
    .limit(1)
    .single();
  const { data: feedB } = await service
    .from('feed_profiles')
    .select('id, version')
    .eq('id', parsed.data.feed_b_id)
    .order('version', { ascending: false })
    .limit(1)
    .single();

  if (!feedA || !feedB) {
    return NextResponse.json({ error: 'feed_not_found' }, { status: 404 });
  }

  // Idempotency guard
  if (!parsed.data.force) {
    const since = new Date(Date.now() - DEDUP_WINDOW_MS).toISOString();
    const { data: recent } = await service
      .from('matching_cycles')
      .select('id, created_at, status')
      .eq('feed_a_id', feedA.id)
      .eq('feed_a_version', feedA.version)
      .eq('feed_b_id', feedB.id)
      .eq('feed_b_version', feedB.version)
      .eq('date_from', parsed.data.date_from)
      .eq('date_to', parsed.data.date_to)
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (recent) {
      return NextResponse.json(
        {
          cycle_id: recent.id,
          status: recent.status,
          deduped: true,
          message: `An identical cycle ran ${Math.round((Date.now() - new Date(recent.created_at).getTime()) / 1000)}s ago. Re-using its result. Pass force=true to run again.`
        },
        { status: 200 }
      );
    }
  }

  // Pre-create the cycle row so we can return cycle_id immediately,
  // then run the full matching pipeline (AI tiebreak + triage) in the
  // background via after() — avoids Netlify's 10s function timeout.
  const { data: preCycle, error: preErr } = await service
    .from('matching_cycles')
    .insert({
      feed_a_id: feedA.id,
      feed_a_version: feedA.version,
      feed_b_id: feedB.id,
      feed_b_version: feedB.version,
      date_from: parsed.data.date_from,
      date_to: parsed.data.date_to,
      status: 'PENDING',
      initiated_by: user.id
    })
    .select('id')
    .single();

  if (preErr || !preCycle) {
    return NextResponse.json({ error: preErr?.message ?? 'failed to create cycle' }, { status: 500 });
  }

  const cycleId = preCycle.id;
  const opts = {
    supabase: service,
    feedAId: feedA.id,
    feedAVersion: feedA.version,
    feedBId: feedB.id,
    feedBVersion: feedB.version,
    dateFrom: parsed.data.date_from,
    dateTo: parsed.data.date_to,
    initiatedBy: user.id,
    restrictByCounterpartyEntity: parsed.data.restrict_by_counterparty_entity ?? true,
    pipelineId: parsed.data.pipeline_id,
    existingCycleId: cycleId
  };

  // Run matching after the response is sent — keeps the HTTP call fast
  after(async () => {
    try {
      await runMatchingCycle(opts);
    } catch (err) {
      logger.error({ err, cycleId }, 'background matching cycle failed');
      await service
        .from('matching_cycles')
        .update({ status: 'FAILED', finished_at: new Date().toISOString() })
        .eq('id', cycleId);
    }
  });

  return NextResponse.json({
    cycle_id: cycleId,
    status: 'running',
    match_count: 0,
    exception_count: 0
  });
}
