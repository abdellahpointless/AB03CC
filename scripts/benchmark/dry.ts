import { makeDecoder } from '../../src/core/optimizer/decode';
import { evaluate, modulesDoneBy, validate } from '../../src/core/optimizer/evaluate';
import { defaultSettings } from '../../src/core/defaults';
import { instanceFromPlan, loadInputs, runApp } from './common';

const paths = process.argv.slice(2);
const inp = loadInputs(paths, 'src/data/builtin-part-times.json');
const settings = defaultSettings();
settings.calendar.startDate = '2026-10-09';
const plan = runApp(inp, settings);
const { inst, appQueues } = instanceFromPlan(plan, settings, inp.partTimes);
console.log('jobs', inst.n, 'modules', inst.M, 'machines', inst.machineIds.join(' | '));
console.log('validate app queues:', validate(inst, appQueues));
const m = evaluate(inst, appQueues);
console.log('app: sumC', m.sumC, 'makespan', m.makespan, 'setup', m.setupTotal, '| planner KPI sumMo', plan.kpis.sumMoCompletion, 'makespan', plan.kpis.makespanMinutes, 'changeover', plan.kpis.changeoverMinutes);

const dec = makeDecoder(inst);
const keys: Record<string, (mi: number) => number> = {
  'work asc': mi => inst.work[mi],
  'parts asc': mi => inst.modParts[mi].length,
  'work/K+maxpart': mi => inst.work[mi] / inst.K + Math.max(...Array.from(inst.modParts[mi], p => Math.min(...Array.from(inst.eligList[p], k => inst.dur[p * inst.K + k])))),
};
for (const [name, f] of Object.entries(keys)) {
  const order = Array.from({ length: inst.M }, (_, i) => i).sort((a, b) => f(a) - f(b));
  const q = dec.decode(order);
  const r = evaluate(inst, q);
  console.log(name.padEnd(16), 'sumC', r.sumC, 'makespan', r.makespan, 'setup', r.setupTotal, 'problems', validate(inst, q).length);
}
const cps = [960, 1920, 2880, 3840, 4800, 5760].map(x => x);
console.log('modules done by day (app):', modulesDoneBy(m.modEnd, cps).join(' '));
