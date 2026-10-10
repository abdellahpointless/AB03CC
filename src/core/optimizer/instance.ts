import { changeoverMinutes } from '../scheduler/simulate';
import type { ChangeoverRules, Job, MachineConfig } from '../types';

/**
 * A compact, array based copy of one planning problem: which parts exist, which machines can run them,
 * how long they take, how long a changeover between two parts takes and which master order (module) each belongs to.
 * The searches below work on this form because it is much faster than the object model used by the UI.
 */
export interface Instance {
  K: number;
  machineIds: string[];
  n: number;
  jobs: Job[];
  M: number;
  modIds: string[];
  /** module index of every job */
  mod: Int32Array;
  /** job indices of every module */
  modParts: Int32Array[];
  /** minutes of job j on machine k at [j * K + k]; 0 when the machine cannot run it */
  dur: Int32Array;
  elig: Uint8Array;
  /** machines a job may run on */
  eligList: Int8Array[];
  /** machine index a job is tied to (ERP assignment / user pin), or -1 */
  fixed: Int16Array;
  /** tied jobs per machine: they stay at the head of that machine's queue */
  head: Int32Array[];
  /** changeover minutes from job a to job b at [a * n + b]; the first job of a queue has none */
  setup: Uint8Array;
  /** objective weight of every module (1 = plain "finish modules as early as possible") */
  weight: Float64Array;
  /** total work of a module on its cheapest machine for every part (ignores changeovers) */
  work: Float64Array;
}

export interface InstanceItem {
  job: Job;
  /** machine id this job is tied to, if any */
  fixedMachine?: string;
}

export interface BuildOptions {
  machines: MachineConfig[];
  changeover: ChangeoverRules;
  /** minutes the job needs on that machine, or null when the machine cannot take it */
  durationOn(job: Job, machine: MachineConfig, tied: boolean): number | null;
  weightOf?(moduleKey: string, parts: Job[]): number;
}

export function buildInstance(items: InstanceItem[], opts: BuildOptions): Instance {
  const K = opts.machines.length;
  const n = items.length;
  const jobs = items.map(i => i.job);
  const machineIds = opts.machines.map(m => m.id);

  const modIndex = new Map<string, number>();
  const modIds: string[] = [];
  const mod = new Int32Array(n);
  jobs.forEach((j, i) => {
    let m = modIndex.get(j.masterOrder);
    if (m === undefined) {
      m = modIds.length;
      modIndex.set(j.masterOrder, m);
      modIds.push(j.masterOrder);
    }
    mod[i] = m;
  });
  const M = modIds.length;
  const partLists: number[][] = Array.from({ length: M }, () => []);
  mod.forEach((m, i) => partLists[m].push(i));

  const dur = new Int32Array(n * K);
  const elig = new Uint8Array(n * K);
  const eligList: Int8Array[] = [];
  const fixed = new Int16Array(n).fill(-1);
  const headLists: number[][] = Array.from({ length: K }, () => []);
  for (let i = 0; i < n; i++) {
    const list: number[] = [];
    const fm = items[i].fixedMachine;
    if (fm !== undefined) {
      const k = machineIds.indexOf(fm);
      if (k < 0) throw new Error(`job ${jobs[i].id} is tied to unknown machine ${fm}`);
      const d = opts.durationOn(jobs[i], opts.machines[k], true);
      if (d === null) throw new Error(`job ${jobs[i].id} is tied to ${fm} but has no duration there`);
      dur[i * K + k] = Math.max(1, Math.round(d));
      elig[i * K + k] = 1;
      fixed[i] = k;
      headLists[k].push(i);
      list.push(k);
    } else {
      for (let k = 0; k < K; k++) {
        const d = opts.durationOn(jobs[i], opts.machines[k], false);
        if (d === null) continue;
        dur[i * K + k] = Math.max(1, Math.round(d));
        elig[i * K + k] = 1;
        list.push(k);
      }
    }
    eligList.push(Int8Array.from(list));
  }

  const setup = new Uint8Array(n * n);
  for (let a = 0; a < n; a++) for (let b = 0; b < n; b++) if (a !== b) setup[a * n + b] = Math.min(255, changeoverMinutes(jobs[a], jobs[b], opts.changeover));

  const weight = new Float64Array(M).fill(1);
  if (opts.weightOf) for (let m = 0; m < M; m++) weight[m] = opts.weightOf(modIds[m], partLists[m].map(i => jobs[i]));

  const work = new Float64Array(M);
  for (let m = 0; m < M; m++) {
    for (const p of partLists[m]) {
      let best = Infinity;
      for (const k of eligList[p]) best = Math.min(best, dur[p * K + k]);
      work[m] += best;
    }
  }

  return {
    K,
    machineIds,
    n,
    jobs,
    M,
    modIds,
    mod,
    modParts: partLists.map(l => Int32Array.from(l)),
    dur,
    elig,
    eligList,
    fixed,
    head: headLists.map(l => Int32Array.from(l)),
    setup,
    weight,
    work,
  };
}
