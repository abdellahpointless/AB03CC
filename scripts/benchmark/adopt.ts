/**
 * Re-checks a schedule produced elsewhere (for example by the exact solver) with this tool's evaluator and stores it
 * in the same format as a solve run, so the report can use it.
 *   npx tsx scripts/benchmark/adopt.ts --queues cpsat-best.json --out best-cpsat.json -- <workload files>
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { defaultSettings } from '../../src/core/defaults';
import { evaluate, validate } from '../../src/core/optimizer/evaluate';
import { instanceFromPlan, loadInputs, runApp } from './common';

const args = process.argv.slice(2);
const flag = (name: string, def?: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};
const files = args.slice(args.indexOf('--') + 1);
const inp = loadInputs(files, 'src/data/builtin-part-times.json');
const settings = defaultSettings();
settings.calendar.startDate = flag('start-date', '2026-10-09')!;
const plan = runApp(inp, settings);
const { inst, appQueues } = instanceFromPlan(plan, settings, inp.partTimes);
const queues = (JSON.parse(readFileSync(flag('queues')!, 'utf8')) as { queues: number[][] }).queues;
const problems = validate(inst, queues);
if (problems.length) throw new Error(`invalid schedule: ${problems.slice(0, 3).join('; ')}`);
const m = evaluate(inst, queues);
const app = evaluate(inst, appQueues);
console.log(`checked: sumC ${m.sumC}, makespan ${m.makespan}, setup ${m.setupTotal}`);
writeFileSync(flag('out', 'best-adopted.json')!, JSON.stringify({ seed: -1, sumC: m.sumC, makespan: m.makespan, setupTotal: m.setupTotal, app: { sumC: app.sumC, makespan: app.makespan, setupTotal: app.setupTotal }, jobIds: inst.jobs.map(j => j.id), queues }));
