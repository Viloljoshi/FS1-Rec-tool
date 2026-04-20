/* eslint-disable no-console */
import { createClient } from '@supabase/supabase-js';
import { runMatchingCycle } from '../lib/matching/run-cycle';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const sb = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false }
});

async function main() {
  const { data: feeds } = await sb
    .from('feed_profiles')
    .select('id, name, version')
    .in('name', ['Internal Blotter', 'Broker B — J.P. Morgan']);
  const a = feeds?.find((f) => f.name === 'Internal Blotter');
  const b = feeds?.find((f) => f.name === 'Broker B — J.P. Morgan');
  if (!a || !b) throw new Error('missing feeds');

  const { data: manager } = await sb
    .from('profiles')
    .select('id')
    .eq('email', 'manager@demo.co')
    .maybeSingle();

  const r = await runMatchingCycle({
    supabase: sb,
    feedAId: a.id,
    feedAVersion: a.version,
    feedBId: b.id,
    feedBVersion: b.version,
    dateFrom: '2026-04-01',
    dateTo: '2026-04-30',
    initiatedBy: manager?.id ?? null,
    restrictByCounterpartyEntity: true
  });
  console.log(`cycle_id=${r.cycle_id}  matches=${r.match_count}  exceptions=${r.exception_count}`);
  console.log('counts=' + JSON.stringify(r.counts, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
