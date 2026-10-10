/**
 * Runs the app's planner in each mode and effort on a workload and prints what it achieved and how long it took.
 *   npx tsx scripts/benchmark/engine.ts [--efforts quick,standard,thorough] [--settings run.json] -- <workload files>
 */
import { WorkCalendar } from '../../src/core/calendar';
import { planProduction } from '../../src/core/scheduler/plan';
import type { PlanResult, PlanningEffort } from '../../src/core/types';
import { loadSettings, parseFlags, loadInputs } from './common';

const flags = parseFlags();
const inp = loadInputs(flags.files, 'src/data/builtin-part-times.json');
const base = loadSettings(flags);
const dayLen = new WorkCalendar(base.calendar).dayLen;
const efforts = (flags.get('efforts', 'quick,standard,thorough')!.split(',') as PlanningEffort[]);

function line(label: string, plan: PlanResult, secs: number) {
  const mos = Object.values(plan.moSync);
  const by = (d: number) => mos.filter(m => m.lastFinish <= d * dayLen).length;
  console.log(
    label.padEnd(18),
    `sumMo ${String(plan.kpis.sumMoCompletion).padStart(7)}`,
    `avg ${(plan.kpis.sumMoCompletion / Math.max(1, mos.length) / 60).toFixed(1)}h`,
    `makespan ${String(plan.kpis.makespanMinutes).padStart(5)}`,
    `changeover ${String(plan.kpis.changeoverMinutes).padStart(5)}`,
    `done by day1/2/3: ${by(1)}/${by(2)}/${by(3)}`,
    `late ${plan.kpis.overdueJobs}`,
    `${secs.toFixed(1)}s`,
  );
}

let t0 = Date.now();
const classic = planProduction(inp.jobs, { ...base, planningMode: 'classic' }, {}, inp.carpenter, inp.partTimes);
line('classic', classic, (Date.now() - t0) / 1000);
for (const effort of efforts) {
  t0 = Date.now();
  let quickAt = 0;
  const plan = planProduction(inp.jobs, { ...base, planningMode: 'modules_first', planningEffort: effort }, {}, inp.carpenter, inp.partTimes, { onQuick: () => (quickAt = Date.now() - t0) });
  line(`modules-first ${effort}`, plan, (Date.now() - t0) / 1000);
  if (flags.has('verbose') && plan.optimization) console.log('   quick plan after', quickAt, 'ms;', JSON.stringify(plan.optimization));
}
