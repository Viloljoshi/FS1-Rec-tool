/* eslint-disable no-console */
import { writeFileSync, readFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { SECURITIES, BROKERS, ACCOUNTS, TRADING_DATES, settlementDate } from './constants';

// Deterministic PRNG (mulberry32) for reproducible seeds
function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = mulberry32(42);
const randInt = (min: number, max: number) => Math.floor(rand() * (max - min + 1)) + min;
const pick = <T>(arr: T[]): T => arr[Math.floor(rand() * arr.length)]!;

interface PriceRow { symbol: string; date: string; close: number }

function loadPrices(): Map<string, number> {
  const map = new Map<string, number>();
  const file = path.join(process.cwd(), 'data', 'seed', 'prices.json');
  if (existsSync(file)) {
    const rows: PriceRow[] = JSON.parse(readFileSync(file, 'utf8'));
    for (const r of rows) map.set(`${r.symbol}|${r.date}`, r.close);
  }
  for (const sec of SECURITIES) {
    for (const date of TRADING_DATES) {
      const key = `${sec.symbol}|${date}`;
      if (!map.has(key)) {
        const drift = (rand() - 0.5) * 0.02;
        map.set(key, +(sec.baseline_close * (1 + drift)).toFixed(4));
      }
    }
  }
  return map;
}

interface Internal {
  internal_id: string;
  trade_date: string;
  settlement_date: string;
  direction: 'BUY' | 'SELL';
  symbol: string;
  isin: string;
  cusip: string;
  quantity: number;
  price: number;
  currency: 'USD';
  counterparty_canonical: string;
  counterparty_alias_used: string;
  account: string;
}

function generateInternal(prices: Map<string, number>, n = 1000): Internal[] {
  const trades: Internal[] = [];
  const perBroker = Math.floor(n / BROKERS.length);
  let idSeq = 1;

  for (const broker of BROKERS) {
    for (let i = 0; i < perBroker; i++) {
      const sec = pick(SECURITIES);
      const date = pick(TRADING_DATES);
      const priceBase = prices.get(`${sec.symbol}|${date}`) ?? sec.baseline_close;
      const price = +(priceBase * (1 + (rand() - 0.5) * 0.005)).toFixed(4);
      const qty = pick([100, 200, 300, 500, 750, 1000, 1500, 2500, 5000]);
      trades.push({
        internal_id: `INT-${String(idSeq++).padStart(6, '0')}`,
        trade_date: date,
        settlement_date: settlementDate(date),
        direction: rand() > 0.5 ? 'BUY' : 'SELL',
        symbol: sec.symbol,
        isin: sec.isin,
        cusip: sec.cusip,
        quantity: qty,
        price,
        currency: 'USD',
        counterparty_canonical: broker.canonical,
        counterparty_alias_used: broker.canonical,
        account: pick(ACCOUNTS)
      });
    }
  }
  return trades;
}

// ---------- Broker A format: MM/DD/YYYY, B/S, rounded 2dp ----------
interface BrokerARow {
  trd_id: string;
  trade_dt: string;
  sttl_dt: string;
  bs: 'B' | 'S';
  tkr: string;
  isin: string;
  qty: number;
  px: number;
  ccy: string;
  cpty: string;
  acct: string;
}

function toBrokerA(
  internal: Internal[],
  broker = BROKERS[0]!
): Array<BrokerARow & { _internal_ref: string; _drift: string }> {
  const mine = internal.filter((t) => t.counterparty_canonical === broker.canonical);
  const rows: Array<BrokerARow & { _internal_ref: string; _drift: string }> = [];
  let idSeq = 1001;
  for (const t of mine) {
    const aliasIdx = Math.floor(rand() * broker.aliases.length);
    rows.push({
      trd_id: `BRKA-${idSeq++}`,
      trade_dt: toUSDate(t.trade_date),
      sttl_dt: toUSDate(t.settlement_date),
      bs: t.direction === 'BUY' ? 'B' : 'S',
      tkr: t.symbol,
      isin: t.isin,
      qty: t.quantity,
      px: +t.price.toFixed(2),
      ccy: t.currency,
      cpty: broker.aliases[aliasIdx]!,
      acct: t.account.replace('ACCT-', 'A'),
      _internal_ref: t.internal_id,
      _drift: 'CLEAN'
    });
  }
  // inject 3 duplicates — tagged so the gold set can exercise DUPLICATE class
  for (let i = 0; i < 3 && rows.length > 0; i++) {
    const sourceRow = rows[randInt(0, rows.length - 1)]!;
    rows.push({ ...sourceRow, trd_id: `BRKA-${idSeq++}`, _drift: 'DUPLICATE' });
  }
  return rows;
}

// ---------- Broker B format: YYYY-MM-DD, Buy/Sell, full precision, with breaks ----------
interface BrokerBRow {
  ExternalTradeRef: string;
  TradeDate: string;
  SettleDate: string;
  Side: 'Buy' | 'Sell';
  Ticker: string;
  CUSIP: string;
  Quantity: number;
  Price: number;
  Currency: string;
  Counterparty: string;
  ClientAccount: string;
  _internal_ref: string;
  _drift: string;
}

function toBrokerB(internal: Internal[], broker = BROKERS[1]!): BrokerBRow[] {
  const mine = internal.filter((t) => t.counterparty_canonical === broker.canonical);
  const rows: BrokerBRow[] = [];
  let idSeq = 77001;

  for (const [i, t] of mine.entries()) {
    const driftBucket = i % 20;
    let qty = t.quantity;
    let price = +t.price.toFixed(4);
    let tradeDate = t.trade_date;
    let cpty = broker.aliases[randInt(0, broker.aliases.length - 1)]!;
    let acct = t.account;
    let drift = 'CLEAN';

    if (driftBucket === 0) {
      qty = qty + (qty > 500 ? 100 : 10);
      drift = 'WRONG_QTY';
    } else if (driftBucket === 1) {
      cpty = 'JPMorgun Sec LLC';
      drift = 'CPY_TYPO';
    } else if (driftBucket === 2) {
      const d = new Date(t.trade_date);
      d.setUTCDate(d.getUTCDate() + 1);
      tradeDate = d.toISOString().slice(0, 10);
      drift = 'DATE_DRIFT';
    } else if (driftBucket === 3) {
      price = +(price * 1.015).toFixed(4);
      drift = 'PRICE_BREAK_MATERIAL';
    } else if (driftBucket === 4) {
      acct = acct.replace('ACCT-', 'CLIENT_');
      drift = 'ACCT_FORMAT_DRIFT';
    } else if (driftBucket === 5) {
      cpty = 'JPMCB';
      drift = 'CPY_SHORT_ALIAS';
    } else if (driftBucket === 6) {
      price = +(price + 0.003).toFixed(4);
      drift = 'PRICE_DRIFT_ROUNDING';
    }

    rows.push({
      ExternalTradeRef: `BRKB-${idSeq++}`,
      TradeDate: tradeDate,
      SettleDate: settlementDate(tradeDate),
      Side: t.direction === 'BUY' ? 'Buy' : 'Sell',
      Ticker: t.symbol,
      CUSIP: t.cusip,
      Quantity: qty,
      Price: price,
      Currency: t.currency,
      Counterparty: cpty,
      ClientAccount: acct,
      _internal_ref: t.internal_id,
      _drift: drift
    });
  }

  return rows;
}

// ---------- Custodian format: UPPERCASE, settle-date only ----------
interface CustodianRow {
  STATEMENT_ID: string;
  SETTLE_DT: string;
  BUY_SELL: 'BUY' | 'SELL';
  SEC_SYMBOL: string;
  QUANTITY: number;
  UNIT_PRICE: number;
  CCY: string;
  EXECUTING_BROKER: string;
  CUSTODIAN_ACCT: string;
  _internal_ref: string;
}

function toCustodian(internal: Internal[]): CustodianRow[] {
  // 60% sample; drop 10 trades to create MISSING_ONE_SIDE exceptions
  const sample = internal.filter(() => rand() < 0.6);
  const dropped = new Set<string>();
  while (dropped.size < 10 && dropped.size < sample.length) {
    dropped.add(sample[randInt(0, sample.length - 1)]!.internal_id);
  }
  const kept = sample.filter((t) => !dropped.has(t.internal_id));
  const rows: CustodianRow[] = [];
  let idSeq = 1;
  for (const t of kept) {
    const cptyCanonical = BROKERS.find((b) => b.canonical === t.counterparty_canonical)!;
    rows.push({
      STATEMENT_ID: `CUST-${t.settlement_date.replace(/-/g, '')}-${String(idSeq++).padStart(4, '0')}`,
      SETTLE_DT: t.settlement_date,
      BUY_SELL: t.direction,
      SEC_SYMBOL: t.symbol,
      QUANTITY: t.quantity,
      UNIT_PRICE: +t.price.toFixed(4),
      CCY: t.currency,
      EXECUTING_BROKER: cptyCanonical.canonical.toUpperCase(),
      CUSTODIAN_ACCT: t.account.replace('ACCT-', '') + '-CUST',
      _internal_ref: t.internal_id
    });
  }
  return rows;
}

// ---------- Gold eval pairs ----------
interface GoldPair {
  pair_id: string;
  trade_a: string;
  trade_b: string;
  label: 'MATCH' | 'NO_MATCH' | 'AMBIGUOUS';
  exception_class: string;
  reason: string;
  curator: string;
  curated_at: string;
  /** Which Party-B feed this pair references. Lets the eval harness slice
   *  precision/recall per feed, not just overall. */
  source_feed: 'broker-a' | 'broker-b' | 'custodian';
  /** Asset class of the underlying trade — today always EQUITY, but the
   *  field is present so future FX / FI gold pairs can coexist without
   *  schema migrations. */
  asset_class: 'EQUITY' | 'FX' | 'FI' | 'FUTURE';
}

/**
 * Holistic gold generator. Pulls representative pairs from all three
 * Party-B feeds (broker-a, broker-b, custodian) plus manufactured
 * unmatched cases, so the eval harness measures precision/recall per
 * feed and per exception class — not just "broker-b with 5 drift types."
 *
 * Output composition (~60 pairs):
 *   - 12 broker-a MATCH (clean format drift)
 *   - 3  broker-a DUPLICATE (same natural key)
 *   - 10 broker-b MATCH (clean format drift)
 *   - 10 broker-b AMBIGUOUS (5 drift types × 2 pairs)
 *   - 5  broker-b NO_MATCH — WRONG_QTY
 *   - 5  broker-b NO_MATCH — ID_MISMATCH (unrelated pairing)
 *   - 10 custodian MATCH (clean)
 *   - 5  custodian NO_MATCH — MISSING_ONE_SIDE (internal trade with no custodian row)
 */
function generateGold(
  internal: Internal[],
  brokerA: Array<BrokerARow & { _internal_ref: string; _drift: string }>,
  brokerB: BrokerBRow[],
  custodian: CustodianRow[]
): GoldPair[] {
  const pairs: GoldPair[] = [];
  const today = new Date().toISOString().slice(0, 10);
  let seq = 1;

  const push = (
    trade_a: string,
    trade_b: string,
    label: GoldPair['label'],
    exception_class: string,
    reason: string,
    source_feed: GoldPair['source_feed']
  ): void => {
    pairs.push({
      pair_id: `G${String(seq++).padStart(3, '0')}`,
      trade_a,
      trade_b,
      label,
      exception_class,
      reason,
      curator: 'product',
      curated_at: today,
      source_feed,
      asset_class: 'EQUITY'
    });
  };

  // ── broker-a: 12 clean MATCH + 3 DUPLICATE ─────────────────────────────
  const brokerAClean = brokerA.filter((r) => r._drift === 'CLEAN').slice(0, 12);
  for (const row of brokerAClean) {
    push(
      row._internal_ref,
      row.trd_id,
      'MATCH',
      'FORMAT_DRIFT',
      'Clean broker-a fill — same trade, US date format and short side code.',
      'broker-a'
    );
  }
  const brokerADupes = brokerA.filter((r) => r._drift === 'DUPLICATE');
  for (const row of brokerADupes) {
    push(
      row._internal_ref,
      row.trd_id,
      'NO_MATCH',
      'DUPLICATE',
      'Broker-a resent the same fill under a new external ID — double-booking risk.',
      'broker-a'
    );
  }

  // ── broker-b: 10 MATCH + 10 AMBIGUOUS + 10 NO_MATCH ────────────────────
  const brokerBClean = brokerB.filter((r) => r._drift === 'CLEAN').slice(0, 10);
  for (const row of brokerBClean) {
    push(
      row._internal_ref,
      row.ExternalTradeRef,
      'MATCH',
      'FORMAT_DRIFT',
      'Clean pair differs only in format conventions (date, side code, precision).',
      'broker-b'
    );
  }
  const drifts: Array<[string, string, string]> = [
    ['CPY_TYPO', 'CPY_ALIAS', 'Counterparty name is a likely typo of a known alias.'],
    ['CPY_SHORT_ALIAS', 'CPY_ALIAS', 'Very short or internal-code alias of the canonical name.'],
    ['DATE_DRIFT', 'TIMING', 'Trade date differs by one business day.'],
    ['PRICE_BREAK_MATERIAL', 'WRONG_PRICE', 'Price disagreement beyond rounding tolerance — material money break.'],
    ['PRICE_DRIFT_ROUNDING', 'ROUNDING', 'Sub-cent price drift from rounding/precision mismatch — safe to accept.'],
    ['ACCT_FORMAT_DRIFT', 'FORMAT_DRIFT', 'Account identifier uses different prefix convention.']
  ];
  for (const [driftTag, exClass, reason] of drifts) {
    const rows = brokerB.filter((r) => r._drift === driftTag).slice(0, 2);
    for (const row of rows) {
      push(row._internal_ref, row.ExternalTradeRef, 'AMBIGUOUS', exClass, reason, 'broker-b');
    }
  }
  const wrongQty = brokerB.filter((r) => r._drift === 'WRONG_QTY').slice(0, 5);
  for (const row of wrongQty) {
    push(
      row._internal_ref,
      row.ExternalTradeRef,
      'NO_MATCH',
      'WRONG_QTY',
      'Quantity differs beyond tolerance — genuine break.',
      'broker-b'
    );
  }
  for (let i = 0; i < 5 && brokerB.length > 10; i++) {
    const unrelated = internal.filter((t) => t.counterparty_canonical !== BROKERS[1]!.canonical);
    const intTrade = unrelated[randInt(0, unrelated.length - 1)]!;
    const bRow = brokerB[randInt(0, brokerB.length - 1)]!;
    push(
      intTrade.internal_id,
      bRow.ExternalTradeRef,
      'NO_MATCH',
      'ID_MISMATCH',
      'Unrelated trades — different counterparty and no natural key overlap.',
      'broker-b'
    );
  }

  // ── custodian: 10 MATCH + 5 NO_MATCH (missing custodian row) ───────────
  const custodianSample = custodian.slice(0, 10);
  for (const row of custodianSample) {
    push(
      row._internal_ref,
      row.STATEMENT_ID,
      'MATCH',
      'FORMAT_DRIFT',
      'Custodian statement entry aligned with internal trade; only identifier format differs.',
      'custodian'
    );
  }
  // Five internal trades that have no custodian entry (MISSING_ONE_SIDE).
  // We pair them against a sentinel string so the engine will score the
  // pair as unmatched-on-B and the gold harness can verify the UNMATCHED path.
  const custodianRefs = new Set(custodian.map((r) => r._internal_ref));
  const missing = internal.filter((t) => !custodianRefs.has(t.internal_id)).slice(0, 5);
  for (const t of missing) {
    push(
      t.internal_id,
      '__NO_COUNTERPART__',
      'NO_MATCH',
      'MISSING_ONE_SIDE',
      'Internal trade never landed in the custodian feed — classic missed allocation.',
      'custodian'
    );
  }

  return pairs;
}

// ---------- Helpers ----------
function toUSDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${m}/${d}/${y}`;
}

function toCSV<T extends Record<string, unknown>>(rows: T[], headers: (keyof T)[]): string {
  const head = headers.join(',');
  const lines = rows.map((r) =>
    headers
      .map((h) => {
        const v = r[h];
        if (v === null || v === undefined) return '';
        const s = String(v);
        return s.includes(',') || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s;
      })
      .join(',')
  );
  return [head, ...lines].join('\n');
}

// ---------- Main ----------
function main() {
  console.log('loading prices...');
  const prices = loadPrices();

  console.log('generating internal blotter (1000 trades)...');
  const internal = generateInternal(prices, 1000);

  console.log('generating Broker A feed (Goldman)...');
  const brokerA = toBrokerA(internal);

  console.log('generating Broker B feed (JPM) with breaks...');
  const brokerB = toBrokerB(internal);

  console.log('generating Custodian feed...');
  const custodian = toCustodian(internal);

  console.log('generating gold eval set...');
  const gold = generateGold(internal, brokerA, brokerB, custodian);

  const outDir = path.join(process.cwd(), 'data', 'seed');
  const evalDir = path.join(process.cwd(), 'data', 'eval');
  mkdirSync(outDir, { recursive: true });
  mkdirSync(evalDir, { recursive: true });

  writeFileSync(path.join(outDir, 'internal.json'), JSON.stringify(internal, null, 2));

  writeFileSync(
    path.join(outDir, 'broker-a.csv'),
    toCSV(brokerA as unknown as Array<Record<string, unknown>>, [
      'trd_id',
      'trade_dt',
      'sttl_dt',
      'bs',
      'tkr',
      'isin',
      'qty',
      'px',
      'ccy',
      'cpty',
      'acct'
    ])
  );

  const brokerBPublic = brokerB.map((r) => {
    const clone = { ...r } as Record<string, unknown>;
    delete clone._internal_ref;
    delete clone._drift;
    return clone;
  });
  writeFileSync(
    path.join(outDir, 'broker-b.csv'),
    toCSV(brokerBPublic as Array<Record<string, unknown>>, [
      'ExternalTradeRef',
      'TradeDate',
      'SettleDate',
      'Side',
      'Ticker',
      'CUSIP',
      'Quantity',
      'Price',
      'Currency',
      'Counterparty',
      'ClientAccount'
    ])
  );

  const custodianPublic = custodian.map((r) => {
    const clone = { ...r } as Record<string, unknown>;
    delete clone._internal_ref;
    return clone;
  });
  writeFileSync(
    path.join(outDir, 'custodian.csv'),
    toCSV(custodianPublic as Array<Record<string, unknown>>, [
      'STATEMENT_ID',
      'SETTLE_DT',
      'BUY_SELL',
      'SEC_SYMBOL',
      'QUANTITY',
      'UNIT_PRICE',
      'CCY',
      'EXECUTING_BROKER',
      'CUSTODIAN_ACCT'
    ])
  );

  writeFileSync(
    path.join(evalDir, 'gold.jsonl'),
    gold.map((g) => JSON.stringify(g)).join('\n')
  );

  // Companion metadata with internal↔broker-b drift annotations for seed-supabase
  writeFileSync(path.join(outDir, 'broker-b.meta.json'), JSON.stringify(brokerB, null, 2));
  writeFileSync(
    path.join(outDir, 'custodian.meta.json'),
    JSON.stringify(custodian, null, 2)
  );

  console.log(
    `\nwrote: internal.json (${internal.length}), broker-a.csv (${brokerA.length}), broker-b.csv (${brokerB.length}), custodian.csv (${custodian.length}), gold.jsonl (${gold.length})`
  );
}

main();
