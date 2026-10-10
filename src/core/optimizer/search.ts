import { makeDecoder } from './decode';
import { evaluate, type Queues } from './evaluate';
import { moduleCost, type Instance } from './instance';
import { advance } from './timing';

/** Small seeded generator: the same seed always walks the same search. */
export function makeRng(seed: number) {
  let s = seed >>> 0 || 1;
  const next = () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  };
  return {
    next,
    int: (n: number) => Math.floor(next() * n),
  };
}
export type Rng = ReturnType<typeof makeRng>;

export interface Weights {
  /** weight of the latest machine finish (keeps the tail of the plan from blowing up) */
  makespan: number;
  /** weight of the sum of all part end times (smooths plateaus: finishing any part earlier helps) */
  partEnd: number;
  /** weight of total changeover minutes */
  setup: number;
}

export const DEFAULT_WEIGHTS: Weights = { makespan: 0.3, partEnd: 0.0015, setup: 0 };

/* ------------------------------------------------------------------ */
/* Stage A: search over the order of the modules, decoded greedily      */
/* ------------------------------------------------------------------ */

export function annealOrder(
  inst: Instance,
  init: ArrayLike<number>,
  iters: number,
  rng: Rng,
  log?: (s: string) => void,
  tick?: (done: number) => void,
): { order: Int32Array; cost: number } {
  const dec = makeDecoder(inst);
  const M = inst.M;
  let cur = Int32Array.from(init as ArrayLike<number>);
  let curCost = dec.cost(cur);
  let best = cur.slice();
  let bestCost = curCost;
  const cand = new Int32Array(M);

  // temperature from a sample of random neighbours
  const deltas: number[] = [];
  for (let i = 0; i < 300; i++) {
    cand.set(cur);
    applyOrderMove(cand, rng);
    const d = dec.cost(cand) - curCost;
    if (d > 0) deltas.push(d);
  }
  deltas.sort((a, b) => a - b);
  const median = deltas.length ? deltas[Math.floor(deltas.length / 2)] : 1;
  const T0 = Math.max(1, median * 0.8);
  const T1 = Math.max(0.05, T0 / 400);
  const alpha = Math.pow(T1 / T0, 1 / Math.max(1, iters));
  let T = T0;

  for (let it = 0; it < iters; it++) {
    cand.set(cur);
    applyOrderMove(cand, rng);
    const c = dec.cost(cand);
    const d = c - curCost;
    if (d <= 0 || rng.next() < Math.exp(-d / T)) {
      cur.set(cand);
      curCost = c;
      if (c < bestCost - 1e-9) {
        bestCost = c;
        best = cur.slice();
      }
    }
    T *= alpha;
    if (tick && it % 256 === 255) tick(256);
    if (log && it % Math.max(1, Math.floor(iters / 5)) === 0) log(`  order SA ${it}/${iters} T=${T.toFixed(2)} cur=${curCost.toFixed(0)} best=${bestCost.toFixed(0)}`);
  }
  return { order: best, cost: bestCost };
}

function applyOrderMove(a: Int32Array, rng: Rng) {
  const n = a.length;
  const r = rng.next();
  if (r < 0.4) {
    // insert
    const i = rng.int(n);
    let j = rng.int(n);
    if (i === j) return;
    const v = a[i];
    if (i < j) a.copyWithin(i, i + 1, j + 1);
    else a.copyWithin(j + 1, j, i);
    a[j] = v;
  } else if (r < 0.75) {
    // swap
    const i = rng.int(n);
    const j = rng.int(n);
    const t = a[i];
    a[i] = a[j];
    a[j] = t;
  } else if (r < 0.9) {
    // adjacent swap
    const i = rng.int(Math.max(1, n - 1));
    const t = a[i];
    a[i] = a[i + 1];
    a[i + 1] = t;
  } else {
    // reverse a short segment
    const i = rng.int(n);
    const len = 2 + rng.int(5);
    const j = Math.min(n - 1, i + len);
    for (let x = i, y = j; x < y; x++, y--) {
      const t = a[x];
      a[x] = a[y];
      a[y] = t;
    }
  }
}

/* ------------------------------------------------------------------ */
/* Stage B: annealing directly on the machine queues                     */
/* ------------------------------------------------------------------ */

export interface QueueSearch {
  /** current queues as plain arrays */
  queues(): Queues;
  /** objective value of the current state */
  cost(): number;
  weighted(): number;
  anneal(iters: number, T0: number, T1: number, rng: Rng, log?: (s: string) => void, tick?: (done: number) => void): void;
  /** deterministic steepest-descent sweeps over every relocation; returns the number of improvements */
  descend(maxPasses: number, rng: Rng, maxEvals?: number): number;
  best(): { queues: Queues; cost: number };
  load(q: Queues): void;
  /** recompute everything from scratch and compare with the incremental values (for tests) */
  selfCheck(): string | null;
  sampleTemperature(rng: Rng, samples?: number): number;
}

export function makeQueueSearch(inst: Instance, init: Queues, w: Weights = DEFAULT_WEIGHTS): QueueSearch {
  const { n, K, M, dur, setup, mod, hasDown } = inst;
  const Q: Int32Array[] = Array.from({ length: K }, () => new Int32Array(n + 2));
  const len = new Int32Array(K);
  const mach = new Int16Array(n);
  const pos = new Int32Array(n);
  const endT = new Int32Array(n);
  const setupB = new Uint8Array(n);
  const modEnd = new Float64Array(M);
  const mEnd = new Int32Array(K);
  let sumW = 0;
  let sumEnd = 0;
  let setupTot = 0;

  const freeJobs: number[] = [];
  for (let j = 0; j < n; j++) if (inst.fixed[j] < 0) freeJobs.push(j);
  const headLen = new Int32Array(K);
  for (let k = 0; k < K; k++) headLen[k] = inst.head[k].length;
  // tied jobs may change places inside the head of their machine (they all run before the free jobs)
  const tiedJobs: number[] = [];
  for (let j = 0; j < n; j++) if (inst.fixed[j] >= 0) tiedJobs.push(j);

  // groups used to propose "put it next to something it shares a setup with"
  const sameMatnr: Int32Array[] = new Array(n);
  {
    const byMatnr = new Map<string, number[]>();
    inst.jobs.forEach((jb, i) => (byMatnr.get(jb.matnr) ?? byMatnr.set(jb.matnr, []).get(jb.matnr)!).push(i));
    inst.jobs.forEach((jb, i) => (sameMatnr[i] = Int32Array.from(byMatnr.get(jb.matnr)!.filter(x => x !== i))));
  }

  const modStamp = new Int32Array(M);
  let stamp = 0;
  const touched = new Int32Array(M);
  let touchedN = 0;
  const modLogIdx = new Int32Array(M);
  const modLogVal = new Float64Array(M);
  let modLogN = 0;

  // snapshots of up to two machine suffixes for undo
  interface Snap {
    k: number;
    i0: number;
    len: number;
    jobs: Int32Array;
    ends: Int32Array;
    setups: Uint8Array;
    mEnd: number;
  }
  const mkSnap = (): Snap => ({ k: -1, i0: 0, len: 0, jobs: new Int32Array(n + 2), ends: new Int32Array(n + 2), setups: new Uint8Array(n + 2), mEnd: 0 });
  const snaps = [mkSnap(), mkSnap()];
  let snapN = 0;
  let saveSumW = 0;
  let saveSumEnd = 0;
  let saveSetup = 0;

  function takeSnap(k: number, i0: number) {
    const s = snaps[snapN++];
    s.k = k;
    s.i0 = i0;
    s.len = len[k];
    s.mEnd = mEnd[k];
    for (let i = i0; i < len[k]; i++) {
      const j = Q[k][i];
      s.jobs[i - i0] = j;
      s.ends[i - i0] = endT[j];
      s.setups[i - i0] = setupB[j];
    }
  }

  function restoreSnaps() {
    // queues first, then times
    for (let a = 0; a < snapN; a++) {
      const s = snaps[a];
      const k = s.k;
      // jobs currently in the suffix of k that are not part of the snapshot are restored by their owners below
      len[k] = s.len;
      for (let i = s.i0; i < s.len; i++) {
        const j = s.jobs[i - s.i0];
        Q[k][i] = j;
        mach[j] = k;
        pos[j] = i;
        endT[j] = s.ends[i - s.i0];
        setupB[j] = s.setups[i - s.i0];
      }
      mEnd[k] = s.mEnd;
    }
    for (let i = 0; i < modLogN; i++) modEnd[modLogIdx[i]] = modLogVal[i];
    sumW = saveSumW;
    sumEnd = saveSumEnd;
    setupTot = saveSetup;
  }

  function beginMove() {
    snapN = 0;
    modLogN = 0;
    touchedN = 0;
    stamp++;
    saveSumW = sumW;
    saveSumEnd = sumEnd;
    saveSetup = setupTot;
  }

  /** recompute times of queue k from index i0 on and note the touched modules */
  function recompute(k: number, i0: number) {
    const q = Q[k];
    let t = 0;
    let prev = -1;
    if (i0 > 0) {
      prev = q[i0 - 1];
      t = endT[prev];
    }
    for (let i = i0; i < len[k]; i++) {
      const j = q[i];
      const s = prev < 0 ? 0 : setup[prev * n + j];
      setupTot += s - setupB[j];
      setupB[j] = s;
      t = hasDown[k] ? advance(inst, k, t, s, dur[j * K + k]) : t + s + dur[j * K + k];
      sumEnd += t - endT[j];
      endT[j] = t;
      mach[j] = k;
      pos[j] = i;
      const m = mod[j];
      if (modStamp[m] !== stamp) {
        modStamp[m] = stamp;
        touched[touchedN++] = m;
      }
      prev = j;
    }
    mEnd[k] = len[k] ? endT[q[len[k] - 1]] : 0;
  }

  function finishModules() {
    for (let a = 0; a < touchedN; a++) {
      const m = touched[a];
      const ps = inst.modParts[m];
      let e = 0;
      for (let i = 0; i < ps.length; i++) {
        const v = endT[ps[i]];
        if (v > e) e = v;
      }
      if (e !== modEnd[m]) {
        modLogIdx[modLogN] = m;
        modLogVal[modLogN++] = modEnd[m];
        sumW += moduleCost(inst, m, e) - moduleCost(inst, m, modEnd[m]);
        modEnd[m] = e;
      }
    }
  }

  const objective = () => {
    let ms = 0;
    for (let k = 0; k < K; k++) if (mEnd[k] > ms) ms = mEnd[k];
    return sumW + w.makespan * ms + w.partEnd * sumEnd + w.setup * setupTot;
  };

  function remove(k: number, i: number): number {
    const q = Q[k];
    const j = q[i];
    q.copyWithin(i, i + 1, len[k]);
    len[k]--;
    return j;
  }
  function insert(k: number, i: number, j: number) {
    const q = Q[k];
    q.copyWithin(i + 1, i, len[k]);
    q[i] = j;
    len[k]++;
  }

  function loadQueues(qs: Queues) {
    len.fill(0);
    for (let k = 0; k < K; k++) {
      for (const j of qs[k]) Q[k][len[k]++] = j;
    }
    endT.fill(0);
    setupB.fill(0);
    sumEnd = 0;
    setupTot = 0;
    modEnd.fill(0);
    sumW = 0;
    beginMove();
    for (let k = 0; k < K; k++) recompute(k, 0);
    for (let m = 0; m < M; m++) {
      const ps = inst.modParts[m];
      let e = 0;
      for (let i = 0; i < ps.length; i++) if (endT[ps[i]] > e) e = endT[ps[i]];
      modEnd[m] = e;
      sumW += moduleCost(inst, m, e);
    }
  }
  loadQueues(init);

  let bestCost = objective();
  let bestQ: Queues = snapshotQueues();
  function snapshotQueues(): Queues {
    return Array.from({ length: K }, (_, k) => Array.from(Q[k].subarray(0, len[k])));
  }

  const jobAt = (k: number, i: number) => Q[k][i];

  /**
   * Proposes and applies one move. Returns false when the proposal was not legal (nothing changed).
   * After a true return the caller either keeps the state or calls restoreSnaps().
   */
  function propose(rng: Rng): boolean {
    const r = rng.next();
    if (tiedJobs.length && r < 0.06) return proposeHead(rng);
    if (r < 0.4) return proposeRelocate(rng);
    if (r < 0.65) return proposeSwap(rng);
    if (r < 0.8) return proposeBlock(rng);
    return proposeAdjacent(rng);
  }

  function proposeHead(rng: Rng): boolean {
    const j = tiedJobs[rng.int(tiedJobs.length)];
    const k = mach[j];
    const h = headLen[k];
    if (h < 2) return false;
    const i1 = pos[j];
    const p = rng.int(h);
    if (p === i1) return false;
    beginMove();
    const i0 = Math.min(i1, p);
    takeSnap(k, i0);
    remove(k, i1);
    insert(k, p, j);
    recompute(k, i0);
    finishModules();
    return true;
  }

  function proposeRelocate(rng: Rng): boolean {
    const j = freeJobs[rng.int(freeJobs.length)];
    const k1 = mach[j];
    const i1 = pos[j];
    let k2: number;
    let p: number;
    const bias = rng.next();
    if (bias < 0.65) {
      // next to something related: same module, or same drawing
      const mates = inst.modParts[mod[j]];
      let a = -1;
      if (bias < 0.4 && mates.length > 1) a = mates[rng.int(mates.length)];
      else if (sameMatnr[j].length) a = sameMatnr[j][rng.int(sameMatnr[j].length)];
      else if (mates.length > 1) a = mates[rng.int(mates.length)];
      if (a < 0 || a === j) return false;
      k2 = mach[a];
      if (!inst.elig[j * K + k2]) k2 = inst.eligList[j][rng.int(inst.eligList[j].length)];
      if (k2 === mach[a]) p = pos[a] + (rng.next() < 0.5 ? 0 : 1);
      else p = headLen[k2] + rng.int(len[k2] - headLen[k2] + 1);
    } else {
      k2 = inst.eligList[j][rng.int(inst.eligList[j].length)];
      p = headLen[k2] + rng.int(len[k2] - headLen[k2] + 1);
    }
    if (k2 === k1) {
      // positions refer to the queue before removal
      if (p > i1) p--;
      if (p === i1) return false;
      if (p < headLen[k2]) return false;
      beginMove();
      const i0 = Math.min(i1, p);
      takeSnap(k1, i0);
      remove(k1, i1);
      insert(k1, p, j);
      recompute(k1, i0);
    } else {
      if (p < headLen[k2]) p = headLen[k2];
      beginMove();
      takeSnap(k1, i1);
      takeSnap(k2, p);
      remove(k1, i1);
      insert(k2, p, j);
      recompute(k1, i1);
      recompute(k2, p);
    }
    finishModules();
    return true;
  }

  function proposeSwap(rng: Rng): boolean {
    const a = freeJobs[rng.int(freeJobs.length)];
    let b: number;
    if (rng.next() < 0.5) {
      // a job of the same module or drawing
      const mates = rng.next() < 0.5 ? inst.modParts[mod[a]] : sameMatnr[a];
      if (!mates.length) return false;
      b = mates[rng.int(mates.length)];
    } else {
      b = freeJobs[rng.int(freeJobs.length)];
    }
    if (a === b || inst.fixed[b] >= 0) return false;
    const ka = mach[a];
    const kb = mach[b];
    if (!inst.elig[a * K + kb] || !inst.elig[b * K + ka]) return false;
    const ia = pos[a];
    const ib = pos[b];
    beginMove();
    if (ka === kb) {
      const i0 = Math.min(ia, ib);
      takeSnap(ka, i0);
      Q[ka][ia] = b;
      Q[ka][ib] = a;
      recompute(ka, i0);
    } else {
      takeSnap(ka, ia);
      takeSnap(kb, ib);
      Q[ka][ia] = b;
      Q[kb][ib] = a;
      recompute(ka, ia);
      recompute(kb, ib);
    }
    finishModules();
    return true;
  }

  function proposeAdjacent(rng: Rng): boolean {
    const j = freeJobs[rng.int(freeJobs.length)];
    const k = mach[j];
    const i = pos[j];
    if (i + 1 >= len[k] || i < headLen[k]) return false;
    const other = Q[k][i + 1];
    if (inst.fixed[other] >= 0) return false;
    beginMove();
    takeSnap(k, i);
    Q[k][i] = other;
    Q[k][i + 1] = j;
    recompute(k, i);
    finishModules();
    return true;
  }

  function proposeBlock(rng: Rng): boolean {
    const j = freeJobs[rng.int(freeJobs.length)];
    const k1 = mach[j];
    const i1 = pos[j];
    const size = 2 + rng.int(2);
    if (i1 + size > len[k1]) return false;
    for (let x = 0; x < size; x++) if (inst.fixed[Q[k1][i1 + x]] >= 0) return false;
    // destination machine must be able to run the whole block
    let k2 = k1;
    if (rng.next() < 0.6) k2 = rng.int(K);
    for (let x = 0; x < size; x++) if (!inst.elig[Q[k1][i1 + x] * K + k2]) return false;
    let p = headLen[k2] + rng.int(len[k2] - headLen[k2] + 1 - (k2 === k1 ? size : 0));
    if (k2 === k1) {
      if (p >= i1) p += 0; // positions are in the queue without the block
      if (p === i1) return false;
    }
    beginMove();
    const block = Array.from({ length: size }, (_, x) => Q[k1][i1 + x]);
    if (k2 === k1) {
      const i0 = Math.min(i1, p);
      takeSnap(k1, i0);
      for (let x = 0; x < size; x++) remove(k1, i1);
      for (let x = 0; x < size; x++) insert(k1, p + x, block[x]);
      recompute(k1, i0);
    } else {
      takeSnap(k1, i1);
      takeSnap(k2, p);
      for (let x = 0; x < size; x++) remove(k1, i1);
      for (let x = 0; x < size; x++) insert(k2, p + x, block[x]);
      recompute(k1, i1);
      recompute(k2, p);
    }
    finishModules();
    return true;
  }

  function sampleTemperature(rng: Rng, samples = 2000): number {
    const base = objective();
    const ds: number[] = [];
    for (let i = 0; i < samples; i++) {
      if (!propose(rng)) continue;
      const d = objective() - base;
      if (d > 0) ds.push(d);
      restoreSnaps();
    }
    ds.sort((a, b) => a - b);
    return ds.length ? ds[Math.floor(ds.length / 2)] : 1;
  }

  function anneal(iters: number, T0: number, T1: number, rng: Rng, log?: (s: string) => void, tick?: (done: number) => void) {
    const alpha = Math.pow(T1 / T0, 1 / Math.max(1, iters));
    let T = T0;
    let cur = objective();
    for (let it = 0; it < iters; it++) {
      if (propose(rng)) {
        const c = objective();
        const d = c - cur;
        if (d <= 0 || rng.next() < Math.exp(-d / T)) {
          cur = c;
          if (c < bestCost - 1e-9) {
            bestCost = c;
            bestQ = snapshotQueues();
          }
        } else {
          restoreSnaps();
        }
      }
      T *= alpha;
      if (tick && it % 4096 === 4095) tick(4096);
      if (log && it > 0 && it % Math.max(1, Math.floor(iters / 8)) === 0) log(`  queue SA ${it}/${iters} T=${T.toFixed(2)} cur=${cur.toFixed(0)} best=${bestCost.toFixed(0)} sumC=${sumC().toFixed(0)}`);
    }
  }

  function sumC() {
    let s = 0;
    for (let m = 0; m < M; m++) s += modEnd[m];
    return s;
  }

  function descend(maxPasses: number, rng: Rng, maxEvals = Infinity): number {
    let improvements = 0;
    let evals = 0;
    for (let pass = 0; pass < maxPasses; pass++) {
      let improved = false;
      const order = freeJobs.slice();
      for (let i = order.length - 1; i > 0; i--) {
        const x = rng.int(i + 1);
        const t = order[i];
        order[i] = order[x];
        order[x] = t;
      }
      for (const j of order) {
        if (evals >= maxEvals) return improvements;
        const base = objective();
        let bestD = -1e-9;
        let bestK = -1;
        let bestP = -1;
        const k1 = mach[j];
        for (const k2 of inst.eligList[j]) {
          const lo = headLen[k2];
          const hi = len[k2] - (k2 === k1 ? 1 : 0);
          for (let p = lo; p <= hi; p++) {
            if (k2 === k1 && p === pos[j]) continue;
            // apply
            beginMove();
            const i1 = pos[j];
            if (k2 === k1) {
              const i0 = Math.min(i1, p);
              takeSnap(k1, i0);
              remove(k1, i1);
              insert(k1, p, j);
              recompute(k1, i0);
            } else {
              takeSnap(k1, i1);
              takeSnap(k2, p);
              remove(k1, i1);
              insert(k2, p, j);
              recompute(k1, i1);
              recompute(k2, p);
            }
            finishModules();
            const d = objective() - base;
            restoreSnaps();
            evals++;
            if (d < bestD) {
              bestD = d;
              bestK = k2;
              bestP = p;
            }
          }
        }
        if (bestK >= 0) {
          const i1 = pos[j];
          beginMove();
          if (bestK === k1) {
            const i0 = Math.min(i1, bestP);
            takeSnap(k1, i0);
            remove(k1, i1);
            insert(k1, bestP, j);
            recompute(k1, i0);
          } else {
            takeSnap(k1, i1);
            takeSnap(bestK, bestP);
            remove(k1, i1);
            insert(bestK, bestP, j);
            recompute(k1, i1);
            recompute(bestK, bestP);
          }
          finishModules();
          improved = true;
          improvements++;
          const c = objective();
          if (c < bestCost - 1e-9) {
            bestCost = c;
            bestQ = snapshotQueues();
          }
        }
      }
      if (!improved) break;
    }
    return improvements;
  }

  function selfCheck(): string | null {
    const qs = snapshotQueues();
    const m = evaluate(inst, qs);
    let ms = 0;
    for (let k = 0; k < K; k++) ms = Math.max(ms, mEnd[k]);
    if (Math.abs(m.sumW - sumW) > 1e-6) return `sumW ${sumW} vs ${m.sumW}`;
    if (m.makespan !== ms) return `makespan ${ms} vs ${m.makespan}`;
    if (m.setupTotal !== setupTot) return `setup ${setupTot} vs ${m.setupTotal}`;
    let se = 0;
    for (let j = 0; j < n; j++) se += m.end[j];
    if (se !== sumEnd) return `sumEnd ${sumEnd} vs ${se}`;
    for (let j = 0; j < n; j++) if (m.end[j] !== endT[j]) return `end of ${j}`;
    for (let k = 0; k < K; k++)
      for (let i = 0; i < len[k]; i++) {
        const j = jobAt(k, i);
        if (mach[j] !== k || pos[j] !== i) return `index of ${j}`;
      }
    return null;
  }

  return {
    queues: snapshotQueues,
    cost: objective,
    weighted: () => sumW,
    anneal,
    descend,
    best: () => ({ queues: bestQ.map(q => q.slice()), cost: bestCost }),
    load: q => {
      loadQueues(q);
      const c = objective();
      if (c < bestCost) {
        bestCost = c;
        bestQ = snapshotQueues();
      }
    },
    selfCheck,
    sampleTemperature,
  };
}

/* ------------------------------------------------------------------ */
/* Orchestration                                                         */
/* ------------------------------------------------------------------ */

export interface OptimizeOptions {
  seed?: number;
  /** module-order annealing iterations */
  orderIters?: number;
  /** queue annealing iterations (per restart) */
  queueIters?: number;
  restarts?: number;
  weights?: Weights;
  /** extra starting schedules (for example the planner's own) */
  starts?: Queues[];
  log?: (s: string) => void;
  /** called now and then with the share of the planned work that is done (0..1) */
  onProgress?: (fraction: number) => void;
  /** annealing starts at this share of the typical uphill step (default 0.15) and cools to 1/coolBy of that (default 100) */
  heat?: number;
  coolBy?: number;
  /** stage A: how many of the starting module orders get annealed (best first); default all */
  orderStarts?: number;
  /** at most this many candidate moves in the final descent (it grows with the cube of the part count); default 150000 */
  descendEvals?: number;
}

export interface OptimizeResult {
  queues: Queues;
  /** the full objective (weighted completion times plus the small makespan / part-end / changeover terms) */
  objective: number;
  sumW: number;
  sumC: number;
  makespan: number;
  setupTotal: number;
}

/** Heuristic module orders used as starting points. */
export function startingOrders(inst: Instance): Int32Array[] {
  const idx = Array.from({ length: inst.M }, (_, i) => i);
  const maxPart = (m: number) => Math.max(...Array.from(inst.modParts[m], p => Math.min(...Array.from(inst.eligList[p], k => inst.dur[p * inst.K + k]))));
  const keys: Array<(m: number) => number> = [m => inst.work[m] / inst.weight[m], m => inst.work[m] / inst.K + maxPart(m), m => inst.modParts[m].length];
  return keys.map(f => Int32Array.from([...idx].sort((a, b) => f(a) - f(b) || a - b)));
}

/** The objective the searches minimise, computed from scratch for any schedule. */
export function objectiveValue(inst: Instance, queues: Queues, w: Weights = DEFAULT_WEIGHTS): number {
  const m = evaluate(inst, queues);
  let sumEnd = 0;
  for (let j = 0; j < inst.n; j++) sumEnd += m.end[j];
  return m.sumW + w.makespan * m.makespan + w.partEnd * sumEnd + w.setup * m.setupTotal;
}

/** Cost of one module-order iteration relative to one queue iteration (measured), used to pace the progress. */
const ORDER_COST = 10;

export function optimize(inst: Instance, opts: OptimizeOptions = {}): OptimizeResult {
  const log = opts.log;
  const rng = makeRng(opts.seed ?? 1);
  const weights = opts.weights ?? DEFAULT_WEIGHTS;
  const dec = makeDecoder(inst);
  const candidates: Queues[] = [...(opts.starts ?? [])];

  const orderIters = opts.orderIters ?? 60000;
  const queueIters = opts.queueIters ?? 600000;
  const restarts = opts.restarts ?? 3;
  const orders = startingOrders(inst);
  const total = Math.min(orders.length, opts.orderStarts ?? orders.length) * orderIters * ORDER_COST + restarts * queueIters;
  let done = 0;
  let reported = -1;
  const report = (work: number) => {
    done += work;
    const f = Math.min(1, done / Math.max(1, total));
    if (opts.onProgress && f - reported >= 0.01) {
      reported = f;
      opts.onProgress(f);
    }
  };

  if (inst.n === 0 || inst.fixed.every(f => f >= 0)) {
    // every part is tied to a machine: only the order of the tied parts could change, which the decoder already settles
    const q = candidates[0] ?? makeDecoder(inst).decode(Int32Array.from({ length: inst.M }, (_, i) => i));
    const m = evaluate(inst, q);
    return { queues: q, objective: objectiveValue(inst, q, weights), sumW: m.sumW, sumC: m.sumC, makespan: m.makespan, setupTotal: m.setupTotal };
  }

  // stage A: module orders
  const ranked = orders.map(o => ({ o, c: dec.cost(o) })).sort((a, b) => a.c - b.c).map(x => x.o);
  for (const init of ranked.slice(0, opts.orderStarts ?? ranked.length)) {
    const r = annealOrder(inst, init, orderIters, rng, undefined, n => report(n * ORDER_COST));
    log?.(`stage A start -> weighted sum ${r.cost.toFixed(0)}`);
    candidates.push(dec.decode(r.order));
  }

  // stage B: queue level annealing from the best candidates
  const scored = candidates.map(q => ({ q, c: evaluate(inst, q).sumW }));
  scored.sort((a, b) => a.c - b.c);
  const search = makeQueueSearch(inst, scored[0].q, weights);
  let overallBest = { queues: scored[0].q, cost: Infinity };
  for (let r = 0; r < restarts; r++) {
    const startQ = r === 0 ? scored[0].q : r === 1 && scored[1] ? scored[1].q : overallBest.queues;
    search.load(startQ);
    const T0 = search.sampleTemperature(rng) * (opts.heat ?? 0.15);
    search.anneal(queueIters, Math.max(1, T0), Math.max(0.05, T0 / (opts.coolBy ?? 100)), rng, log, report);
    search.load(search.best().queues);
    search.descend(4, rng, opts.descendEvals ?? 150000);
    const b = search.best();
    log?.(`restart ${r}: objective ${b.cost.toFixed(1)}`);
    if (b.cost < overallBest.cost) overallBest = { queues: b.queues, cost: b.cost };
  }

  // never hand back something worse than a schedule we were given
  let result = overallBest.queues;
  let objective = objectiveValue(inst, result, weights);
  for (const start of opts.starts ?? []) {
    const v = objectiveValue(inst, start, weights);
    if (v < objective - 1e-9) {
      result = start;
      objective = v;
    }
  }
  opts.onProgress?.(1);
  const m = evaluate(inst, result);
  return { queues: result, objective, sumW: m.sumW, sumC: m.sumC, makespan: m.makespan, setupTotal: m.setupTotal };
}
