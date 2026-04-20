/* eslint-disable no-console */
import { createClient } from '@supabase/supabase-js';
import { embedBatch } from '../lib/ai/openai';

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false, autoRefreshToken: false }
});

interface Row {
  trade_id: string;
  counterparty: string;
}

async function main() {
  console.log('fetching trades_canonical without embeddings...');
  const { data: trades, error } = await sb
    .from('trades_canonical')
    .select('trade_id, counterparty')
    .is('counterparty_embedding', null);
  if (error) throw error;
  if (!trades || trades.length === 0) {
    console.log('all embeddings already populated.');
    return;
  }
  console.log(`  found ${trades.length} trades to embed`);

  // Build unique counterparty strings -> pick ONE trade per string (saves API calls + updates all)
  const uniqueCp = new Map<string, string[]>();
  for (const t of trades as Row[]) {
    const list = uniqueCp.get(t.counterparty) ?? [];
    list.push(t.trade_id);
    uniqueCp.set(t.counterparty, list);
  }
  console.log(`  ${uniqueCp.size} unique counterparty strings to embed (saves ${trades.length - uniqueCp.size} API calls)`);

  const names = Array.from(uniqueCp.keys());

  // OpenAI embed API accepts up to 2048 inputs per request, but keep batches small
  const BATCH = 50;
  let done = 0;
  for (let i = 0; i < names.length; i += BATCH) {
    const slice = names.slice(i, i + BATCH);
    const vecs = await embedBatch(slice, null);
    // Apply each vector to all trades with that counterparty
    for (let j = 0; j < slice.length; j++) {
      const name = slice[j]!;
      const vec = vecs[j];
      if (!vec || vec.length === 0) continue;
      const ids = uniqueCp.get(name) ?? [];
      const { error: updErr } = await sb
        .from('trades_canonical')
        .update({ counterparty_embedding: `[${vec.join(',')}]` })
        .in('trade_id', ids);
      if (updErr) {
        console.error(`  update failed for ${name}:`, updErr.message);
      }
    }
    done += slice.length;
    console.log(`  embedded ${done}/${names.length} unique counterparties`);
  }
  console.log('\n✓ embedding backfill complete');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
