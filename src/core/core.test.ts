import { describe, expect, it } from 'vitest';
import { WorkCalendar } from './calendar';
import { demoCarpenterParts, demoJobs } from './demo';
import { defaultSettings } from './defaults';
import { plannedDuration } from './efficiency';
import { buildCarpenterMap, normalizeMo } from './parse/carpenter';
import { parseProduction } from './parse/production';
import { toIsoDate } from './parse/workbook';
import { isEligible, planProduction } from './scheduler/plan';
import { SimContext } from './scheduler/simulate';
import type { Job } from './types';

const settings = () => {
  const s = defaultSettings();
  s.calendar.startDate = '2026-10-09'; // a Friday
  return s;
};

describe('production parser', () => {
  const row = (over: Record<string, unknown>) => ({
    'Box Code': 217,
    'Master Order Number': '300000138107',
    'Order Number': '300000138107',
    Matnr: '200138302',
    'Nc File Minute': 21,
    'Material No': '200138302',
    'Material Type': 'pcgf',
    'Sales Order': 14102306,
    Qty: '2',
    'Cutting Count': 3,
    'Finished Count': 1,
    'Production Status': null,
    DiscontinuedReason: null,
    ...over,
  });

  it('keeps leading zeros, upper-cases material and flags blocked rows', () => {
    const { jobs } = parseProduction([row({}), row({ 'Order Number': 'B', 'Production Status': '11' }), row({ 'Order Number': 'C', DiscontinuedReason: 'Wrong CAM' })]);
    expect(jobs[0].boxCode).toBe('0217');
    expect(jobs[0].salesOrder).toBe('0014102306');
    expect(jobs[0].materialType).toBe('PCGF');
    expect(jobs[0].qty).toBe(2);
    expect(jobs[0].boxRemaining).toBe(2);
    expect(jobs[1].blocked).toBe(true);
    expect(jobs[2].blockedReason).toContain('Wrong CAM');
  });

  it('keeps duplicate order numbers as separate jobs', () => {
    const { jobs, report } = parseProduction([row({}), row({})]);
    expect(new Set(jobs.map(j => j.id)).size).toBe(2);
    expect(report.warnings.join(' ')).toMatch(/duplicate/);
  });

  it('converts excel serial dates', () => {
    expect(toIsoDate(46311)).toBe('2026-10-16');
    expect(toIsoDate('2026-10-16T00:00:00')).toBe('2026-10-16');
  });
});

describe('efficiency', () => {
  const job = parseProduction([{ 'Box Code': '1', 'Master Order Number': 'M', 'Order Number': '1', 'Nc File Minute': 10, 'Material Type': 'FH', Qty: 2 }]).jobs[0];
  it('applies (nc / eff + offset) x qty with the documented lookup order', () => {
    const s = settings();
    const m = s.machines[0];
    expect(plannedDuration(job, m, s).durationMin).toBe(2 * (10 + 2)); // FH offset = 2
    s.globalEfficiencyPercent = 50;
    expect(plannedDuration(job, m, s).durationMin).toBe(2 * (20 + 2));
    s.materialEfficiency.FH = 80;
    expect(plannedDuration(job, m, s).durationMin).toBe(Math.round(2 * (12.5 + 2)));
    s.efficiencyMatrix[m.id] = { FH: 100 };
    expect(plannedDuration(job, m, s).durationMin).toBe(2 * (10 + 2));
    expect(plannedDuration(job, m, s, 77).durationMin).toBe(77);
  });
});

describe('calendar', () => {
  it('skips weekends', () => {
    const cal = new WorkCalendar(settings().calendar); // Fri 09/10
    expect(cal.toIso(0)).toBe('2026-10-09T06:00');
    expect(cal.toIso(960)).toBe('2026-10-12T06:00'); // next working day is Monday
    expect(cal.toIso(960, true)).toBe('2026-10-09T22:00');
  });
});

describe('carpenter join', () => {
  it('normalizes master orders and detects open parts', () => {
    expect(normalizeMo(' 300 12.0')).toBe('30012');
    const parts = [
      { masterOrder: '100', qty: 1, cuttedStatus: true, carpenterStatus: false },
      { masterOrder: '100', qty: 2, cuttedStatus: false, carpenterStatus: false, alertMessage: 'no stock' },
    ];
    const { map, report } = buildCarpenterMap(parts, ['100.0'], 'cutted_status');
    expect(map['100'].openParts).toBe(1);
    expect(map['100'].status).toBe('material_issue');
    expect(report.matchedMasterOrders).toBe(1);
  });
});

describe('scheduler', () => {
  const jobs = demoJobs();

  it('plans every schedulable job exactly once, on an eligible machine, without overlaps', () => {
    const s = settings();
    const plan = planProduction(jobs, s, {}, demoCarpenterParts(jobs));
    const ctx = new SimContext(s, s.machines);
    const seen = new Set<string>();
    for (const [machineId, queue] of Object.entries(plan.queues)) {
      const machine = s.machines.find(m => m.id === machineId)!;
      let end = 0;
      for (const it of queue) {
        expect(seen.has(it.job.id)).toBe(false);
        seen.add(it.job.id);
        expect(it.startMinute).toBeGreaterThanOrEqual(end);
        end = it.endMinute;
        if (!it.erpLocked) expect(isEligible(it.job, machine, s, ctx)).toBe(true);
      }
    }
    const ex = plan.exceptions;
    expect(seen.size + ex.blocked.length + ex.outOfScope.length + ex.manual30000.length + ex.noEligibleMachine.length).toBe(jobs.length);
  });

  it('is deterministic', () => {
    const a = planProduction(jobs, settings());
    const b = planProduction(jobs, settings());
    const sig = (p: typeof a) => Object.values(p.queues).flat().map(i => `${i.machineId}:${i.job.id}:${i.startMinute}`).join('|');
    expect(sig(a)).toBe(sig(b));
  });

  it('honours a user pin, a manual duration and downtime', () => {
    const s = settings();
    const target = jobs.find(j => j.materialType === 'ALU' && !j.erpMachine && !j.masterOrder.startsWith('30000'))!;
    s.timelineEvents = [{ id: 'e', machineId: 'ALL', type: 'breakdown', title: 'x', startMinute: 30, durationMinutes: 120 }];
    const plan = planProduction(jobs, s, { [target.id]: { machine: 'HAAS - 1', durationMin: 45 } });
    const it = plan.queues['HAAS - 1'].find(i => i.job.id === target.id)!;
    expect(it).toBeTruthy();
    expect(it.userLocked).toBe(true);
    expect(it.durationMin).toBe(45);
    for (const q of Object.values(plan.queues))
      for (const i of q) for (const seg of i.segments) expect(seg.endMinute <= 30 || seg.startMinute >= 150).toBe(true);
  });

  it('keeps machines that are down empty', () => {
    const s = settings();
    s.machines[0].isDown = true;
    const plan = planProduction(jobs, s);
    expect(plan.queues[s.machines[0].id]).toBeUndefined();
  });

  it('keeps carpenter-blocked modules out of the synchronized count', () => {
    const s = settings();
    const mo = jobs.find(j => !j.masterOrder.startsWith('30000') && !j.erpMachine)!.masterOrder;
    s.simulatedUncutMasterOrders = [mo];
    const plan = planProduction(jobs, s);
    expect(plan.moSync[mo]?.synchronized ?? false).toBe(false);
    expect(plan.waitingOnCarpenter.some(w => w.masterOrder === mo)).toBe(true);
  });
});

it('type sanity: Job fields used by the UI exist', () => {
  const j: Pick<Job, 'id' | 'boxCode'> = { id: '1', boxCode: '0001' };
  expect(j.boxCode).toBe('0001');
});
