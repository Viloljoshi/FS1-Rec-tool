import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/rbac/server';
import { supabaseService } from '@/lib/supabase/service';

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const url = new URL(request.url);
  const q = (url.searchParams.get('q') ?? '').trim();
  const limit = Math.min(20, Number(url.searchParams.get('limit') ?? '10'));
  if (!q) return NextResponse.json({ results: [] });

  const sb = supabaseService();
  const { data, error } = await sb
    .from('counterparty_entities')
    .select('id, canonical_name, lei, sec_crd, country')
    .ilike('canonical_name', `%${q}%`)
    .limit(limit);

  if (error) {
    // also search aliases
    return NextResponse.json({ results: [] });
  }

  // also search aliases if entity result is thin
  let results = data ?? [];
  if (results.length < limit) {
    const { data: aliasRows } = await sb
      .from('counterparty_aliases')
      .select('entity_id, alias')
      .ilike('alias', `%${q}%`)
      .limit(limit);

    if (aliasRows && aliasRows.length > 0) {
      const missingIds = aliasRows
        .map((a) => a.entity_id)
        .filter((id) => !results.find((r) => r.id === id));
      if (missingIds.length > 0) {
        const { data: extra } = await sb
          .from('counterparty_entities')
          .select('id, canonical_name, lei, sec_crd, country')
          .in('id', missingIds)
          .limit(limit - results.length);
        results = [...results, ...(extra ?? [])];
      }
    }
  }

  return NextResponse.json({ results });
}
