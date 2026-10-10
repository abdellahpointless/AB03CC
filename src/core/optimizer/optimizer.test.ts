import { describe, expect, it } from 'vitest';
import { defaultSettings } from '../defaults';
import { demoJobs } from '../demo';
import { planProduction } from '../scheduler/plan';
import { lowerBound } from './bounds';
import { makeDecoder } from './decode';
import { evaluate, modulesDoneBy, validate } from './evaluate';
import { instanceFromPlan } from './fromPlan';
import { makeQueueSearch, makeRng, optimize, startingOrders } from './search';

const settings = defaultSettings();
settings.calendar.startDate = '2026-10-09';
const jobs = demoJobs();
const plan = planProduction(jobs, settings);
const { inst, appQueues } = instanceFromPlan(plan, settings, {});

describe('optimizer instance', () => {
  it('replays the planner schedule with the planner timing', () => {
    expect(validate(inst, appQueues)).toEqual([]);
    const m = evaluate(inst, appQueues);
    expect(m.sumC).toBe(plan.kpis.sumMoCompletion);
    expect(m.makespan).toBe(plan.kpis.makespanMinutes);
    expect(m.setupTotal).toBe(plan.kpis.changeoverMinutes);
  });

  it('counts modules finished by a checkpoint', () => {
    const m = evaluate(inst, appQueues);
    const [early, all] = modulesDoneBy(m.modEnd, [0, m.makespan]);
    expect(early).toBe(0);
    expect(all).toBe(inst.M);
  });
});

describe('module decoder', () => {
  it('turns any module order into a valid schedule', () => {
    const dec = makeDecoder(inst);
    for (const order of startingOrders(inst)) {
      const q = dec.decode(order);
      expect(validate(inst, q)).toEqual([]);
      expect(dec.cost(order)).toBeCloseTo(evaluate(inst, q).sumW, 6);
    }
  });
});

describe('queue search', () => {
  it('keeps its incremental bookkeeping identical to a full replay', () => {
    const rng = makeRng(3);
    const s = makeQueueSearch(inst, appQueues);
    const t = s.sampleTemperature(rng, 300);
    expect(s.selfCheck()).toBeNull();
    for (let round = 0; round < 6; round++) {
      s.anneal(4000, t, t / 20, rng);
      expect(s.selfCheck()).toBeNull();
    }
    expect(validate(inst, s.queues())).toEqual([]);
    expect(validate(inst, s.best().queues)).toEqual([]);
  });

  it('never makes the schedule worse than where it started and is deterministic', () => {
    const run = () => optimize(inst, { seed: 7, orderIters: 3000, queueIters: 40000, restarts: 1, starts: [appQueues] });
    const a = run();
    const b = run();
    expect(a.queues).toEqual(b.queues);
    expect(validate(inst, a.queues)).toEqual([]);
    expect(a.sumC).toBeLessThanOrEqual(evaluate(inst, appQueues).sumC);
  });

  it('keeps tied (ERP assigned) parts on their machine, ahead of the free parts', () => {
    const r = optimize(inst, { seed: 2, orderIters: 2000, queueIters: 20000, restarts: 1 });
    r.queues.forEach((q, k) => {
      q.forEach((j, i) => {
        if (inst.fixed[j] >= 0) {
          expect(inst.fixed[j]).toBe(k);
          expect(i).toBeLessThan(inst.head[k].length);
        }
      });
    });
  });
});

describe('lower bound', () => {
  it('is never above what a real schedule achieves', () => {
    const lb = lowerBound(inst);
    expect(lb.sumC).toBeLessThanOrEqual(evaluate(inst, appQueues).sumC);
    const r = optimize(inst, { seed: 1, orderIters: 2000, queueIters: 20000, restarts: 1 });
    expect(lb.sumC).toBeLessThanOrEqual(r.sumC);
  });
});

describe('downtime', () => {
  for (const restart of [false, true]) {
    it(`replays the planner minute for minute when machines are interrupted (${restart ? 'jobs restart' : 'jobs pause'})`, () => {
      const s = defaultSettings();
      s.calendar.startDate = '2026-10-09';
      s.restartJobOnEvent = restart;
      s.timelineEvents = [
        { id: 'a', machineId: 'HAAS - 1', type: 'breakdown', title: 'a', startMinute: 130, durationMinutes: 75 },
        { id: 'b', machineId: 'ALL', type: 'maintenance', title: 'b', startMinute: 400, durationMinutes: 30 },
        { id: 'c', machineId: 'FANUC - 2', type: 'absent', title: 'c', startMinute: 0, durationMinutes: 20 },
        { id: 'd', machineId: 'HAAS - 5', type: 'other', title: 'd', startMinute: 215, durationMinutes: 400 },
      ];
      const p = planProduction(jobs, s);
      const built = instanceFromPlan(p, s, {});
      const m = evaluate(built.inst, built.appQueues);
      const index = new Map(built.inst.jobs.map((j, i) => [j.id, i]));
      let checked = 0;
      for (const q of Object.values(p.queues))
        for (const it of q) {
          const j = index.get(it.job.id)!;
          expect([it.job.id, m.start[j], m.end[j]]).toEqual([it.job.id, it.startMinute, it.endMinute]);
          checked++;
        }
      expect(checked).toBe(built.inst.n);
      expect(m.sumC).toBe(p.kpis.sumMoCompletion);

      // the incremental search agrees with the full replay on interrupted machines too
      const rng = makeRng(11);
      const search = makeQueueSearch(built.inst, built.appQueues);
      const t = search.sampleTemperature(rng, 300);
      for (let round = 0; round < 4; round++) {
        search.anneal(3000, t, t / 20, rng);
        expect(search.selfCheck()).toBeNull();
      }
      const res = optimize(built.inst, { seed: 3, orderIters: 1500, queueIters: 15000, restarts: 1, starts: [built.appQueues] });
      expect(validate(built.inst, res.queues)).toEqual([]);
      expect(res.sumC).toBeLessThanOrEqual(m.sumC);
    });
  }
});
