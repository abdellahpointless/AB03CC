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
const MAX_TRIES = 60;

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

  // start: everything else where it is; each window part (tightest finish first, longest first) goes to the place in a
  // queue where it costs least: on time if it can be, then disturbing the other orders as little as possible
  const K = active.length;
  const w = { makespan: 0, partEnd: 0, setup: DEFAULT_WEIGHTS.setup };
  const start: Queues = active.map(m => queues[m.id].map(j => index.get(j.id)!));
  const headOf = active.map(m => {
    let c = 0;
    for (const j of queues[m.id]) {
      if (!inp.protectedIds.has(j.id)) break;
      c++;
    }
    return c;
  });
  const longest = (x: WindowJob) => Math.max(...inst.eligList[index.get(x.job.id)!].map(k => inst.dur[index.get(x.job.id)! * K + k]));
  for (const wj of [...windowJobs].sort((a, b) => a.due - b.due || longest(b) - longest(a))) {
    const j = index.get(wj.job.id)!;
    const now = evaluate(inst, start);
    let best: { k: number; i: number; v: number } | null = null;
    for (const k of inst.eligList[j]) {
      const q = start[k];
      // only places that start before the finish are worth trying, plus the end of the queue
      const from = Math.max(headOf[k], inst.head[k].length);
      let to = from;
      while (to < q.length && now.start[q[to]] < wj.due) to++;
      // at most MAX_TRIES places per machine on a long queue (evenly spread), so big workloads stay quick
      const stride = Math.max(1, Math.ceil((to - from) / MAX_TRIES));
      const cands: number[] = [];
      for (let i = from; i < to; i += stride) cands.push(i);
      cands.push(q.length);
      for (const i of cands) {
        q.splice(i, 0, j);
        const v = objectiveValue(inst, start, w);
        q.splice(i, 1);
        if (!best || v < best.v - 1e-9) best = { k, i, v };
      }
    }
    if (best) start[best.k].splice(best.i, 0, j); // checked before: has an eligible machine
  }

  let queuesOut = start;
  if (inp.steps > 0) {
    const movable = new Uint8Array(inst.n);
    for (const w of windowJobs) movable[index.get(w.job.id)!] = 1;
    const minPos = Int32Array.from(headOf);
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
