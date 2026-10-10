/**
 * Searches for the best plan the shop could possibly run, using the same timing rules as the planner.
 *
 *   npx tsx scripts/benchmark/solve.ts --seed 1 --iters 20000000 --restarts 1 --out best-1.json -- <files...>
 *
 * Files are recognised by their columns (production export, carpenter list, parts time list).
 * The result JSON holds the instance (for the CP-SAT cross-check) and the best queues found.
 */
import { writeFileSync } from 'node:fs';
import { defaultSettings } from '../../src/core/defaults';
import { evaluate, validate } from '../../src/core/optimizer/evaluate';
import { optimize } from '../../src/core/optimizer/search';
import { instanceFromPlan, loadInputs, runApp } from './common';

const args = process.argv.slice(2);
const flag = (name: string, def?: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};
const files = args.slice(args.indexOf('--') + 1);
const seed = Number(flag('seed', '1'));
const iters = Number(flag('iters', '2000000'));
const restarts = Number(flag('restarts', '1'));
const orderIters = Number(flag('order-iters', '100000'));
const out = flag('out', 'best.json')!;
const start = flag('start-date', '2026-10-09')!;

const inp = loadInputs(files, 'src/data/builtin-part-times.json');
const settings = defaultSettings();
settings.calendar.startDate = start;
const plan = runApp(inp, settings);
const { inst, appQueues } = instanceFromPlan(plan, settings, inp.partTimes);
const app = evaluate(inst, appQueues);
const t0 = Date.now();
const res = optimize(inst, { seed, queueIters: iters, orderIters, restarts, starts: [appQueues] });
const problems = validate(inst, res.queues);
const secs = (Date.now() - t0) / 1000;
console.log(`seed ${seed}: sumC ${res.sumC} (app ${app.sumC}, ${(((res.sumC - app.sumC) / app.sumC) * 100).toFixed(2)}%) makespan ${res.makespan} setup ${res.setupTotal} in ${secs.toFixed(0)}s${problems.length ? ' PROBLEMS ' + problems.length : ''}`);
writeFileSync(
  out,
  JSON.stringify({
    seed,
    sumC: res.sumC,
    makespan: res.makespan,
    setupTotal: res.setupTotal,
    app: { sumC: app.sumC, makespan: app.makespan, setupTotal: app.setupTotal },
    jobIds: inst.jobs.map(j => j.id),
    queues: res.queues,
  }),
);
