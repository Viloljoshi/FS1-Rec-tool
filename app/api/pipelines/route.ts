import { NextResponse } from 'next/server';
import { z } from 'zod';
import { friendlyZodError } from '@/lib/api/errors';
import { supabaseService } from '@/lib/supabase/service';
import { getCurrentUser } from '@/lib/rbac/server';
import { recordAudit } from '@/lib/audit/log';
import { DEFAULT_WEIGHTS } from '@/lib/matching/fellegi_sunter';

const CreateSchema = z.object({
  name: z.string().min(1).max(80),
  asset_class: z.enum(['EQUITY', 'FI', 'FX', 'FUTURE', 'OTHER']),
  description: z.string().max(500).optional(),
  /**
   * Seed matching_rules row for this pipeline. If omitted, a neutral
   * equities-flavoured default is written so the pipeline is immediately
   * runnable.
   */
  seed_config: z
    .object({
      price_rel_tolerance: z.number().min(0).max(0.2).default(0.01),
      quantity_rel_tolerance: z.number().min(0).max(0.5).default(0.05),
      date_day_delta: z.number().int().min(0).max(10).default(1),
      bands: z
        .object({
          high_min: z.number().min(0.5).max(0.999).default(0.95),
          medium_min: z.number().min(0.3).max(0.9).default(0.7)
        })
        .default({ high_min: 0.95, medium_min: 0.7 }),
      llm_tiebreak_band: z.enum(['MEDIUM_ONLY', 'ALL', 'NONE']).default('MEDIUM_ONLY'),
      blocking_keys: z
        .array(
          z.enum([
            'symbol',
            'isin',
            'cusip',
            'trade_date',
            'settlement_date',
            'direction',
            'currency',
            'account'
          ])
        )
        .default(['symbol', 'trade_date', 'direction']),
      enabled_stages: z
        .array(
          z.enum([
            'normalize',
            'hash',
            'blocking',
            'similarity',
            'fellegi_sunter',
            'hungarian',
            'llm_tiebreak'
          ])
        )
        .default([
          'normalize',
          'hash',
          'blocking',
          'similarity',
          'fellegi_sunter',
          'hungarian',
          'llm_tiebreak'
        ]),
      match_types: z.array(z.enum(['1:1', '1:N', 'N:1', 'N:M'])).default(['1:1'])
    })
    .optional()
});

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  if (user.role !== 'manager') {
    return NextResponse.json({ error: 'forbidden: manager role required' }, { status: 403 });
  }

  const parsed = CreateSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json(friendlyZodError(parsed.error), { status: 400 });

  const sb = supabaseService();

  const { data: existing } = await sb
    .from('pipelines')
    .select('id')
    .eq('name', parsed.data.name)
    .maybeSingle();
  if (existing) {
    return NextResponse.json({ error: `pipeline '${parsed.data.name}' already exists` }, { status: 409 });
  }

  const { data: pipeline, error: pipeErr } = await sb
    .from('pipelines')
    .insert({
      name: parsed.data.name,
      asset_class: parsed.data.asset_class,
      description: parsed.data.description ?? null,
      active: true
    })
    .select('id')
    .single();
  if (pipeErr) return NextResponse.json({ error: pipeErr.message }, { status: 500 });

  const seed = parsed.data.seed_config ?? {
    price_rel_tolerance: 0.01,
    quantity_rel_tolerance: 0.05,
    date_day_delta: 1,
    bands: { high_min: 0.95, medium_min: 0.7 },
    llm_tiebreak_band: 'MEDIUM_ONLY' as const,
    blocking_keys: ['symbol', 'trade_date', 'direction'] as const,
    enabled_stages: [
      'normalize',
      'hash',
      'blocking',
      'similarity',
      'fellegi_sunter',
      'hungarian',
      'llm_tiebreak'
    ] as const,
    match_types: ['1:1'] as const
  };

  const { data: rule, error: ruleErr } = await sb
    .from('matching_rules')
    .insert({
      name: 'default',
      version: 1,
      active: true,
      weights: DEFAULT_WEIGHTS,
      tolerances: seed,
      created_by: user.id,
      pipeline_id: pipeline.id
    })
    .select('id, version')
    .single();
  if (ruleErr) return NextResponse.json({ error: ruleErr.message }, { status: 500 });

  await recordAudit({
    actor: user.id,
    action: 'PIPELINE_CREATE',
    entity_type: 'pipelines',
    entity_id: pipeline.id,
    after: {
      name: parsed.data.name,
      asset_class: parsed.data.asset_class,
      seed_rule_id: rule.id
    },
    reason: `Manager created pipeline '${parsed.data.name}' (${parsed.data.asset_class})`
  });

  return NextResponse.json({ pipeline_id: pipeline.id, matching_rules_id: rule.id });
}
