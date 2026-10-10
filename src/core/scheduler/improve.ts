import { budgetFor } from '../optimizer/budget';
import { evaluate, validate, type Queues } from '../optimizer/evaluate';
import { buildInstance, type InstanceItem } from '../optimizer/instance';
import { instanceOptions } from '../optimizer/options';
import { DEFAULT_WEIGHTS, objectiveValue, optimize } from '../optimizer/search';
import type { PartKind } from '../partKinds';
import type { Job, MachineConfig, PlannerSettings } from '../types';
import type { SimContext } from './simulate';
import { moduleWeights, type ModuleFacts } from './weights';

/** More classes than this are merged into the last one. */
export const MAX_TIERS = 8;

export interface JobClasses {
  /** priority class of every job: 0 is planned first, a machine runs its class 0 parts before any class 1 part ... */
  tierOf: Map<string, number>;
  tierCount: number;
  /** what finishing each master order is worth inside its class */
  weights: Map<string, number>;
}

export interface ClassifyInput {
  jobs: Job[];
  settings: PlannerSettings;
  kinds: Map<string, PartKind>;
  /** parts of an emergency: planned before everything else */
  emergency: Set<string>;
  rankOf: Map<string, number>;
  carpenterBlocked: (masterOrder: string) => boolean;
}

/**
 * Priority classes, strongest first: emergency parts, then rework (it ignores every rule), then the classes the
 * filter rules make (sales order, schedule, customer, material), then everything else.
 */
export function classifyJobs(inp: ClassifyInput): JobClasses {
  const byMo = new Map<string, Job[]>();
  for (const j of inp.jobs) (byMo.get(j.masterOrder) ?? byMo.set(j.masterOrder, []).get(j.masterOrder)!).push(j);
  const rank = (j: Job) => inp.rankOf.get(j.id) ?? Infinity;
  const facts: ModuleFacts[] = [...byMo].map(([key, parts]) => ({
    key,
    lead: parts.reduce((a, b) => (rank(b) < rank(a) ? b : a)),
    parts: parts.length,
    carpenterBlocked: inp.carpenterBlocked(key),
  }));
  const mw = moduleWeights(facts, inp.settings.priorityRules, inp.settings.carpenterDelayMode);
  const ruleTier = new Map(facts.map((f, i) => [f.key, mw.tiers[i]]));
  const raw = new Map<string, number>();
  for (const j of inp.jobs) {
    raw.set(j.id, inp.emergency.has(j.id) ? 0 : inp.kinds.get(j.id) === 'rework' ? 1 : 2 + (ruleTier.get(j.masterOrder) ?? 0));
  }
  const present = [...new Set(raw.values())].sort((a, b) => a - b);
  const index = new Map(present.map((v, i) => [v, Math.min(i, MAX_TIERS - 1)]));
  const tierOf = new Map<string, number>();
  raw.forEach((v, id) => tierOf.set(id, index.get(v)!));
  return { tierOf, tierCount: Math.min(present.length, MAX_TIERS), weights: new Map(facts.map((f, i) => [f.key, mw.weights[i]])) };
}

/** Keeps every machine's order, but runs a higher class before a lower one (stable inside a class). */
export function partitionByTier(queues: Record<string, Job[]>, tierOf: Map<string, number>): void {
  for (const id of Object.keys(queues)) {
    const q = queues[id].map((j, i) => ({ j, i, t: tierOf.get(j.id) ?? 0 }));
    q.sort((a, b) => a.t - b.t || a.i - b.i);
    queues[id] = q.map(x => x.j);
  }
}

export interface ImproveInput {
  active: MachineConfig[];
  /** the plan to start from, per machine (already ordered by class) */
  queues: Record<string, Job[]>;
  /** jobs that must stay on the machine they are on (ERP assignments, user pins) */
  tied: Set<string>;
  settings: PlannerSettings;
  ctx: SimContext;
  classes: JobClasses;
  carpenterBlocked: (masterOrder: string) => boolean;
  /** when every master order of the starting plan finishes; carpenter-blocked orders may not slip past this in "hard" mode */
  startModuleEnd: Map<string, number>;
  onProgress?: (fraction: number) => void;
}

export interface Improvement {
  queues: Record<string, Job[]>;
}

/** Fixed seed: the same workload and settings always give the same plan. */
const SEED = 20261010;

/**
 * Searches for a plan that finishes master orders sooner than the one given, class by class: the strongest class is
 * planned first on empty machines, then the next one after it, and so on, so a higher class is never held up by a lower
 * one. Inside a class the weighted sum of master-order completion times is minimised, under the same machine rules,
 * durations, changeovers and disruptions as the planner. Returns null when nothing could be improved.
 */
export function improveQueues(inp: ImproveInput): Improvement | null {
  const { active, queues, tied, settings, ctx, classes } = inp;
  const total = active.reduce((n, m) => n + queues[m.id].length, 0);
  if (total < 3) return null;

  const hard = settings.carpenterDelayMode === 'hard';
  const out: Record<string, Job[]> = Object.fromEntries(active.map(m => [m.id, [] as Job[]]));
  // where each machine stands after the classes planned so far
  const state = active.map(() => ({ t: 0, prev: null as Job | null }));
  let improvedAny = false;
  let done = 0;

  for (let tier = 0; tier < classes.tierCount; tier++) {
    const items: InstanceItem[] = [];
    const startQueues: Job[][] = active.map(m => queues[m.id].filter(j => (classes.tierOf.get(j.id) ?? 0) === tier));
    active.forEach((m, k) => startQueues[k].forEach(job => items.push({ job, fixedMachine: tied.has(job.id) ? m.id : undefined })));
    if (items.length === 0) continue;
    const share = items.length / total;

    const weightsOf = (key: string) => classes.weights.get(key) ?? 1;
    const meanW = items.reduce((a, it) => a + weightsOf(it.job.masterOrder), 0) / items.length;
    const inst = buildInstance(items, {
      ...instanceOptions(active, settings, ctx),
      startState: m => state[active.indexOf(m)],
      weightOf: weightsOf,
      dueOf: (key, parts) => {
        const end = inp.startModuleEnd.get(key);
        return hard && end !== undefined && inp.carpenterBlocked(key) && parts.length ? { due: end, slope: 100 * meanW } : null;
      },
    });
    const index = new Map(inst.jobs.map((j, i) => [j.id, i]));
    const start: Queues = startQueues.map(q => q.map(j => index.get(j.id)!));

    let result: Queues = start;
    if (items.length >= 3 && !items.every(it => it.fixedMachine !== undefined)) {
      const search = { makespan: DEFAULT_WEIGHTS.makespan * meanW, partEnd: DEFAULT_WEIGHTS.partEnd * meanW, setup: DEFAULT_WEIGHTS.setup * meanW };
      const r = optimize(inst, {
        seed: SEED + tier,
        ...budgetFor(inst.n, settings.planningEffort ?? 'standard'),
        weights: search,
        starts: [start],
        onProgress: inp.onProgress ? f => inp.onProgress!(Math.min(1, done + share * f)) : undefined,
      });
      // a schedule the search hands back must be a legal one, and better than what we started from
      if (!validate(inst, r.queues).length && r.objective < objectiveValue(inst, start, search) - 1e-9) {
        result = r.queues;
        improvedAny = true;
      }
    }
    done += share;
    // the next class begins where this one left each machine
    const m = evaluate(inst, result);
    active.forEach((mach, k) => {
      const q = result[k].map(j => inst.jobs[j]);
      out[mach.id].push(...q);
      if (q.length) state[k] = { t: m.machineEnd[k], prev: q[q.length - 1] };
    });
  }
  inp.onProgress?.(1);
  return improvedAny ? { queues: out } : null;
}
