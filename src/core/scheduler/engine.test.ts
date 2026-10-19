import { describe, expect, it } from 'vitest';
import { demoCarpenterParts, demoJobs } from '../demo';
import { defaultSettings } from '../defaults';
import { budgetFor } from '../optimizer/budget';
import { analyzeEmergency } from '../emergency';
import { buildGroups, classifyKinds, parsePrefixes } from '../partKinds';
import type { Job, PlanResult, PlannerSettings, PriorityRule } from '../types';
import { isEligible, planProduction } from './plan';
import { SimContext } from './simulate';
import { moduleWeights, type ModuleFacts } from './weights';

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

  it('gives every order the same weight and class when no rule singles any out', () => {
    expect(moduleWeights([facts({}), facts({}), facts({})], finishOnly, 'soft')).toEqual({ weights: [1, 1, 1], tiers: [0, 0, 0] });
  });

  it('puts an order matching a customer rule in a class of its own, planned first', () => {
    const rules: PriorityRule[] = [{ id: 'c', type: 'customer', level: 1, enabled: true, name: 'c', values: ['ACME'] }, ...finishOnly.map(r => ({ ...r, level: 2 }))];
    const [acme, other] = moduleWeights([facts({ customer: 'ACME' }), facts({ customer: 'Other' })], rules, 'soft').tiers;
    expect(acme).toBeLessThan(other);
  });

  it('lets a more important level beat a less important one, like digits', () => {
    const rules: PriorityRule[] = [
      { id: 'a', type: 'customer', level: 1, enabled: true, name: 'a', values: ['A'] },
      { id: 'b', type: 'sales_order', level: 2, enabled: true, name: 'b', values: ['S2'] },
    ];
    const { tiers } = moduleWeights([facts({ salesOrder: 'S2' }), facts({ customer: 'A' }), facts({ customer: 'A', salesOrder: 'S2' }), facts({})], rules, 'off');
    const [onlyLevel2, onlyLevel1, both, none] = tiers;
    expect(both).toBeLessThan(onlyLevel1);
    expect(onlyLevel1).toBeLessThan(onlyLevel2);
    expect(onlyLevel2).toBeLessThan(none);
  });

  it('nudges closer production dates up and furthest-first dates down', () => {
    const closeFirst: PriorityRule[] = [{ id: 'd', type: 'production_date', level: 1, enabled: true, name: 'd', dateDirection: 'closest_first' }];
    const mods = [facts({ plannedDate: '2026-10-20' }), facts({ plannedDate: '2026-10-10' }), facts({ plannedDate: '2026-10-30' })];
    const [mid, early, late] = moduleWeights(mods, closeFirst, 'off').weights;
    expect(early).toBeGreaterThan(mid);
    expect(mid).toBeGreaterThan(late);
    expect(early / late).toBeLessThan(1.5); // a nudge, never a rule
    const furthest = moduleWeights(mods, [{ ...closeFirst[0], dateDirection: 'furthest_first' }], 'off').weights;
    expect(furthest[2]).toBeGreaterThan(furthest[1]);
  });

  it('puts the orders still waiting for the carpenter right after the ready ones of their class, unless it is off', () => {
    const rules: PriorityRule[] = [{ id: 'c', type: 'customer', level: 1, enabled: true, name: 'c', values: ['ACME'] }, ...finishOnly.map(r => ({ ...r, level: 2 }))];
    const mods = [facts({ customer: 'ACME' }, { carpenterBlocked: true }), facts({ customer: 'ACME' }), facts({ customer: 'Other' }), facts({ customer: 'Other' }, { carpenterBlocked: true })];
    const [acmeWaiting, acmeReady, otherReady, otherWaiting] = moduleWeights(mods, rules, 'soft').tiers;
    expect(acmeReady).toBeLessThan(acmeWaiting);
    expect(acmeWaiting).toBeLessThan(otherReady); // the user's class still comes first
    expect(otherReady).toBeLessThan(otherWaiting);
    const off = moduleWeights(mods, rules, 'off').tiers;
    expect(off[0]).toBe(off[1]);
    expect(off[2]).toBe(off[3]);
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

  it('keeps ERP-assigned parts on the machine ERP gave them (the optimizer chooses their place in its queue)', () => {
    const tied = Object.values(fast.queues).flat().filter(i => i.erpLocked);
    expect(tied.length).toBeGreaterThan(0);
    for (const [machineId, items] of Object.entries(fast.queues)) expect(items.filter(i => i.erpLocked).every(i => i.job.erpMachine === machineId)).toBe(true);
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

  it('keeps the ERP machine only when that machine takes the part; the others are planned where they are allowed', () => {
    const s = base({ priorityRules: finishOnly });
    const haas1 = s.machines.find(m => m.id === 'HAAS - 1')!;
    const tiedJobs = jobs.map(j => ({ ...j, erpMachine: 'HAAS - 1', blocked: false }));
    const p = planProduction(tiedJobs, s);
    const ctx = new SimContext(s, s.machines, {});
    const placed = Object.values(p.queues).flat();
    expect(placed.length).toBeGreaterThan(0);
    for (const it of placed) {
      expect(isEligible(it.job, s.machines.find(m => m.id === it.machineId)!, s, ctx)).toBe(true);
      if (isEligible(it.job, haas1, s, ctx)) expect(it.machineId).toBe('HAAS - 1');
    }
    expect(p.exceptions.erpRefused.length).toBeGreaterThan(0);
    for (const j of p.exceptions.erpRefused) expect(p.refusals[j.id]).toMatch(/^ERP machine HAAS - 1: /);
  });

  it('never lets a part break a size limit or a material rule, whatever the ERP says', () => {
    const s = base({ priorityRules: finishOnly });
    const fanuc2 = s.machines.find(m => m.id === 'FANUC - 2')!;
    const onFanuc2 = jobs.map(j => ({ ...j, erpMachine: 'FANUC - 2', blocked: false }));
    const p = planProduction(onFanuc2, s);
    for (const it of p.queues['FANUC - 2'] ?? []) {
      expect(fanuc2.allowedMaterials).toContain(it.job.materialType);
      expect(it.job.ncMinutes).toBeLessThan(fanuc2.size!.max!);
    }
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

  it('respects the rule levels strictly: a machine runs level 1 parts, then level 2 parts, then the rest', () => {
    const bySo = new Map<string, number>();
    for (const j of jobs) bySo.set(j.salesOrder, (bySo.get(j.salesOrder) ?? 0) + 1);
    const [first, second] = [...bySo].filter(([so]) => so).sort((a, b) => b[1] - a[1]).slice(0, 2).map(x => x[0]);
    const rules: PriorityRule[] = [
      { id: 'a', type: 'sales_order', level: 1, enabled: true, name: 'a', values: [first] },
      { id: 'b', type: 'sales_order', level: 2, enabled: true, name: 'b', values: [second] },
      ...finishOnly.map(r => ({ ...r, level: 3 })),
    ];
    const rank = (so: string) => (so === first ? 0 : so === second ? 1 : 2);
    for (const mode of ['classic', 'modules_first'] as const) {
      const p = planProduction(jobs, base({ priorityRules: rules, planningMode: mode }));
      for (const items of Object.values(p.queues)) {
        const ranks = items.map(i => rank(i.job.salesOrder));
        expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
      }
    }
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

describe('modules still at the carpenter', () => {
  // a module with 1 part left in the workload and 3 uncut parts at the carpenter, among modules that are complete here
  const setup = () => {
    const all = demoJobs().filter(j => !j.blocked && j.masterOrder.startsWith('10000'));
    const counts = new Map<string, number>();
    for (const j of all) counts.set(j.masterOrder, (counts.get(j.masterOrder) ?? 0) + 1);
    const mo = [...counts].find(([, n]) => n >= 2)![0];
    const keep = all.find(j => j.masterOrder === mo)!;
    const jobs = all.filter(j => j.masterOrder !== mo || j.id === keep.id);
    // the website marks whole orders as cut: these rows say "cut" but they are still in the list, so still at the carpenter
    const carp = (n: number) => ({ masterOrder: mo, workOrder: `30000099${n}`, text: `Wood part ${n}`, qty: 1, cuttedStatus: true, carpenterStatus: false });
    const carpenter = [carp(1), carp(2), carp(3)];
    return { jobs, mo, keep, carpenter };
  };

  it('counts its uncut carpenter parts as parts left and plans the modules that can be finished first', () => {
    const { jobs, mo, keep, carpenter } = setup();
    const p = planProduction(jobs, base({ priorityRules: finishOnly }), {}, carpenter);
    const item = Object.values(p.queues).flat().find(i => i.job.id === keep.id)!;
    expect(item.decidingRule).toContain('4 parts left, 3 still at the carpenter');
    expect(p.moSync[mo].carpenterBlocked).toBe(true);
    // on its machine, every part of a ready module runs before it
    const q = p.queues[item.machineId];
    const at = q.findIndex(i => i.job.id === keep.id);
    expect(q.slice(at + 1).every(i => p.moSync[i.job.masterOrder]?.carpenterBlocked)).toBe(true);
    // with the carpenter ignored, the 1-part module is one of the very first to finish
    const off = planProduction(jobs, base({ priorityRules: finishOnly, carpenterDelayMode: 'off' }), {}, carpenter);
    const ends = Object.values(off.moSync).map(m => m.lastFinish).sort((a, b) => a - b);
    expect(off.moSync[mo].lastFinish).toBeLessThanOrEqual(ends[Math.floor(ends.length / 4)]);
    expect(p.moSync[mo].lastFinish).toBeGreaterThan(off.moSync[mo].lastFinish);
  });

  it('treats a module that is no longer in the carpenter list as complete in the workload', () => {
    const { jobs, mo, keep } = setup();
    const p = planProduction(jobs, base({ priorityRules: finishOnly }), {}, []);
    expect(p.moSync[mo].carpenterBlocked).toBe(false);
    expect(Object.values(p.queues).flat().find(i => i.job.id === keep.id)!.decidingRule).toContain('1 part left');
  });
});

describe('what is still at the carpenter', () => {
  const jobs = demoJobs().filter(j => !j.blocked && j.masterOrder.startsWith('10000'));
  const mo = jobs[0].masterOrder;
  it('trusts the Cutted Status column only when told to', () => {
    const rows = [1, 2].map(n => ({ masterOrder: mo, workOrder: `9${n}`, qty: 1, cuttedStatus: true, carpenterStatus: false }));
    expect(planProduction(jobs, base({ priorityRules: finishOnly, planningMode: 'classic' }), {}, rows).moSync[mo].carpenterBlocked).toBe(true);
    expect(planProduction(jobs, base({ priorityRules: finishOnly, planningMode: 'classic', carpenterCutColumn: 'cutted_status' }), {}, rows).moSync[mo].carpenterBlocked).toBe(false);
  });
  it("uses the workload's own counters for parts the carpenter list does not show", () => {
    const counted = jobs.map(j => (j.masterOrder === mo ? { ...j, atCarpenter: 2 } : j));
    const p = planProduction(counted, base({ priorityRules: finishOnly, planningMode: 'classic' }), {}, []);
    expect(p.moSync[mo].carpenterBlocked).toBe(true);
    expect(p.carpenter[mo].notInList).toBe(2);
    expect(Object.values(p.queues).flat().find(i => i.job.masterOrder === mo)!.decidingRule).toContain('2 still at the carpenter');
  });
});

describe('part kinds, tables and spares', () => {
  const tableJobs = (): Job[] => {
    const base = demoJobs();
    // three table parts of one sales order, two spare parts of another, one rework part
    const mk = (j: Job, order: string, master: string, so: string): Job => ({ ...j, id: `x-${order}`, orderNumber: order, masterOrder: master, salesOrder: so, erpMachine: null, blocked: false });
    const pick = base.filter(j => j.materialType === 'ALU' && !j.blocked).slice(0, 6);
    return [
      ...base,
      mk(pick[0], '600000000001', '600000000001', 'SO-TABLE'),
      mk(pick[1], '600000000002', '600000000001', 'SO-TABLE'),
      mk(pick[2], '300000000003', '300000000003', 'SO-TABLE'), // 30000 with the sales order of a 60000: a table too
      mk(pick[3], '300000000010', '300000000010', 'SO-SPARE'),
      mk(pick[4], '300000000011', '300000000011', 'SO-SPARE'),
      mk(pick[5], '800000000001', base[0].masterOrder, 'SO-REWORK'),
    ];
  };

  it('knows tables, spares, rework and modules by how their numbers start', () => {
    const jobs = tableJobs();
    const kinds = classifyKinds(jobs);
    expect(kinds.get('x-600000000001')).toBe('table');
    expect(kinds.get('x-300000000003')).toBe('table');
    expect(kinds.get('x-300000000010')).toBe('spare');
    expect(kinds.get('x-800000000001')).toBe('rework');
    expect(buildGroups(jobs, kinds).map(g => [g.kind, g.jobIds.length])).toEqual([['spare', 2], ['table', 3]]);
  });

  it('uses the order-number prefixes from the settings', () => {
    const jobs = tableJobs();
    // tables are no longer 60000: they fall back to modules; 80000 rework is now a module, 30000 stays spare
    const kinds = classifyKinds(jobs, { rework: ['81000'], table: ['61000'], spare: ['30000', '60000'] });
    expect(kinds.get('x-800000000001')).toBe('module');
    expect(kinds.get('x-600000000001')).toBe('spare');
    expect(kinds.get('x-300000000010')).toBe('spare');
    expect(parsePrefixes(' 80000, 81000;x 80000 ')).toEqual(['80000', '81000']);
  });

  it('counts rework, spares and tables on their own, never as finished modules', () => {
    const jobs = tableJobs();
    const s = base({ priorityRules: finishOnly });
    s.partWindows = { 'table|SO-TABLE': { start: '2026-10-09T10:00', finish: '2026-10-09T20:00' }, 'spare|SO-SPARE': { start: '2026-10-10T06:00', finish: '2026-10-10T20:00' } };
    const p = planProduction(jobs, s);
    expect(p.kpis.finished).toEqual({ rework: 1, spares: 2, tables: 2 });
    const modules = Object.values(p.moSync).filter(m => m.kind === 'module');
    expect(p.kpis.totalMos).toBe(modules.length);
    expect(Object.values(p.moSync).filter(m => m.kind === 'table').map(m => m.masterOrder).sort()).toEqual(['300000000003', '600000000001']);
    // the rework part shares its module's master order, but the module finishes with its own parts
    const mo = jobs.find(j => j.id === 'x-800000000001')!.masterOrder;
    const own = Object.values(p.queues).flat().filter(i => i.job.masterOrder === mo && i.kind === 'module');
    if (own.length) expect(p.moSync[mo].lastFinish).toBe(Math.max(...own.map(i => i.endMinute)));
    expect(p.moSync[mo]?.parts ?? 0).toBe(own.length);
  });

  it('leaves tables and spares unplanned until the user gives them a start and a finish', () => {
    const jobs = tableJobs();
    const p = planProduction(jobs, base({ priorityRules: finishOnly }));
    const planned = new Set(Object.values(p.queues).flat().map(i => i.job.id));
    expect(['x-600000000001', 'x-300000000003', 'x-300000000010'].some(id => planned.has(id))).toBe(false);
    expect(p.exceptions.manual30000.length).toBeGreaterThanOrEqual(5);
  });

  it('plans a table inside its window and barely disturbs the other orders', () => {
    const jobs = tableJobs();
    const s = base({ priorityRules: finishOnly });
    const without = planProduction(jobs, s);
    s.partWindows = { 'table|SO-TABLE': { start: '2026-10-09T10:00', finish: '2026-10-09T20:00' }, 'spare|SO-SPARE': { start: '2026-10-10T06:00', finish: '2026-10-10T20:00' } };
    const p = planProduction(jobs, s);
    const items = Object.values(p.queues).flat();
    const table = items.filter(i => i.windowGroup === 'table|SO-TABLE');
    expect(table).toHaveLength(3);
    const release = 4 * 60; // 10:00 on a shift starting at 06:00
    for (const it of table) expect(it.startMinute).toBeGreaterThanOrEqual(release);
    expect(p.windowReport['table|SO-TABLE'].lateBy).toBe(0);
    expect(p.windowReport['spare|SO-SPARE'].startMinute).toBeGreaterThanOrEqual(960);
    // the other orders finish no more than a table's worth of work later
    const tableMinutes = table.reduce((a, i) => a + i.durationMin, 0);
    const otherEnd = (pl: PlanResult) => Object.values(pl.queues).flat().filter(i => !i.windowGroup && i.kind === 'module').reduce((m, i) => Math.max(m, i.endMinute), 0);
    expect(otherEnd(p) - otherEnd(without)).toBeLessThanOrEqual(tableMinutes + 90);
  });

  it('plans a table with a tight finish together with the modules: on time, and the modules finish sooner than with the quick insertion', () => {
    const jobs = tableJobs();
    const s = base({ priorityRules: finishOnly });
    s.partWindows = { 'table|SO-TABLE': { start: '2026-10-09T06:00', finish: '2026-10-09T09:00' } };
    let quick: PlanResult | null = null;
    const p = planProduction(jobs, s, {}, [], {}, { onQuick: q => (quick = q) });
    expect(quick).not.toBeNull();
    expect(p.windowReport['table|SO-TABLE'].lateBy).toBe(0);
    const modules = (pl: PlanResult) => Object.values(pl.moSync).filter(m => !m.masterOrder.startsWith('6') && !m.masterOrder.startsWith('3')).reduce((a, m) => a + m.lastFinish, 0);
    expect(modules(p)).toBeLessThanOrEqual(modules(quick!));
  });

  it('keeps a table inside the class that is running when it has to be finished', () => {
    const jobs = tableJobs();
    const so = jobs.find(j => j.salesOrder && !j.blocked && !j.orderNumber.startsWith('6') && !j.orderNumber.startsWith('3'))!.salesOrder;
    const rules: PriorityRule[] = [{ id: 'a', type: 'sales_order', level: 1, enabled: true, name: 'a', values: [so] }, ...finishOnly.map(r => ({ ...r, level: 2 }))];
    const s = base({ priorityRules: rules });
    s.partWindows = { 'table|SO-TABLE': { start: '2026-10-09T06:00', finish: '2026-10-12T20:00' } };
    const p = planProduction(jobs, s);
    expect(p.windowReport['table|SO-TABLE'].lateBy).toBe(0);
    // a late finish: the table waits for the first class, it does not jump ahead of it
    for (const q of Object.values(p.queues)) {
      const lastFirst = q.map(i => i.job.salesOrder === so).lastIndexOf(true);
      const firstTable = q.findIndex(i => i.windowGroup === 'table|SO-TABLE');
      if (lastFirst >= 0 && firstTable >= 0) expect(firstTable).toBeGreaterThan(lastFirst);
    }
  });

  it('runs rework parts before anything else on their machine, whatever the rules say', () => {
    const jobs = tableJobs();
    const p = planProduction(jobs, base({ priorityRules: finishOnly }));
    const rework = Object.values(p.queues).flat().find(i => i.kind === 'rework')!;
    expect(rework).toBeDefined();
    const queue = p.queues[rework.machineId];
    const firstNonRework = queue.findIndex(i => i.kind !== 'rework');
    expect(queue.indexOf(rework)).toBeLessThan(firstNonRework < 0 ? Infinity : firstNonRework);
  });
});

describe('emergency orders', () => {
  const jobs = demoJobs();
  const customerSo = jobs.find(j => j.salesOrder && !j.blocked)!.salesOrder;

  it('plans the parts of an emergency sales order before anything else on every machine', () => {
    const s = base({ priorityRules: finishOnly });
    s.emergencies = [{ id: 'e', salesOrder: customerSo, schedule: null, applied: true }];
    for (const mode of ['classic', 'modules_first'] as const) {
      const p = planProduction(jobs, { ...s, planningMode: mode });
      for (const items of Object.values(p.queues)) {
        const flags = items.map(i => i.emergency);
        expect(flags).toEqual([...flags].sort((a, b) => Number(b) - Number(a))); // all urgent parts come first
      }
      expect(Object.values(p.queues).flat().some(i => i.emergency)).toBe(true);
    }
  });

  it('tells how long the parts take alone, and what that does to the rest', () => {
    const a = analyzeEmergency({ jobs, settings: base({ priorityRules: finishOnly }), locks: {}, carpenterParts: [], partTimes: {}, salesOrder: customerSo, schedule: null });
    expect(a.planned).toBeGreaterThan(0);
    expect(a.finishMinute).toBeGreaterThan(0);
    expect(a.machines.length).toBeGreaterThan(0);
    expect(a.effect).not.toBeNull();
    // planned alone it cannot take longer than it does inside the full plan with the emergency applied
    const s = base({ priorityRules: finishOnly });
    s.emergencies = [{ id: 'e', salesOrder: customerSo, schedule: null, applied: true }];
    const full = planProduction(jobs, s);
    const finish = Math.max(...Object.values(full.queues).flat().filter(i => i.emergency).map(i => i.endMinute));
    expect(a.finishMinute).toBeLessThanOrEqual(finish);
  });
});

describe('End rule', () => {
  it('plans only what the rules above it pick, and lists the rest as left out', () => {
    const so = jobs.find(j => j.salesOrder)!.salesOrder;
    const rules: PriorityRule[] = [
      { id: 's', type: 'sales_order', level: 1, enabled: true, name: 's', values: [so] },
      { id: 'e', type: 'end', level: 1, enabled: true, name: 'End' },
      ...finishOnly.map(r => ({ ...r, level: 2 })),
    ];
    const p = planProduction(jobs, base({ planningMode: 'classic', priorityRules: rules }));
    const planned = Object.values(p.queues).flat().map(s => s.job);
    expect(planned.length).toBeGreaterThan(0);
    expect(planned.every(j => j.salesOrder === so)).toBe(true);
    expect(p.exceptions.leftOut!.length).toBeGreaterThan(0);
    expect(p.exceptions.leftOut!.every(j => j.salesOrder !== so)).toBe(true);
    // an End with nothing above it to pick does nothing
    const alone = planProduction(jobs, base({ planningMode: 'classic', priorityRules: [{ id: 'e', type: 'end', level: 1, enabled: true, name: 'End' }, ...finishOnly.map(r => ({ ...r, level: 2 }))] }));
    expect(alone.exceptions.leftOut!.length).toBe(0);
  });
});
