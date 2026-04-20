import { NextResponse } from 'next/server';
import { z } from 'zod';
import { friendlyZodError } from '@/lib/api/errors';
import { supabaseService } from '@/lib/supabase/service';
import { getCurrentUser } from '@/lib/rbac/server';
import { recordAudit } from '@/lib/audit/log';
import { DEFAULT_WEIGHTS } from '@/lib/matching/fellegi_sunter';

const PublishSchema = z.object({
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

  // Find current active default
  const { data: current } = await sb
    .from('matching_rules')
    .select('id, version, weights, tolerances')
    .eq('name', 'default')
    .eq('active', true)
    .maybeSingle();

  const newVersion = (current?.version ?? 0) + 1;

  // Deactivate previous
  if (current) {
    await sb
      .from('matching_rules')
      .update({ active: false })
      .eq('name', 'default')
      .eq('version', current.version);
  }

  // Insert new version
  const weights = parsed.data.weights ?? DEFAULT_WEIGHTS;
  const payload = {
    ...parsed.data.tolerances,
    bands: parsed.data.bands,
    llm_tiebreak_band: parsed.data.llm_tiebreak_band,
    preset: parsed.data.preset ?? 'CUSTOM'
  };
  const { data: inserted, error } = await sb
    .from('matching_rules')
    .insert({
      name: 'default',
      version: newVersion,
      active: true,
      weights,
      tolerances: payload,
      created_by: user.id
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
    after: { version: inserted.version, preset: parsed.data.preset, bands: parsed.data.bands, tolerances: parsed.data.tolerances, llm_tiebreak_band: parsed.data.llm_tiebreak_band },
    reason: parsed.data.reason ?? `Published ${parsed.data.preset ?? 'CUSTOM'} profile as v${newVersion}`
  });

  return NextResponse.json({ id: inserted.id, version: inserted.version });
}
