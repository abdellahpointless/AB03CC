/// <reference lib="webworker" />
import { planProduction } from './scheduler/plan';
import type { CarpenterPart, Job, PlannerSettings, UserLock } from './types';

export interface PlanRequest {
  id: number;
  jobs: Job[];
  settings: PlannerSettings;
  locks: Record<string, UserLock>;
  carpenterParts: CarpenterPart[];
}

self.onmessage = (e: MessageEvent<PlanRequest>) => {
  const { id, jobs, settings, locks, carpenterParts } = e.data;
  try {
    self.postMessage({ id, plan: planProduction(jobs, settings, locks, carpenterParts) });
  } catch (err) {
    self.postMessage({ id, error: err instanceof Error ? err.message : String(err) });
  }
};
