/**
 * Compares the best timeline found with the plan the app produced and writes a self-contained HTML report.
 *
 *   npx tsx scripts/benchmark/report.ts --best best-1.json --best best-2.json [--export app-plan.xlsx]
 *       [--settings run.json] --out report.html [--start-date 2026-10-09] -- <workload.xlsx> [carpenter.xlsx] [parts-time-list.xlsx]
 *
 * `--settings` holds what was changed in the app for the run being judged (priority rules, disruptions ...).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { WorkCalendar, formatClock } from '../../src/core/calendar';
import { lowerBound } from '../../src/core/optimizer/bounds';
import { evaluate, modulesDoneBy, validate, type Metrics, type Queues } from '../../src/core/optimizer/evaluate';
import { parseAppExport, reconcileExport } from './exportParse';
import { loadRows, parseFlags, prepare } from './common';
import { buildReportHtml, type ReportData, type ScheduleView, type Summary } from './reportHtml';

const flags = parseFlags();
const { settings, plan, inst, appQueues: plannerQueues } = prepare(flags);
const calendar = new WorkCalendar(settings.calendar);

const notes: string[] = [];
let appQueues: Queues = plannerQueues;
let appLabel = "this tool's own run of the app's planner on the same workload and settings";
const exportPath = flags.get('export');
if (exportPath) {
  const rec = reconcileExport(inst, parseAppExport(loadRows(exportPath)));
  appQueues = rec.queues;
  appLabel = `the export you attached (${exportPath.split('/').pop()})`;
  if (rec.notes.length) notes.push(...rec.notes.map(n => `Check: ${n}`));
  else notes.push('Check: the export matches the timing model exactly (same parts, machines, durations, changeovers, start and end minutes), so both plans below are judged by the same clock.');
}

// best schedule among all solver runs, judged again here so a file from another setting can never mislead
let best: { queues: Queues; sumC: number } | null = null;
let runs = 0;
for (const f of flags.all('best')) {
  const r = JSON.parse(readFileSync(f, 'utf8')) as { queues: Queues; jobIds: string[] };
  if (r.jobIds.join('|') !== inst.jobs.map(j => j.id).join('|')) {
    console.warn(`skipping ${f}: it was solved for a different workload`);
    continue;
  }
  if (validate(inst, r.queues).length) {
    console.warn(`skipping ${f}: not a valid schedule for this workload`);
    continue;
  }
  runs++;
  const sumC = evaluate(inst, r.queues).sumC;
  if (!best || sumC < best.sumC) best = { queues: r.queues, sumC };
}
if (!best) throw new Error('no usable --best file');

const mApp = evaluate(inst, appQueues);
const mBest = evaluate(inst, best.queues);
const lb = lowerBound(inst);

const dayLen = calendar.dayLen;
const horizonDays = Math.ceil(Math.max(mApp.makespan, mBest.makespan) / dayLen) + 2;
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

const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const dayLabels = Array.from({ length: horizonDays + 1 }, (_, d) => {
  const dt = calendar.toDate(d * dayLen);
  return `${dayNames[dt.getDay()]} ${String(dt.getDate()).padStart(2, '0')}/${String(dt.getMonth() + 1).padStart(2, '0')}`;
});
const stamp = (minute: number) => {
  const iso = calendar.toIso(minute);
  const dt = calendar.toDate(minute);
  return `${dayNames[dt.getDay()]} ${formatClock(iso)}`;
};

const downtime: number[][] = [];
inst.down.forEach((w, k) => {
  for (let i = 0; i < w.length; i += 2) downtime.push([k, w[i], w[i + 1]]);
});

const customers = inst.modIds.map((_, m) => inst.jobs[inst.modParts[m][0]].customer);
const gain = ((mApp.sumC - mBest.sumC) / mApp.sumC) * 100;
const floorGap = ((mBest.sumC - lb.sumC) / lb.sumC) * 100;

const rules = settings.priorityRules.filter(r => r.enabled).map(r => r.name);
notes.push(`Settings of the app run: priority rules in use: ${rules.length ? rules.join('; ') : 'none'}. Plan starts ${stamp(0)}.`);
if (downtime.length) {
  const list = downtime.map(d => `${inst.machineIds[d[0]]} stopped ${d[2] - d[1]} min from ${stamp(d[1])}`).join('; ');
  notes.push(`Disruptions on the timeline, applied to both plans: ${list}. (A disruption cuts a running part in two: the machine pauses and the part carries on afterwards.)`);
}
notes.push(
  `The perfect timeline is the best schedule found by a search that tries millions of re-orderings and machine swaps, checked with the same rules as the planner: every part runs on a machine that can take it, ERP-assigned parts stay on their machine at the head of its queue, changeovers cost 0/8/12/20 minutes by the same rules, nothing runs in parallel on one machine. It was the best of ${runs} independent search run(s).`,
  `Goal used: finish as many master orders as early as possible, measured as the sum of all master-order completion times (equivalent to the average).`,
  `No schedule can finish the average master order sooner than ${(lb.sumC / inst.M / 60).toFixed(1)} h, even if changeovers were free and every part could run anywhere in parallel (a mathematical floor). The perfect timeline is ${floorGap.toFixed(0)}% above that floor. The floor ignores changeovers and the machine restrictions, so it cannot be reached; it only shows the scale.`,
  `The app's schedule is taken from ${appLabel}.`,
);

const data: ReportData = {
  title: 'Perfect timeline versus the app plan',
  subtitle: `${inst.M} master orders, ${inst.n} parts, ${inst.K} machines. The perfect timeline finishes the average master order ${gain.toFixed(1)}% sooner than the app's plan.`,
  source: `Workload: ${flags.files.map(f => f.split('/').pop()?.replace(/^[0-9a-f]{8}-/, '')).join(', ')}`,
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
  downtime,
  summary: { app: summarize(mApp), perfect: summarize(mBest), lowerBound: lb.sumC },
  notes,
};
writeFileSync(flags.get('out', 'report.html')!, buildReportHtml(data));
console.log(`report written: app sumC ${mApp.sumC} -> perfect ${mBest.sumC} (${gain.toFixed(1)}%), lower bound ${lb.sumC.toFixed(0)}, ${runs} run(s)`);
console.log('modules by day app    :', data.summary.app.byDay.join(' '));
console.log('modules by day perfect:', data.summary.perfect.byDay.join(' '));
notes.filter(n => n.startsWith('Check')).forEach(n => console.log(n));
