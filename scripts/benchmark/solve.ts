/**
 * Searches for the best plan the shop could possibly run, using the same timing rules as the planner.
 *
 *   npx tsx scripts/benchmark/solve.ts --seed 1 --iters 20000000 --restarts 1 [--settings run.json] --out best-1.json -- <files...>
 *
 * Files are recognised by their columns (production export, carpenter list, parts time list).
 * `--settings` holds the changes made in the app (priority rules, disruptions on the timeline ...).
 * The result JSON holds the best queues found.
 */
import { writeFileSync } from 'node:fs';
import { evaluate, validate } from '../../src/core/optimizer/evaluate';
import { optimize } from '../../src/core/optimizer/search';
import { parseFlags, prepare } from './common';

const flags = parseFlags();
const seed = Number(flags.get('seed', '1'));
const iters = Number(flags.get('iters', '2000000'));
const restarts = Number(flags.get('restarts', '1'));
const orderIters = Number(flags.get('order-iters', '100000'));
const out = flags.get('out', 'best.json')!;

const { inst, appQueues } = prepare(flags);
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
