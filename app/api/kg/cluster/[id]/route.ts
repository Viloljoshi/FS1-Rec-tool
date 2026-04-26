import { NextResponse } from 'next/server';
import { getCounterpartyCluster } from '@/lib/kg/queries';
import { getCurrentUser } from '@/lib/rbac/server';
import { supabaseService } from '@/lib/supabase/service';

export async function GET(_req: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const { id } = await context.params;

  try {
    const cluster = await getCounterpartyCluster(id);
    if (!cluster) return NextResponse.json({ error: 'not_found' }, { status: 404 });
    return NextResponse.json(cluster);
  } catch {
    // Neo4j unavailable — fall back to Postgres
    const sb = supabaseService();
    const { data: entity } = await sb
      .from('counterparty_entities')
      .select('id, canonical_name, lei, sec_crd, country')
      .eq('id', id)
      .single();
    if (!entity) return NextResponse.json({ error: 'not_found' }, { status: 404 });
    const { data: aliasRows } = await sb
      .from('counterparty_aliases')
      .select('alias')
      .eq('entity_id', id);
    return NextResponse.json({
      entity,
      aliases: (aliasRows ?? []).map((a) => a.alias),
      subsidiaries: []
    });
  }
}
