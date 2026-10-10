import type { PlanningEffort } from '../types';

export interface Budget {
  /** annealing steps over the order of the master orders (each is a full greedy rebuild, so they are costly) */
  orderIters: number;
  /** annealing steps directly on the machine queues (cheap, incremental) */
  queueIters: number;
  restarts: number;
}

/** The planner refuses to build the search model for more parts than this (the changeover table grows with the square). */
export const MAX_OPTIMIZED_JOBS = 4000;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(v)));

/**
 * How much searching a plan of `n` parts gets. The counts are fixed (never a clock), so the same workload and
 * settings always give the same plan. A step on the queues costs time in proportion to the length of the queues, so
 * the step count falls again for very large plans; the numbers aim at a few seconds for the standard effort.
 */
export function budgetFor(n: number, effort: PlanningEffort): Budget {
  const orders = clamp(2_400_000 / Math.max(1, n), 800, 8000);
  const steps = clamp(Math.min(2500 * n, 570_000_000 / Math.max(1, n)), 200_000, 6_000_000);
  switch (effort) {
    case 'quick':
      return { orderIters: clamp(orders / 3, 400, 2700), queueIters: clamp(steps / 4, 60_000, 1_500_000), restarts: 1 };
    case 'thorough':
      return { orderIters: clamp(orders * 3, 2_000, 24_000), queueIters: clamp(steps * 4, 600_000, 24_000_000), restarts: 1 };
    default:
      return { orderIters: orders, queueIters: steps, restarts: 1 };
  }
}
