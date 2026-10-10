import type { Instance } from './instance';

export interface LowerBound {
  /** valid lower bound on the unweighted sum of module completion minutes */
  sumC: number;
  /** lower bound on the k-th module to finish (k = 1..M) */
  kth: number[];
  /** machine subset that gave the strongest bound for the last module */
  note: string;
}

/**
 * Lower bound on the sum of module completion times, ignoring changeovers.
 * Whatever the schedule, the first k modules to finish must have all their work done by the time the k-th one does.
 * For a group G of machines, parts that can only run inside G add up to at least the k smallest per-module totals,
 * and the machines of G can do at most |G| minutes of work per minute.
 */
export function lowerBound(inst: Instance): LowerBound {
  const { K, M, n } = inst;
  const kth = new Array<number>(M).fill(0);
  let bestNote = '';
  for (let mask = 1; mask < 1 << K; mask++) {
    const size = popcount(mask);
    const F = new Float64Array(M);
    for (let j = 0; j < n; j++) {
      const el = inst.eligList[j];
      let inside = true;
      let minDur = Infinity;
      for (const k of el) {
        if (!(mask & (1 << k))) {
          inside = false;
          break;
        }
        minDur = Math.min(minDur, inst.dur[j * K + k]);
      }
      if (inside) F[inst.mod[j]] += minDur;
    }
    const sorted = Array.from(F).sort((a, b) => a - b);
    let cum = 0;
    for (let k = 0; k < M; k++) {
      cum += sorted[k];
      const b = cum / size;
      if (b > kth[k]) {
        kth[k] = b;
        if (k === M - 1) bestNote = inst.machineIds.filter((_, x) => mask & (1 << x)).join(' + ');
      }
    }
  }
  // the k-th finisher also cannot beat the (k-1)-th
  for (let k = 1; k < M; k++) if (kth[k] < kth[k - 1]) kth[k] = kth[k - 1];
  return { sumC: kth.reduce((a, b) => a + b, 0), kth, note: bestNote };
}

function popcount(x: number) {
  let c = 0;
  while (x) {
    c += x & 1;
    x >>= 1;
  }
  return c;
}
