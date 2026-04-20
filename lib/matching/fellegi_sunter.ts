import type { FieldScores } from './similarity';
import type { FieldScore, MatchBand } from '@/lib/canonical/schema';

export interface FieldWeights {
  m: number;
  u: number;
  threshold: number;
}

export interface WeightSet {
  isin: FieldWeights;
  cusip: FieldWeights;
  symbol: FieldWeights;
  trade_date: FieldWeights;
  settlement_date: FieldWeights;
  direction: FieldWeights;
  quantity: FieldWeights;
  price: FieldWeights;
  currency: FieldWeights;
  counterparty: FieldWeights;
  account: FieldWeights;
}

export const DEFAULT_WEIGHTS: WeightSet = {
  isin:            { m: 0.99, u: 0.00001, threshold: 1.0 },
  cusip:           { m: 0.99, u: 0.00001, threshold: 1.0 },
  symbol:          { m: 0.99, u: 0.01,    threshold: 1.0 },
  trade_date:      { m: 0.95, u: 0.02,    threshold: 0.66 },
  settlement_date: { m: 0.93, u: 0.02,    threshold: 0.66 },
  direction:       { m: 0.99, u: 0.5,     threshold: 1.0 },
  quantity:        { m: 0.95, u: 0.001,   threshold: 0.9 },
  price:           { m: 0.95, u: 0.001,   threshold: 0.9 },
  currency:        { m: 0.99, u: 0.3,     threshold: 1.0 },
  counterparty:    { m: 0.88, u: 0.02,    threshold: 0.8 },
  account:         { m: 0.92, u: 0.001,   threshold: 0.9 }
};

function log2(x: number): number {
  return Math.log(Math.max(x, Number.MIN_VALUE)) / Math.LN2;
}

function weightAgree(w: FieldWeights): number {
  return log2(w.m / w.u);
}

function weightDisagree(w: FieldWeights): number {
  return log2((1 - w.m) / (1 - w.u));
}

function sigmoid(x: number): number {
  return 1 / (1 + Math.pow(2, -x));
}

export function scoreContribution(score: number, w: FieldWeights): { weight: number; contribution: number } {
  if (score >= w.threshold) {
    const weight = weightAgree(w);
    return { weight, contribution: weight };
  }
  if (score <= 0.0001) {
    const weight = weightDisagree(w);
    return { weight, contribution: weight };
  }
  const agree = weightAgree(w);
  const disagree = weightDisagree(w);
  const blended = score * agree + (1 - score) * disagree;
  return { weight: agree, contribution: blended };
}

export interface PosteriorResult {
  posterior: number;
  total_weight: number;
  band: MatchBand;
  field_scores: FieldScore[];
}

export function computePosterior(
  raw: FieldScores,
  weights: WeightSet = DEFAULT_WEIGHTS
): PosteriorResult {
  const field_scores: FieldScore[] = [];
  let total = 0;

  const addField = (name: keyof WeightSet, score: number | null) => {
    if (score === null) return;
    const { weight, contribution } = scoreContribution(score, weights[name]);
    total += contribution;
    field_scores.push({ field: name, raw_score: score, weight, contribution });
  };

  addField('isin', raw.isin);
  addField('cusip', raw.cusip);
  addField('symbol', raw.symbol);
  addField('trade_date', raw.trade_date);
  addField('settlement_date', raw.settlement_date);
  addField('direction', raw.direction);
  addField('quantity', raw.quantity);
  addField('price', raw.price);
  addField('currency', raw.currency);
  addField('counterparty', raw.counterparty);
  addField('account', raw.account);

  const posterior = sigmoid(total);
  const band: MatchBand = posterior >= 0.95 ? 'HIGH' : posterior >= 0.7 ? 'MEDIUM' : 'LOW';
  return { posterior, total_weight: total, band, field_scores };
}
