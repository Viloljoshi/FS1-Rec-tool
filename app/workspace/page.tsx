import { AppShell } from '@/components/layout/AppShell';
import { WorkspaceClient } from './WorkspaceClient';
import { supabaseServer } from '@/lib/supabase/server';

const VALID_STATUSES = ['OPEN', 'ESCALATED', 'RESOLVED'] as const;
type StatusFilter = (typeof VALID_STATUSES)[number] | 'ALL';

export default async function WorkspacePage({
  searchParams
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const sp = await searchParams;
  const rawStatus = (sp.status ?? 'OPEN').toUpperCase();
  const statusFilter: StatusFilter =
    rawStatus === 'ALL' || (VALID_STATUSES as readonly string[]).includes(rawStatus)
      ? (rawStatus as StatusFilter)
      : 'OPEN';

  const sb = await supabaseServer();
  let query = sb
    .from('exceptions')
    .select(
      `
      id, cycle_id, band, status, exception_class, assignee, explanation_cached, opened_at, updated_at,
      match_result:match_results!match_result_id ( id, posterior, band, field_scores, deterministic_hit, llm_verdict ),
      trade_a:trades_canonical!trade_a_id ( trade_id, source_id, source_ref, trade_date, settlement_date, direction, symbol, isin, cusip, quantity, price, currency, counterparty, counterparty_canonical_id, account ),
      trade_b:trades_canonical!trade_b_id ( trade_id, source_id, source_ref, trade_date, settlement_date, direction, symbol, isin, cusip, quantity, price, currency, counterparty, counterparty_canonical_id, account )
    `
    )
    .order('opened_at', { ascending: false })
    .limit(500);
  if (statusFilter !== 'ALL') query = query.eq('status', statusFilter);
  const { data: exceptions } = await query;

  const { data: cycles } = await sb
    .from('matching_cycles')
    .select('id, started_at, counts, feed_a_id, feed_b_id, pipeline_id')
    .order('started_at', { ascending: false })
    .limit(20);

  const { data: feeds } = await sb.from('feed_profiles').select('id, name, version');

  const { data: pipelines } = await sb.from('pipelines').select('id, name, asset_class');

  const { data: statusRows } = await sb
    .from('exceptions')
    .select('cycle_id, status')
    .limit(5000);
  const statusBreakdown: Record<string, Record<string, number>> = {};
  for (const r of statusRows ?? []) {
    const cycle = (r.cycle_id ?? '') as string;
    const status = (r.status ?? '') as string;
    if (!statusBreakdown[cycle]) statusBreakdown[cycle] = {};
    statusBreakdown[cycle][status] = (statusBreakdown[cycle][status] ?? 0) + 1;
  }

  return (
    <AppShell>
      <WorkspaceClient
        initialExceptions={(exceptions ?? []) as unknown as Exception[]}
        cycles={cycles ?? []}
        feeds={feeds ?? []}
        statusFilter={statusFilter}
        statusBreakdown={statusBreakdown}
        pipelines={pipelines ?? []}
      />
    </AppShell>
  );
}

export type Exception = Awaited<ReturnType<typeof loadSchema>>;
async function loadSchema() {
  return {} as {
    id: string;
    cycle_id: string;
    band: 'HIGH' | 'MEDIUM' | 'LOW' | null;
    status: string;
    exception_class: string;
    assignee: string | null;
    explanation_cached: string | null;
    opened_at: string;
    updated_at: string;
    match_result: {
      id: string;
      posterior: number;
      band: 'HIGH' | 'MEDIUM' | 'LOW';
      field_scores: Array<{ field: string; raw_score: number; weight: number; contribution: number }>;
      deterministic_hit: boolean;
      llm_verdict: { verdict: string; confidence: number; reasoning: string; decisive_fields: string[] } | null;
    } | null;
    trade_a: TradeRow | null;
    trade_b: TradeRow | null;
  };
}

export interface TradeRow {
  trade_id: string;
  source_id: string;
  source_ref: string;
  trade_date: string;
  settlement_date: string;
  direction: 'BUY' | 'SELL';
  symbol: string;
  isin: string | null;
  cusip: string | null;
  quantity: string | number;
  price: string | number;
  currency: string;
  counterparty: string;
  counterparty_canonical_id: string | null;
  account: string;
}
