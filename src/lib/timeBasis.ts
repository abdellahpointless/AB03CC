import type { ScheduledJob } from '../core/types';

const trim = (n: number) => String(Math.round(n * 10) / 10);

/** One sentence explaining where a job's planned time comes from (used for tooltips and details). */
export function timeBasisNote(it: Pick<ScheduledJob, 'timeBasis' | 'measuredPerPart' | 'job'>, multiplier: number): string {
  if (it.timeBasis === 'measured') {
    return `Real time from your parts list: ${trim(it.measuredPerPart ?? 0)} min per part. Efficiency and offsets do not apply.`;
  }
  if (it.timeBasis === 'estimated') {
    return `Estimated: NC ${trim(it.job.ncMinutes)} min × ${multiplier} = ${trim(it.job.ncMinutes * multiplier)} min per part (this part is not in the list).`;
  }
  return 'Run time set by you.';
}

export function timeBasisLabel(basis: ScheduledJob['timeBasis']): string {
  return basis === 'measured' ? 'Measured' : basis === 'estimated' ? 'Estimated' : 'Set by you';
}
