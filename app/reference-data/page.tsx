import { AppShell } from '@/components/layout/AppShell';
import { ReferenceDataClient } from './ReferenceDataClient';
import { searchCounterparties } from '@/lib/kg/queries';
import { supabaseService } from '@/lib/supabase/service';

export default async function ReferenceDataPage() {
  let initial: Array<{
    id: string;
    canonical_name: string;
    lei: string | null;
    sec_crd: string | null;
    country: string | null;
  }> = [];

  try {
    initial = await searchCounterparties('', 12);
  } catch {
    // Neo4j unavailable — fall back to Postgres
    const sb = supabaseService();
    const { data } = await sb
      .from('counterparty_entities')
      .select('id, canonical_name, lei, sec_crd, country')
      .order('canonical_name', { ascending: true })
      .limit(12);
    initial = data ?? [];
  }

  return (
    <AppShell>
      <div className="w-full px-6 xl:px-8 2xl:px-10 py-6">
        <div className="mb-6">
          <h1 className="text-xl font-semibold text-slate-900">Reference Data — Entity Graph</h1>
          <p className="text-sm text-slate-500 mt-1">
            Counterparty + security master as a Neo4j knowledge graph. Aliases, subsidiaries, and identifier
            cross-references are first-class queries. The matching engine calls this graph at scoring time.
          </p>
        </div>
        <ReferenceDataClient initial={initial} />
      </div>
    </AppShell>
  );
}
