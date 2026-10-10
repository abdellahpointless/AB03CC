import { WorkCalendar } from './calendar';
import { emergencyJobIds } from './partKinds';
import { planProduction } from './scheduler/plan';
import type { CarpenterPart, EmergencyOrder, Job, PartTimeMap, PlannerSettings, UserLock } from './types';

export interface EmergencyAnalysis {
  salesOrder: string;
  schedule: number | null;
  customer: string;
  /** parts of the order that can be planned, and parts that cannot (on hold, out of scope, no machine) */
  planned: number;
  unplannable: number;
  /** best case: the parts alone on empty machines, planned by the optimizer */
  finishMinute: number;
  finishTime: string;
  durationMinutes: number;
  machines: Array<{ machineId: string; boxes: number; finishMinute: number; busyMinutes: number }>;
  /** quick estimate of what it does to everything else (classic plan with and without the emergency); null if nothing else is planned */
  effect: { ordersDelayed: number; averageDelayMinutes: number; lastFinishDelayMinutes: number } | null;
}

/**
 * How long would the emergency parts take if they were planned first? They are planned alone, from the start of the
 * plan, with the same rules and disruptions as the real plan, so the answer is the best the shop can do.
 */
export function analyzeEmergency(input: {
  jobs: Job[];
  settings: PlannerSettings;
  locks: Record<string, UserLock>;
  carpenterParts: CarpenterPart[];
  partTimes: PartTimeMap;
  salesOrder: string;
  schedule: number | null;
}): EmergencyAnalysis {
  const { jobs, settings, locks, carpenterParts, partTimes } = input;
  const entry: EmergencyOrder = { id: 'analysis', salesOrder: input.salesOrder, schedule: input.schedule, applied: true };
  const ids = emergencyJobIds(jobs, [entry]);
  const mine = jobs.filter(j => ids.has(j.id));
  const others = (settings.emergencies ?? []).filter(e => e.applied && !(e.salesOrder === input.salesOrder && e.schedule === input.schedule));
  const calm: PlannerSettings = { ...settings, emergencies: [], partWindows: {}, planningMode: 'modules_first', planningEffort: 'standard' };
  const alone = planProduction(mine, calm, locks, carpenterParts, partTimes);

  const items = Object.values(alone.queues).flat();
  const cal = new WorkCalendar(settings.calendar);
  const finishMinute = items.reduce((m, i) => Math.max(m, i.endMinute), 0);

  let effect: EmergencyAnalysis['effect'] = null;
  if (mine.length && jobs.length > mine.length) {
    const quick = (list: EmergencyOrder[]) => planProduction(jobs, { ...settings, emergencies: list, planningMode: 'classic' }, locks, carpenterParts, partTimes);
    const withIt = quick([...others, entry]);
    const without = quick(others);
    const emergencyMasters = new Set(mine.map(j => j.masterOrder));
    const delays: number[] = [];
    for (const [mo, m] of Object.entries(withIt.moSync)) {
      if (emergencyMasters.has(mo)) continue;
      const before = without.moSync[mo]?.lastFinish;
      if (before !== undefined) delays.push(m.lastFinish - before);
    }
    effect = {
      ordersDelayed: delays.filter(d => d > 0).length,
      averageDelayMinutes: delays.length ? delays.reduce((a, b) => a + b, 0) / delays.length : 0,
      lastFinishDelayMinutes: withIt.kpis.makespanMinutes - without.kpis.makespanMinutes,
    };
  }

  return {
    salesOrder: input.salesOrder,
    schedule: input.schedule,
    customer: mine[0]?.customer ?? '',
    planned: items.length,
    unplannable: mine.length - items.length,
    finishMinute,
    finishTime: items.length ? cal.toIso(finishMinute, true) : '',
    durationMinutes: finishMinute,
    machines: Object.entries(alone.queues)
      .filter(([, q]) => q.length)
      .map(([machineId, q]) => ({ machineId, boxes: q.length, finishMinute: q[q.length - 1].endMinute, busyMinutes: q.reduce((a, i) => a + i.durationMin, 0) })),
    effect,
  };
}
