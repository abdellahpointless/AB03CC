/// <reference lib="webworker" />
import { planProduction } from './scheduler/plan';
import type { CarpenterPart, Job, PartTimeMap, PlannerSettings, UserLock } from './types';

export interface PlanRequest {
  id: number;
  jobs: Job[];
  settings: PlannerSettings;
  locks: Record<string, UserLock>;
  carpenterParts: CarpenterPart[];
  partTimes: PartTimeMap;
}

self.onmessage = (e: MessageEvent<PlanRequest>) => {
  const { id, jobs, settings, locks, carpenterParts, partTimes } = e.data;
  try {
    self.postMessage({ id, plan: planProduction(jobs, settings, locks, carpenterParts, partTimes) });
  } catch (err) {
    self.postMessage({ id, error: err instanceof Error ? err.message : String(err) });
  }
};
