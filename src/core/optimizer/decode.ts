import { moduleCost, type Instance } from './instance';
import type { Queues } from './evaluate';
import { advance } from './timing';

/**
 * Turns a module order into a full schedule: modules are taken in order, their parts (hardest to place first,
 * longest first) go to whichever machine would finish them earliest, counting the changeover. Nothing idles.
 */
export interface Decoder {
  decode(order: ArrayLike<number>): Queues;
  /** weighted sum of module completion times of the schedule `decode` would produce, without building it */
  cost(order: ArrayLike<number>): number;
}

export function makeDecoder(inst: Instance): Decoder {
  const { n, K, M, dur, setup, fixed, head, mod, hasDown, minStart, firstSetup, t0 } = inst;
  // parts of every module: forced parts first, then longest first
  const parts: Int32Array[] = inst.modParts.map(list => {
    const free = Array.from(list).filter(j => fixed[j] < 0);
    free.sort((a, b) => inst.eligList[a].length - inst.eligList[b].length || Math.max(...Array.from(inst.eligList[b], k => dur[b * K + k])) - Math.max(...Array.from(inst.eligList[a], k => dur[a * K + k])) || a - b);
    return Int32Array.from(free);
  });

  const avail = new Int32Array(K);
  const last = new Int32Array(K);
  const endT = new Int32Array(n);
  const modEnd = new Float64Array(M);
  const qs: number[][] = Array.from({ length: K }, () => []);

  function run(order: ArrayLike<number>, build: boolean): number {
    for (let k = 0; k < K; k++) avail[k] = t0[k];
    last.fill(-1);
    modEnd.fill(0);
    if (build) for (const q of qs) q.length = 0;
    // tied jobs first, in the module order they belong to
    const rank = new Int32Array(M);
    for (let i = 0; i < order.length; i++) rank[order[i]] = i;
    for (let k = 0; k < K; k++) {
      const h = Array.from(head[k]).sort((a, b) => rank[mod[a]] - rank[mod[b]] || dur[a * K + k] - dur[b * K + k]);
      for (const j of h) {
        const s = last[k] < 0 ? firstSetup[k * n + j] : setup[last[k] * n + j];
        if (minStart[j] > avail[k]) avail[k] = minStart[j];
        avail[k] = hasDown[k] ? advance(inst, k, avail[k], s, dur[j * K + k]) : avail[k] + s + dur[j * K + k];
        endT[j] = avail[k];
        if (endT[j] > modEnd[mod[j]]) modEnd[mod[j]] = endT[j];
        last[k] = j;
        if (build) qs[k].push(j);
      }
    }
    for (let oi = 0; oi < order.length; oi++) {
      const m = order[oi];
      const list = parts[m];
      for (let pi = 0; pi < list.length; pi++) {
        const j = list[pi];
        const el = inst.eligList[j];
        let bestK = el[0];
        let bestFinish = Infinity;
        let bestSetup = 0;
        for (let e = 0; e < el.length; e++) {
          const k = el[e];
          const s = last[k] < 0 ? firstSetup[k * n + j] : setup[last[k] * n + j];
          const from = minStart[j] > avail[k] ? minStart[j] : avail[k];
          const finish = hasDown[k] ? advance(inst, k, from, s, dur[j * K + k]) : from + s + dur[j * K + k];
          if (finish < bestFinish || (finish === bestFinish && s < bestSetup)) {
            bestFinish = finish;
            bestK = k;
            bestSetup = s;
          }
        }
        avail[bestK] = bestFinish;
        endT[j] = bestFinish;
        if (bestFinish > modEnd[m]) modEnd[m] = bestFinish;
        last[bestK] = j;
        if (build) qs[bestK].push(j);
      }
    }
    let sum = 0;
    for (let m = 0; m < M; m++) sum += moduleCost(inst, m, modEnd[m]);
    return sum;
  }

  return {
    decode(order) {
      run(order, true);
      return qs.map(q => q.slice());
    },
    cost(order) {
      return run(order, false);
    },
  };
}
