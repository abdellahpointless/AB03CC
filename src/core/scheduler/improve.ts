import { budgetFor } from '../optimizer/budget';
import { validate, type Queues } from '../optimizer/evaluate';
import { buildInstance, type InstanceItem } from '../optimizer/instance';
import { instanceOptions } from '../optimizer/options';
import { DEFAULT_WEIGHTS, objectiveValue, optimize } from '../optimizer/search';
import type { Job, MachineConfig, PlannerSettings } from '../types';
import type { SimContext } from './simulate';
import { moduleWeights, type ModuleFacts } from './weights';

export interface ImproveInput {
  active: MachineConfig[];
  /** the plan to start from, per machine */
  queues: Record<string, Job[]>;
  /** jobs that must stay on the machine they are on (ERP assignments, user pins) */
  tied: Set<string>;
  settings: PlannerSettings;
  ctx: SimContext;
  rankOf: Map<string, number>;
  carpenterBlocked: (masterOrder: string) => boolean;
  /** when every master order of the starting plan finishes; carpenter-blocked orders may not slip past this in "hard" mode */
  startModuleEnd: Map<string, number>;
  onProgress?: (fraction: number) => void;
}

export interface Improvement {
  queues: Record<string, Job[]>;
  /** what finishing each master order is worth, so plans can be compared the same way the search compared them */
  weights: Map<string, number>;
}

/** Fixed seed: the same workload and settings always give the same plan. */
const SEED = 20261010;

/**
 * Searches for a plan that finishes master orders sooner than the one given (the weighted sum of master-order
 * completion times, see weights.ts), under the same machine rules, durations, changeovers and disruptions.
 * Returns null when the search found nothing better.
 */
export function improveQueues(inp: ImproveInput): Improvement | null {
  const { active, queues, tied, settings, ctx } = inp;
  const items: InstanceItem[] = [];
  for (const m of active) for (const job of queues[m.id]) items.push({ job, fixedMachine: tied.has(job.id) ? m.id : undefined });
  // nothing to decide when there are too few parts, or when ERP and the user have already fixed the machine of every one
  if (items.length < 3 || items.every(it => it.fixedMachine !== undefined)) return null;

  const byMo = new Map<string, Job[]>();
  for (const it of items) (byMo.get(it.job.masterOrder) ?? byMo.set(it.job.masterOrder, []).get(it.job.masterOrder)!).push(it.job);
  const rank = (j: Job) => inp.rankOf.get(j.id) ?? Infinity;
  const facts: ModuleFacts[] = [...byMo].map(([key, parts]) => ({
    key,
    lead: parts.reduce((a, b) => (rank(b) < rank(a) ? b : a)),
    parts: parts.length,
    carpenterBlocked: inp.carpenterBlocked(key),
  }));
  const w = moduleWeights(facts, settings.priorityRules, settings.carpenterDelayMode);
  const weights = new Map(facts.map((f, i) => [f.key, w[i]]));
  const meanW = w.reduce((a, b) => a + b, 0) / Math.max(1, w.length);

  const hard = settings.carpenterDelayMode === 'hard';
  const inst = buildInstance(items, {
    ...instanceOptions(active, settings, ctx),
    weightOf: key => weights.get(key) ?? 1,
    dueOf: (key, parts) => {
      const end = inp.startModuleEnd.get(key);
      return hard && end !== undefined && inp.carpenterBlocked(key) && parts.length ? { due: end, slope: 100 * meanW } : null;
    },
  });

  const index = new Map(inst.jobs.map((j, i) => [j.id, i]));
  const start: Queues = active.map(m => queues[m.id].map(j => index.get(j.id)!));
  const search = {
    makespan: DEFAULT_WEIGHTS.makespan * meanW,
    partEnd: DEFAULT_WEIGHTS.partEnd * meanW,
    setup: DEFAULT_WEIGHTS.setup * meanW,
  };
  const result = optimize(inst, {
    seed: SEED,
    ...budgetFor(inst.n, settings.planningEffort ?? 'standard'),
    weights: search,
    starts: [start],
    onProgress: inp.onProgress,
  });

  // a schedule the search hands back must be a legal one, and better than what we started from
  if (validate(inst, result.queues).length) return null;
  if (result.objective >= objectiveValue(inst, start, search) - 1e-9) return null;

  const out: Record<string, Job[]> = {};
  active.forEach((m, k) => (out[m.id] = result.queues[k].map(j => inst.jobs[j])));
  return { queues: out, weights };
}
