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
  /** changeover minutes from job a to job b at [a * n + b] */
  setup: Uint8Array;
  /** minute at which each machine becomes free (it already has earlier work in a plan built in stages) */
  t0: Int32Array;
  /** changeover before job j when it is the first of machine k's queue, at [k * n + j] (after that earlier work) */
  firstSetup: Uint8Array;
  /** earliest minute a part may start (a table or spare that was given a start time); 0 = no limit */
  minStart: Int32Array;
  /** objective weight of every module (1 = plain "finish modules as early as possible") */
  weight: Float64Array;
  /** minute after which finishing a module costs `slope` extra per minute (Infinity = no limit) */
  due: Float64Array;
  slope: Float64Array;
  /** downtime of every machine as merged windows [start0, end0, start1, end1, ...] in working minutes */
  down: Int32Array[];
  /** 1 when the machine has any downtime (lets the hot loops skip the window arithmetic) */
  hasDown: Uint8Array;
  /** a job that meets downtime starts again afterwards instead of pausing */
  restart: boolean;
  /** total work of a module on its cheapest machine for every part (ignores changeovers) */
  work: Float64Array;
}

export interface InstanceItem {
  job: Job;
  /** machine id this job is tied to, if any */
  fixedMachine?: string;
  /** the only machine the job is allowed on, without being tied to the head of its queue (a part already placed) */
  onlyMachine?: string;
}

export interface BuildOptions {
  machines: MachineConfig[];
  changeover: ChangeoverRules;
  /** a part's time in minutes, the same on every machine (drives the 'much bigger part' changeover) */
  sizeOf(job: Job): number;
  /** minutes the job needs on that machine, or null when the machine cannot take it */
  durationOn(job: Job, machine: MachineConfig, tied: boolean): number | null;
  weightOf?(moduleKey: string, parts: Job[]): number;
  /** a minute the module should not finish after, and what every minute beyond it costs */
  dueOf?(moduleKey: string, parts: Job[]): { due: number; slope: number } | null;
  /** where each machine stands when this part of the plan begins: free from minute `t`, last running `prev` */
  startState?(machine: MachineConfig): { t: number; prev: Job | null };
  /** earliest minute a job may start */
  minStartOf?(job: Job): number;
  /** which module a job counts towards (default: its master order) */
  moduleOf?(job: Job): string;
  /** windows in which the machine does not work (breakdowns, maintenance ...), merged and sorted */
  downtime?(machine: MachineConfig): Array<{ start: number; end: number }>;
  restartJobOnEvent?: boolean;
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
    const key = opts.moduleOf ? opts.moduleOf(j) : j.masterOrder;
    let m = modIndex.get(key);
    if (m === undefined) {
      m = modIds.length;
      modIndex.set(key, m);
      modIds.push(key);
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
    const fm = items[i].fixedMachine ?? items[i].onlyMachine;
    if (fm !== undefined) {
      const k = machineIds.indexOf(fm);
      if (k < 0) throw new Error(`job ${jobs[i].id} is tied to unknown machine ${fm}`);
      const d = opts.durationOn(jobs[i], opts.machines[k], true);
      if (d === null) throw new Error(`job ${jobs[i].id} is tied to ${fm} but has no duration there`);
      dur[i * K + k] = Math.max(1, Math.round(d));
      elig[i * K + k] = 1;
      if (items[i].fixedMachine !== undefined) {
        fixed[i] = k;
        headLists[k].push(i);
      }
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
  for (let a = 0; a < n; a++) for (let b = 0; b < n; b++) if (a !== b) setup[a * n + b] = Math.min(255, changeoverMinutes(jobs[a], jobs[b], opts.changeover, opts.sizeOf));

  const weight = new Float64Array(M).fill(1);
  if (opts.weightOf) for (let m = 0; m < M; m++) weight[m] = opts.weightOf(modIds[m], partLists[m].map(i => jobs[i]));

  const t0 = new Int32Array(K);
  const firstSetup = new Uint8Array(K * n);
  if (opts.startState) {
    for (let k = 0; k < K; k++) {
      const st = opts.startState(opts.machines[k]);
      t0[k] = Math.round(st.t);
      for (let j = 0; j < n; j++) firstSetup[k * n + j] = Math.min(255, changeoverMinutes(st.prev, jobs[j], opts.changeover, opts.sizeOf));
    }
  }
  const minStart = new Int32Array(n);
  if (opts.minStartOf) for (let j = 0; j < n; j++) minStart[j] = Math.max(0, Math.round(opts.minStartOf(jobs[j])));

  const due = new Float64Array(M).fill(Infinity);
  const slope = new Float64Array(M);
  if (opts.dueOf) {
    for (let m = 0; m < M; m++) {
      const d = opts.dueOf(modIds[m], partLists[m].map(i => jobs[i]));
      if (d) {
        due[m] = d.due;
        slope[m] = d.slope;
      }
    }
  }

  const work = new Float64Array(M);
  for (let m = 0; m < M; m++) {
    for (const p of partLists[m]) {
      let best = Infinity;
      for (const k of eligList[p]) best = Math.min(best, dur[p * K + k]);
      work[m] += best;
    }
  }

  const down = opts.machines.map(m => {
    const windows = opts.downtime?.(m) ?? [];
    const flat = new Int32Array(windows.length * 2);
    windows.forEach((w, i) => {
      flat[i * 2] = Math.round(w.start);
      flat[i * 2 + 1] = Math.round(w.end);
    });
    return flat;
  });

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
    t0,
    firstSetup,
    minStart,
    weight,
    due,
    slope,
    work,
    down,
    hasDown: Uint8Array.from(down, d => (d.length ? 1 : 0)),
    restart: Boolean(opts.restartJobOnEvent),
  };
}

/** What finishing module `m` at minute `c` costs: its weight per minute, plus the penalty past its limit. */
export function moduleCost(inst: Instance, m: number, c: number): number {
  const base = inst.weight[m] * c;
  return c > inst.due[m] ? base + inst.slope[m] * (c - inst.due[m]) : base;
}
