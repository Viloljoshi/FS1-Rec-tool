export interface Confusion {
  tp: number;
  fp: number;
  tn: number;
  fn: number;
}

export function precision(c: Confusion): number {
  const denom = c.tp + c.fp;
  return denom === 0 ? 0 : c.tp / denom;
}

export function recall(c: Confusion): number {
  const denom = c.tp + c.fn;
  return denom === 0 ? 0 : c.tp / denom;
}

export function f1(c: Confusion): number {
  const p = precision(c);
  const r = recall(c);
  return p + r === 0 ? 0 : (2 * p * r) / (p + r);
}
