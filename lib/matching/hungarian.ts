import munkres from 'munkres-js';

export interface Candidate {
  a_index: number;
  b_index: number;
  posterior: number;
}

export interface Assignment {
  a_index: number;
  b_index: number;
  posterior: number;
}

/**
 * Given candidate pairs across a rectangular cost matrix with scores,
 * return the optimal 1:1 assignment that maximizes total posterior.
 * Unassigned indices are omitted from the result.
 */
export function optimalAssign(
  aCount: number,
  bCount: number,
  candidates: Candidate[],
  minPosterior = 0.5
): Assignment[] {
  if (aCount === 0 || bCount === 0) return [];

  const size = Math.max(aCount, bCount);
  const LARGE = 10;
  const cost: number[][] = Array.from({ length: size }, () => Array(size).fill(LARGE));
  for (const c of candidates) {
    if (c.posterior < minPosterior) continue;
    // minimize cost = (1 - posterior), so high posterior = low cost
    cost[c.a_index]![c.b_index] = 1 - c.posterior;
  }

  const result = munkres(cost);
  const byPair = new Map<string, number>();
  for (const c of candidates) byPair.set(`${c.a_index}|${c.b_index}`, c.posterior);

  const out: Assignment[] = [];
  for (const [ai, bi] of result) {
    if (ai >= aCount || bi >= bCount) continue;
    const key = `${ai}|${bi}`;
    const posterior = byPair.get(key);
    if (posterior === undefined || posterior < minPosterior) continue;
    out.push({ a_index: ai, b_index: bi, posterior });
  }
  return out;
}
