/**
 * Re-checks a schedule produced elsewhere (for example by the exact solver) with this tool's evaluator and stores it
 * in the same format as a solve run, so the report can use it.
 *   npx tsx scripts/benchmark/adopt.ts --queues cpsat-best.json --out best-cpsat.json [--settings run.json] -- <workload files>
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { evaluate, validate } from '../../src/core/optimizer/evaluate';
import { parseFlags, prepare } from './common';

const flags = parseFlags();
const { inst, appQueues } = prepare(flags);
const queues = (JSON.parse(readFileSync(flags.get('queues')!, 'utf8')) as { queues: number[][] }).queues;
const problems = validate(inst, queues);
if (problems.length) throw new Error(`invalid schedule: ${problems.slice(0, 3).join('; ')}`);
const m = evaluate(inst, queues);
const app = evaluate(inst, appQueues);
console.log(`checked: sumC ${m.sumC}, makespan ${m.makespan}, setup ${m.setupTotal}`);
writeFileSync(flags.get('out', 'best-adopted.json')!, JSON.stringify({ seed: -1, sumC: m.sumC, makespan: m.makespan, setupTotal: m.setupTotal, app: { sumC: app.sumC, makespan: app.makespan, setupTotal: app.setupTotal }, jobIds: inst.jobs.map(j => j.id), queues }));
