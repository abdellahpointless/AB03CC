import { describe, expect, it } from 'vitest';
import { buildDispatch, snapshotOf } from './dispatch';
import { demoJobs } from './demo';
import { defaultSettings } from './defaults';
import { planProduction } from './scheduler/plan';

const settings = defaultSettings();
settings.calendar.startDate = '2026-10-09';
const plan = planProduction(demoJobs(), settings);

describe('send to machines', () => {
  it('numbers every machine in running order, going up by the step', () => {
    const r = buildDispatch(plan, null, 10);
    for (const [m, items] of Object.entries(plan.queues)) {
      const rows = r.rows.filter(x => x.machine === m);
      expect(rows.map(x => x.orderNumber)).toEqual(items.map(i => i.job.orderNumber));
      expect(rows.map(x => x.status)).toEqual(items.map((_, i) => (i + 1) * 10));
    }
    expect(r.changes.every(c => c.kind === 'new')).toBe(true);
  });

  it('shows nothing changed right after marking as sent', () => {
    const first = buildDispatch(plan, null, 10);
    const again = buildDispatch(plan, snapshotOf(first.rows), 10);
    expect(again.changes.every(c => c.kind === 'same')).toBe(true);
    expect(again.removed).toEqual([]);
  });

  it('only marks the parts that changed when a part is inserted, moved to another machine or dropped', () => {
    const first = buildDispatch(plan, null, 10);
    const snap = snapshotOf(first.rows);
    const machines = Object.keys(plan.queues).filter(m => plan.queues[m].length > 3);
    const [a, b] = machines;
    const queues = Object.fromEntries(Object.entries(plan.queues).map(([m, q]) => [m, [...q]]));
    const moved = queues[a].splice(1, 1)[0]; // moves to the front of another machine
    queues[b].unshift({ ...moved, machineId: b });
    const dropped = queues[b].pop()!; // taken out of the plan
    const next = { ...plan, queues };
    const r = buildDispatch(next, snap, 10);
    const kinds = new Map(r.changes.map(c => [c.row.orderNumber, c.kind]));
    expect(kinds.get(moved.job.orderNumber)).toBe('machine');
    expect(r.removed.map(x => x.orderNumber)).toContain(dropped.job.orderNumber);
    // everybody else keeps the number they were sent with
    const others = r.changes.filter(c => c.kind !== 'same' && c.row.orderNumber !== moved.job.orderNumber);
    expect(others).toEqual([]);
    // the moved part sits at the front of its new machine, below the first old number
    const row = r.rows.find(x => x.orderNumber === moved.job.orderNumber)!;
    expect(row.machine).toBe(b);
    const rest = r.rows.filter(x => x.machine === b && x.orderNumber !== moved.job.orderNumber);
    expect(row.status).toBeLessThan(rest[0].status);
    expect(row.status).toBeGreaterThan(0);
    // statuses stay strictly increasing on every machine
    for (const m of Object.keys(queues)) {
      const s = r.rows.filter(x => x.machine === m).map(x => x.status);
      expect([...s].sort((x, y) => x - y)).toEqual(s);
      expect(new Set(s).size).toBe(s.length);
    }
  });

  it('starts a machine over when no gap is left', () => {
    const first = buildDispatch(plan, null, 1);
    const snap = snapshotOf(first.rows);
    const m = Object.keys(plan.queues).find(x => plan.queues[x].length > 3)!;
    const queues = Object.fromEntries(Object.entries(plan.queues).map(([k, q]) => [k, [...q]]));
    const [x] = queues[m].splice(queues[m].length - 1, 1);
    queues[m].splice(1, 0, x); // goes between two consecutive numbers: no integer in between
    const r = buildDispatch({ ...plan, queues }, snap, 1);
    expect(r.renumbered).toContain(m);
    expect(r.rows.filter(y => y.machine === m).map(y => y.status)).toEqual(queues[m].map((_, i) => i + 1));
  });
});
