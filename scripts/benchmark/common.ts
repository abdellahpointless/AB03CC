import { readFileSync } from 'node:fs';
import { defaultSettings, mergeSettings } from '../../src/core/defaults';
import { instanceFromPlan } from '../../src/core/optimizer/fromPlan';
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

export { instanceFromPlan };
export type { Built } from '../../src/core/optimizer/fromPlan';

/** `--name value` flags (repeatable) and the workload files after `--`. */
export function parseFlags(argv: string[] = process.argv.slice(2)) {
  const sep = argv.indexOf('--');
  const head = sep >= 0 ? argv.slice(0, sep) : argv;
  const files = sep >= 0 ? argv.slice(sep + 1) : [];
  const all = (name: string) => head.flatMap((a, i) => (a === `--${name}` ? [head[i + 1]] : []));
  return { files, all, get: (name: string, def?: string) => all(name)[0] ?? def, has: (name: string) => head.includes(`--${name}`) };
}
export type Flags = ReturnType<typeof parseFlags>;

/**
 * Settings of the run being judged: the app's defaults plus the changes in the optional `--settings file.json`
 * (priority rules, disruptions on the timeline, calendar ...) and the plan start date.
 */
export function loadSettings(flags: Flags): PlannerSettings {
  const path = flags.get('settings');
  const patch = path ? (JSON.parse(readFileSync(path, 'utf8')) as Partial<PlannerSettings>) : {};
  const settings = mergeSettings({ ...defaultSettings(), ...patch });
  settings.calendar.startDate = flags.get('start-date', patch.calendar?.startDate ?? '2026-10-09')!;
  return settings;
}

/** Everything a benchmark script needs: the inputs, the settings, the app's own plan and the search instance of it. */
export function prepare(flags: Flags) {
  const inp = loadInputs(flags.files, 'src/data/builtin-part-times.json');
  const settings = loadSettings(flags);
  const plan = runApp(inp, settings);
  const { inst, appQueues } = instanceFromPlan(plan, settings, inp.partTimes);
  return { inp, settings, plan, inst, appQueues };
}
