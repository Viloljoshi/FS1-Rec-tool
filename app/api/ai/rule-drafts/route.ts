import { NextResponse } from 'next/server';
import { supabaseService } from '@/lib/supabase/service';
import { getCurrentUser } from '@/lib/rbac/server';
import { proposeRuleDrafts } from '@/lib/ai/prompts/rule-drafts';

interface ExceptionJoin {
  exception_class: string;
  band: string | null;
  trade_a_id: string | null;
  trade_b_id: string | null;
}

interface ActionRow {
  action: string;
  reason: string | null;
  // Supabase can return the joined row as an object or (confusingly) an array of one
  exception: ExceptionJoin | ExceptionJoin[] | null;
}

function extractException(e: ActionRow['exception']): ExceptionJoin | null {
  if (!e) return null;
  if (Array.isArray(e)) return e[0] ?? null;
  return e;
}

export async function POST(): Promise<Response> {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  if (user.role !== 'manager' && user.role !== 'auditor') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const sb = supabaseService();

  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const { data: actions, error } = await sb
    .from('resolution_actions')
    .select(
      `action, reason, created_at,
       exception:exceptions!exception_id ( exception_class, band, trade_a_id, trade_b_id )`
    )
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(2000);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const buckets = new Map<string, {
    exception_class: string;
    band: string | null;
    action_counts: Record<string, number>;
    total: number;
    reasons: string[];
  }>();

  for (const a of (actions ?? []) as unknown as ActionRow[]) {
    const exc = extractException(a.exception);
    if (!exc) continue;
    const key = `${exc.exception_class}|${exc.band ?? 'UNMATCHED'}`;
    const b = buckets.get(key) ?? {
      exception_class: exc.exception_class,
      band: exc.band,
      action_counts: {},
      total: 0,
      reasons: []
    };
    b.action_counts[a.action] = (b.action_counts[a.action] ?? 0) + 1;
    b.total++;
    if (a.reason) b.reasons.push(a.reason);
    buckets.set(key, b);
  }

  const patterns = Array.from(buckets.values())
    .filter((p) => p.total >= 5)
    .map((p) => ({
      exception_class: p.exception_class,
      band: p.band,
      sample_counterparty: null,
      action_counts: p.action_counts,
      total: p.total,
      sample_reasons: p.reasons.slice(0, 5)
    }));

  if (patterns.length === 0) {
    return NextResponse.json({
      drafts: [],
      summary: 'Not enough analyst adjudications yet. Need 5+ resolutions per pattern for a proposal.',
      patterns_observed: buckets.size
    });
  }

  const result = await proposeRuleDrafts({ patterns, actor: user.id });
  return NextResponse.json({
    ...result,
    patterns_observed: patterns.length
  });
}
