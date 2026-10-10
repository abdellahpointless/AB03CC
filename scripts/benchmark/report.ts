/**
 * Compares the best timeline found with the plan the app produced and writes a self-contained HTML report.
 *
 *   npx tsx scripts/benchmark/report.ts --best best-1.json --best best-2.json [--export app-plan.xlsx]
 *       --out report.html [--start-date 2026-10-09] -- <workload.xlsx> [carpenter.xlsx] [parts-time-list.xlsx]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { WorkCalendar } from '../../src/core/calendar';
import { defaultSettings } from '../../src/core/defaults';
import { lowerBound } from '../../src/core/optimizer/bounds';
import { evaluate, modulesDoneBy, validate, type Metrics, type Queues } from '../../src/core/optimizer/evaluate';
import type { Instance } from '../../src/core/optimizer/instance';
import { parseAppExport, reconcileExport } from './exportParse';
import { instanceFromPlan, loadInputs, loadRows, runApp } from './common';
import { buildReportHtml, type ReportData, type ScheduleView, type Summary } from './reportHtml';

const args = process.argv.slice(2);
const flags = (name: string) => args.flatMap((a, i) => (a === `--${name}` ? [args[i + 1]] : []));
const flag = (name: string, def?: string) => flags(name)[0] ?? def;
const files = args.slice(args.indexOf('--') + 1);

const settings = defaultSettings();
settings.calendar.startDate = flag('start-date', '2026-10-09')!;
const inp = loadInputs(files, 'src/data/builtin-part-times.json');
const plan = runApp(inp, settings);
const { inst, appQueues: plannerQueues } = instanceFromPlan(plan, settings, inp.partTimes);

const notes: string[] = [];
let appQueues: Queues = plannerQueues;
let appLabel = "this tool's own run of the app's planner on the same workload";
const exportPath = flag('export');
if (exportPath) {
  const rec = reconcileExport(inst, parseAppExport(loadRows(exportPath)));
  appQueues = rec.queues;
  appLabel = `the export you attached (${exportPath.split('/').pop()})`;
  if (rec.notes.length) notes.push(...rec.notes.map(n => `Check: ${n}`));
  else notes.push('Check: the export matches the timing model exactly (same parts, machines, durations, changeovers, start and end minutes).');
}

// best schedule among all solver runs
let best: { queues: Queues; sumC: number; seed: number } | null = null;
let runs = 0;
for (const f of flags('best')) {
  const r = JSON.parse(readFileSync(f, 'utf8')) as { queues: Queues; sumC: number; seed: number; jobIds: string[] };
  if (r.jobIds.join('|') !== inst.jobs.map(j => j.id).join('|')) {
    console.warn(`skipping ${f}: it was solved for a different workload`);
    continue;
  }
  runs++;
  if (!best || r.sumC < best.sumC) best = { queues: r.queues, sumC: r.sumC, seed: r.seed };
}
if (!best) throw new Error('no usable --best file');
const problems = validate(inst, best.queues);
if (problems.length) throw new Error(`best schedule is invalid: ${problems.slice(0, 3).join('; ')}`);

const mApp = evaluate(inst, appQueues);
const mBest = evaluate(inst, best.queues);
const lb = lowerBound(inst);

const dayLen = new WorkCalendar(settings.calendar).dayLen;
const horizonDays = Math.ceil(Math.max(mApp.makespan, mBest.makespan) / dayLen) + 2;
const calendar = new WorkCalendar(settings.calendar);
const lateParts = (m: Metrics) => inst.jobs.filter((j, i) => j.dueDate && calendar.toIso(m.end[i], true).slice(0, 10) > j.dueDate).length;
const summarize = (m: Metrics): Summary => {
  const sorted = Array.from(m.modEnd).sort((a, b) => a - b);
  const q = (p: number) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))];
  return {
    sumC: m.sumC,
    avgC: m.sumC / inst.M,
    medianC: q(0.5),
    makespan: m.makespan,
    setupTotal: m.setupTotal,
    lateParts: lateParts(m),
    busyPercent: Math.round((m.busy.reduce((a, b) => a + b, 0) / (inst.K * m.makespan)) * 100),
    byDay: modulesDoneBy(m.modEnd, Array.from({ length: horizonDays }, (_, d) => (d + 1) * dayLen)),
    quartiles: [0.25, 0.5, 0.75, 1].map(q),
  };
};

const basis = new Map<string, boolean>();
for (const q of Object.values(plan.queues)) for (const it of q) basis.set(it.job.id, it.timeBasis === 'measured');

const view = (queues: Queues, m: Metrics): ScheduleView => {
  const closing = new Int32Array(inst.M).fill(-1);
  for (let j = 0; j < inst.n; j++) if (closing[inst.mod[j]] < 0 || m.end[j] > m.end[closing[inst.mod[j]]]) closing[inst.mod[j]] = j;
  const jobs: number[][] = [];
  queues.forEach((q, k) => q.forEach(j => jobs.push([k, j, m.start[j], m.end[j], m.setupBefore[j], inst.mod[j], closing[inst.mod[j]] === j ? 1 : 0, basis.get(inst.jobs[j].id) ? 1 : 0, inst.jobs[j].qty])));
  return { jobs };
};

const cal = new WorkCalendar(settings.calendar);
const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const dayLabels = Array.from({ length: horizonDays + 1 }, (_, d) => {
  const dt = cal.toDate(d * dayLen);
  return `${dayNames[dt.getDay()]} ${String(dt.getDate()).padStart(2, '0')}/${String(dt.getMonth() + 1).padStart(2, '0')}`;
});

const customers = inst.modIds.map((_, m) => inst.jobs[inst.modParts[m][0]].customer);
const gain = ((mApp.sumC - mBest.sumC) / mApp.sumC) * 100;
const floorGap = ((mBest.sumC - lb.sumC) / lb.sumC) * 100;
notes.push(
  `The perfect timeline is the best schedule found by a search that tries millions of re-orderings and machine swaps, checked with the same rules as the planner: every part runs on a machine that can take it, ERP-assigned parts stay on their machine at the head of its queue, changeovers cost 0/8/12/20 minutes by the same rules, nothing runs in parallel on one machine. It was the best of ${runs} independent search run(s).`,
  `Goal used: finish as many master orders as early as possible, measured as the sum of all master-order completion times (equivalent to the average).`,
  `No schedule can finish the average master order sooner than ${(lb.sumC / inst.M / 60).toFixed(1)} h, even if changeovers were free and every part could run anywhere in parallel (a mathematical floor). The perfect timeline is ${floorGap.toFixed(0)}% above that floor. The floor ignores changeovers and the machine restrictions, so it cannot be reached; it only shows the scale.`,
  `The app's schedule is taken from ${appLabel}.`,
);

const data: ReportData = {
  title: 'Perfect timeline versus the app plan',
  subtitle: `${inst.M} master orders, ${inst.n} parts, ${inst.K} machines. The perfect timeline finishes the average master order ${gain.toFixed(1)}% sooner than the app's plan.`,
  source: `Workload: ${files.map(f => f.split('/').pop()?.replace(/^[0-9a-f]{8}-/, '')).join(', ')}`,
  machines: inst.machineIds,
  jobBoxes: inst.jobs.map(j => j.boxCode),
  jobMaterials: inst.jobs.map(j => j.materialType),
  jobMatnr: inst.jobs.map(j => j.matnr),
  modules: inst.modIds.map((id, m) => ({ id, customer: customers[m], parts: inst.modParts[m].length, work: Math.round(inst.work[m]), appEnd: mApp.modEnd[m], bestEnd: mBest.modEnd[m] })),
  perfect: view(best.queues, mBest),
  app: view(appQueues, mApp),
  dayLen,
  shiftStartHour: settings.calendar.shiftStartHour,
  dayLabels,
  summary: { app: summarize(mApp), perfect: summarize(mBest), lowerBound: lb.sumC },
  notes,
};
writeFileSync(flag('out', 'report.html')!, buildReportHtml(data));
console.log(`report written: app sumC ${mApp.sumC} -> perfect ${mBest.sumC} (${gain.toFixed(1)}%), lower bound ${lb.sumC.toFixed(0)}, ${runs} run(s)`);
console.log('modules by day app    :', data.summary.app.byDay.join(' '));
console.log('modules by day perfect:', data.summary.perfect.byDay.join(' '));
void (null as unknown as Instance);
