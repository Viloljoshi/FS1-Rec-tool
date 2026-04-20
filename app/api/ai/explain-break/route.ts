import { NextResponse } from 'next/server';
import { z } from 'zod';
import { friendlyZodError } from '@/lib/api/errors';
import { explainBreak } from '@/lib/ai/prompts/explain-break';
import { supabaseServer } from '@/lib/supabase/server';
import { getCurrentUser } from '@/lib/rbac/server';

const BodySchema = z.object({
  exception_id: z.string().uuid()
});

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const parsed = BodySchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(friendlyZodError(parsed.error), { status: 400 });
  }

  const supabase = await supabaseServer();
  const { data: exc } = await supabase
    .from('exceptions')
    .select(
      `id, explanation_cached,
       match_result:match_results!match_result_id ( field_scores ),
       trade_a:trades_canonical!trade_a_id ( source_ref, trade_date, direction, symbol, quantity, price, counterparty, account ),
       trade_b:trades_canonical!trade_b_id ( source_ref, trade_date, direction, symbol, quantity, price, counterparty, account )`
    )
    .eq('id', parsed.data.exception_id)
    .single();

  if (!exc) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (exc.explanation_cached) {
    return NextResponse.json({ cached: true, explanation: JSON.parse(exc.explanation_cached) });
  }

  const fieldScores = Array.isArray(exc.match_result)
    ? (exc.match_result[0]?.field_scores ?? [])
    : ((exc.match_result as { field_scores?: unknown } | null)?.field_scores ?? []);

  const tradeA = Array.isArray(exc.trade_a) ? exc.trade_a[0] : exc.trade_a;
  const tradeB = Array.isArray(exc.trade_b) ? exc.trade_b[0] : exc.trade_b;

  const result = await explainBreak({
    trade_a: (tradeA as unknown as Record<string, unknown>) ?? {},
    trade_b: (tradeB as unknown as Record<string, unknown>) ?? {},
    field_scores: (fieldScores as unknown as Array<{ field: string; raw_score: number; weight: number; contribution: number }>) ?? [],
    actor: user.id
  });

  await supabase
    .from('exceptions')
    .update({ explanation_cached: JSON.stringify(result) })
    .eq('id', parsed.data.exception_id);

  return NextResponse.json({ cached: false, explanation: result });
}
