/* eslint-disable no-console */
import { createClient } from '@supabase/supabase-js';

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false, autoRefreshToken: false }
});

const SEED_FEED_NAMES = ['Internal Blotter', 'Broker A — Goldman', 'Broker B — J.P. Morgan', 'Custodian'];

async function count(table: string): Promise<number> {
  const { count } = await sb.from(table).select('*', { count: 'exact', head: true });
  return count ?? 0;
}

async function main() {
  console.log('wiping transactional + non-seed data...');

  // Transactional
  await sb.from('resolution_actions').delete().gte('created_at', '1970-01-01');
  await sb.from('exceptions').delete().gte('opened_at', '1970-01-01');
  await sb.from('match_results').delete().gte('created_at', '1970-01-01');
  await sb.from('matching_cycles').delete().gte('started_at', '1970-01-01');
  await sb.from('audit_events').delete().gte('created_at', '1970-01-01');
  await sb.from('ai_calls').delete().gte('created_at', '1970-01-01');
  await sb.from('eval_runs').delete().gte('created_at', '1970-01-01');

  // Non-seed feed profiles + their trades + mappings
  const { data: keptFeeds } = await sb.from('feed_profiles').select('id').in('name', SEED_FEED_NAMES);
  const keepIds = new Set((keptFeeds ?? []).map((f) => f.id));
  const { data: allFeeds } = await sb.from('feed_profiles').select('id, name');
  const dropIds = (allFeeds ?? []).filter((f) => !keepIds.has(f.id)).map((f) => f.id);
  if (dropIds.length > 0) {
    console.log(`  dropping ${dropIds.length} non-seed feed profiles...`);
    await sb.from('trades_canonical').delete().in('source_id', dropIds);
    await sb.from('trades_raw').delete().in('feed_profile_id', dropIds);
    await sb.from('field_mappings').delete().in('feed_profile_id', dropIds);
    await sb.from('feed_profiles').delete().in('id', dropIds);
  }

  console.log('\n✓ wiped. remaining counts:');
  for (const t of [
    'matching_cycles', 'match_results', 'exceptions', 'resolution_actions',
    'audit_events', 'ai_calls', 'eval_runs', 'feed_profiles', 'trades_canonical'
  ]) {
    console.log(`  ${t.padEnd(22)} ${await count(t)}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
