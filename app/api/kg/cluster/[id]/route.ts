import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/rbac/server';
import { supabaseService } from '@/lib/supabase/service';

export async function GET(_req: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const { id } = await context.params;
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

  const aliases = (aliasRows ?? []).map((a) => a.alias);

  return NextResponse.json({
    entity,
    aliases,
    subsidiaries: []
  });
}
