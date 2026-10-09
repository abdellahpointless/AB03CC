/**
 * Runs the planner on real exports and prints a summary plus invariant checks.
 *   npm run check:data -- <BoxShelf.xlsx> [CarpenterList.xlsx]
 */
import { readFileSync } from 'node:fs';
import { defaultSettings } from '../src/core/defaults';
import { parseCarpenter } from '../src/core/parse/carpenter';
import { buildPartTimeIndex, parsePartTimes, partTimeCoverage, pickPartTimes } from '../src/core/parse/partTimes';
import { parseProduction } from '../src/core/parse/production';
import { detectKind, rowsFromBuffer } from '../src/core/parse/workbook';
import { planProduction } from '../src/core/scheduler/plan';
import { isEligible } from '../src/core/scheduler/plan';
import { SimContext } from '../src/core/scheduler/simulate';

const paths = process.argv.slice(2);
if (paths.length === 0) {
  console.error('usage: check-data <production.xlsx> [carpenter.xlsx] [parts-time-list.xlsx]  (files are recognised by their columns)');
  process.exit(1);
}
const load = (p: string) => {
  const b = readFileSync(p);
  return rowsFromBuffer(new Uint8Array(b.buffer, b.byteOffset, b.byteLength));
};

let jobs: ReturnType<typeof parseProduction>['jobs'] = [];
let report: ReturnType<typeof parseProduction>['report'] | null = null;
let parts: ReturnType<typeof parseCarpenter>['parts'] = [];
let partEntries: ReturnType<typeof parsePartTimes>['entries'] = [];
for (const p of paths) {
  const rows = load(p);
  const kind = detectKind(rows);
  console.log(`${p.split('/').pop()}: ${kind}, ${rows.length} rows`);
  if (kind === 'production') ({ jobs, report } = parseProduction(rows));
  else if (kind === 'carpenter') parts = parseCarpenter(rows).parts;
  else if (kind === 'parttimes') partEntries = parsePartTimes(rows).entries;
}
if (!report) {
  console.error('No production export among the files.');
  process.exit(1);
}
console.log('import:', { rows: report.totalRows, mos: report.uniqueMasterOrders, matnr: report.uniqueMatnr, assigned: report.assignedInErp, unassignedMin: report.unassignedMinutes });
console.log('warnings:', report.warnings);
const index = buildPartTimeIndex(partEntries);
const partTimes = pickPartTimes(index, jobs);
console.log('part list:', partEntries.length, 'entries ->', partTimeCoverage(index, jobs));

const settings = defaultSettings();
settings.calendar.startDate = '2026-10-09';
const t0 = Date.now();
const plan = planProduction(jobs, settings, {}, parts, partTimes);
const ms = Date.now() - t0;
const k = plan.kpis;
console.log(`planned in ${ms} ms`);
console.log({ jobs: k.plannedJobs, measured: k.measuredJobs, estimated: k.estimatedJobs, hours: k.plannedHours, changeover: k.changeoverMinutes, saved: k.setupSavedMinutes, makespan: k.makespanMinutes, sumMo: k.sumMoCompletion, sync: `${k.synchronizedMos}/${k.totalMos}`, late: k.overdueJobs, carpenterWaiting: k.waitingOnCarpenter });
for (const [id, q] of Object.entries(plan.queues)) console.log(id.padEnd(10), String(q.length).padStart(4), 'jobs  finish', k.finishPerMachine[id], ' util', k.utilizationPerMachine[id] + '%');
const ex = plan.exceptions;
console.log('exceptions:', { blocked: ex.blocked.length, noEligible: ex.noEligibleMachine.length, outOfScope: ex.outOfScope.length, manual30000: ex.manual30000.length, unpicked: ex.unpickedWarehouse.length });

// ---- invariants ----
const problems: string[] = [];
const ctx = new SimContext(settings, settings.machines);
const seen = new Set<string>();
for (const [id, q] of Object.entries(plan.queues)) {
  const machine = settings.machines.find(m => m.id === id)!;
  let prevEnd = 0;
  for (const it of q) {
    if (seen.has(it.job.id)) problems.push(`duplicate ${it.job.id}`);
    seen.add(it.job.id);
    if (it.startMinute < prevEnd) problems.push(`overlap on ${id} at ${it.job.id}`);
    prevEnd = it.endMinute;
    if (!it.erpLocked && !it.userLocked && !isEligible(it.job, machine, settings, ctx)) problems.push(`ineligible ${it.job.id} on ${id}`);
    if (it.erpLocked && it.job.erpMachine !== id) problems.push(`ERP lock broken ${it.job.id}`);
  }
}
const expected = jobs.length - ex.blocked.length - ex.outOfScope.length - ex.manual30000.length - ex.noEligibleMachine.length;
if (seen.size !== expected) problems.push(`scheduled ${seen.size} but expected ${expected}`);
console.log(problems.length ? `PROBLEMS:\n${problems.slice(0, 20).join('\n')}` : 'all invariants hold');
process.exit(problems.length ? 1 : 0);
