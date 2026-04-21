import { NextResponse } from 'next/server';
import { z } from 'zod';
import { friendlyZodError } from '@/lib/api/errors';
import { supabaseService } from '@/lib/supabase/service';
import { getCurrentUser } from '@/lib/rbac/server';
import { recordAudit } from '@/lib/audit/log';
import { DEFAULT_WEIGHTS } from '@/lib/matching/fellegi_sunter';

const BlockingFieldEnum = z.enum([
  'symbol',
  'isin',
  'cusip',
  'trade_date',
  'settlement_date',
  'direction',
  'currency',
  'account'
]);
const StageIdEnum = z.enum([
  'normalize',
  'hash',
  'blocking',
  'similarity',
  'fellegi_sunter',
  'hungarian',
  'llm_tiebreak'
]);
const MatchTypeEnum = z.enum(['1:1', '1:N', 'N:1', 'N:M']);

const PublishSchema = z.object({
  pipeline_id: z.string().uuid().optional(),
  preset: z.enum(['STRICT', 'BALANCED', 'LENIENT', 'CUSTOM']).optional(),
  bands: z.object({
    high_min: z.number().min(0.5).max(0.999),
    medium_min: z.number().min(0.3).max(0.9)
  }),
  tolerances: z.object({
    price_rel_tolerance: z.number().min(0).max(0.2),
    quantity_rel_tolerance: z.number().min(0).max(0.5),
    date_day_delta: z.number().int().min(0).max(5)
  }),
  llm_tiebreak_band: z.enum(['MEDIUM_ONLY', 'ALL', 'NONE']),
  blocking_keys: z.array(BlockingFieldEnum).min(1).max(6).optional(),
  enabled_stages: z.array(StageIdEnum).min(1).optional(),
  match_types: z.array(MatchTypeEnum).min(1).optional(),
  weights: z.record(z.string(), z.object({
    m: z.number().min(0).max(1),
    u: z.number().min(0).max(1),
    threshold: z.number().min(0).max(1)
  })).optional(),
  reason: z.string().max(500).optional()
});

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  if (user.role !== 'manager') {
    return NextResponse.json({ error: 'forbidden: manager role required to publish matching rules' }, { status: 403 });
  }

  const parsed = PublishSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(friendlyZodError(parsed.error), { status: 400 });
  }

  const sb = supabaseService();

  // Resolve pipeline scope. If pipeline_id omitted, default to Equities for
  // backwards-compatibility with older UI that didn't thread the id through.
  let pipelineId: string | null = parsed.data.pipeline_id ?? null;
  if (!pipelineId) {
    const { data: eq } = await sb.from('pipelines').select('id').eq('name', 'Equities').maybeSingle();
    pipelineId = eq?.id ?? null;
  }
  if (!pipelineId) {
    return NextResponse.json({ error: 'no pipeline resolved; provide pipeline_id' }, { status: 400 });
  }

  // Find current active default scoped to this pipeline
  const { data: current } = await sb
    .from('matching_rules')
    .select('id, version, weights, tolerances, pipeline_id')
    .eq('name', 'default')
    .eq('active', true)
    .eq('pipeline_id', pipelineId)
    .maybeSingle();

  const newVersion = (current?.version ?? 0) + 1;

  // Deactivate previous row for THIS pipeline only
  if (current) {
    await sb
      .from('matching_rules')
      .update({ active: false })
      .eq('name', 'default')
      .eq('version', current.version)
      .eq('pipeline_id', pipelineId);
  }

  // Insert new version
  const weights = parsed.data.weights ?? DEFAULT_WEIGHTS;
  const payload: Record<string, unknown> = {
    ...parsed.data.tolerances,
    bands: parsed.data.bands,
    llm_tiebreak_band: parsed.data.llm_tiebreak_band,
    preset: parsed.data.preset ?? 'CUSTOM'
  };
  if (parsed.data.blocking_keys) payload.blocking_keys = parsed.data.blocking_keys;
  if (parsed.data.enabled_stages) payload.enabled_stages = parsed.data.enabled_stages;
  if (parsed.data.match_types) payload.match_types = parsed.data.match_types;
  const { data: inserted, error } = await sb
    .from('matching_rules')
    .insert({
      name: 'default',
      version: newVersion,
      active: true,
      weights,
      tolerances: payload,
      created_by: user.id,
      pipeline_id: pipelineId
    })
    .select('id, version')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await recordAudit({
    actor: user.id,
    action: 'MATCHING_RULES_PUBLISH',
    entity_type: 'matching_rules',
    entity_id: inserted.id,
    before: current ?? undefined,
    after: { version: inserted.version, preset: parsed.data.preset, bands: parsed.data.bands, tolerances: parsed.data.tolerances, llm_tiebreak_band: parsed.data.llm_tiebreak_band, blocking_keys: parsed.data.blocking_keys, enabled_stages: parsed.data.enabled_stages, match_types: parsed.data.match_types, pipeline_id: pipelineId },
    reason: parsed.data.reason ?? `Published ${parsed.data.preset ?? 'CUSTOM'} profile as v${newVersion}`
  });

  return NextResponse.json({ id: inserted.id, version: inserted.version });
}
