import { NextResponse } from 'next/server';
import { z } from 'zod';
import { friendlyZodError } from '@/lib/api/errors';
import { suggestPipeline } from '@/lib/ai/prompts/suggest-pipeline';
import { supabaseServer } from '@/lib/supabase/server';
import { getCurrentUser } from '@/lib/rbac/server';

const BodySchema = z.object({
  feed_id: z.string().uuid().optional(),
  asset_class_hint: z.enum(['EQUITY', 'FI', 'FX', 'FUTURE', 'OTHER']).default('EQUITY')
});

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  if (user.role !== 'manager') {
    return NextResponse.json({ error: 'forbidden', detail: 'manager role required' }, { status: 403 });
  }

  const parsed = BodySchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(friendlyZodError(parsed.error), { status: 400 });
  }

  const { feed_id, asset_class_hint } = parsed.data;
  const supabase = await supabaseServer();

  let feed_mapping: Array<{ source_field: string; canonical_field: string }> = [];
  let sample_rows: Array<Record<string, unknown>> = [];

  if (feed_id) {
    const { data: feed } = await supabase
      .from('feed_profiles')
      .select('id, version')
      .eq('id', feed_id)
      .order('version', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (feed) {
      const { data: mappings } = await supabase
        .from('field_mappings')
        .select('source_field, canonical_field')
        .eq('feed_profile_id', feed.id)
        .eq('feed_profile_version', feed.version);
      feed_mapping = (mappings ?? []) as typeof feed_mapping;

      const { data: trades } = await supabase
        .from('trades_canonical')
        .select('symbol, trade_date, settlement_date, direction, quantity, price, currency, counterparty, account')
        .eq('source_id', feed.id)
        .limit(10);
      sample_rows = (trades ?? []) as typeof sample_rows;
    }
  }

  if (feed_mapping.length === 0) {
    feed_mapping = [
      { source_field: 'ticker', canonical_field: 'symbol' },
      { source_field: 'trade_dt', canonical_field: 'trade_date' },
      { source_field: 'side', canonical_field: 'direction' },
      { source_field: 'qty', canonical_field: 'quantity' },
      { source_field: 'px', canonical_field: 'price' }
    ];
  }

  const suggestion = await suggestPipeline({
    asset_class_hint,
    feed_mapping,
    sample_rows,
    actor: user.id
  });

  return NextResponse.json({ suggestion });
}
