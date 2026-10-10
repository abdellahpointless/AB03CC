import { planStartOffset } from '../calendar';
import { plannedDuration, type PlannedDuration } from '../efficiency';
import { partKey } from '../parse/partTimes';
import { partTypeFromEntry, type PartTypeRef } from '../partTypes';
import type { ChangeoverRules, Job, MachineConfig, PartTimeMap, PlannerSettings, Segment, TimelineEvent } from '../types';

export interface Interval {
  start: number;
  end: number;
}

/** Everything the simulation needs, prepared once per planning run. */
export class SimContext {
  readonly settings: PlannerSettings;
  /** Downtime per machine, merged into disjoint sorted intervals. */
  private readonly downtime = new Map<string, Interval[]>();
  /** User supplied durations / start minutes. */
  readonly manualDuration = new Map<string, number>();
  readonly manualStart = new Map<string, number>();
  /** earliest minute a part may start (tables and spares given a start time); unlike a pin it does not reorder the queue */
  readonly release = new Map<string, number>();
  private readonly durCache = new Map<string, PlannedDuration>();

  constructor(
    settings: PlannerSettings,
    machines: MachineConfig[],
    readonly partTimes: PartTimeMap = {},
  ) {
    this.settings = settings;
    const startOffset = planStartOffset(settings.calendar);
    for (const m of machines) {
      const windows = eventsFor(settings.timelineEvents, m.id);
      if (startOffset > 0) windows.push({ start: 0, end: startOffset }); // the plan starts later than the shift
      this.downtime.set(m.id, mergeIntervals(windows));
    }
  }

  downtimeOf(machineId: string): Interval[] {
    return this.downtime.get(machineId) ?? [];
  }

  /** Average real minutes per piece from the parts list, when the list is in use and knows this part. */
  measuredFor(job: Job): number | undefined {
    return this.settings.useMeasuredTimes ? this.partTimes[partKey(job.matnr)]?.minutes : undefined;
  }

  private readonly types = new Map<string, PartTypeRef | null>();
  private readonly sizes = new Map<string, number>();

  /** Standard part name and size (small/big) from the parts list; null when the part is not in the list. */
  partTypeOf(job: Job): PartTypeRef | null {
    let t = this.types.get(job.id);
    if (t === undefined) {
      t = partTypeFromEntry(this.partTimes[partKey(job.matnr)]);
      this.types.set(job.id, t);
    }
    return t;
  }

  /** A part's time in minutes, whatever the machine: the listed time, or NC x factor, times quantity (or the typed time). */
  readonly sizeOf = (job: Job): number => {
    let v = this.sizes.get(job.id);
    if (v === undefined) {
      const manual = this.manualDuration.get(job.id);
      const measured = this.measuredFor(job);
      const mult = this.settings.estimateMultiplier > 0 ? this.settings.estimateMultiplier : 1;
      v = manual && manual > 0 ? manual : (measured !== undefined && measured > 0 ? measured : job.ncMinutes * mult) * job.qty;
      this.sizes.set(job.id, v);
    }
    return v;
  };

  duration(job: Job, machine: MachineConfig): PlannedDuration {
    const key = `${job.id}|${machine.id}`;
    let d = this.durCache.get(key);
    if (!d) {
      d = plannedDuration(job, machine, this.settings, this.manualDuration.get(job.id), this.measuredFor(job));
      this.durCache.set(key, d);
    }
    return d;
  }
}

function eventsFor(events: TimelineEvent[], machineId: string): Interval[] {
  return events
    .filter(e => e.type !== 'rework' && (e.machineId === machineId || e.machineId === 'ALL') && e.durationMinutes > 0)
    .map(e => ({ start: e.startMinute, end: e.startMinute + e.durationMinutes }));
}

function mergeIntervals(list: Interval[]): Interval[] {
  const sorted = [...list].sort((a, b) => a.start - b.start);
  const out: Interval[] = [];
  for (const iv of sorted) {
    const last = out[out.length - 1];
    if (last && iv.start <= last.end) last.end = Math.max(last.end, iv.end);
    else out.push({ ...iv });
  }
  return out;
}

/**
 * Setup minutes between two consecutive parts. `size` is a part's time in minutes, the same on every machine so that
 * the search and the simulation agree. No changeover for the same drawing, or for a part of the same material family
 * that is not much bigger than the one before.
 */
export function changeoverMinutes(prev: Job | null, cur: Job, r: ChangeoverRules, size: (j: Job) => number): number {
  if (!prev) return 0;
  if (prev.matnr === cur.matnr) return 0;
  if (prev.materialType !== cur.materialType) return r.differentMaterialTypeMin;
  return size(cur) >= Math.max(1, r.biggerPartRatio) * size(prev) ? r.biggerPartMin : 0;
}

/** Places `length` working minutes from `t`, pausing across downtime. */
function placeSplit(t: number, length: number, down: Interval[]): { segments: Segment[]; end: number } {
  const segments: Segment[] = [];
  let remaining = length;
  let cursor = t;
  for (const iv of down) {
    if (iv.end <= cursor) continue;
    if (iv.start <= cursor) {
      cursor = iv.end;
      continue;
    }
    const room = iv.start - cursor;
    const take = Math.min(room, remaining);
    if (take > 0) segments.push({ startMinute: cursor, endMinute: cursor + take });
    remaining -= take;
    cursor = take === room ? iv.end : cursor + take;
    if (remaining <= 0) break;
  }
  if (remaining > 0) {
    segments.push({ startMinute: cursor, endMinute: cursor + remaining });
    cursor += remaining;
  }
  return { segments, end: segments.length ? segments[segments.length - 1].endMinute : cursor };
}

/** Finds the first contiguous free window of `length` minutes at or after `t`. */
function placeContiguous(t: number, length: number, down: Interval[]): Segment {
  let start = t;
  for (const iv of down) {
    if (iv.end <= start) continue;
    if (iv.start >= start + length) break;
    start = iv.end;
  }
  return { startMinute: start, endMinute: start + length };
}

export interface MachineState {
  t: number;
  prev: Job | null;
}

export interface StepResult {
  setup: number;
  durationMin: number;
  startMinute: number;
  endMinute: number;
  segments: Segment[];
}

/** Advances a machine by one job: changeover first, then machining. Single source of truth for timing. */
export function step(
  state: MachineState,
  job: Job,
  machine: MachineConfig,
  ctx: SimContext,
  opts: { respectManualStart: boolean },
): StepResult {
  const down = ctx.downtimeOf(machine.id);
  const manualStart = ctx.manualStart.get(job.id);
  let t = state.t;
  if (opts.respectManualStart && manualStart !== undefined && manualStart > t) t = manualStart;
  const release = ctx.release.get(job.id);
  if (release !== undefined && release > t) t = release;

  const setup = changeoverMinutes(state.prev, job, ctx.settings.changeover, ctx.sizeOf);
  if (setup > 0) t = placeSplit(t, setup, down).end;

  const durationMin = ctx.duration(job, machine).durationMin;
  let segments: Segment[];
  if (ctx.settings.restartJobOnEvent) {
    segments = [placeContiguous(t, durationMin, down)];
  } else {
    // a job may not *start* inside downtime
    for (const iv of down) if (t >= iv.start && t < iv.end) t = iv.end;
    segments = placeSplit(t, durationMin, down).segments;
  }
  const startMinute = segments[0].startMinute;
  const endMinute = segments[segments.length - 1].endMinute;
  state.t = endMinute;
  state.prev = job;
  return { setup, durationMin, startMinute, endMinute, segments };
}

export interface QueueSim {
  finish: number;
  setup: number;
  moEnd: Map<string, number>;
  steps?: Array<{ job: Job } & StepResult>;
}

export function simulateQueue(
  queue: Job[],
  machine: MachineConfig,
  ctx: SimContext,
  opts: { record?: boolean; respectManualStart?: boolean } = {},
): QueueSim {
  const state: MachineState = { t: 0, prev: null };
  const moEnd = new Map<string, number>();
  const steps: QueueSim['steps'] = opts.record ? [] : undefined;
  let setup = 0;
  for (const job of queue) {
    const r = step(state, job, machine, ctx, { respectManualStart: Boolean(opts.respectManualStart) });
    setup += r.setup;
    if (r.endMinute > (moEnd.get(job.masterOrder) ?? 0)) moEnd.set(job.masterOrder, r.endMinute);
    steps?.push({ job, ...r });
  }
  return { finish: state.t, setup, moEnd, steps };
}
