import { describe, expect, it } from 'vitest';
import { demoCarpenterParts, demoJobs } from '../demo';
import { defaultSettings } from '../defaults';
import { budgetFor } from '../optimizer/budget';
import type { Job, PlanResult, PlannerSettings, PriorityRule } from '../types';
import { isEligible, planProduction } from './plan';
import { SimContext } from './simulate';
import { moduleWeights, TIER, type ModuleFacts } from './weights';

const base = (patch: Partial<PlannerSettings> = {}): PlannerSettings => {
  const s = defaultSettings();
  s.calendar.startDate = '2026-10-09';
  s.planningEffort = 'quick';
  return { ...s, ...patch };
};
const finishOnly: PriorityRule[] = [{ id: 'f', type: 'finish_master_order', level: 1, enabled: true, name: 'Finish Full Module First', direction: 'lowest_first' }];
const jobs = demoJobs();

const sumMo = (p: PlanResult) => p.kpis.sumMoCompletion;

describe('master order weights', () => {
  const job = (over: Partial<Job>): Job => ({ ...demoJobs()[0], ...over });
  const facts = (over: Partial<Job>, extra: Partial<ModuleFacts> = {}): ModuleFacts => ({ key: String(Math.random()), lead: job(over), parts: 3, carpenterBlocked: false, ...extra });

  it('gives every order the same weight when no rule singles any out', () => {
    expect(moduleWeights([facts({}), facts({}), facts({})], finishOnly, 'soft')).toEqual([1, 1, 1]);
  });

  it('counts an order matching a customer rule TIER times more than the others', () => {
    const rules: PriorityRule[] = [{ id: 'c', type: 'customer', level: 1, enabled: true, name: 'c', values: ['ACME'] }, ...finishOnly.map(r => ({ ...r, level: 2 }))];
    const w = moduleWeights([facts({ customer: 'ACME' }), facts({ customer: 'Other' })], rules, 'soft');
    expect(w).toEqual([TIER, 1]);
  });

  it('lets a more important level beat a less important one, like digits', () => {
    const rules: PriorityRule[] = [
      { id: 'a', type: 'customer', level: 1, enabled: true, name: 'a', values: ['A'] },
      { id: 'b', type: 'sales_order', level: 2, enabled: true, name: 'b', values: ['S2'] },
    ];
    const [onlyLevel2, onlyLevel1, both, none] = moduleWeights([facts({ salesOrder: 'S2' }), facts({ customer: 'A' }), facts({ customer: 'A', salesOrder: 'S2' }), facts({})], rules, 'off');
    expect(none).toBeLessThan(onlyLevel2);
    expect(onlyLevel2).toBeLessThan(onlyLevel1);
    expect(onlyLevel1).toBeLessThan(both);
  });

  it('nudges closer production dates up and furthest-first dates down', () => {
    const closeFirst: PriorityRule[] = [{ id: 'd', type: 'production_date', level: 1, enabled: true, name: 'd', dateDirection: 'closest_first' }];
    const mods = [facts({ plannedDate: '2026-10-20' }), facts({ plannedDate: '2026-10-10' }), facts({ plannedDate: '2026-10-30' })];
    const [mid, early, late] = moduleWeights(mods, closeFirst, 'off');
    expect(early).toBeGreaterThan(mid);
    expect(mid).toBeGreaterThan(late);
    expect(early / late).toBeLessThan(1.5); // a nudge, never a rule
    const furthest = moduleWeights(mods, [{ ...closeFirst[0], dateDirection: 'furthest_first' }], 'off');
    expect(furthest[2]).toBeGreaterThan(furthest[1]);
  });

  it('counts orders still waiting for the carpenter for less, more so in hard mode', () => {
    const blocked = [facts({}, { carpenterBlocked: true }), facts({})];
    const soft = moduleWeights(blocked, finishOnly, 'soft');
    const hard = moduleWeights(blocked, finishOnly, 'hard');
    const off = moduleWeights(blocked, finishOnly, 'off');
    expect(off).toEqual([1, 1]);
    expect(soft[0]).toBeLessThan(1);
    expect(hard[0]).toBeLessThan(soft[0]);
    expect(soft[1]).toBe(1);
  });
});

describe('effort budgets', () => {
  it('never depends on a clock and grows with the effort', () => {
    for (const n of [20, 400, 2000]) {
      const q = budgetFor(n, 'quick');
      const s = budgetFor(n, 'standard');
      const t = budgetFor(n, 'thorough');
      expect(q.queueIters).toBeLessThan(s.queueIters);
      expect(s.queueIters).toBeLessThan(t.queueIters);
      expect(budgetFor(n, 'standard')).toEqual(s);
    }
  });
});

describe('modules-first planner', () => {
  const classic = planProduction(jobs, base({ planningMode: 'classic', priorityRules: finishOnly }));
  const fast = planProduction(jobs, base({ priorityRules: finishOnly }));

  it('plans every job exactly once, on a machine that may take it', () => {
    const s = base({ priorityRules: finishOnly });
    const ctx = new SimContext(s, s.machines, {});
    const seen = new Set<string>();
    for (const [machineId, items] of Object.entries(fast.queues)) {
      const machine = s.machines.find(m => m.id === machineId)!;
      let prevEnd = 0;
      for (const it of items) {
        expect(seen.has(it.job.id)).toBe(false);
        seen.add(it.job.id);
        if (!it.erpLocked && !it.userLocked) expect(isEligible(it.job, machine, s, ctx)).toBe(true);
        expect(it.startMinute - it.setupBefore).toBeGreaterThanOrEqual(prevEnd);
        prevEnd = it.endMinute;
      }
    }
    const planned = Object.values(classic.queues).reduce((n, q) => n + q.length, 0);
    expect(seen.size).toBe(planned);
  });

  it('finishes master orders sooner than the earlier heuristic and says by how much', () => {
    expect(sumMo(fast)).toBeLessThan(sumMo(classic));
    expect(fast.optimization?.classicSumMo).toBe(sumMo(classic));
    expect(fast.optimization?.effort).toBe('quick');
    const [day1] = fast.optimization!.doneByDay;
    expect(day1[1]).toBeGreaterThanOrEqual(day1[0]);
  });

  it('leaves the classic plan alone when asked for it', () => {
    expect(classic.optimization).toBeUndefined();
    let called = false;
    planProduction(jobs, base({ planningMode: 'classic' }), {}, [], {}, { onQuick: () => (called = true) });
    expect(called).toBe(false);
  });

  it('is deterministic', () => {
    const again = planProduction(jobs, base({ priorityRules: finishOnly }));
    const shape = (p: PlanResult) => Object.fromEntries(Object.entries(p.queues).map(([m, q]) => [m, q.map(i => `${i.job.id}@${i.startMinute}`)]));
    expect(shape(again)).toEqual(shape(fast));
  });

  it('keeps ERP-assigned parts on the machine ERP gave them, at the head of its queue', () => {
    const tied = Object.values(fast.queues).flat().filter(i => i.erpLocked);
    expect(tied.length).toBeGreaterThan(0);
    for (const [machineId, items] of Object.entries(fast.queues)) {
      const lockedHere = items.filter(i => i.erpLocked);
      expect(items.slice(0, lockedHere.length).every(i => i.erpLocked)).toBe(true);
      expect(lockedHere.every(i => i.job.erpMachine === machineId)).toBe(true);
    }
  });

  it('shows the fast plan first, then reports progress up to 100% and returns the optimized plan', () => {
    const events: string[] = [];
    const progress: number[] = [];
    const plan = planProduction(jobs, base({ priorityRules: finishOnly }), {}, [], {}, {
      onQuick: p => events.push(`quick:${sumMo(p)}`),
      onProgress: f => progress.push(f),
    });
    expect(events).toEqual([`quick:${sumMo(classic)}`]);
    expect(progress.length).toBeGreaterThan(2);
    expect(progress[progress.length - 1]).toBe(1);
    expect([...progress].sort((a, b) => a - b)).toEqual(progress);
    expect(sumMo(plan)).toBeLessThan(sumMo(classic));
  });

  it('has nothing to optimize, and does not fail, when every part is already tied to a machine', () => {
    const tiedJobs = jobs.map(j => ({ ...j, erpMachine: 'HAAS - 1', blocked: false }));
    const p = planProduction(tiedJobs, base({ priorityRules: finishOnly }));
    const placed = Object.values(p.queues).flat();
    expect(placed.length).toBeGreaterThan(0);
    expect(placed.every(i => i.machineId === 'HAAS - 1')).toBe(true);
  });

  it('works around a breakdown without losing or double-booking a part', () => {
    const s = base({ priorityRules: finishOnly });
    s.timelineEvents = [{ id: 'e', machineId: 'HAAS - 1', type: 'breakdown', title: 'x', startMinute: 60, durationMinutes: 240 }];
    const p = planProduction(jobs, s);
    const items = p.queues['HAAS - 1'];
    for (const it of items) {
      // nothing is machining inside the breakdown window
      for (const seg of it.segments) expect(seg.endMinute <= 60 || seg.startMinute >= 300).toBe(true);
    }
    const count = Object.values(p.queues).reduce((n, q) => n + q.length, 0);
    expect(count).toBe(Object.values(classic.queues).reduce((n, q) => n + q.length, 0));
    expect(sumMo(p)).toBeLessThanOrEqual(sumMo(planProduction(jobs, { ...s, planningMode: 'classic' })));
  });

  it('finishes the orders of a prioritised customer sooner than without the priority', () => {
    const customers = [...new Set(jobs.map(j => j.customer))];
    const chosen = customers[customers.length - 1];
    const rules: PriorityRule[] = [{ id: 'c', type: 'customer', level: 1, enabled: true, name: 'c', values: [chosen] }, ...finishOnly.map(r => ({ ...r, level: 2 }))];
    const avgFinish = (p: PlanResult) => {
      const mine = Object.values(p.moSync).filter(m => m.customer === chosen);
      return mine.reduce((a, m) => a + m.lastFinish, 0) / Math.max(1, mine.length);
    };
    const without = planProduction(jobs, base({ priorityRules: finishOnly }));
    const withRule = planProduction(jobs, base({ priorityRules: rules }));
    expect(avgFinish(withRule)).toBeLessThan(avgFinish(without));
  });

  it('holds back master orders the carpenter has not finished, more firmly than when the carpenter is ignored', () => {
    const carpenter = demoCarpenterParts(jobs);
    const run = (mode: 'off' | 'soft' | 'hard') => planProduction(jobs, base({ priorityRules: finishOnly, carpenterDelayMode: mode }), {}, carpenter);
    const blockedAvg = (p: PlanResult) => {
      const open = p.waitingOnCarpenter.map(w => w.masterOrder);
      return open.reduce((a, mo) => a + p.moSync[mo].lastFinish, 0) / Math.max(1, open.length);
    };
    const off = run('off');
    const soft = run('soft');
    expect(soft.waitingOnCarpenter.length).toBeGreaterThan(0);
    expect(blockedAvg(soft)).toBeGreaterThanOrEqual(blockedAvg(off));
  });
});
