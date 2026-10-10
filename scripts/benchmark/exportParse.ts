import type { Instance } from '../../src/core/optimizer/instance';
import type { Queues } from '../../src/core/optimizer/evaluate';
import { evaluate } from '../../src/core/optimizer/evaluate';
import type { Row } from '../../src/core/parse/workbook';
import { RowReader, num, str } from '../../src/core/parse/cells';

export interface ExportRow {
  machine: string;
  sequence: number;
  orderNumber: string;
  masterOrder: string;
  boxCode: string;
  plannedMin: number;
  setupBefore: number;
  startMinute: number | null;
  endMinute: number | null;
  timeBasis: string;
}

/** Reads the "Plan_All" sheet the app exports (the first sheet of the workbook). */
export function parseAppExport(rows: Row[]): ExportRow[] {
  const r = new RowReader(rows[0]);
  const need = ['machine', 'sequence', 'ordernumber', 'masterorder'];
  const missing = need.filter(k => !r.has(k));
  if (missing.length) throw new Error(`This does not look like the app's plan export (missing ${missing.join(', ')}). Use the first sheet, "Plan_All".`);
  return rows.map(row => {
    const start = r.get(row, 'startminute');
    const end = r.get(row, 'endminute');
    return {
      machine: str(r.get(row, 'machine')),
      sequence: num(r.get(row, 'sequence'), 0),
      orderNumber: str(r.get(row, 'ordernumber')),
      masterOrder: str(r.get(row, 'masterorder')),
      boxCode: str(r.get(row, 'boxcode')),
      plannedMin: num(r.get(row, 'plannedminutes'), 0),
      setupBefore: num(r.get(row, 'setupbefore(min)', 'setupbefore'), 0),
      startMinute: start === undefined ? null : num(start, 0),
      endMinute: end === undefined ? null : num(end, 0),
      timeBasis: str(r.get(row, 'timebasis')),
    };
  });
}

export interface Reconciliation {
  queues: Queues;
  /** things that differ between the export and what this tool computes for the same workload */
  notes: string[];
  matched: number;
  exportOnly: string[];
  instanceOnly: string[];
}

/**
 * Maps the export onto the search instance and checks it against the timing model: same set of parts, same machines,
 * same durations, same changeovers, same start/end minutes. Anything that differs is listed instead of being hidden.
 */
export function reconcileExport(inst: Instance, rows: ExportRow[]): Reconciliation {
  const notes: string[] = [];
  const byOrder = new Map<string, number[]>();
  inst.jobs.forEach((j, i) => (byOrder.get(j.orderNumber) ?? byOrder.set(j.orderNumber, []).get(j.orderNumber)!).push(i));
  const used = new Set<number>();
  const queues: Queues = inst.machineIds.map(() => []);
  const exportOnly: string[] = [];
  const sorted = [...rows].sort((a, b) => a.machine.localeCompare(b.machine) || a.sequence - b.sequence);
  let durMismatch = 0;
  let machineUnknown = 0;
  let ineligible = 0;
  for (const row of sorted) {
    const cands = byOrder.get(row.orderNumber)?.filter(i => !used.has(i)) ?? [];
    const k = inst.machineIds.indexOf(row.machine);
    if (!cands.length) {
      exportOnly.push(row.orderNumber);
      continue;
    }
    if (k < 0) {
      machineUnknown++;
      continue;
    }
    const j = cands.find(i => inst.mod[i] >= 0 && inst.jobs[i].masterOrder === row.masterOrder) ?? cands[0];
    used.add(j);
    if (!inst.elig[j * inst.K + k]) ineligible++;
    if (inst.dur[j * inst.K + k] !== Math.round(row.plannedMin)) durMismatch++;
    queues[k].push(j);
  }
  const instanceOnly = inst.jobs.filter((_, i) => !used.has(i)).map(j => j.orderNumber);
  if (exportOnly.length) notes.push(`${exportOnly.length} parts in the export are not in this problem (first: ${exportOnly.slice(0, 3).join(', ')}).`);
  if (instanceOnly.length) notes.push(`${instanceOnly.length} parts of this problem are missing from the export (first: ${instanceOnly.slice(0, 3).join(', ')}).`);
  if (machineUnknown) notes.push(`${machineUnknown} export rows use a machine this problem does not have.`);
  if (ineligible) notes.push(`${ineligible} export rows sit on a machine the rules would not allow (ERP assignments are allowed to).`);
  if (durMismatch) notes.push(`${durMismatch} planned durations differ from this tool's (settings such as efficiency or part times probably differ).`);

  // timing check: replay the export's own sequence
  if (!instanceOnly.length && !exportOnly.length) {
    const m = evaluate(inst, queues);
    let startDiff = 0;
    let endDiff = 0;
    let setupDiff = 0;
    const idx = new Map<string, number[]>();
    inst.jobs.forEach((j, i) => (idx.get(j.orderNumber) ?? idx.set(j.orderNumber, []).get(j.orderNumber)!).push(i));
    const seen = new Set<number>();
    for (const row of sorted) {
      const j = (idx.get(row.orderNumber) ?? []).find(i => !seen.has(i) && inst.jobs[i].masterOrder === row.masterOrder);
      if (j === undefined) continue;
      seen.add(j);
      if (row.endMinute !== null && Math.abs(row.endMinute - m.end[j]) > 1) endDiff++;
      if (row.startMinute !== null && Math.abs(row.startMinute - m.start[j]) > 1) startDiff++;
      if (Math.abs(row.setupBefore - m.setupBefore[j]) > 0) setupDiff++;
    }
    if (endDiff || startDiff) notes.push(`${endDiff} end minutes / ${startDiff} start minutes differ when the export's sequence is replayed (the export may include downtime events or different changeover rules).`);
    if (setupDiff) notes.push(`${setupDiff} changeover values differ from the rules used here.`);
  }
  return { queues, notes, matched: used.size, exportOnly, instanceOnly };
}
