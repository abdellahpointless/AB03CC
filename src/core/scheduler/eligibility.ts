import type { Job, MachineConfig, PlannerSettings } from '../types';
import type { SimContext } from './simulate';

/** The materials a machine takes right now: its own, plus its backup materials while those are switched on. */
export function materialsOf(machine: MachineConfig): string[] {
  return machine.useBackupMaterials ? [...machine.allowedMaterials, ...(machine.backupMaterials ?? [])] : machine.allowedMaterials;
}

/** Minutes per piece the machine's size limit is checked against (NC file minutes, or planned minutes). */
export function sizeMinutes(job: Job, machine: MachineConfig, ctx?: SimContext): number {
  if (machine.size?.basis === 'planned' && ctx) return ctx.duration(job, machine).durationMin / Math.max(1, job.qty);
  return job.ncMinutes;
}

/**
 * Why this machine may not run this part, or null when it may. Every rule is hard: the planner, the optimizer, ERP
 * assignments and drag & drop on the Gantt all go through here.
 */
export function refusal(job: Job, machine: MachineConfig, _s?: PlannerSettings, ctx?: SimContext): string | null {
  if (machine.isDown) return `${machine.name} is down`;
  if (!materialsOf(machine).includes(job.materialType)) {
    const backup = machine.backupMaterials?.includes(job.materialType);
    return backup ? `${job.materialType} is only a backup material on ${machine.name} (switched off)` : `${machine.name} does not take ${job.materialType || 'this material'}`;
  }
  const lim = machine.size;
  if (lim && (lim.min || lim.max)) {
    const v = sizeMinutes(job, machine, ctx);
    const what = lim.basis === 'planned' ? 'planned min/piece' : 'NC min/piece';
    if (lim.max && lim.max > 0 && v >= lim.max) return `${round(v)} ${what}: ${machine.name} only takes parts under ${lim.max}`;
    if (lim.min && lim.min > 0 && v < lim.min) return `${round(v)} ${what}: ${machine.name} only takes parts from ${lim.min}`;
  }
  if (machine.partTypes?.restricted && ctx) {
    const t = ctx.partTypeOf(job);
    // parts that are not in the parts list have no type: only the other rules apply to them
    if (t && !machine.partTypes.allowed[t.key]?.[t.size]) return `${machine.name} is not set to make ${t.size} parts of type "${t.key}"`;
  }
  return null;
}

export function isEligible(job: Job, machine: MachineConfig, s?: PlannerSettings, ctx?: SimContext): boolean {
  return refusal(job, machine, s, ctx) === null;
}

const round = (v: number) => Math.round(v * 10) / 10;
