import type { Instance } from './instance';

/**
 * Time arithmetic of one machine, identical to the planner's `step` (scheduler/simulate.ts): the changeover is placed
 * first and pauses across downtime and breaks; the part then either pauses across downtime or, when jobs restart after
 * an event, needs one free window; a part never starts inside downtime or a break.
 *
 * Machines without downtime (the usual case) take the plain `t + setup + minutes` path.
 */

/** `start` is the machining start of the last `advance` call (the first minute the part actually runs). */
export const last = { start: 0 };

/** index (even) of the first window [w[i], w[i+1]) that ends after `t` */
function firstAfter(w: Int32Array, t: number): number {
  let lo = 0;
  let hi = w.length >> 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (w[mid * 2 + 1] <= t) lo = mid + 1;
    else hi = mid;
  }
  return lo * 2;
}

/** `t`, or the end of the window it falls in */
function skipInside(t: number, w: Int32Array): number {
  const i = firstAfter(w, t);
  return i < w.length && w[i] <= t ? w[i + 1] : t;
}

/** end of `length` working minutes placed from `t`, pausing across the windows */
function splitEnd(t: number, length: number, w: Int32Array): number {
  let remaining = length;
  let cursor = t;
  let lastEnd = -1;
  for (let i = firstAfter(w, t); i < w.length; i += 2) {
    const ws = w[i];
    const we = w[i + 1];
    if (we <= cursor) continue;
    if (ws <= cursor) {
      cursor = we;
      continue;
    }
    const room = ws - cursor;
    const take = remaining < room ? remaining : room;
    if (take > 0) lastEnd = cursor + take;
    remaining -= take;
    cursor = take === room ? we : cursor + take;
    if (remaining <= 0) break;
  }
  if (remaining > 0) {
    lastEnd = cursor + remaining;
    cursor += remaining;
  }
  return lastEnd >= 0 ? lastEnd : cursor;
}

/**
 * Minute at which a job ends when its machine is free from `t`, it needs `setup` changeover minutes and `minutes`
 * of machining. Also leaves the machining start in `last.start`.
 */
export function advance(inst: Instance, k: number, t: number, setup: number, minutes: number): number {
  if (!inst.hasDown[k]) {
    last.start = t + setup;
    return t + setup + minutes;
  }
  const w = inst.down[k];
  const off = inst.off[k];
  // the changeover needs the operator: it pauses across downtime and breaks
  if (setup > 0) t = splitEnd(t, setup, off);
  if (inst.restart) {
    for (;;) {
      t = skipInside(t, off);
      let start = t;
      for (let i = firstAfter(w, start); i < w.length; i += 2) {
        if (w[i + 1] <= start) continue;
        if (w[i] >= start + minutes) break;
        start = w[i + 1];
      }
      if (start === t) break;
      t = start;
    }
    last.start = t;
    return t + minutes;
  }
  // no start inside downtime or a break; once running the part pauses only for downtime
  t = skipInside(t, off);
  last.start = t;
  return splitEnd(t, minutes, w);
}
