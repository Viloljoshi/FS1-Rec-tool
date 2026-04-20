/* eslint-disable no-console */
import { createClient } from '@supabase/supabase-js';
import { runMatchingCycle } from '../lib/matching/run-cycle';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
if (!url || !serviceKey) {
  console.error('Missing Supabase env vars');
  process.exit(1);
}

const sb = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false }
});

async function runFor(feedAName: string, feedBName: string, restrict: boolean) {
  const { data: feeds } = await sb
    .from('feed_profiles')
    .select('id, name, version')
    .in('name', [feedAName, feedBName]);
  const a = feeds?.find((f) => f.name === feedAName);
  const b = feeds?.find((f) => f.name === feedBName);
  if (!a || !b) throw new Error(`Missing feed profiles: ${feedAName} / ${feedBName}`);

  const { data: manager } = await sb
    .from('profiles')
    .select('id')
    .eq('email', 'manager@demo.co')
    .maybeSingle();

  const result = await runMatchingCycle({
    supabase: sb,
    feedAId: a.id,
    feedAVersion: a.version,
    feedBId: b.id,
    feedBVersion: b.version,
    dateFrom: '2026-04-01',
    dateTo: '2026-04-30',
    initiatedBy: manager?.id ?? null,
    restrictByCounterpartyEntity: restrict
  });
  console.log(
    `  [${feedAName} vs ${feedBName}] matches=${result.match_count} exceptions=${result.exception_count} counts=${JSON.stringify(result.counts)}`
  );
  return result;
}

async function main() {
  console.log('pre-computing matching cycles...');

  const existing = await sb
    .from('matching_cycles')
    .select('id', { count: 'exact', head: true });
  if ((existing.count ?? 0) >= 3) {
    console.log(`  ${existing.count} cycles already exist, skipping`);
    return;
  }

  await runFor('Internal Blotter', 'Broker B — J.P. Morgan', true);
  await runFor('Internal Blotter', 'Broker A — Goldman', true);
  await runFor('Internal Blotter', 'Custodian', false);

  console.log('\n✓ Pre-compute complete');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
