/* eslint-disable no-console */
/**
 * Runtime determinism check.
 *
 * Pulls a real feed-pair from the live DB, then runs the matching engine
 * twice with byte-identical inputs. Diffs the two EngineOutputs (matches,
 * field scores, unmatched lists) hash-for-hash. Exits non-zero if any
 * divergence is found — that means our sort+ORDER BY work isn't tight
 * enough and something upstream is still leaking non-determinism.
 */
import { createClient } from '@supabase/supabase-js';
import { createHash } from 'crypto';
import { runEngine } from '../lib/matching/engine';
import { DEFAULT_WEIGHTS } from '../lib/matching/fellegi_sunter';
import type { RawCanonicalTrade } from '../lib/matching/normalize';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
if (!url || !key) { console.error('Missing Supabase env vars'); process.exit(1); }

const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

async function fetchTrades(feedId: string, version: number): Promise<RawCanonicalTrade[]> {
  const { data, error } = await sb
    .from('trades_canonical')
    .select('trade_id, source_id, source_ref, trade_date, settlement_date, direction, symbol, isin, cusip, quantity, price, currency, counterparty, counterparty_canonical_id, account')
    .eq('source_id', feedId)
    .eq('source_version', version)
    .order('trade_id', { ascending: true })
    .limit(5000);
  if (error) throw error;
  return (data ?? []) as RawCanonicalTrade[];
}

function hashMatches(output: ReturnType<typeof runEngine>): string {
  const canonical = output.matches.map((m) => ({
    a: m.trade_a_id,
    b: m.trade_b_id,
    band: m.explanation.band,
    p: Number(m.explanation.posterior).toFixed(6),
    type: m.explanation.match_type,
    det: m.explanation.deterministic_hit,
    fs: [...m.explanation.field_scores]
      .sort((x, y) => x.field.localeCompare(y.field))
      .map((f) => `${f.field}:${Number(f.raw_score).toFixed(4)}`)
      .join('|')
  }));
  canonical.sort((x, y) => (x.a + '|' + x.b).localeCompare(y.a + '|' + y.b));
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

function hashUnmatched(ids: string[]): string {
  return createHash('sha256').update([...ids].sort().join(',')).digest('hex');
}

async function main(): Promise<void> {
  const pairs: Array<[string, string]> = [
    ['Internal Blotter', 'Broker B — J.P. Morgan'],
    ['Internal Blotter', 'Broker A — Goldman'],
    ['Internal Blotter', '01-jane-street-mixed-formats'],
    ['Internal Blotter', '03-broken-data']
  ];

  let pass = 0;
  let fail = 0;

  for (const [aName, bName] of pairs) {
    const { data: a } = await sb.from('feed_profiles').select('id, version').eq('name', aName).order('version', { ascending: false }).limit(1).maybeSingle();
    const { data: b } = await sb.from('feed_profiles').select('id, version').eq('name', bName).order('version', { ascending: false }).limit(1).maybeSingle();
    if (!a || !b) { console.log(`[SKIP] ${aName} × ${bName} — missing feed`); continue; }

    const [sideA1, sideB1] = await Promise.all([fetchTrades(a.id, a.version), fetchTrades(b.id, b.version)]);
    const [sideA2, sideB2] = await Promise.all([fetchTrades(a.id, a.version), fetchTrades(b.id, b.version)]);

    const out1 = runEngine({ side_a: sideA1, side_b: sideB1, weights: DEFAULT_WEIGHTS });
    const out2 = runEngine({ side_a: sideA2, side_b: sideB2, weights: DEFAULT_WEIGHTS });

    const h1 = hashMatches(out1);
    const h2 = hashMatches(out2);
    const u1 = hashUnmatched(out1.unmatched_b);
    const u2 = hashUnmatched(out2.unmatched_b);

    const matchesIdentical = h1 === h2;
    const unmatchedIdentical = u1 === u2;
    const countsIdentical =
      out1.matches.length === out2.matches.length &&
      out1.unmatched_a.length === out2.unmatched_a.length &&
      out1.unmatched_b.length === out2.unmatched_b.length;

    const label = matchesIdentical && unmatchedIdentical && countsIdentical ? 'PASS' : 'FAIL';
    if (label === 'PASS') pass++; else fail++;

    console.log(`[${label}] ${aName} × ${bName}`);
    console.log(`       matches=${out1.matches.length} unmatched_a=${out1.unmatched_a.length} unmatched_b=${out1.unmatched_b.length}`);
    console.log(`       match-hash:    ${h1.slice(0, 16)}...  =  ${h2.slice(0, 16)}...  ${matchesIdentical ? '✓' : '✗'}`);
    console.log(`       unmatchedB:    ${u1.slice(0, 16)}...  =  ${u2.slice(0, 16)}...  ${unmatchedIdentical ? '✓' : '✗'}`);

    if (!matchesIdentical) {
      const by1 = new Map(out1.matches.map((m) => [`${m.trade_a_id}|${m.trade_b_id}`, m]));
      const by2 = new Map(out2.matches.map((m) => [`${m.trade_a_id}|${m.trade_b_id}`, m]));
      for (const [k, m1] of by1) {
        const m2 = by2.get(k);
        if (!m2) { console.log(`       diff: pair ${k.slice(0, 20)}... only in run1 (${m1.explanation.band})`); continue; }
        if (m1.explanation.band !== m2.explanation.band) {
          console.log(`       diff: pair ${k.slice(0, 20)}... band ${m1.explanation.band} vs ${m2.explanation.band}`);
        }
      }
    }
  }

  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`RESULT: ${pass} pass · ${fail} fail`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
