/* eslint-disable no-console */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

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
  account: string;
}

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

const rand = mulberry32(99);

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

function formatDDMMMYYYY(iso: string): string {
  const months = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  return `${String(d).padStart(2, '0')}-${months[m - 1]}-${y}`;
}

function formatDDMMYYYY(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

function shiftDate(iso: string, days: number): string {
  const d = new Date(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// ============================================================================
// File 1 — Morgan Stanley: ISO-15022-style settlement format
// ============================================================================
function generateMorganStanley(internal: InternalTrade[]) {
  const mine = internal.filter((t) => t.counterparty_canonical === 'Morgan Stanley & Co. LLC');
  const sample = mine.slice(0, 35);

  const rows: Array<Record<string, unknown>> = [];
  let seq = 5001;

  sample.forEach((t, i) => {
    let qty = t.quantity;
    let price = t.price;
    let date = t.trade_date;
    let cpy = 'Morgan Stanley & Co. LLC';
    let acct = t.account;
    let skip = false;

    // Injected breaks
    if (i === 2) { qty = qty + 200; }              // WRONG_QTY
    if (i === 6) { qty = Math.max(qty - 100, 50); } // WRONG_QTY
    if (i === 10) { cpy = 'MS'; }                   // CPY alias short
    if (i === 14) { cpy = 'Morgan Stanley Co'; }    // CPY missing LLC suffix
    if (i === 18) { date = shiftDate(date, 1); }    // DATE_DRIFT
    if (i === 22) { price = +(price * 1.018).toFixed(4); } // PRICE_DRIFT over 1% tolerance
    if (i === 26) { skip = true; }                  // missing from broker file

    if (skip) return;

    rows.push({
      ms_trade_id: `MS-${seq++}`,
      trade_dt: formatDDMMMYYYY(date),
      sett_dt: formatDDMMMYYYY(t.settlement_date),
      side: t.direction === 'BUY' ? 'B' : 'S',
      security: t.symbol,
      isin: t.isin,
      nominal: qty,
      execution_px: price.toFixed(4),
      ccy: t.currency,
      cpy,
      account_ref: acct.replace('ACCT-', '') // 4421 instead of ACCT-4421
    });
  });

  // Add one trade MS has that we don't (common in real recon)
  rows.push({
    ms_trade_id: `MS-${seq++}`,
    trade_dt: '08-APR-2026',
    sett_dt: '09-APR-2026',
    side: 'B',
    security: 'KO',
    isin: 'US1912161007',
    nominal: 3000,
    execution_px: '60.8200',
    ccy: 'USD',
    cpy: 'Morgan Stanley & Co. LLC',
    account_ref: '4421'
  });

  return rows;
}

// ============================================================================
// File 2 — Jefferies: FIX-style short tags, T+1 confirm timing
// ============================================================================
function generateJefferies(internal: InternalTrade[]) {
  const mine = internal.filter((t) => t.counterparty_canonical === 'Jefferies LLC');
  const sample = mine.slice(0, 30);

  const rows: Array<Record<string, unknown>> = [];
  let seq = 88001;

  sample.forEach((t, i) => {
    let qty = t.quantity;
    let price = t.price;
    let date = t.trade_date;
    let cpy = 'Jefferies LLC';
    let acct = t.account;
    let skip = false;

    if (i === 4) { qty = qty + 50; }             // WRONG_QTY
    if (i === 8) { cpy = 'Jeferies'; }           // CPY TYPO (Double Metaphone catches)
    if (i === 12) { cpy = 'JEFF LLC'; }          // CPY_ALIAS
    if (i === 16) { date = shiftDate(date, 1); }  // DATE_DRIFT (T+1 timing)
    if (i === 20) { acct = acct.replace('ACCT-', ''); } // ACCT_FORMAT
    if (i === 24) { skip = true; }               // Missing

    if (skip) return;

    rows.push({
      ClOrdID: `JEFF-${seq++}`,
      TransactTime: date.replace(/-/g, '') + '-09:30:00', // FIX-style
      SettlementDate: t.settlement_date.replace(/-/g, ''),
      Side: t.direction === 'BUY' ? '1' : '2', // FIX Side values
      Symbol: t.symbol,
      SecurityID: t.cusip,
      OrderQty: qty,
      LastPx: price.toFixed(6),
      Currency: t.currency,
      Counterparty: cpy,
      Account: acct
    });
  });

  return rows;
}

// ============================================================================
// File 3 — Barclays: UK-style DD/MM/YYYY, with duplicates
// ============================================================================
function generateBarclays(internal: InternalTrade[]) {
  const mine = internal.filter((t) => t.counterparty_canonical === 'Barclays Capital Inc.');
  const sample = mine.slice(0, 30);

  const rows: Array<Record<string, unknown>> = [];
  let seq = 2001;

  sample.forEach((t, i) => {
    let qty = t.quantity;
    let price = t.price;
    let cpy = 'Barclays Capital Inc.';
    let skip = false;

    if (i === 3) { qty = qty * 2; }            // WRONG_QTY (doubled — allocation confusion?)
    if (i === 7) { cpy = 'BARC'; }             // CPY_ALIAS
    if (i === 11) { cpy = 'Barclays Cap'; }    // CPY_ALIAS
    if (i === 15) { price = +(price * 0.98).toFixed(2); } // PRICE_DRIFT 2% off
    if (i === 19) { skip = true; }             // Missing

    if (skip) return;

    const row = {
      'Trade Reference': `BARC-${seq++}`,
      'Trade Date': formatDDMMYYYY(t.trade_date),
      'Settlement Date': formatDDMMYYYY(t.settlement_date),
      'B/S': t.direction === 'BUY' ? 'BUY' : 'SELL',
      'Ticker': t.symbol,
      'CUSIP': t.cusip,
      'Quantity': qty,
      'Unit Price': price.toFixed(4),
      'Currency': t.currency,
      'Counterparty Name': cpy,
      'Client Account Code': t.account
    };
    rows.push(row);

    // Inject a duplicate for trade index 5 (classic broker retry issue)
    if (i === 5) {
      rows.push({ ...row, 'Trade Reference': `BARC-${seq++}` });
    }
  });

  return rows;
}

// ============================================================================
// File 4 — Internal extract (optional, for dual-upload demo)
// Same 95 trades as the above 3 brokers combined, internal-side format
// ============================================================================
function generateInternalExtract(internal: InternalTrade[]) {
  const targets = ['Morgan Stanley & Co. LLC', 'Jefferies LLC', 'Barclays Capital Inc.'];
  const mine = internal.filter((t) => targets.includes(t.counterparty_canonical));

  return mine.slice(0, 120).map((t) => ({
    internal_id: t.internal_id,
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
    account: t.account
  }));
}

// ============================================================================
function main() {
  const internalPath = path.join(process.cwd(), 'data', 'seed', 'internal.json');
  const internal: InternalTrade[] = JSON.parse(readFileSync(internalPath, 'utf8'));

  const outDir = path.join(process.cwd(), 'demo');
  mkdirSync(outDir, { recursive: true });

  const ms = generateMorganStanley(internal);
  const jeff = generateJefferies(internal);
  const barc = generateBarclays(internal);
  const internalExtract = generateInternalExtract(internal);

  writeFileSync(
    path.join(outDir, '01-morgan-stanley-april-2026.csv'),
    toCSV(ms, [
      'ms_trade_id', 'trade_dt', 'sett_dt', 'side', 'security', 'isin',
      'nominal', 'execution_px', 'ccy', 'cpy', 'account_ref'
    ])
  );

  writeFileSync(
    path.join(outDir, '02-jefferies-april-2026.csv'),
    toCSV(jeff, [
      'ClOrdID', 'TransactTime', 'SettlementDate', 'Side', 'Symbol',
      'SecurityID', 'OrderQty', 'LastPx', 'Currency', 'Counterparty', 'Account'
    ])
  );

  writeFileSync(
    path.join(outDir, '03-barclays-april-2026.csv'),
    toCSV(barc, [
      'Trade Reference', 'Trade Date', 'Settlement Date', 'B/S', 'Ticker',
      'CUSIP', 'Quantity', 'Unit Price', 'Currency', 'Counterparty Name', 'Client Account Code'
    ])
  );

  writeFileSync(
    path.join(outDir, '00-internal-blotter-april-2026.csv'),
    toCSV(internalExtract, [
      'internal_id', 'trade_date', 'settlement_date', 'direction', 'symbol',
      'isin', 'cusip', 'quantity', 'price', 'currency', 'counterparty', 'account'
    ])
  );

  void rand;

  console.log('\n✓ Demo files generated:');
  console.log(`  demo/00-internal-blotter-april-2026.csv  (${internalExtract.length} rows — "our" side)`);
  console.log(`  demo/01-morgan-stanley-april-2026.csv    (${ms.length} rows — settlement format)`);
  console.log(`  demo/02-jefferies-april-2026.csv         (${jeff.length} rows — FIX-style tags)`);
  console.log(`  demo/03-barclays-april-2026.csv          (${barc.length} rows — UK format)`);
}

main();
