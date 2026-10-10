/** Writes the instance (and the best queues of a solve run) as JSON for the CP-SAT cross-check. */
import { readFileSync, writeFileSync } from 'node:fs';
import { defaultSettings } from '../../src/core/defaults';
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
const best = flag('best') ? (JSON.parse(readFileSync(flag('best')!, 'utf8')) as { queues: number[][]; jobIds: string[] }) : null;
if (best && best.jobIds.join('|') !== inst.jobs.map(j => j.id).join('|')) throw new Error('best file belongs to a different instance');
writeFileSync(
  flag('out', 'instance.json')!,
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
    bestQueues: best?.queues ?? null,
  }),
);
console.log('instance written', inst.n, 'jobs', inst.M, 'modules');
