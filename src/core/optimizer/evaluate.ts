import type { Instance } from './instance';

/** A schedule: for every machine the ordered list of job indices. */
export type Queues = number[][];

export interface Metrics {
  /** end minute of every job */
  end: Int32Array;
  start: Int32Array;
  setupBefore: Uint8Array;
  /** completion minute of every module (its last part) */
  modEnd: Float64Array;
  /** sum of module completion minutes, unweighted */
  sumC: number;
  /** weighted sum of module completion minutes */
  sumW: number;
  makespan: number;
  setupTotal: number;
  machineEnd: number[];
  busy: number[];
  machineSetup: number[];
}

/** Plays a schedule forward with the same timing rules as the planner (no downtime events). */
export function evaluate(inst: Instance, queues: Queues): Metrics {
  const { n, K, M, dur, setup } = inst;
  const end = new Int32Array(n);
  const start = new Int32Array(n);
  const setupBefore = new Uint8Array(n);
  const machineEnd = new Array<number>(K).fill(0);
  const busy = new Array<number>(K).fill(0);
  const machineSetup = new Array<number>(K).fill(0);
  let setupTotal = 0;
  for (let k = 0; k < K; k++) {
    let t = 0;
    let prev = -1;
    for (const j of queues[k]) {
      const d = dur[j * K + k];
      if (d <= 0) throw new Error(`job ${inst.jobs[j].id} cannot run on ${inst.machineIds[k]}`);
      const s = prev < 0 ? 0 : setup[prev * n + j];
      t += s;
      start[j] = t;
      t += d;
      end[j] = t;
      setupBefore[j] = s;
      busy[k] += d;
      machineSetup[k] += s;
      setupTotal += s;
      prev = j;
    }
    machineEnd[k] = t;
  }
  const modEnd = new Float64Array(M);
  for (let j = 0; j < n; j++) if (end[j] > modEnd[inst.mod[j]]) modEnd[inst.mod[j]] = end[j];
  let sumC = 0;
  let sumW = 0;
  for (let m = 0; m < M; m++) {
    sumC += modEnd[m];
    sumW += inst.weight[m] * modEnd[m];
  }
  return { end, start, setupBefore, modEnd, sumC, sumW, makespan: Math.max(0, ...machineEnd), setupTotal, machineEnd, busy, machineSetup };
}

/** Checks that a schedule uses every job exactly once, on a machine that can run it, with tied jobs at the head. */
export function validate(inst: Instance, queues: Queues): string[] {
  const problems: string[] = [];
  const seen = new Uint8Array(inst.n);
  queues.forEach((q, k) => {
    q.forEach((j, i) => {
      if (seen[j]) problems.push(`job ${inst.jobs[j].id} appears twice`);
      seen[j] = 1;
      if (!inst.elig[j * inst.K + k]) problems.push(`job ${inst.jobs[j].id} cannot run on ${inst.machineIds[k]}`);
      if (inst.fixed[j] >= 0 && inst.fixed[j] !== k) problems.push(`job ${inst.jobs[j].id} is tied to ${inst.machineIds[inst.fixed[j]]}`);
      if (inst.fixed[j] < 0 && i < inst.head[k].length) problems.push(`free job ${inst.jobs[j].id} sits inside the tied head of ${inst.machineIds[k]}`);
    });
  });
  for (let j = 0; j < inst.n; j++) if (!seen[j]) problems.push(`job ${inst.jobs[j].id} is missing`);
  return problems;
}

/** Number of modules finished by each checkpoint minute. */
export function modulesDoneBy(modEnd: ArrayLike<number>, checkpoints: number[]): number[] {
  return checkpoints.map(t => {
    let c = 0;
    for (let m = 0; m < modEnd.length; m++) if (modEnd[m] <= t + 1e-9) c++;
    return c;
  });
}
