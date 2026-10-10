import { SimContext } from '../scheduler/simulate';
import type { PartTimeMap, PlanResult, PlannerSettings } from '../types';
import type { Queues } from './evaluate';
import { buildInstance, type Instance, type InstanceItem } from './instance';
import { instanceOptions } from './options';

export interface Built {
  inst: Instance;
  /** the planner's own schedule expressed as job indices */
  appQueues: Queues;
}

/**
 * Builds the search instance from exactly the parts the planner scheduled, so the search and the planner solve the same
 * problem: same parts, same machine rules, same durations and changeovers.
 */
export function instanceFromPlan(plan: PlanResult, settings: PlannerSettings, partTimes: PartTimeMap, keepModules?: Set<string>): Built {
  const machines = settings.machines.filter(m => !m.isDown);
  const ctx = new SimContext(settings, machines, partTimes);
  const items: InstanceItem[] = [];
  for (const m of machines) {
    for (const it of plan.queues[m.id] ?? []) {
      if (keepModules && !keepModules.has(it.job.masterOrder)) continue;
      items.push({ job: it.job, fixedMachine: it.erpLocked || it.userLocked ? m.id : undefined });
    }
  }
  const inst = buildInstance(items, instanceOptions(machines, settings, ctx));
  const index = new Map(inst.jobs.map((j, i) => [j.id, i]));
  const appQueues: Queues = machines.map(m => (plan.queues[m.id] ?? []).filter(it => index.has(it.job.id)).map(it => index.get(it.job.id)!));
  return { inst, appQueues };
}
