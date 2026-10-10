/**
 * Compares optimizer settings on a workload: one line per setting, several seeds each.
 *   npx tsx scripts/benchmark/tune.ts --seeds 1,2,3 --configs 'name=iters:1200000,heat:0.5,coolBy:300,orderIters:5000' ... [--settings run.json] -- <files>
 */
import { evaluate } from '../../src/core/optimizer/evaluate';
import { optimize, type OptimizeOptions } from '../../src/core/optimizer/search';
import { parseFlags, prepare } from './common';

const flags = parseFlags();
const { inst, appQueues } = prepare(flags);
const seeds = flags.get('seeds', '1,2,3')!.split(',').map(Number);
const app = evaluate(inst, appQueues);
console.log(`instance: ${inst.n} parts, ${inst.M} modules; classic plan ${app.sumC}`);
for (const spec of flags.all('configs')) {
  const [name, rest] = spec.split('=');
  const p = Object.fromEntries((rest ?? '').split(',').filter(Boolean).map(kv => kv.split(':')));
  const results: number[] = [];
  const t0 = Date.now();
  for (const seed of seeds) {
    const o: OptimizeOptions = {
      seed,
      orderIters: Number(p.orderIters ?? 5000),
      queueIters: Number(p.iters ?? 1_000_000),
      restarts: Number(p.restarts ?? 1),
      heat: p.heat ? Number(p.heat) : undefined,
      coolBy: p.coolBy ? Number(p.coolBy) : undefined,
      orderStarts: p.orderStarts ? Number(p.orderStarts) : undefined,
      descendEvals: p.descend ? Number(p.descend) : undefined,
      starts: [appQueues],
    };
    results.push(optimize(inst, o).sumC);
  }
  const secs = (Date.now() - t0) / 1000 / seeds.length;
  const mean = results.reduce((a, b) => a + b, 0) / results.length;
  console.log(`${name.padEnd(28)} mean ${mean.toFixed(0)}  min ${Math.min(...results)}  max ${Math.max(...results)}  [${results.join(' ')}]  ${secs.toFixed(1)}s each`);
}
