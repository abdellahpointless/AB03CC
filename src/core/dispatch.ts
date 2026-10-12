import type { PlanResult } from './types';

/** One planned part as it has to be entered in the shop-floor system: machine, status number, box code. */
export interface DispatchRow {
  machine: string;
  /** position on the machine, 1-based */
  position: number;
  /** the "Production Status" number to enter; unchanged parts keep the number they were sent with */
  status: number;
  boxCode: string;
  orderNumber: string;
  masterOrder: string;
  materialType: string;
  minutes: number;
  start: string;
}

/** What was last sent: per order number, the machine and the status number it was given. */
export type SentSnapshot = Record<string, { machine: string; status: number; box: string }>;

export type ChangeKind = 'new' | 'machine' | 'status' | 'same';
export interface DispatchChange {
  row: DispatchRow;
  kind: ChangeKind;
  from?: { machine: string; status: number };
}

export interface DispatchResult {
  rows: DispatchRow[];
  changes: DispatchChange[];
  /** sent before, no longer in the plan */
  removed: Array<{ orderNumber: string; box: string; machine: string; status: number }>;
  /** machines whose numbers had to be renumbered from scratch (no gap was left) */
  renumbered: string[];
}

/** Largest index set of strictly increasing values (longest increasing subsequence), by position. */
function keepIncreasing(values: Array<number | null>): Set<number> {
  const idx: number[] = [];
  const prev = new Array<number>(values.length).fill(-1);
  const tailVal: number[] = [];
  const tailIdx: number[] = [];
  values.forEach((v, i) => {
    if (v === null) return;
    let lo = 0;
    let hi = tailVal.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (tailVal[mid] < v) lo = mid + 1;
      else hi = mid;
    }
    tailVal[lo] = v;
    tailIdx[lo] = i;
    prev[i] = lo > 0 ? tailIdx[lo - 1] : -1;
  });
  let k = tailIdx.length ? tailIdx[tailIdx.length - 1] : -1;
  while (k >= 0) {
    idx.push(k);
    k = prev[k];
  }
  return new Set(idx);
}

/**
 * The plan as entries for the shop-floor system. With a snapshot of what was sent before, parts whose relative order
 * still fits keep their old status number, so only the parts that really changed have to be entered again.
 */
export function buildDispatch(plan: PlanResult, sent: SentSnapshot | null, step: number): DispatchResult {
  const rows: DispatchRow[] = [];
  const changes: DispatchChange[] = [];
  const renumbered: string[] = [];
  const present = new Set<string>();
  for (const [machine, items] of Object.entries(plan.queues)) {
    const old = items.map(it => {
      const s = sent?.[it.job.orderNumber];
      return s && s.machine === machine ? s.status : null;
    });
    const keep = keepIncreasing(old);
    const status = new Array<number>(items.length).fill(0);
    let ok = true;
    // fill every run of parts that are not kept between the kept neighbours
    let i = 0;
    while (i < items.length && ok) {
      if (keep.has(i)) {
        status[i] = old[i]!;
        i++;
        continue;
      }
      let j = i;
      while (j < items.length && !keep.has(j)) j++;
      const lo = i > 0 ? status[i - 1] : 0;
      const hi = j < items.length ? old[j]! : Infinity;
      const k = j - i;
      if (hi === Infinity) for (let t = 0; t < k; t++) status[i + t] = lo + step * (t + 1);
      else if (hi - lo > k) for (let t = 0; t < k; t++) status[i + t] = lo + Math.floor(((hi - lo) * (t + 1)) / (k + 1));
      else ok = false;
      i = j;
    }
    if (!ok) {
      renumbered.push(machine);
      items.forEach((_, t) => (status[t] = step * (t + 1)));
    }
    items.forEach((it, t) => {
      const row: DispatchRow = {
        machine,
        position: t + 1,
        status: status[t],
        boxCode: it.job.boxCode,
        orderNumber: it.job.orderNumber,
        masterOrder: it.job.masterOrder,
        materialType: it.job.materialType,
        minutes: it.durationMin,
        start: it.startTime,
      };
      rows.push(row);
      present.add(row.orderNumber);
      const s = sent?.[row.orderNumber];
      let kind: ChangeKind = 'same';
      if (!sent) kind = 'new';
      else if (!s) kind = 'new';
      else if (s.machine !== machine) kind = 'machine';
      else if (s.status !== row.status) kind = 'status';
      changes.push({ row, kind, from: s ? { machine: s.machine, status: s.status } : undefined });
    });
  }
  const removed = Object.entries(sent ?? {})
    .filter(([order]) => !present.has(order))
    .map(([orderNumber, s]) => ({ orderNumber, box: s.box, machine: s.machine, status: s.status }));
  return { rows, changes, removed, renumbered };
}

export function snapshotOf(rows: DispatchRow[]): SentSnapshot {
  return Object.fromEntries(rows.map(r => [r.orderNumber, { machine: r.machine, status: r.status, box: r.boxCode }]));
}
