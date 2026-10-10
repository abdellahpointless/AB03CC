/**
 * Builds small random sub-problems (a few master orders of the real workload) for the exact solver.
 *   npx tsx scripts/benchmark/subtest.ts --count 6 --parts 22 --out-dir dir -- <workload files>
 * Writes dir/sub-N.json (instance + the search's best queues) to feed to cpsat.py with --hint none.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { defaultSettings } from '../../src/core/defaults';
import { evaluate } from '../../src/core/optimizer/evaluate';
import { makeRng, optimize } from '../../src/core/optimizer/search';
import { instanceFromPlan, loadInputs, runApp } from './common';

const args = process.argv.slice(2);
const flag = (name: string, def?: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};
const files = args.slice(args.indexOf('--') + 1);
const count = Number(flag('count', '5'));
const target = Number(flag('parts', '22'));
const dir = flag('out-dir', '.')!;
const pure = args.includes('--pure');
mkdirSync(dir, { recursive: true });

const inp = loadInputs(files, 'src/data/builtin-part-times.json');
const settings = defaultSettings();
settings.calendar.startDate = '2026-10-09';
const plan = runApp(inp, settings);
const rng = makeRng(99);
const modules = new Map<string, number>();
for (const q of Object.values(plan.queues)) for (const it of q) modules.set(it.job.masterOrder, (modules.get(it.job.masterOrder) ?? 0) + 1);
const all = [...modules.keys()];

for (let c = 0; c < count; c++) {
  // random modules until about `target` parts; skip modules with more than a third of the budget
  const pool = all.slice().sort(() => rng.next() - 0.5);
  const keep = new Set<string>();
  let parts = 0;
  for (const m of pool) {
    const p = modules.get(m)!;
    if (p > target / 3 || parts + p > target) continue;
    keep.add(m);
    parts += p;
    if (parts >= target - 1) break;
  }
  const { inst, appQueues } = instanceFromPlan(plan, settings, inp.partTimes, keep);
  const res = optimize(inst, { seed: c + 1, orderIters: 4000, queueIters: 150000, restarts: 2, starts: [appQueues], weights: pure ? { makespan: 0, partEnd: 0, setup: 0 } : undefined });
  const app = evaluate(inst, appQueues);
  writeFileSync(
    `${dir}/sub-${c}.json`,
    JSON.stringify({
      n: inst.n,
      K: inst.K,
      M: inst.M,
      machineIds: inst.machineIds,
      jobIds: inst.jobs.map(j => j.id),
      mod: Array.from(inst.mod),
      dur: Array.from(inst.dur),
      fixed: Array.from(inst.fixed),
      head: inst.head.map(h => Array.from(h)),
      setup: Array.from(inst.setup),
      appQueues,
      bestQueues: res.queues,
      searchSumC: res.sumC,
      appSumC: app.sumC,
    }),
  );
  console.log(`sub-${c}: ${inst.n} parts, ${inst.M} modules, app ${app.sumC}, search ${res.sumC}`);
}
