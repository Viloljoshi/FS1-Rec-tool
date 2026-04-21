/* eslint-disable no-console */
import { createClient } from '@supabase/supabase-js';
import { runMatchingCycle } from '../lib/matching/run-cycle';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const sb = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false }
});

interface Args {
  pipeline: string;
  feedAName?: string;
  feedBName?: string;
  dateFrom?: string;
  dateTo?: string;
}

async function runFor({ pipeline: pipelineName, feedAName = 'Internal Blotter', feedBName = 'Broker B — J.P. Morgan', dateFrom = '2026-04-01', dateTo = '2026-04-30' }: Args): Promise<void> {
  const { data: p } = await sb.from('pipelines').select('id, asset_class').eq('name', pipelineName).maybeSingle();
  if (!p) {
    console.log(`pipeline ${pipelineName} not found, skipping`);
    return;
  }

  const { data: feeds } = await sb
    .from('feed_profiles')
    .select('id, name, version')
    .in('name', [feedAName, feedBName]);
  const a = feeds?.find((f) => f.name === feedAName);
  const b = feeds?.find((f) => f.name === feedBName);
  if (!a || !b) {
    console.log(`feeds not found: ${feedAName}, ${feedBName}`);
    return;
  }

  const { data: manager } = await sb.from('profiles').select('id').eq('email', 'manager@demo.co').maybeSingle();

  const r = await runMatchingCycle({
    supabase: sb,
    feedAId: a.id,
    feedAVersion: a.version,
    feedBId: b.id,
    feedBVersion: b.version,
    dateFrom,
    dateTo,
    initiatedBy: manager?.id ?? null,
    restrictByCounterpartyEntity: false,
    pipelineId: p.id
  });
  console.log(
    `[${pipelineName}] cycle=${r.cycle_id.slice(0, 8)} matches=${r.match_count} exceptions=${r.exception_count} counts=${JSON.stringify(r.counts)}`
  );
}

async function main(): Promise<void> {
  const mode = process.argv[2] ?? 'equities';
  if (mode === 'fi' || mode === 'FI' || mode === 'Fixed Income') {
    await runFor({
      pipeline: 'Fixed Income',
      feedAName: 'FI Internal Blotter',
      feedBName: 'FI Broker — Citi Bonds',
      dateFrom: '2026-04-14',
      dateTo: '2026-04-14'
    });
  } else if (mode === 'equities' || mode === 'Equities') {
    await runFor({ pipeline: 'Equities' });
  } else {
    await runFor({ pipeline: mode });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
