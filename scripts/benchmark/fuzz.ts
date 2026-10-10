/**
 * Plans random cut-outs of a real workload under random settings, pins, disruptions and carpenter lists, and checks
 * what must always hold: no failure, every part planned once, only on machines that may take it, no overlaps, and the
 * optimizer never worse than the classic heuristic.
 *   npx tsx scripts/benchmark/fuzz.ts --runs 40 [--seed 1] -- <workload.xlsx> [carpenter.xlsx] [parts-list.xlsx]
 */
import { defaultSettings, RULE_PRESETS } from '../../src/core/defaults';
import { makeRng } from '../../src/core/optimizer/search';
import { isEligible, planProduction } from '../../src/core/scheduler/plan';
import { SimContext } from '../../src/core/scheduler/simulate';
import type { PlanResult, PlannerSettings, TimelineEvent, UserLock } from '../../src/core/types';
import { loadInputs, parseFlags } from './common';

const flags = parseFlags();
const runs = Number(flags.get('runs', '30'));
const rng = makeRng(Number(flags.get('seed', '1')));
const inp = loadInputs(flags.files, 'src/data/builtin-part-times.json');
const pick = <T>(xs: T[]) => xs[rng.int(xs.length)];
const chance = (p: number) => rng.next() < p;

let failures = 0;
for (let r = 0; r < runs; r++) {
  const size = 10 + rng.int(inp.jobs.length - 10);
  const start = rng.int(inp.jobs.length - size + 1);
  const jobs = chance(0.5) ? inp.jobs.slice(start, start + size) : inp.jobs.filter(() => rng.next() < size / inp.jobs.length);
  const s: PlannerSettings = defaultSettings();
  s.calendar.startDate = '2026-10-09';
  s.planningEffort = 'quick';
  s.priorityRules = structuredClone(pick(Object.values(RULE_PRESETS)).rules);
  for (const rule of s.priorityRules) {
    if (rule.type === 'customer') rule.values = [pick(jobs.length ? jobs : inp.jobs).customer];
    if (rule.type === 'sales_order') rule.values = [pick(jobs.length ? jobs : inp.jobs).salesOrder];
  }
  s.carpenterDelayMode = pick(['off', 'soft', 'hard'] as const);
  s.restartJobOnEvent = chance(0.3);
  s.allowHaas5Overflow = chance(0.3);
  s.keepErpAssignments = chance(0.8);
  s.useMeasuredTimes = chance(0.8);
  if (chance(0.2)) s.machines[rng.int(s.machines.length)].isDown = true;
  const events: TimelineEvent[] = [];
  for (let e = rng.int(4); e > 0; e--) {
    events.push({ id: `e${e}`, machineId: chance(0.2) ? 'ALL' : pick(s.machines).id, type: pick(['breakdown', 'maintenance', 'absent', 'other'] as const), title: 't', startMinute: rng.int(3000), durationMinutes: 5 + rng.int(500) });
  }
  s.timelineEvents = events;
  const locks: Record<string, UserLock> = {};
  const pins = chance(0.4);
  for (const j of jobs) {
    if (!chance(0.03)) continue;
    const lock: UserLock = {};
    if (chance(0.5)) lock.machine = pick(s.machines).id;
    if (chance(0.3)) lock.durationMin = 5 + rng.int(120);
    if (pins && chance(0.3)) lock.startMinute = rng.int(2500);
    if (Object.keys(lock).length) locks[j.id] = lock;
  }
  const label = `run ${r}: ${jobs.length} parts, rules ${s.priorityRules.map(x => x.type).join('+')}, carpenter ${s.carpenterDelayMode}, ${events.length} disruptions, ${Object.keys(locks).length} locks`;
  const problems: string[] = [];
  let classic: PlanResult | null = null;
  let optimized: PlanResult | null = null;
  try {
    classic = planProduction(jobs, { ...s, planningMode: 'classic' }, locks, inp.carpenter, inp.partTimes);
    optimized = planProduction(jobs, { ...s, planningMode: 'modules_first' }, locks, inp.carpenter, inp.partTimes);
  } catch (err) {
    problems.push(`threw: ${err instanceof Error ? err.stack : err}`);
  }
  if (classic && optimized) {
    const ctx = new SimContext(s, s.machines.filter(m => !m.isDown), inp.partTimes);
    for (const [name, p] of [['classic', classic], ['optimized', optimized]] as const) {
      const seen = new Set<string>();
      for (const [machineId, q] of Object.entries(p.queues)) {
        const machine = s.machines.find(m => m.id === machineId)!;
        let prevEnd = 0;
        for (const it of q) {
          if (seen.has(it.job.id)) problems.push(`${name}: ${it.job.id} planned twice`);
          seen.add(it.job.id);
          if (it.startMinute < prevEnd) problems.push(`${name}: overlap on ${machineId} at ${it.job.id}`);
          prevEnd = it.endMinute;
          if (!it.erpLocked && !it.userLocked && !isEligible(it.job, machine, s, ctx)) problems.push(`${name}: ${it.job.id} on ${machineId} not allowed`);
        }
      }
      if (name === 'optimized' && seen.size !== Object.values(classic.queues).reduce((n, q) => n + q.length, 0)) problems.push('optimized and classic plan a different number of parts');
    }
    const noPins = Object.values(locks).every(l => l.startMinute === undefined);
    if (noPins && optimized.optimization && optimized.kpis.sumMoCompletion > classic.kpis.sumMoCompletion * 1.0001 && s.priorityRules.every(x => x.type === 'finish_master_order' || x.type === 'waiting' || x.type === 'production_date') && s.carpenterDelayMode === 'off') {
      problems.push(`optimized sum ${optimized.kpis.sumMoCompletion} is worse than classic ${classic.kpis.sumMoCompletion}`);
    }
  }
  if (problems.length) {
    failures++;
    console.log(`FAIL ${label}\n  ${problems.slice(0, 4).join('\n  ')}`);
  } else {
    console.log(`ok   ${label}${optimized?.optimization ? `  (${classic!.kpis.sumMoCompletion} -> ${optimized.kpis.sumMoCompletion})` : ''}`);
  }
}
console.log(failures ? `${failures} of ${runs} runs failed` : `all ${runs} runs hold`);
process.exit(failures ? 1 : 0);
