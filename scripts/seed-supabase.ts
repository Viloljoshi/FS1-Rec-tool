/* eslint-disable no-console */
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import Papa from 'papaparse';
import { BROKERS, SECURITIES } from './constants';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
if (!url || !serviceKey) {
  console.error('Missing Supabase env vars');
  process.exit(1);
}
const sb = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false }
});

const DEMO_USERS = [
  { email: 'analyst@demo.co', password: 'ReconAI-Demo-2026!', role: 'analyst' as const, display_name: 'Alex Analyst' },
  { email: 'manager@demo.co', password: 'ReconAI-Demo-2026!', role: 'manager' as const, display_name: 'Morgan Manager' },
  { email: 'auditor@demo.co', password: 'ReconAI-Demo-2026!', role: 'auditor' as const, display_name: 'Aubrey Auditor' }
];

async function seedUsers(): Promise<Map<string, string>> {
  console.log('seeding demo users...');
  const emailToId = new Map<string, string>();

  const { data: list } = await sb.auth.admin.listUsers({ perPage: 200 });
  const existing = new Map<string, string>();
  for (const u of list?.users ?? []) {
    if (u.email) existing.set(u.email, u.id);
  }

  for (const u of DEMO_USERS) {
    let id = existing.get(u.email);
    if (!id) {
      const { data, error } = await sb.auth.admin.createUser({
        email: u.email,
        password: u.password,
        email_confirm: true,
        user_metadata: { display_name: u.display_name }
      });
      if (error) throw error;
      id = data.user!.id;
      console.log(`  created ${u.email} (${id})`);
    } else {
      console.log(`  exists  ${u.email} (${id})`);
    }
    await sb.from('profiles').upsert({
      id,
      email: u.email,
      role: u.role,
      display_name: u.display_name
    });
    emailToId.set(u.email, id);
  }
  return emailToId;
}

async function seedFeedProfiles(createdBy: string): Promise<Record<string, string>> {
  console.log('seeding feed profiles...');
  const feeds: Array<{ name: string; kind: 'INTERNAL' | 'BROKER' | 'CUSTODIAN'; notes: string }> = [
    { name: 'Internal Blotter',     kind: 'INTERNAL',  notes: 'Internal trading system source-of-truth blotter.' },
    { name: 'Broker A — Goldman',   kind: 'BROKER',    notes: 'Format: MM/DD/YYYY, B/S, rounded 2dp.' },
    { name: 'Broker B — J.P. Morgan', kind: 'BROKER',  notes: 'Format: YYYY-MM-DD, Buy/Sell, full precision.' },
    { name: 'Custodian',            kind: 'CUSTODIAN', notes: 'Settlement view; UPPERCASE fields, settle-date only.' }
  ];
  const ids: Record<string, string> = {};
  for (const f of feeds) {
    const { data: existing } = await sb
      .from('feed_profiles')
      .select('id')
      .eq('name', f.name)
      .maybeSingle();
    if (existing) {
      ids[f.name] = existing.id;
      console.log(`  exists ${f.name} (${existing.id})`);
      continue;
    }
    const { data, error } = await sb
      .from('feed_profiles')
      .insert({ name: f.name, kind: f.kind, version: 1, notes: f.notes, created_by: createdBy })
      .select('id')
      .single();
    if (error) throw error;
    ids[f.name] = data.id;
    console.log(`  created ${f.name} (${data.id})`);
  }
  return ids;
}

async function seedFieldMappings(feedIds: Record<string, string>, confirmedBy: string) {
  console.log('seeding field mappings...');
  const mapSpec: Record<string, Array<[string, string, number, string]>> = {
    'Internal Blotter': [
      ['internal_id', 'source_ref', 1.0, 'internal source-of-truth identifier'],
      ['trade_date', 'trade_date', 1.0, 'direct match'],
      ['settlement_date', 'settlement_date', 1.0, 'direct match'],
      ['direction', 'direction', 1.0, 'direct match'],
      ['symbol', 'symbol', 1.0, 'direct match'],
      ['isin', 'isin', 1.0, 'direct match'],
      ['cusip', 'cusip', 1.0, 'direct match'],
      ['quantity', 'quantity', 1.0, 'direct match'],
      ['price', 'price', 1.0, 'direct match'],
      ['currency', 'currency', 1.0, 'direct match'],
      ['counterparty_canonical', 'counterparty', 1.0, 'direct match'],
      ['account', 'account', 1.0, 'direct match']
    ],
    'Broker A — Goldman': [
      ['trd_id', 'source_ref', 0.99, 'broker trade identifier'],
      ['trade_dt', 'trade_date', 0.98, 'US MM/DD/YYYY date format'],
      ['sttl_dt', 'settlement_date', 0.98, 'US MM/DD/YYYY settlement date'],
      ['bs', 'direction', 0.95, 'B/S → BUY/SELL mapping'],
      ['tkr', 'symbol', 0.99, 'ticker'],
      ['isin', 'isin', 1.0, 'identifier'],
      ['qty', 'quantity', 1.0, 'units'],
      ['px', 'price', 0.97, 'price rounded to 2dp'],
      ['ccy', 'currency', 1.0, 'ISO 4217'],
      ['cpty', 'counterparty', 0.92, 'abbreviated counterparty name'],
      ['acct', 'account', 0.88, 'account with prefix stripped']
    ],
    'Broker B — J.P. Morgan': [
      ['ExternalTradeRef', 'source_ref', 0.99, 'broker external reference'],
      ['TradeDate', 'trade_date', 1.0, 'ISO 8601 date'],
      ['SettleDate', 'settlement_date', 1.0, 'ISO 8601 settlement'],
      ['Side', 'direction', 0.96, 'Buy/Sell → BUY/SELL'],
      ['Ticker', 'symbol', 0.99, 'ticker'],
      ['CUSIP', 'cusip', 1.0, 'identifier'],
      ['Quantity', 'quantity', 1.0, 'units'],
      ['Price', 'price', 0.99, 'full precision'],
      ['Currency', 'currency', 1.0, 'ISO 4217'],
      ['Counterparty', 'counterparty', 0.88, 'varied abbreviations'],
      ['ClientAccount', 'account', 0.95, 'client account identifier']
    ],
    Custodian: [
      ['STATEMENT_ID', 'source_ref', 0.99, 'custodian statement identifier'],
      ['SETTLE_DT', 'settlement_date', 1.0, 'settlement date'],
      ['BUY_SELL', 'direction', 0.97, 'BUY/SELL direct'],
      ['SEC_SYMBOL', 'symbol', 0.99, 'ticker'],
      ['QUANTITY', 'quantity', 1.0, 'units'],
      ['UNIT_PRICE', 'price', 0.99, 'per-unit price'],
      ['CCY', 'currency', 1.0, 'ISO 4217'],
      ['EXECUTING_BROKER', 'counterparty', 0.90, 'uppercase executing broker name'],
      ['CUSTODIAN_ACCT', 'account', 0.85, 'custody-formatted account']
    ]
  };

  for (const [feedName, mappings] of Object.entries(mapSpec)) {
    const profileId = feedIds[feedName];
    if (!profileId) continue;
    const { count: existingCount } = await sb
      .from('field_mappings')
      .select('*', { count: 'exact', head: true })
      .eq('feed_profile_id', profileId);
    if ((existingCount ?? 0) > 0) {
      console.log(`  ${feedName}: ${existingCount} mappings exist, skipping`);
      continue;
    }
    const rows = mappings.map(([source_field, canonical_field, confidence, reasoning]) => ({
      feed_profile_id: profileId,
      feed_profile_version: 1,
      source_field,
      canonical_field: canonical_field as never,
      confidence,
      ai_reasoning: reasoning,
      confirmed_by: confirmedBy
    }));
    const { error } = await sb.from('field_mappings').insert(rows);
    if (error) throw error;
    console.log(`  ${feedName}: ${rows.length} mappings`);
  }
}

async function seedCounterpartyEntities() {
  console.log('seeding counterparty entities + aliases...');
  for (const broker of BROKERS) {
    const { data: existing } = await sb
      .from('counterparty_entities')
      .select('id')
      .eq('canonical_name', broker.canonical)
      .maybeSingle();
    let entityId = existing?.id;
    if (!entityId) {
      const { data, error } = await sb
        .from('counterparty_entities')
        .insert({
          canonical_name: broker.canonical,
          sec_crd: broker.sec_crd,
          country: broker.country
        })
        .select('id')
        .single();
      if (error) throw error;
      entityId = data.id;
    }
    const aliasRows = broker.aliases.map((alias) => ({
      entity_id: entityId!,
      alias,
      normalized_alias: alias.toLowerCase().replace(/[.,&]/g, '').replace(/\s+/g, ' ').trim()
    }));
    const { error: aerr } = await sb
      .from('counterparty_aliases')
      .upsert(aliasRows, { onConflict: 'entity_id,alias' });
    if (aerr) throw aerr;
  }
  console.log(`  seeded ${BROKERS.length} entities with aliases`);
}

async function seedMatchingRules(createdBy: string) {
  console.log('seeding default matching rules v1...');
  const { data: existing } = await sb
    .from('matching_rules')
    .select('id')
    .eq('name', 'default')
    .eq('active', true)
    .maybeSingle();
  if (existing) {
    console.log('  default rules v1 exists, skipping');
    return;
  }
  const weights = {
    isin: { m: 0.99, u: 0.00001, threshold: 1.0 },
    cusip: { m: 0.99, u: 0.00001, threshold: 1.0 },
    symbol: { m: 0.99, u: 0.01, threshold: 1.0 },
    trade_date: { m: 0.95, u: 0.02, threshold: 0.66 },
    settlement_date: { m: 0.93, u: 0.02, threshold: 0.66 },
    direction: { m: 0.99, u: 0.5, threshold: 1.0 },
    quantity: { m: 0.95, u: 0.001, threshold: 0.9 },
    price: { m: 0.95, u: 0.001, threshold: 0.9 },
    currency: { m: 0.99, u: 0.3, threshold: 1.0 },
    counterparty: { m: 0.88, u: 0.02, threshold: 0.8 },
    account: { m: 0.92, u: 0.001, threshold: 0.9 }
  };
  const tolerances = {
    price_rel_tolerance: 0.01,
    quantity_rel_tolerance: 0.05,
    date_day_delta: 1
  };
  const { error } = await sb.from('matching_rules').insert({
    name: 'default',
    version: 1,
    active: true,
    weights,
    tolerances,
    created_by: createdBy
  });
  if (error) throw error;
  console.log('  default rules v1 inserted');
}

interface InternalTrade {
  internal_id: string;
  trade_date: string;
  settlement_date: string;
  direction: 'BUY' | 'SELL';
  symbol: string;
  isin: string;
  cusip: string;
  quantity: number;
  price: number;
  currency: string;
  counterparty_canonical: string;
  counterparty_alias_used: string;
  account: string;
}

async function seedTradesInternal(feedId: string, uploadedBy: string) {
  console.log('seeding internal trades...');
  const file = path.join(process.cwd(), 'data', 'seed', 'internal.json');
  const trades: InternalTrade[] = JSON.parse(readFileSync(file, 'utf8'));

  const { count } = await sb
    .from('trades_raw')
    .select('*', { count: 'exact', head: true })
    .eq('feed_profile_id', feedId);
  if ((count ?? 0) > 0) {
    console.log(`  ${count} internal trades already seeded, skipping`);
    return;
  }

  // Resolve counterparty_canonical_id per broker
  const { data: cpEntities } = await sb
    .from('counterparty_entities')
    .select('id, canonical_name');
  const cpMap = new Map((cpEntities ?? []).map((e) => [e.canonical_name, e.id]));

  // Batch inserts of 200 at a time
  for (let i = 0; i < trades.length; i += 200) {
    const slice = trades.slice(i, i + 200);

    const rawInserts = slice.map((t, idx) => ({
      feed_profile_id: feedId,
      feed_profile_version: 1,
      row_index: i + idx,
      payload: t,
      uploaded_by: uploadedBy
    }));
    const { data: rawRows, error: rawErr } = await sb
      .from('trades_raw')
      .insert(rawInserts)
      .select('id, row_index');
    if (rawErr) throw rawErr;

    const rawIdByIndex = new Map(rawRows!.map((r) => [r.row_index, r.id]));

    const canonicalInserts = slice.map((t, idx) => ({
      source_id: feedId,
      source_version: 1,
      source_ref: t.internal_id,
      trade_date: t.trade_date,
      settlement_date: t.settlement_date,
      direction: t.direction,
      symbol: t.symbol,
      isin: t.isin,
      cusip: t.cusip,
      quantity: t.quantity,
      price: t.price,
      currency: t.currency,
      counterparty: t.counterparty_canonical,
      counterparty_canonical_id: cpMap.get(t.counterparty_canonical) ?? null,
      account: t.account,
      asset_class: 'EQUITY' as const,
      lineage: {
        raw_row_id: rawIdByIndex.get(i + idx),
        profile_version: 1,
        mapping_version: 1
      }
    }));
    const { error: canErr } = await sb.from('trades_canonical').insert(canonicalInserts);
    if (canErr) throw canErr;
    console.log(`  internal canonical rows ${i + slice.length}/${trades.length}`);
  }
}

interface HeaderMap {
  source_ref: string;
  trade_date: string;
  settlement_date: string;
  direction: string;
  symbol: string;
  isin: string;
  cusip: string;
  quantity: string;
  price: string;
  currency: string;
  counterparty: string;
  account: string;
}

function getCell(row: Record<string, string>, key: string): string | undefined {
  if (!key) return undefined;
  return row[key];
}

async function seedCsvFeed(
  feedId: string,
  feedName: string,
  csvFile: string,
  metaFile: string | null,
  headerMap: HeaderMap,
  uploadedBy: string
) {
  console.log(`seeding ${feedName} from ${csvFile}...`);
  const { count } = await sb
    .from('trades_raw')
    .select('*', { count: 'exact', head: true })
    .eq('feed_profile_id', feedId);
  if ((count ?? 0) > 0) {
    console.log(`  ${count} rows exist for ${feedName}, skipping`);
    return;
  }

  const csvContent = readFileSync(path.join(process.cwd(), 'data', 'seed', csvFile), 'utf8');
  const parsed = Papa.parse<Record<string, string>>(csvContent, { header: true, skipEmptyLines: true });
  const rows = parsed.data;

  const meta: Array<Record<string, unknown>> = metaFile
    ? JSON.parse(readFileSync(path.join(process.cwd(), 'data', 'seed', metaFile), 'utf8'))
    : [];

  const { data: cpEntities } = await sb.from('counterparty_entities').select('id, canonical_name');
  const { data: aliases } = await sb.from('counterparty_aliases').select('entity_id, alias, normalized_alias');
  const cpByName = new Map((cpEntities ?? []).map((e) => [e.canonical_name.toLowerCase(), e.id]));
  const cpByAlias = new Map(
    (aliases ?? []).map((a) => [a.alias.toLowerCase(), a.entity_id])
  );
  const cpByNormAlias = new Map(
    (aliases ?? []).map((a) => [a.normalized_alias.toLowerCase(), a.entity_id])
  );

  for (let i = 0; i < rows.length; i += 200) {
    const slice = rows.slice(i, i + 200);

    const rawInserts = slice.map((r, idx) => ({
      feed_profile_id: feedId,
      feed_profile_version: 1,
      row_index: i + idx,
      payload: r,
      uploaded_by: uploadedBy
    }));
    const { data: rawRows, error: rawErr } = await sb
      .from('trades_raw')
      .insert(rawInserts)
      .select('id, row_index');
    if (rawErr) throw rawErr;
    const rawIdByIndex = new Map(rawRows!.map((r) => [r.row_index, r.id]));

    const canonicalInserts = slice.map((r, idx) => {
      const row = r as Record<string, string>;
      const source_ref = getCell(row, headerMap.source_ref) ?? '';
      const trade_date = toIso(getCell(row, headerMap.trade_date) ?? getCell(row, headerMap.settlement_date) ?? '');
      const settlement_date = toIso(getCell(row, headerMap.settlement_date) ?? '');
      const direction = mapDirection(getCell(row, headerMap.direction) ?? '');
      const cpty = getCell(row, headerMap.counterparty) ?? '';
      const cpId =
        cpByName.get(cpty.toLowerCase()) ??
        cpByAlias.get(cpty.toLowerCase()) ??
        cpByNormAlias.get(cpty.toLowerCase().replace(/[.,&]/g, '').replace(/\s+/g, ' ').trim()) ??
        null;
      const cusipCell = getCell(row, headerMap.cusip);
      const symbol = getCell(row, headerMap.symbol) ?? findSymbolByCusip(cusipCell ?? '') ?? 'UNK';
      return {
        source_id: feedId,
        source_version: 1,
        source_ref,
        trade_date,
        settlement_date,
        direction,
        symbol,
        isin: getCell(row, headerMap.isin) ?? null,
        cusip: cusipCell ?? null,
        quantity: Number(getCell(row, headerMap.quantity) ?? 0),
        price: Number(getCell(row, headerMap.price) ?? 0),
        currency: (getCell(row, headerMap.currency) ?? 'USD').toUpperCase(),
        counterparty: cpty,
        counterparty_canonical_id: cpId,
        account: getCell(row, headerMap.account) ?? '',
        asset_class: 'EQUITY' as const,
        lineage: {
          raw_row_id: rawIdByIndex.get(i + idx),
          profile_version: 1,
          mapping_version: 1
        }
      };
    });

    const { error: canErr } = await sb.from('trades_canonical').insert(canonicalInserts);
    if (canErr) throw canErr;
    console.log(`  ${feedName} canonical rows ${i + slice.length}/${rows.length}`);
  }

  void meta;
}

function toIso(input: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(input)) return input;
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(input)) {
    const [m, d, y] = input.split('/');
    return `${y}-${m}-${d}`;
  }
  if (/^\d{8}$/.test(input)) {
    return `${input.slice(0, 4)}-${input.slice(4, 6)}-${input.slice(6, 8)}`;
  }
  return new Date(input).toISOString().slice(0, 10);
}

function mapDirection(input: string): 'BUY' | 'SELL' {
  const v = input.trim().toUpperCase();
  if (['B', 'BUY'].includes(v)) return 'BUY';
  if (['S', 'SELL'].includes(v)) return 'SELL';
  throw new Error(`bad direction: ${input}`);
}

function findSymbolByCusip(cusip: string): string | null {
  const sec = SECURITIES.find((s) => s.cusip === cusip);
  return sec?.symbol ?? null;
}

async function main() {
  const users = await seedUsers();
  const analystId = users.get('analyst@demo.co')!;
  const managerId = users.get('manager@demo.co')!;

  await seedCounterpartyEntities();
  await seedMatchingRules(managerId);
  const feedIds = await seedFeedProfiles(managerId);
  await seedFieldMappings(feedIds, managerId);

  await seedTradesInternal(feedIds['Internal Blotter']!, analystId);

  await seedCsvFeed(
    feedIds['Broker A — Goldman']!,
    'Broker A',
    'broker-a.csv',
    null,
    {
      source_ref: 'trd_id',
      trade_date: 'trade_dt',
      settlement_date: 'sttl_dt',
      direction: 'bs',
      symbol: 'tkr',
      isin: 'isin',
      cusip: '',
      quantity: 'qty',
      price: 'px',
      currency: 'ccy',
      counterparty: 'cpty',
      account: 'acct'
    },
    analystId
  );

  await seedCsvFeed(
    feedIds['Broker B — J.P. Morgan']!,
    'Broker B',
    'broker-b.csv',
    'broker-b.meta.json',
    {
      source_ref: 'ExternalTradeRef',
      trade_date: 'TradeDate',
      settlement_date: 'SettleDate',
      direction: 'Side',
      symbol: 'Ticker',
      isin: '',
      cusip: 'CUSIP',
      quantity: 'Quantity',
      price: 'Price',
      currency: 'Currency',
      counterparty: 'Counterparty',
      account: 'ClientAccount'
    },
    analystId
  );

  await seedCsvFeed(
    feedIds.Custodian!,
    'Custodian',
    'custodian.csv',
    'custodian.meta.json',
    {
      source_ref: 'STATEMENT_ID',
      trade_date: 'SETTLE_DT',
      settlement_date: 'SETTLE_DT',
      direction: 'BUY_SELL',
      symbol: 'SEC_SYMBOL',
      isin: '',
      cusip: '',
      quantity: 'QUANTITY',
      price: 'UNIT_PRICE',
      currency: 'CCY',
      counterparty: 'EXECUTING_BROKER',
      account: 'CUSTODIAN_ACCT'
    },
    analystId
  );

  console.log('\n✓ Supabase seed complete.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

void existsSync;
