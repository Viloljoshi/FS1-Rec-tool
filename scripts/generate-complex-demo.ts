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
const rand = mulberry32(777);

function toCsvLine(fields: (string | number | null | undefined)[]): string {
  return fields
    .map((f) => {
      if (f === null || f === undefined) return '';
      const s = String(f);
      return /[,"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    })
    .join(',');
}

function toUsDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${m}/${d}/${y}`;
}
function toUkDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}
function toLongDate(iso: string): string {
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  return `${months[m - 1]} ${d} ${y}`;
}
function toSwiftDate(iso: string): string {
  const months = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  return `${String(d).padStart(2, '0')}-${months[m - 1]}-${y}`;
}

const internal: InternalTrade[] = JSON.parse(
  readFileSync(path.join(process.cwd(), 'data', 'seed', 'internal.json'), 'utf8')
);

// ============================================================================
// FILE 1 — Jane Street: MIXED formats + free-text memo + ragged rows
// ============================================================================
// Demonstrates:
//   ✓ 4 different date formats interleaved in one file
//   ✓ Mixed direction codes (B/S, BUY/SELL, 1/2)
//   ✓ Price with $ / commas / plain / scientific notation
//   ✓ Quantity with commas / decimals
//   ✓ Free-text memo column (should be mapped as "ignore")
//   ✓ 3 rows with missing account (normalizer uses default)
//   ✓ 2 rows with trailing ragged commas (papaparse handles)
//   ✓ CPY variants: "JS", "Jane Street", "Jane Street Capital LLC", "JSC"
function generateJaneStreetMessy(): string {
  const mine = internal.filter((t) => t.counterparty_canonical === 'Jane Street Capital LLC').slice(0, 28);
  const header = [
    'ID', 'When', 'Settle', 'Side', 'Ticker', 'SecID_ISIN', 'Qty', 'ExecPrice',
    'Ccy', 'Counterparty', 'Book', 'InternalMemo'
  ];

  const rows: string[] = [header.join(',')];
  const memos = [
    'client relationship trade', '',
    'algo v3.2 (VWAP)', 'cover for IPO drawdown',
    'market making leg of pair', '',
    'override — desk confirmed', 'split fill across 4 venues',
    '', 'late posting — operations please verify'
  ];
  const cpyVariants = ['JS', 'Jane Street', 'Jane Street Capital LLC', 'JSC', 'Jane St'];

  mine.forEach((t, i) => {
    // Rotate through date formats row by row
    const dateFormats = [t.trade_date, toUsDate(t.trade_date), toUkDate(t.trade_date), toLongDate(t.trade_date)];
    const dateStr = dateFormats[i % 4]!;
    const settleStr = toSwiftDate(t.settlement_date);

    // Rotate direction codes
    const sides = [t.direction === 'BUY' ? 'B' : 'S', t.direction, t.direction === 'BUY' ? '1' : '2'];
    const sideStr = sides[i % 3]!;

    // Price variations
    let priceStr: string;
    const pickPrice = i % 5;
    if (pickPrice === 0) priceStr = `$${t.price.toFixed(2)}`;
    else if (pickPrice === 1) priceStr = t.price.toLocaleString('en-US', { minimumFractionDigits: 4 });
    else if (pickPrice === 2) priceStr = t.price.toExponential(3);
    else priceStr = t.price.toFixed(4);

    // Qty with commas sometimes
    const qtyStr = t.quantity >= 1000 && i % 3 === 0
      ? t.quantity.toLocaleString('en-US')
      : String(t.quantity);

    const cpy = cpyVariants[i % cpyVariants.length]!;
    const book = i % 7 === 0 ? '' : t.account; // some rows missing account
    const memo = memos[i % memos.length]!;

    const line = toCsvLine([
      `JS-2026-${5000 + i}`,
      dateStr,
      settleStr,
      sideStr,
      t.symbol,
      t.isin,
      qtyStr,
      priceStr,
      t.currency,
      cpy,
      book,
      memo
    ]);

    // Inject 2 ragged rows (trailing extra commas)
    rows.push(i === 5 || i === 17 ? line + ',,' : line);
  });

  // One row with zero qty (should be skipped or error-logged)
  rows.push(toCsvLine([
    'JS-2026-9999', '2026-04-10', '11-APR-2026', 'B', 'AAPL', 'US0378331005',
    '0', '178.43', 'USD', 'Jane Street', '', 'dry-run ignore'
  ]));

  return rows.join('\n');
}

// ============================================================================
// FILE 2 — Virtu: JSON metadata column + unicode counterparty
// ============================================================================
// Demonstrates:
//   ✓ JSON blob column with nested structure (user maps as "ignore")
//   ✓ Unicode in counterparty field ("Société Générale" as occasional counterparty)
//   ✓ Semicolon separators in counterparty (multiple executing legs)
//   ✓ Standard header + column order
function generateVirtuJsonMeta(): string {
  const mine = internal.filter((t) => t.counterparty_canonical === 'Virtu Americas LLC').slice(0, 25);
  const header = [
    'event_id', 'trade_date', 'settle_date', 'action', 'tkr', 'cusip',
    'qty', 'px', 'ccy', 'counterparty_name', 'client_acct', 'metadata'
  ];
  const rows: string[] = [header.join(',')];
  const cpyVariants = ['Virtu Americas LLC', 'Virtu', 'VIRTU', 'Virtu Financial', 'Virtu Americas'];

  mine.forEach((t, i) => {
    // Most rows have rich JSON; some have empty JSON; one has malformed
    let meta: string;
    if (i === 10) meta = '{bad json here}';
    else if (i === 15) meta = '{}';
    else {
      meta = JSON.stringify({
        venue: ['NYSE', 'NASDAQ', 'ARCA', 'BATS'][i % 4],
        algo: `algo_v${(i % 3) + 1}`,
        order_type: i % 2 === 0 ? 'LIMIT' : 'MARKET',
        routed_by: 'SOR-02',
        parent_trade_id: i > 5 && i % 4 === 0 ? `VIRTU-P-${7000 + i}` : null,
        latency_ms: 14 + (i % 30)
      });
    }

    const cpy = i === 7 || i === 19 ? 'Société Générale; Virtu' : cpyVariants[i % cpyVariants.length]!;

    const line = toCsvLine([
      `VIRTU-${7000 + i}`,
      t.trade_date,
      t.settlement_date,
      t.direction === 'BUY' ? 'Buy' : 'Sell',
      t.symbol,
      t.cusip,
      t.quantity,
      t.price.toFixed(4),
      t.currency,
      cpy,
      t.account,
      meta
    ]);
    rows.push(line);
  });

  return rows.join('\n');
}

// ============================================================================
// FILE 3 — Barclays: SWIFT-style tag:value blocks in ONE column (pre-flattened)
// ============================================================================
// Demonstrates:
//   ✓ ONE "message_block" column containing `:35B:, :36B:, :90A:, etc.` pairs
//   ✓ System CANNOT handle this without pre-processing — we flag it as a limitation
//   ✓ We ALSO emit a twin CSV that's pre-flattened, showing the upgrade path
function generateBarclaysSwift(): { raw: string; flattened: string } {
  const mine = internal.filter((t) => t.counterparty_canonical === 'Barclays Capital Inc.').slice(0, 20);
  const headerRaw = ['msg_ref', 'msg_block'];
  const rawRows: string[] = [headerRaw.join(',')];

  const headerFlat = [
    'msg_ref', 'trade_date', 'settle_date', 'side', 'symbol', 'isin',
    'qty', 'price', 'ccy', 'counterparty', 'account'
  ];
  const flatRows: string[] = [headerFlat.join(',')];

  mine.forEach((t, i) => {
    const msgBlock = [
      `:20C:REF//BARC-${8000 + i}`,
      `:94A:TRAD//${toSwiftDate(t.trade_date)}`,
      `:98A:SETT//${toSwiftDate(t.settlement_date)}`,
      `:22F:SIDE//${t.direction === 'BUY' ? 'BUY' : 'SELL'}`,
      `:35B:ISIN ${t.isin} ${t.symbol}`,
      `:36B:UNIT/${t.quantity},`,
      `:90A:DEAL//${t.price.toFixed(4)}`,
      `:11A:CCY//${t.currency}`,
      `:95P:PSET//BARCLAYS CAPITAL INC`,
      `:97A:SAFE//${t.account}`
    ].join(' | ');

    rawRows.push(toCsvLine([`BARC-${8000 + i}`, msgBlock]));

    flatRows.push(
      toCsvLine([
        `BARC-${8000 + i}`,
        toSwiftDate(t.trade_date),
        toSwiftDate(t.settlement_date),
        t.direction === 'BUY' ? 'BUY' : 'SELL',
        t.symbol,
        t.isin,
        t.quantity,
        t.price.toFixed(4),
        t.currency,
        'BARCLAYS CAPITAL INC',
        t.account
      ])
    );
  });

  return { raw: rawRows.join('\n'), flattened: flatRows.join('\n') };
}

// ============================================================================
function main() {
  void rand;
  const outDir = path.join(process.cwd(), 'demo', 'complex');
  mkdirSync(outDir, { recursive: true });

  const js = generateJaneStreetMessy();
  writeFileSync(path.join(outDir, '01-jane-street-mixed-formats.csv'), js);

  const vi = generateVirtuJsonMeta();
  writeFileSync(path.join(outDir, '02-virtu-json-metadata.csv'), vi);

  const barc = generateBarclaysSwift();
  writeFileSync(path.join(outDir, '03-barclays-swift-raw.csv'), barc.raw);
  writeFileSync(path.join(outDir, '03-barclays-swift-flattened.csv'), barc.flattened);

  console.log('\n✓ Complex demo files generated in demo/complex/:');
  console.log('  01-jane-street-mixed-formats.csv   (30 rows — HANDLED: mixed dates/directions/prices, free-text memo, ragged)');
  console.log('  02-virtu-json-metadata.csv         (25 rows — HANDLED: JSON in column, Unicode CPY, malformed JSON row)');
  console.log('  03-barclays-swift-raw.csv          (20 rows — NOT HANDLED: SWIFT tag:value blocks in one column)');
  console.log('  03-barclays-swift-flattened.csv    (20 rows — HANDLED: the same data after pre-flattening)');
}
main();
