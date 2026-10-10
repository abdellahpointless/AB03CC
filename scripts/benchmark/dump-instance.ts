/** Writes the instance (and the best queues of a solve run) as JSON for the CP-SAT cross-check. */
import { readFileSync, writeFileSync } from 'node:fs';
import { parseFlags, prepare } from './common';

const flags = parseFlags();
const { inst, appQueues } = prepare(flags);
const bestPath = flags.get('best');
const best = bestPath ? (JSON.parse(readFileSync(bestPath, 'utf8')) as { queues: number[][]; jobIds: string[] }) : null;
if (best && best.jobIds.join('|') !== inst.jobs.map(j => j.id).join('|')) throw new Error('best file belongs to a different instance');
writeFileSync(
  flags.get('out', 'instance.json')!,
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
    downtime: inst.down.map(d => Array.from(d)),
    appQueues,
    bestQueues: best?.queues ?? null,
  }),
);
console.log('instance written', inst.n, 'jobs', inst.M, 'modules');
