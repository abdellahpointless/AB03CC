import { WorkCalendar } from './calendar';
import type { CalendarSettings, Job, PlanResult, ScheduledJob } from './types';

export type Granularity = 'hour' | 'shift' | 'day';

export interface FinishedMo {
  masterOrder: string;
  customer: string;
  parts: number;
  /** why a module whose CNC work is done still cannot be shipped */
  hold?: 'carpenter' | 'missing-parts';
}

export interface FinishedPart {
  boxCode: string;
  masterOrder: string;
  machineId: string;
  materialType: string;
  qty: number;
  endTime: string;
  rework: boolean;
}

export interface ThroughputBucket {
  index: number;
  startMinute: number;
  endMinute: number;
  startIso: string;
  endIso: string;
  dayIndex: number;
  /** e.g. "Fri 09/10" */
  dayLabel: string;
  /** e.g. "06:00–07:00" (or the day label when bucketing by day) */
  label: string;
  isDayStart: boolean;
  /** master orders whose last planned part ends in this bucket and are free to ship */
  mos: FinishedMo[];
  /** CNC work finished here but the module is held (open carpenter parts or parts that cannot be planned) */
  heldMos: FinishedMo[];
  parts: FinishedPart[];
  pieces: number;
  byMachine: Record<string, number>;
  /** minutes of machining inside the bucket, all machines */
  busyMinutes: number;
  busyPercent: number;
  cumulativeMos: number;
  cumulativeParts: number;
}

export interface ThroughputDay {
  dayIndex: number;
  label: string;
  mos: number;
  heldMos: number;
  parts: number;
  pieces: number;
}

export interface Throughput {
  granularity: Granularity;
  bucketMinutes: number;
  buckets: ThroughputBucket[];
  days: ThroughputDay[];
  totals: { mos: number; heldMos: number; parts: number; pieces: number };
  maxMos: number;
  maxHeld: number;
  maxParts: number;
  /** busiest bucket by parts, ties broken by master orders */
  peak: ThroughputBucket | null;
  machineIds: string[];
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function bucketMinutesFor(g: Granularity, calendar: CalendarSettings, cal: WorkCalendar): number {
  if (g === 'hour') return 60;
  if (g === 'day') return cal.dayLen;
  return Math.max(60, Math.round(calendar.hoursPerShift * 60));
}

/** A part ending exactly on a boundary belongs to the bucket that just closed ("finished by 07:00"). */
export function bucketIndexOf(endMinute: number, size: number): number {
  return Math.max(0, Math.floor((endMinute - 1e-6) / size));
}

const clock = (iso: string) => iso.slice(11, 16);

export function computeThroughput(
  plan: PlanResult,
  calendar: CalendarSettings,
  granularity: Granularity,
  /** jobs the planner could not place (their module cannot be complete) */
  unplaced: Job[] = [...plan.exceptions.blocked, ...plan.exceptions.noEligibleMachine, ...plan.exceptions.manual30000],
): Throughput {
  const cal = new WorkCalendar(calendar);
  const size = bucketMinutesFor(granularity, calendar, cal);
  const items: ScheduledJob[] = Object.values(plan.queues).flat();
  const machineIds = Object.keys(plan.queues);
  const last = items.reduce((m, i) => Math.max(m, i.endMinute), 0);
  const count = items.length ? bucketIndexOf(last, size) + 1 : 0;

  const buckets: ThroughputBucket[] = Array.from({ length: count }, (_, index) => {
    const startMinute = index * size;
    const endMinute = startMinute + size;
    const startIso = cal.toIso(startMinute);
    const endIso = cal.toIso(endMinute, true);
    const d = cal.toDate(startMinute);
    const dayLabel = `${DAY_NAMES[d.getDay()]} ${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
    return {
      index,
      startMinute,
      endMinute,
      startIso,
      endIso,
      dayIndex: Math.floor(startMinute / cal.dayLen),
      dayLabel,
      label: granularity === 'day' ? dayLabel : `${clock(startIso)}–${clock(endIso)}`,
      isDayStart: granularity === 'day' || startMinute % cal.dayLen === 0,
      mos: [],
      heldMos: [],
      parts: [],
      pieces: 0,
      byMachine: Object.fromEntries(machineIds.map(m => [m, 0])),
      busyMinutes: 0,
      busyPercent: 0,
      cumulativeMos: 0,
      cumulativeParts: 0,
    };
  });

  // parts + machine busy time
  for (const it of items) {
    const b = buckets[bucketIndexOf(it.endMinute, size)];
    b.parts.push({
      boxCode: it.job.boxCode,
      masterOrder: it.job.masterOrder,
      machineId: it.machineId,
      materialType: it.job.materialType,
      qty: it.job.qty,
      endTime: it.endTime,
      rework: Boolean(it.job.isRework),
    });
    b.pieces += it.job.qty;
    b.byMachine[it.machineId] = (b.byMachine[it.machineId] ?? 0) + 1;
    for (const seg of it.segments) {
      for (let i = bucketIndexOf(seg.startMinute + 1e-3, size); i < count && buckets[i].startMinute < seg.endMinute; i++) {
        const overlap = Math.min(seg.endMinute, buckets[i].endMinute) - Math.max(seg.startMinute, buckets[i].startMinute);
        if (overlap > 0) buckets[i].busyMinutes += overlap;
      }
    }
  }
  const capacity = Math.max(1, machineIds.length) * size;
  for (const b of buckets) b.busyPercent = Math.min(100, Math.round((b.busyMinutes / capacity) * 100));

  // master orders: finished when their last planned part is done (rework parts are not modules)
  const missing = new Map<string, number>();
  for (const j of unplaced) missing.set(j.masterOrder, (missing.get(j.masterOrder) ?? 0) + 1);
  const byMo = new Map<string, ScheduledJob[]>();
  for (const it of items) {
    if (it.job.isRework) continue;
    (byMo.get(it.job.masterOrder) ?? byMo.set(it.job.masterOrder, []).get(it.job.masterOrder)!).push(it);
  }
  byMo.forEach((parts, masterOrder) => {
    const end = parts.reduce((m, p) => Math.max(m, p.endMinute), 0);
    const carpenter = Boolean(plan.moSync[masterOrder]?.carpenterBlocked);
    const hold: FinishedMo['hold'] = carpenter ? 'carpenter' : missing.has(masterOrder) ? 'missing-parts' : undefined;
    const mo: FinishedMo = { masterOrder, customer: parts[0].job.customer, parts: parts.length, hold };
    const b = buckets[bucketIndexOf(end, size)];
    (hold ? b.heldMos : b.mos).push(mo);
  });

  let cumMos = 0;
  let cumParts = 0;
  for (const b of buckets) {
    b.mos.sort((a, c) => a.masterOrder.localeCompare(c.masterOrder));
    b.heldMos.sort((a, c) => a.masterOrder.localeCompare(c.masterOrder));
    b.parts.sort((a, c) => a.endTime.localeCompare(c.endTime) || a.machineId.localeCompare(c.machineId));
    cumMos += b.mos.length;
    cumParts += b.parts.length;
    b.cumulativeMos = cumMos;
    b.cumulativeParts = cumParts;
  }

  const days: ThroughputDay[] = [];
  for (const b of buckets) {
    let d = days[days.length - 1];
    if (!d || d.dayIndex !== b.dayIndex) days.push((d = { dayIndex: b.dayIndex, label: b.dayLabel, mos: 0, heldMos: 0, parts: 0, pieces: 0 }));
    d.mos += b.mos.length;
    d.heldMos += b.heldMos.length;
    d.parts += b.parts.length;
    d.pieces += b.pieces;
  }

  const peak = buckets.reduce<ThroughputBucket | null>(
    (best, b) =>
      !best || b.parts.length > best.parts.length || (b.parts.length === best.parts.length && b.mos.length > best.mos.length) ? b : best,
    null,
  );

  return {
    granularity,
    bucketMinutes: size,
    buckets,
    days,
    totals: {
      mos: buckets.reduce((a, b) => a + b.mos.length, 0),
      heldMos: buckets.reduce((a, b) => a + b.heldMos.length, 0),
      parts: items.length,
      pieces: buckets.reduce((a, b) => a + b.pieces, 0),
    },
    maxMos: Math.max(0, ...buckets.map(b => b.mos.length + b.heldMos.length)),
    maxHeld: Math.max(0, ...buckets.map(b => b.heldMos.length)),
    maxParts: Math.max(0, ...buckets.map(b => b.parts.length)),
    peak,
    machineIds,
  };
}

/** Round-number axis ticks from 0 up to just above `max` (about `target` ticks). */
export function niceTicks(max: number, target = 4): number[] {
  if (max <= 0) return [0, 1];
  const raw = max / target;
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 5, 10].map(m => m * pow).find(s => s >= raw) ?? raw;
  const top = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let v = 0; v <= top + 1e-9; v += step) ticks.push(Math.round(v * 1000) / 1000);
  return ticks;
}
