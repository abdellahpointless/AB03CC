import { isEligible } from '../scheduler/eligibility';
import type { SimContext } from '../scheduler/simulate';
import type { MachineConfig, PlannerSettings } from '../types';
import type { BuildOptions } from './instance';

/** The parts of a search instance that follow from the planner settings: durations, machine rules, changeovers, downtime. */
export function instanceOptions(machines: MachineConfig[], settings: PlannerSettings, ctx: SimContext): BuildOptions {
  return {
    machines,
    changeover: settings.changeover,
    sizeOf: ctx.sizeOf,
    // the planner keeps ERP-assigned jobs on their machine even where the material rules would refuse them
    durationOn: (job, machine, tied) => (tied || isEligible(job, machine, settings, ctx) ? ctx.duration(job, machine).durationMin : null),
    downtime: m => ctx.downtimeOf(m.id),
    restartJobOnEvent: settings.restartJobOnEvent,
  };
}
