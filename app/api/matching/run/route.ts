import { NextResponse } from 'next/server';
import { z } from 'zod';
import { friendlyZodError } from '@/lib/api/errors';
import { supabaseService } from '@/lib/supabase/service';
import { getCurrentUser } from '@/lib/rbac/server';
import { runMatchingCycle } from '@/lib/matching/run-cycle';

const BodySchema = z.object({
  feed_a_id: z.string().uuid(),
  feed_b_id: z.string().uuid(),
  date_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  date_to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  pipeline_id: z.string().uuid().optional(),
  restrict_by_counterparty_entity: z.boolean().optional(),
  // When true, the server will skip the dedup check and force a fresh cycle.
  // Default is false so rapid button clicks don't create duplicate cycles.
  force: z.boolean().optional()
});

const DEDUP_WINDOW_MS = 60_000; // 60s — covers a "user clicked twice by mistake"

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

  // Idempotency guard: if an identical cycle ran in the last DEDUP_WINDOW_MS,
  // surface its result instead of queuing a duplicate. Pass `force: true` to
  // bypass (e.g. user clicks "Run again anyway").
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

  try {
    const result = await runMatchingCycle({
      supabase: service,
      feedAId: feedA.id,
      feedAVersion: feedA.version,
      feedBId: feedB.id,
      feedBVersion: feedB.version,
      dateFrom: parsed.data.date_from,
      dateTo: parsed.data.date_to,
      initiatedBy: user.id,
      restrictByCounterpartyEntity: parsed.data.restrict_by_counterparty_entity ?? true,
      pipelineId: parsed.data.pipeline_id
    });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
