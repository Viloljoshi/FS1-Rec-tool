import { NextResponse } from 'next/server';
import { textCall } from '@/lib/ai/openai';
import { getCurrentUser } from '@/lib/rbac/server';
import { supabaseServer } from '@/lib/supabase/server';

interface CycleSummary {
  feed_b: string;
  counts: Record<string, number>;
  started_at: string;
}

interface FeedRow {
  id: string;
  name: string;
}

interface AICallRow {
  call_type: string;
  fallback_used: boolean | null;
}

interface EvalRow {
  f1_score: number;
  precision_score: number;
  recall_score: number;
  created_at: string;
}

export async function POST(): Promise<Response> {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const sb = await supabaseServer();

  const [{ data: cycles }, { data: feeds }, { data: aiCalls }, { data: evals }] = await Promise.all([
    sb
      .from('matching_cycles')
      .select('feed_b_id, started_at, counts')
      .order('started_at', { ascending: false })
      .limit(5),
    sb.from('feed_profiles').select('id, name'),
    sb.from('ai_calls').select('call_type, fallback_used').limit(200),
    sb
      .from('eval_runs')
      .select('f1_score, precision_score, recall_score, created_at')
      .order('created_at', { ascending: false })
      .limit(1)
  ]);

  const feedRows = (feeds ?? []) as FeedRow[];
  const cycleRows = (cycles ?? []) as Array<{
    feed_b_id: string;
    started_at: string;
    counts: Record<string, number> | null;
  }>;
  const aiCallRows = (aiCalls ?? []) as AICallRow[];
  const evalRows = (evals ?? []) as EvalRow[];

  const feedName = (id: string): string => feedRows.find((f: FeedRow) => f.id === id)?.name ?? id.slice(0, 8);

  const summaries: CycleSummary[] = cycleRows.map((c) => ({
    feed_b: feedName(c.feed_b_id),
    counts: c.counts ?? {},
    started_at: c.started_at
  }));

  const aiTotals = aiCallRows.reduce<Record<string, { total: number; fallback: number }>>((acc, row) => {
    const k = row.call_type;
    acc[k] = acc[k] ?? { total: 0, fallback: 0 };
    acc[k].total++;
    if (row.fallback_used) acc[k].fallback++;
    return acc;
  }, {});

  const lastEval = evalRows[0] ?? null;

  const system = `You are a reconciliation operations analyst writing a brief, factual daily summary for the Head of Ops.
Two to three sentences. Plain English. No bullet points. No jargon the Head of Ops doesn't know. Lead with what's unusual.

STRICT FACTUAL RULES — VIOLATIONS MAKE THE SUMMARY USELESS:
1. Only state numbers that appear verbatim in the data below. Do not compute percentages, ratios, or averages not provided.
2. When comparing two cycles, always check the explicit "older" / "newer" labels in the data. "Older" runs started earlier in chronological time.
3. If you say a value "increased" or "decreased" between runs, you MUST verify the direction against the labeled older vs newer counts. Never flip it.
4. If you cannot determine a direction confidently, say "changed from X to Y" without asserting a direction.
5. Never invent a trend or attribute a cause — only report what the numbers show.`;

  // Present cycles oldest-first with explicit temporal labels so the LLM
  // cannot invert increase/decrease claims. The DB query fetches newest-first,
  // so we reverse here and label explicitly.
  const orderedOldestFirst = [...summaries].reverse();
  const cycleLines = orderedOldestFirst.map((s, i) => {
    const tempLabel =
      orderedOldestFirst.length === 1
        ? 'only run'
        : i === 0
          ? 'oldest'
          : i === orderedOldestFirst.length - 1
            ? 'newest'
            : `run ${i + 1} of ${orderedOldestFirst.length}`;
    return `  [${tempLabel}] ${s.feed_b} (${new Date(s.started_at).toISOString()}): HIGH=${s.counts.HIGH ?? 0}, MEDIUM=${s.counts.MEDIUM ?? 0}, LOW=${s.counts.LOW ?? 0}, exceptions=${s.counts.EXCEPTIONS ?? 0}, matches=${s.counts.MATCHES ?? 0}`;
  }).join('\n');

  const user_msg = `Last ${summaries.length} matching cycles (ordered oldest → newest):
${cycleLines}

AI call totals (last 200): ${Object.entries(aiTotals).map(([k, v]) => `${k}=${v.total}${v.fallback ? ` (${v.fallback} fallback)` : ''}`).join(', ') || 'none'}
Latest evals: ${lastEval ? `F1=${lastEval.f1_score.toFixed(3)}, P=${lastEval.precision_score.toFixed(2)}, R=${lastEval.recall_score.toFixed(2)} (as of ${new Date(lastEval.created_at).toISOString().slice(0, 10)})` : 'none run yet'}`;

  try {
    const text = await textCall({
      call_type: 'DASHBOARD_NARRATIVE',
      system,
      user: user_msg,
      actor: user.id
    });
    return NextResponse.json({ narrative: text || null });
  } catch (err) {
    return NextResponse.json({ narrative: null, error: String(err) }, { status: 500 });
  }
}
