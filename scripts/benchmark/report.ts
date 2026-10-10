/**
 * Compares the best timeline found with the plan the app produced and writes a self-contained HTML report.
 *
 *   npx tsx scripts/benchmark/report.ts --best best-1.json --best best-2.json [--export app-plan.xlsx]
 *       [--upgraded standard | --upgraded-export new-app-plan.xlsx]
 *       [--settings run.json] --out report.html [--start-date 2026-10-09] -- <workload.xlsx> [carpenter.xlsx] [parts-time-list.xlsx]
 *
 * `--settings` holds what was changed in the app for the run being judged (priority rules, disruptions ...).
 * `--upgraded` adds the app's current optimizer (at that effort) as a third plan, computed here from the same inputs;
 * `--upgraded-export` takes it from an export made by the upgraded app instead.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { WorkCalendar, formatClock } from '../../src/core/calendar';
import { lowerBound } from '../../src/core/optimizer/bounds';
import { evaluate, modulesDoneBy, validate, type Metrics, type Queues } from '../../src/core/optimizer/evaluate';
import { parseAppExport, reconcileExport } from './exportParse';
import { loadRows, parseFlags, prepare } from './common';
import { buildReportHtml, type PlanView, type ReportData, type ScheduleView, type Summary } from './reportHtml';
import { planProduction } from '../../src/core/scheduler/plan';
import type { PlanningEffort } from '../../src/core/types';

const flags = parseFlags();
const { inp, settings, plan, inst, appQueues: plannerQueues } = prepare(flags);
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
  else notes.push('Check: the export matches the timing model exactly (same parts, machines, durations, changeovers, start and end minutes), so every plan below is judged by the same clock.');
}

// the upgraded app: its optimizer on the same workload and settings, or its own export
let upgradedQueues: Queues | null = null;
const index = new Map(inst.jobs.map((j, i) => [j.id, i]));
const upgradedExport = flags.get('upgraded-export');
const upgradedEffort = flags.get('upgraded') as PlanningEffort | undefined;
if (upgradedExport) {
  const rec = reconcileExport(inst, parseAppExport(loadRows(upgradedExport)));
  upgradedQueues = rec.queues;
  notes.push(...rec.notes.map(n => `Check (upgraded app export): ${n}`));
} else if (upgradedEffort) {
  const p = planProduction(inp.jobs, { ...settings, planningMode: 'modules_first', planningEffort: upgradedEffort }, {}, inp.carpenter, inp.partTimes);
  upgradedQueues = inst.machineIds.map(id => (p.queues[id] ?? []).map(it => index.get(it.job.id)!));
  const bad = validate(inst, upgradedQueues);
  if (bad.length) throw new Error(`the upgraded app produced an invalid plan: ${bad.slice(0, 3).join('; ')}`);
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
const mUp = upgradedQueues ? evaluate(inst, upgradedQueues) : null;
const lb = lowerBound(inst);

const dayLen = calendar.dayLen;
const horizonDays = Math.ceil(Math.max(mApp.makespan, mBest.makespan, mUp?.makespan ?? 0) / dayLen) + 2;
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
const baseName = exportPath ? 'Your export' : 'App plan';

const rules = settings.priorityRules.filter(r => r.enabled).map(r => r.name);
notes.push(`Settings of the app run: priority rules in use: ${rules.length ? rules.join('; ') : 'none'}. Plan starts ${stamp(0)}.`);
if (downtime.length) {
  const list = downtime.map(d => `${inst.machineIds[d[0]]} stopped ${d[2] - d[1]} min from ${stamp(d[1])}`).join('; ');
  notes.push(`Disruptions on the timeline, applied to every plan: ${list}. (A disruption cuts a running part in two: the machine pauses and the part carries on afterwards.)`);
}
notes.push(
  `The perfect timeline is the best schedule found by a search that tries millions of re-orderings and machine swaps, checked with the same rules as the planner: every part runs on a machine that can take it, ERP-assigned parts stay on their machine at the head of its queue, changeovers cost 0/8/12/20 minutes by the same rules, nothing runs in parallel on one machine. It was the best of ${runs} independent search run(s).`,
  `Goal used: finish as many master orders as early as possible, measured as the sum of all master-order completion times (equivalent to the average).`,
  `No schedule can finish the average master order sooner than ${(lb.sumC / inst.M / 60).toFixed(1)} h, even if changeovers were free and every part could run anywhere in parallel (a mathematical floor). The perfect timeline is ${floorGap.toFixed(0)}% above that floor. The floor ignores changeovers and the machine restrictions, so it cannot be reached; it only shows the scale.`,
  `${baseName} is taken from ${appLabel}.`,
);
if (mUp) notes.push(upgradedExport ? `Upgraded app plan: taken from ${upgradedExport.split('/').pop()}, an export of the upgraded app.` : `Upgraded app plan: the app's planner after the update (optimizer, ${upgradedEffort} effort), computed here from the same workload and settings.`);

const plans: PlanView[] = [
  { label: 'Perfect timeline', short: 'Perfect', color: '--accent', view: view(best.queues, mBest), summary: summarize(mBest), ends: Array.from(mBest.modEnd) },
  ...(mUp && upgradedQueues ? [{ label: 'Upgraded app plan', short: 'Upgraded app', color: '--good', view: view(upgradedQueues, mUp), summary: summarize(mUp), ends: Array.from(mUp.modEnd) }] : []),
  { label: exportPath ? 'Your export (earlier planner)' : 'App plan (earlier planner)', short: baseName, color: '--accent-2', view: view(appQueues, mApp), summary: summarize(mApp), ends: Array.from(mApp.modEnd) },
];
const gainUp = mUp ? ((mApp.sumC - mUp.sumC) / mApp.sumC) * 100 : 0;
const gapUp = mUp ? ((mUp.sumC - mBest.sumC) / mBest.sumC) * 100 : 0;

const data: ReportData = {
  title: mUp ? 'Perfect timeline, upgraded app and your export' : 'Perfect timeline versus the app plan',
  subtitle: mUp
    ? `${inst.M} master orders, ${inst.n} parts, ${inst.K} machines. The upgraded app finishes the average master order ${gainUp.toFixed(1)}% sooner than your export and is ${gapUp.toFixed(1)}% away from the perfect timeline.`
    : `${inst.M} master orders, ${inst.n} parts, ${inst.K} machines. The perfect timeline finishes the average master order ${gain.toFixed(1)}% sooner than the app's plan.`,
  source: `Workload: ${flags.files.map(f => f.split('/').pop()?.replace(/^[0-9a-f]{8}-/, '')).join(', ')}`,
  machines: inst.machineIds,
  jobBoxes: inst.jobs.map(j => j.boxCode),
  jobMaterials: inst.jobs.map(j => j.materialType),
  jobMatnr: inst.jobs.map(j => j.matnr),
  modules: inst.modIds.map((id, m) => ({ id, customer: customers[m], parts: inst.modParts[m].length, work: Math.round(inst.work[m]) })),
  plans,
  dayLen,
  shiftStartHour: settings.calendar.shiftStartHour,
  dayLabels,
  downtime,
  lowerBound: lb.sumC,
  notes,
};
writeFileSync(flags.get('out', 'report.html')!, buildReportHtml(data));
console.log(`report written: ${baseName} sumC ${mApp.sumC}${mUp ? ` -> upgraded ${mUp.sumC} (${gainUp.toFixed(1)}%)` : ''} -> perfect ${mBest.sumC} (${gain.toFixed(1)}% vs ${baseName}), lower bound ${lb.sumC.toFixed(0)}, ${runs} run(s)`);
for (const p of plans) console.log(`modules by day ${p.short.padEnd(13)}:`, p.summary.byDay.join(' '));
notes.filter(n => n.startsWith('Check')).forEach(n => console.log(n));
