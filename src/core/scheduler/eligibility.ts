import type { Job, MachineConfig, PlannerSettings } from '../types';
import type { SimContext } from './simulate';

export function isEligible(job: Job, machine: MachineConfig, s: PlannerSettings, ctx?: SimContext): boolean {
  if (machine.isDown) return false;
  let allowed = machine.allowedMaterials.includes(job.materialType);
  if (!allowed && s.allowHaas5Overflow && machine.overflowMaterials?.includes(job.materialType)) allowed = true;
  if (!allowed) return false;
  if (machine.maxNcMinutes && machine.maxNcMinutes > 0) {
    const perPiece =
      s.fanuc2UsesIdealMinutes || !ctx
        ? job.ncMinutes
        : ctx.duration(job, machine).durationMin / Math.max(1, job.qty);
    if (perPiece >= machine.maxNcMinutes) return false;
  }
  return true;
}
