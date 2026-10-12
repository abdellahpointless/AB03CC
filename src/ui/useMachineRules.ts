import { useCallback, useMemo } from 'react';
import { refusal } from '../core/scheduler/eligibility';
import { SimContext } from '../core/scheduler/simulate';
import type { Job } from '../core/types';
import { useStore } from '../state/store';

/** Why a machine may not run a part (null = it may), with exactly the rules the planner uses. */
export function useMachineRules() {
  const { settings, partTimes } = useStore();
  const ctx = useMemo(() => new SimContext(settings, settings.machines, partTimes), [settings, partTimes]);
  return useCallback(
    (job: Job, machineId: string): string | null => {
      const m = settings.machines.find(x => x.id === machineId);
      return m ? refusal(job, m, settings, ctx) : 'unknown machine';
    },
    [settings, ctx],
  );
}
