import {
  normalizeDate,
  normalizeDirection,
  normalizeIdentifier,
  normalizeSymbol,
  normalizeDecimal,
  normalizeCurrency,
  normalizeCounterparty,
  normalizeAccount
} from '@/lib/canonical/normalize';

export interface NormalizedTrade {
  trade_id: string;
  source_id: string;
  source_ref: string;
  trade_date: string;
  settlement_date: string;
  direction: 'BUY' | 'SELL';
  symbol: string;
  isin: string | null;
  cusip: string | null;
  quantity: string;
  price: string;
  currency: string;
  counterparty: string;
  counterparty_canonical_id: string | null;
  account: string;
}

export interface RawCanonicalTrade {
  trade_id: string;
  source_id: string;
  source_ref: string;
  trade_date: string | Date;
  settlement_date: string | Date;
  direction: string;
  symbol: string;
  isin: string | null;
  cusip: string | null;
  quantity: string | number;
  price: string | number;
  currency: string;
  counterparty: string;
  counterparty_canonical_id?: string | null;
  account: string;
}

export function normalizeTrade(t: RawCanonicalTrade): NormalizedTrade {
  return {
    trade_id: t.trade_id,
    source_id: t.source_id,
    source_ref: t.source_ref,
    trade_date: normalizeDate(t.trade_date),
    settlement_date: normalizeDate(t.settlement_date),
    direction: normalizeDirection(t.direction),
    symbol: normalizeSymbol(t.symbol),
    isin: normalizeIdentifier(t.isin),
    cusip: normalizeIdentifier(t.cusip),
    quantity: normalizeDecimal(t.quantity),
    price: normalizeDecimal(t.price),
    currency: normalizeCurrency(t.currency),
    counterparty: normalizeCounterparty(t.counterparty),
    counterparty_canonical_id: t.counterparty_canonical_id ?? null,
    account: normalizeAccount(t.account)
  };
}
