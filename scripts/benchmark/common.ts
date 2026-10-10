import { readFileSync } from 'node:fs';
import { defaultSettings } from '../../src/core/defaults';
import { parseCarpenter } from '../../src/core/parse/carpenter';
import { buildPartTimeIndex, parsePartTimes, pickPartTimes, type PartTimeEntry } from '../../src/core/parse/partTimes';
import { parseProduction } from '../../src/core/parse/production';
import { detectKind, rowsFromBuffer, type Row } from '../../src/core/parse/workbook';
import { planProduction } from '../../src/core/scheduler/plan';
import type { CarpenterPart, Job, PartTimeMap, PlanResult, PlannerSettings } from '../../src/core/types';

export function loadRows(path: string): Row[] {
  const b = readFileSync(path);
  return rowsFromBuffer(new Uint8Array(b.buffer, b.byteOffset, b.byteLength));
}

export interface Inputs {
  jobs: Job[];
  carpenter: CarpenterPart[];
  partEntries: PartTimeEntry[];
  partTimes: PartTimeMap;
}

/** Reads any mix of the production export, carpenter list and parts time list (recognised by their columns). */
export function loadInputs(paths: string[], builtinPartList?: string): Inputs {
  let jobs: Job[] = [];
  let carpenter: CarpenterPart[] = [];
  let partEntries: PartTimeEntry[] = [];
  for (const p of paths) {
    const rows = loadRows(p);
    const kind = detectKind(rows);
    if (kind === 'production') jobs = parseProduction(rows).jobs;
    else if (kind === 'carpenter') carpenter = parseCarpenter(rows).parts;
    else if (kind === 'parttimes') partEntries = parsePartTimes(rows).entries;
  }
  if (builtinPartList && partEntries.length === 0) {
    try {
      partEntries = (JSON.parse(readFileSync(builtinPartList, 'utf8')) as { entries: PartTimeEntry[] }).entries;
    } catch {
      /* no built-in list available */
    }
  }
  const partTimes = pickPartTimes(buildPartTimeIndex(partEntries), jobs);
  return { jobs, carpenter, partEntries, partTimes };
}

export function runApp(inp: Inputs, settings: PlannerSettings = defaultSettings()): PlanResult {
  return planProduction(inp.jobs, settings, {}, inp.carpenter, inp.partTimes);
}

export { instanceFromPlan, type Built } from '../../src/core/optimizer/fromPlan';
