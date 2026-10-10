import { describe, expect, it } from 'vitest';
import { WorkCalendar, planStartOffset } from './calendar';
import { demoCarpenterParts, demoJobs } from './demo';
import { defaultSettings, mergeSettings } from './defaults';
import { plannedDuration } from './efficiency';
import { buildCarpenterMap, normalizeMo } from './parse/carpenter';
import { buildPartTimeIndex, looksLikePartTimes, parsePartTimes, partKey, pickPartTimes } from './parse/partTimes';
import { parseProduction } from './parse/production';
import { toIsoDate } from './parse/workbook';
import { isEligible, planProduction } from './scheduler/plan';
import { bucketIndexOf, computeThroughput, niceTicks } from './throughput';
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

describe('timing model', () => {
  const job = parseProduction([{ 'Box Code': '1', 'Master Order Number': 'M', 'Order Number': '1', Matnr: '200010006', 'Nc File Minute': 10, 'Material Type': 'FH', Qty: 2 }]).jobs[0];

  it('estimates parts missing from the list as NC x 2.8 x qty', () => {
    const s = settings();
    const d = plannedDuration(job, s.machines[0], s);
    expect(d.basis).toBe('estimated');
    expect(d.durationMin).toBe(Math.round(10 * 2.8 * 2));
  });

  it('applies efficiency rules and material offsets to estimates only, in the documented lookup order', () => {
    const s = settings();
    s.estimateMultiplier = 1;
    s.materialOffsets.FH = 20; // percent
    const m = s.machines[0];
    expect(plannedDuration(job, m, s).durationMin).toBe(Math.round(2 * 10 * 1.2));
    s.globalEfficiencyPercent = 50;
    expect(plannedDuration(job, m, s).durationMin).toBe(Math.round(2 * 20 * 1.2));
    s.materialEfficiency.FH = 80;
    expect(plannedDuration(job, m, s).durationMin).toBe(Math.round(2 * 12.5 * 1.2));
    s.efficiencyMatrix[m.id] = { FH: 100 };
    expect(plannedDuration(job, m, s).durationMin).toBe(Math.round(2 * 10 * 1.2));
    expect(plannedDuration(job, m, s, 77).durationMin).toBe(77);
  });

  it('uses the measured time as-is and ignores every efficiency rule and offset', () => {
    const s = settings();
    s.globalEfficiencyPercent = 50;
    s.materialEfficiency.FH = 40;
    s.materialOffsets.FH = 9;
    s.efficiencyMode = 'cautious';
    s.machines[0].speedPercentage = 60;
    s.partEfficiencyOverrides[job.id] = 30;
    const d = plannedDuration(job, s.machines[0], s, undefined, 16.765);
    expect(d.basis).toBe('measured');
    expect(d.durationMin).toBe(Math.round(16.765 * 2));
    expect(d.cautiousDurationMin).toBe(d.durationMin);
    expect(d.materialOffset).toBe(0);
  });

  it('a manual run time still beats a measured time', () => {
    const s = settings();
    expect(plannedDuration(job, s.machines[0], s, 61, 16.765).durationMin).toBe(61);
  });
});

describe('parts time list', () => {
  const rows = [
    { 'Material Number': '0200010006', 'Material Name': 'Test Bracket', 'Time per Part, avg (min)': 16.7647, 'NC File, avg (min)': 6 },
    { 'Material Number': 2638354, 'Material Name': 'Plate', 'Time per Part, avg (min)': '10,5', 'NC File, avg (min)': 5 },
    { 'Material Number': 'bad', 'Material Name': 'Zero', 'Time per Part, avg (min)': 0 },
  ];

  it('recognises the list by its columns and skips unusable rows', () => {
    expect(looksLikePartTimes(rows[0])).toBe(true);
    expect(looksLikePartTimes({ 'Box Code': 1, 'Nc File Minute': 2 })).toBe(false);
    const { entries, skipped } = parsePartTimes(rows);
    expect(entries.map(e => e[0])).toEqual(['200010006', '2638354']);
    expect(entries[1][1]).toBe(10.5);
    expect(skipped).toBe(1);
  });

  it('matches material numbers despite leading zeros and ".0" suffixes', () => {
    expect(partKey('0200010006')).toBe('200010006');
    expect(partKey(' 200010006.0 ')).toBe('200010006');
    expect(partKey(200010006)).toBe('200010006');
    const index = buildPartTimeIndex(parsePartTimes(rows).entries);
    const jobs = parseProduction([{ 'Box Code': '1', 'Master Order Number': 'M', 'Order Number': '1', Matnr: '200010006', 'Nc File Minute': 6, 'Material Type': 'ALU' }]).jobs;
    expect(pickPartTimes(index, jobs)['200010006'].minutes).toBeCloseTo(16.765, 2);
  });
});

describe('throughput', () => {
  const jobs = demoJobs();
  const s = settings();
  const plan = planProduction(jobs, s);

  it('puts every planned part and every module in exactly one bucket, for any granularity', () => {
    const moCount = new Set(Object.values(plan.queues).flat().map(i => i.job.masterOrder)).size;
    for (const g of ['hour', 'shift', 'day'] as const) {
      const t = computeThroughput(plan, s.calendar, g);
      expect(t.buckets.reduce((a, b) => a + b.parts.length, 0)).toBe(plan.kpis.plannedJobs);
      expect(t.totals.mos + t.totals.heldMos).toBe(moCount);
      expect(t.buckets.at(-1)!.cumulativeParts).toBe(plan.kpis.plannedJobs);
      expect(t.days.reduce((a, d) => a + d.parts, 0)).toBe(plan.kpis.plannedJobs);
    }
  });

  it('counts a part ending exactly on the hour in the hour that just closed', () => {
    expect(bucketIndexOf(60, 60)).toBe(0);
    expect(bucketIndexOf(61, 60)).toBe(1);
    expect(bucketIndexOf(960, 480)).toBe(1);
  });

  it('holds modules with open carpenter parts out of the finished count', () => {
    const mo = jobs.find(j => !j.masterOrder.startsWith('30000') && !j.erpMachine)!.masterOrder;
    const s2 = settings();
    s2.simulatedUncutMasterOrders = [mo];
    const p2 = planProduction(jobs, s2);
    const t = computeThroughput(p2, s2.calendar, 'hour');
    expect(t.buckets.flatMap(b => b.heldMos).some(m => m.masterOrder === mo && m.hold === 'carpenter')).toBe(true);
    expect(t.buckets.flatMap(b => b.mos).some(m => m.masterOrder === mo)).toBe(false);
  });

  it('makes round axis ticks', () => {
    expect(niceTicks(0)).toEqual([0, 1]);
    expect(niceTicks(3)).toEqual([0, 1, 2, 3, 4].slice(0, niceTicks(3).length));
    expect(niceTicks(23).at(-1)!).toBeGreaterThanOrEqual(23);
    expect(niceTicks(23).every(v => Number.isInteger(v))).toBe(true);
  });
});

describe('settings migration', () => {
  it('resets material offsets saved as minutes when they become percent', () => {
    expect(mergeSettings({ materialOffsets: { FH: 7 } }).materialOffsets.FH).toBe(0);
    expect(mergeSettings({ settingsVersion: 3, materialOffsets: { FH: 7 } }).materialOffsets.FH).toBe(7);
  });
});

describe('calendar', () => {
  it('works Monday to Saturday by default and skips Sunday', () => {
    const cal = new WorkCalendar(settings().calendar); // Fri 09/10
    expect(cal.toIso(0)).toBe('2026-10-09T06:00');
    expect(cal.toIso(960)).toBe('2026-10-10T06:00'); // Saturday is a working day
    expect(cal.toIso(1920)).toBe('2026-10-12T06:00'); // Sunday is skipped
    expect(cal.toIso(960, true)).toBe('2026-10-09T22:00');
  });

  it('can skip Saturday or work Sunday', () => {
    const c = { ...settings().calendar, workSaturday: false, workSunday: true };
    const cal = new WorkCalendar(c);
    expect(cal.toIso(960)).toBe('2026-10-11T06:00'); // Friday, then Sunday
  });

  it('starts the plan at a later hour of the first day', () => {
    const s = settings();
    s.calendar.startHour = 10;
    expect(planStartOffset(s.calendar)).toBe(240);
    const p = planProduction(demoJobs(), { ...s, planningMode: 'classic' });
    const firstStart = Math.min(...Object.values(p.queues).flat().map(i => i.startMinute));
    expect(firstStart).toBeGreaterThanOrEqual(240);
    s.calendar.startHour = 3; // before the shift: no effect
    expect(planStartOffset(s.calendar)).toBe(0);
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

  it('places a rework part as its own block before or after the part it was dropped on', () => {
    const s = settings();
    const base = planProduction(jobs, s);
    const anchor = base.queues['HAAS - 1'][5];
    for (const placement of ['before', 'after'] as const) {
      s.timelineEvents = [{ id: 'rw', machineId: 'HAAS - 1', type: 'rework', title: 'Rework', startMinute: anchor.startMinute + 1, durationMinutes: 40, boxCode: anchor.job.boxCode, anchorJobId: anchor.job.id, placement }];
      const plan = planProduction(jobs, s);
      const q = plan.queues['HAAS - 1'];
      const i = q.findIndex(x => x.job.isRework);
      const a = q.findIndex(x => x.job.id === anchor.job.id);
      expect(i).toBe(placement === 'before' ? a - 1 : a + 1);
      expect(q[i].durationMin).toBe(40);
      expect(q[i].segments).toHaveLength(1);
      expect(plan.kpis.plannedJobs).toBe(base.kpis.plannedJobs + 1);
      q.forEach((x, k) => k > 0 && expect(x.startMinute).toBeGreaterThanOrEqual(q[k - 1].endMinute));
      expect(q.find(x => x.job.id === anchor.job.id)!.segments).toHaveLength(1);
    }
  });

  it('plans measured parts at their listed time on any machine and counts them', () => {
    const s = settings();
    s.globalEfficiencyPercent = 50;
    const target = jobs.find(j => j.materialType === 'ALU' && !j.erpMachine && !j.masterOrder.startsWith('30000'))!;
    const times = { [partKey(target.matnr)]: { minutes: 33.3, name: 'Known part' } };
    const plan = planProduction(jobs, s, {}, [], times);
    const it = Object.values(plan.queues).flat().find(i => i.job.id === target.id)!;
    expect(it.timeBasis).toBe('measured');
    expect(it.durationMin).toBe(Math.round(33.3 * target.qty));
    expect(it.partName).toBe('Known part');
    expect(plan.kpis.measuredJobs).toBeGreaterThanOrEqual(1);
    expect(plan.kpis.measuredJobs + plan.kpis.estimatedJobs).toBeLessThanOrEqual(plan.kpis.plannedJobs);
    s.useMeasuredTimes = false;
    const off = Object.values(planProduction(jobs, s, {}, [], times).queues).flat().find(i => i.job.id === target.id)!;
    expect(off.timeBasis).toBe('estimated');
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
