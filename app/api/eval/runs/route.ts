import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/rbac/server';
import { supabaseService } from '@/lib/supabase/service';

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const sb = supabaseService();
  const { data, error } = await sb
    .from('eval_runs')
    .select('id, gold_set_version, precision_score, recall_score, f1_score, per_band, per_class, confusion, model_version, matching_rules_version, initiated_by, created_at')
    .order('created_at', { ascending: false })
    .limit(20);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ runs: data ?? [] });
}
