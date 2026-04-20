import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';
import { getCurrentUser } from '@/lib/rbac/server';

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const url = new URL(request.url);
  const status = url.searchParams.get('status') ?? 'OPEN';
  const cycle = url.searchParams.get('cycle');
  const band = url.searchParams.get('band');

  const supabase = await supabaseServer();

  let query = supabase
    .from('exceptions')
    .select(
      `
      id, cycle_id, band, status, exception_class, assignee, explanation_cached, opened_at, updated_at,
      match_result:match_results!match_result_id (
        id, posterior, band, field_scores, deterministic_hit, llm_verdict
      ),
      trade_a:trades_canonical!trade_a_id (
        trade_id, source_id, source_ref, trade_date, settlement_date, direction, symbol, isin, cusip,
        quantity, price, currency, counterparty, counterparty_canonical_id, account
      ),
      trade_b:trades_canonical!trade_b_id (
        trade_id, source_id, source_ref, trade_date, settlement_date, direction, symbol, isin, cusip,
        quantity, price, currency, counterparty, counterparty_canonical_id, account
      )
    `
    )
    .eq('status', status)
    .order('opened_at', { ascending: false })
    .limit(500);

  if (cycle) query = query.eq('cycle_id', cycle);
  if (band) query = query.eq('band', band);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ exceptions: data ?? [] });
}
