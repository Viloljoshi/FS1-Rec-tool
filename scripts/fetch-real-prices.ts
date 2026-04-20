/* eslint-disable no-console */
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import yahooFinance from 'yahoo-finance2';
import { SECURITIES, TRADING_DATES } from './constants';

interface PriceRow {
  symbol: string;
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

async function main() {
  const period1 = TRADING_DATES[0] ?? '2026-04-06';
  const lastDate = TRADING_DATES[TRADING_DATES.length - 1] ?? period1;
  const period2 = addDays(lastDate, 1);

  const rows: PriceRow[] = [];

  for (const sec of SECURITIES) {
    try {
      const bars = await yahooFinance.historical(sec.symbol, {
        period1,
        period2,
        interval: '1d'
      });
      for (const bar of bars) {
        const date = bar.date.toISOString().slice(0, 10);
        rows.push({
          symbol: sec.symbol,
          date,
          open: bar.open,
          high: bar.high,
          low: bar.low,
          close: bar.close,
          volume: bar.volume
        });
      }
      console.log(`ok  ${sec.symbol} (${bars.length} bars)`);
    } catch (err) {
      console.error(`err ${sec.symbol} — using baseline (${(err as Error).message})`);
      for (const date of TRADING_DATES) {
        const drift = (Math.random() - 0.5) * 0.02;
        rows.push({
          symbol: sec.symbol,
          date,
          open: sec.baseline_close * (1 - drift / 2),
          high: sec.baseline_close * (1 + Math.abs(drift)),
          low: sec.baseline_close * (1 - Math.abs(drift)),
          close: sec.baseline_close * (1 + drift),
          volume: sec.adv
        });
      }
    }
  }

  const outDir = path.join(process.cwd(), 'data', 'seed');
  mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, 'prices.json');
  writeFileSync(outFile, JSON.stringify(rows, null, 2));
  console.log(`\nwrote ${rows.length} rows to ${outFile}`);
}

function addDays(iso: string, n: number): string {
  const d = new Date(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
