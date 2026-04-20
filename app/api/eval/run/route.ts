import { NextResponse } from 'next/server';
import { supabaseService } from '@/lib/supabase/service';
import { getCurrentUser } from '@/lib/rbac/server';
import { runEval } from '@/lib/eval/run';

export async function POST() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  if (user.role === 'analyst') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const service = supabaseService();
  const { data: rules } = await service
    .from('matching_rules')
    .select('version')
    .eq('name', 'default')
    .eq('active', true)
    .single();

  try {
    const report = await runEval({
      supabase: service,
      initiatedBy: user.id,
      modelVersion: process.env.OPENAI_MODEL ?? 'gpt-4o-mini',
      rulesVersion: rules?.version ?? 1
    });
    return NextResponse.json({
      f1: report.f1_score,
      precision: report.precision_score,
      recall: report.recall_score,
      confusion: report.confusion,
      pair_count: report.pair_count
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
