/// <reference lib="webworker" />
import { planProduction } from './scheduler/plan';
import type { CarpenterPart, Job, PartTimeMap, PlanResult, PlannerSettings, UserLock } from './types';

export interface PlanRequest {
  id: number;
  jobs: Job[];
  settings: PlannerSettings;
  locks: Record<string, UserLock>;
  carpenterParts: CarpenterPart[];
  partTimes: PartTimeMap;
}

/**
 * What the worker sends back for a request: first the quick plan (`final: false`, the optimizer is still working), then
 * now and then its progress, then the optimized plan (`final: true`). A plan that needs no optimizer is sent once, final.
 */
export type PlanReply =
  | { id: number; plan: PlanResult; final: boolean }
  | { id: number; progress: number }
  | { id: number; error: string };

self.onmessage = (e: MessageEvent<PlanRequest>) => {
  const { id, jobs, settings, locks, carpenterParts, partTimes } = e.data;
  const send = (m: PlanReply) => self.postMessage(m);
  try {
    const plan = planProduction(jobs, settings, locks, carpenterParts, partTimes, {
      onQuick: p => send({ id, plan: p, final: false }),
      onProgress: f => send({ id, progress: f }),
    });
    send({ id, plan, final: true });
  } catch (err) {
    send({ id, error: err instanceof Error ? err.message : String(err) });
  }
};
