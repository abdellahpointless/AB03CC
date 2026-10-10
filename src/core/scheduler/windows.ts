import { evaluate, validate, type Queues } from '../optimizer/evaluate';
import { buildInstance, type InstanceItem } from '../optimizer/instance';
import { instanceOptions } from '../optimizer/options';
import { DEFAULT_WEIGHTS, makeQueueSearch, makeRng, objectiveValue } from '../optimizer/search';
import type { Job, MachineConfig, PlannerSettings } from '../types';
import type { JobClasses } from './improve';
import type { SimContext } from './simulate';

/** One table or spare part that has to run between a start and a finish the user chose (in plan minutes). */
export interface WindowJob {
  job: Job;
  group: string;
  release: number;
  due: number;
}

export interface InsertInput {
  active: MachineConfig[];
  /** the plan of everything else, per machine */
  queues: Record<string, Job[]>;
  windowJobs: WindowJob[];
  settings: PlannerSettings;
  ctx: SimContext;
  classes: JobClasses;
  /** parts that must stay at the head of their machine's queue (emergency, rework) */
  protectedIds: Set<string>;
  /** search steps; 0 = just put each part where it fits best */
  steps: number;
}

const SEED = 20261011;

/**
 * Puts table and spare parts into a finished plan so that the other orders are disturbed as little as possible: the
 * parts may not start before their group's start, they should be done by its finish (every minute late costs more than
 * delaying all other orders by a minute), and the other parts keep their order, only shifting in time.
 */
export function insertWindowJobs(inp: InsertInput): Record<string, Job[]> {
  const { active, queues, windowJobs, settings, ctx, classes } = inp;
  if (windowJobs.length === 0) return queues;

  const winOf = new Map(windowJobs.map(w => [w.job.id, w]));
  const items: InstanceItem[] = [];
  for (const m of active) for (const job of queues[m.id]) items.push({ job, onlyMachine: m.id });
  for (const w of windowJobs) items.push({ job: w.job });

  // what delaying an order costs: much more for a stronger class
  const tiers = Math.max(1, classes.tierCount);
  const baseWeight = (job: Job) => 30 ** (tiers - 1 - (classes.tierOf.get(job.id) ?? tiers - 1)) * (classes.weights.get(job.masterOrder) ?? 1);
  const moduleWeight = new Map<string, number>();
  for (const it of items) {
    if (winOf.has(it.job.id)) continue;
    moduleWeight.set(it.job.masterOrder, Math.max(moduleWeight.get(it.job.masterOrder) ?? 0, baseWeight(it.job)));
  }
  let sumW = 0;
  moduleWeight.forEach(v => (sumW += v));

  const inst = buildInstance(items, {
    ...instanceOptions(active, settings, ctx),
    moduleOf: job => (winOf.has(job.id) ? `window|${winOf.get(job.id)!.group}` : job.masterOrder),
    weightOf: key => (key.startsWith('window|') ? 0.001 : moduleWeight.get(key) ?? 1),
    dueOf: key => {
      if (!key.startsWith('window|')) return null;
      const w = windowJobs.find(x => `window|${x.group}` === key)!;
      return { due: w.due, slope: Math.max(1, sumW) };
    },
    minStartOf: job => winOf.get(job.id)?.release ?? 0,
  });
  const index = new Map(inst.jobs.map((j, i) => [j.id, i]));

  // start: everything else where it is, each window part at the end of the machine that frees up first
  const K = active.length;
  const start: Queues = active.map(m => queues[m.id].map(j => index.get(j.id)!));
  const ends = evaluate(inst, start).machineEnd.slice();
  for (const w of [...windowJobs].sort((a, b) => a.release - b.release || a.due - b.due)) {
    const j = index.get(w.job.id)!;
    let best = -1;
    for (const k of inst.eligList[j]) if (best < 0 || ends[k] + inst.dur[j * K + k] < ends[best] + inst.dur[j * K + best]) best = k;
    if (best < 0) continue; // checked before: has an eligible machine
    start[best].push(j);
    ends[best] += inst.dur[j * K + best];
  }

  let queuesOut = start;
  if (inp.steps > 0) {
    const movable = new Uint8Array(inst.n);
    for (const w of windowJobs) movable[index.get(w.job.id)!] = 1;
    const minPos = new Int32Array(K);
    active.forEach((m, k) => {
      let c = 0;
      for (const j of queues[m.id]) {
        if (!inp.protectedIds.has(j.id)) break;
        c++;
      }
      minPos[k] = c;
    });
    const w = { makespan: 0, partEnd: 0, setup: DEFAULT_WEIGHTS.setup };
    const search = makeQueueSearch(inst, start, w, { movable, minPos });
    const rng = makeRng(SEED);
    const T0 = search.sampleTemperature(rng, 400) * 0.3;
    search.anneal(inp.steps, Math.max(1, T0), Math.max(0.05, T0 / 100), rng);
    search.load(search.best().queues);
    search.descend(2, rng, 30000);
    const best = search.best().queues;
    if (!validate(inst, best).length && objectiveValue(inst, best, w) <= objectiveValue(inst, start, w)) queuesOut = best;
  }

  const out: Record<string, Job[]> = {};
  active.forEach((m, k) => (out[m.id] = queuesOut[k].map(j => inst.jobs[j])));
  return out;
}
