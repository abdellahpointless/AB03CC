/**
 * Does this tool reproduce the plan in an app export for the given workload and settings?
 *   npx tsx scripts/benchmark/check-export.ts --export app-plan.xlsx [--settings run.json] -- <workload.xlsx> ...
 * Prints how many rows agree on machine, position, start and end minute. When the settings are right, every row agrees.
 */
import { evaluate } from '../../src/core/optimizer/evaluate';
import { parseAppExport, reconcileExport } from './exportParse';
import { loadRows, parseFlags, prepare } from './common';

const flags = parseFlags();
const { inst, plan } = prepare(flags);
const rows = parseAppExport(loadRows(flags.get('export')!));
const rec = reconcileExport(inst, rows);
console.log(rec.notes.length ? rec.notes.map(n => `- ${n}`).join('\n') : '- the export replays exactly under the timing model');
const target = new Map(rows.map(r => [r.orderNumber, r]));
let same = 0;
let total = 0;
for (const q of Object.values(plan.queues))
  for (const it of q) {
    total++;
    const t = target.get(it.job.orderNumber);
    if (t && t.machine === it.machineId && t.sequence === it.sequence && t.startMinute === it.startMinute && t.endMinute === it.endMinute) same++;
  }
const e = evaluate(inst, rec.queues);
console.log(`planner with these settings reproduces ${same} of ${total} export rows (machine, position, start, end)`);
console.log(`export: sum of master order completion ${e.sumC}, last machine ${e.makespan}, changeover ${e.setupTotal}`);
console.log(`planner: sum of master order completion ${plan.kpis.sumMoCompletion}, last machine ${plan.kpis.makespanMinutes}, changeover ${plan.kpis.changeoverMinutes}`);
