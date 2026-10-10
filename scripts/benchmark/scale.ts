/**
 * How does the planner behave on much bigger workloads? Copies the workload k times (new order and master order numbers)
 * and plans it at each effort.
 *   npx tsx scripts/benchmark/scale.ts --copies 4 [--efforts quick,standard] -- <workload files>
 */
import { planProduction } from '../../src/core/scheduler/plan';
import type { PlanningEffort } from '../../src/core/types';
import { loadInputs, loadSettings, parseFlags } from './common';

const flags = parseFlags();
const inp = loadInputs(flags.files, 'src/data/builtin-part-times.json');
const base = loadSettings(flags);
const copies = Number(flags.get('copies', '4'));
const efforts = flags.get('efforts', 'quick,standard')!.split(',') as PlanningEffort[];
const jobs = Array.from({ length: copies }, (_, c) =>
  inp.jobs.map(j => ({ ...j, id: `${j.id}#${c}`, orderNumber: `${j.orderNumber}#${c}`, masterOrder: `${j.masterOrder}#${c}`, boxCode: `${j.boxCode}`, erpMachine: c === 0 ? j.erpMachine : j.erpMachine })),
).flat();
console.log(`${jobs.length} parts in ${new Set(jobs.map(j => j.masterOrder)).size} master orders`);
const t0 = Date.now();
const classic = planProduction(jobs, { ...base, planningMode: 'classic' }, {}, inp.carpenter, inp.partTimes);
console.log(`classic: ${((Date.now() - t0) / 1000).toFixed(1)}s, sum ${classic.kpis.sumMoCompletion}, planned ${classic.kpis.plannedJobs}`);
for (const effort of efforts) {
  const t1 = Date.now();
  let quick = 0;
  const p = planProduction(jobs, { ...base, planningEffort: effort }, {}, inp.carpenter, inp.partTimes, { onQuick: () => (quick = Date.now() - t1) });
  console.log(`${effort}: ${((Date.now() - t1) / 1000).toFixed(1)}s (quick plan after ${quick} ms), sum ${p.kpis.sumMoCompletion} (${(((classic.kpis.sumMoCompletion - p.kpis.sumMoCompletion) / classic.kpis.sumMoCompletion) * 100).toFixed(1)}% sooner), makespan ${p.kpis.makespanMinutes} vs ${classic.kpis.makespanMinutes}, heap ${(process.memoryUsage().heapUsed / 1e6).toFixed(0)} MB`);
}
