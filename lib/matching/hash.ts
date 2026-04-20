import { createHash } from 'node:crypto';
import Decimal from 'decimal.js';
import type { NormalizedTrade } from './normalize';

export function compositeHash(t: NormalizedTrade): string {
  const primaryId = t.isin ?? t.cusip ?? t.symbol;
  const price = new Decimal(t.price).toDecimalPlaces(6).toFixed(6);
  const qty = new Decimal(t.quantity).toDecimalPlaces(6).toFixed(6);
  const key = [primaryId, t.trade_date, qty, price, t.direction, t.account].join('|');
  return createHash('sha256').update(key).digest('hex');
}
