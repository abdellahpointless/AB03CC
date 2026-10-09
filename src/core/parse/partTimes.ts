import type { Job, PartTime, PartTimeMap } from '../types';
import { normalizeHeader, num, str, type Row } from './cells';

/** One list row, stored compactly: [normalized material number, minutes per piece, name]. */
export type PartTimeEntry = [string, number, string];

/**
 * Material numbers arrive as text, numbers ("200010006.0") or with leading zeros depending on how
 * each export was produced. Compare them in one normalized form.
 */
export function partKey(v: unknown): string {
  let s = str(v).toLowerCase();
  if (/^\d+\.0+$/.test(s)) s = s.replace(/\.0+$/, '');
  return s.replace(/^0+(?=.)/, '');
}

interface Columns {
  material: string;
  time: string;
  name?: string;
}

function findColumns(sample: Row | undefined): Columns | null {
  if (!sample) return null;
  const keys = Object.keys(sample);
  const norm = new Map(keys.map(k => [k, normalizeHeader(k)]));
  const material = keys.find(k => norm.get(k) === 'materialnumber') ?? keys.find(k => norm.get(k) === 'matnr');
  const time =
    keys.find(k => norm.get(k)!.startsWith('timeperpart')) ?? keys.find(k => ['avgtime', 'realtime', 'timepermin'].includes(norm.get(k)!));
  if (!material || !time) return null;
  const name = keys.find(k => ['materialname', 'partname', 'name', 'description'].includes(norm.get(k)!));
  return { material, time, name };
}

/** Does this sheet look like the parts time list (material number + average time per part)? */
export function looksLikePartTimes(sample: Row | undefined): boolean {
  return findColumns(sample) !== null;
}

export function parsePartTimes(rows: Row[]): { entries: PartTimeEntry[]; skipped: number } {
  const cols = findColumns(rows[0]);
  if (!cols) return { entries: [], skipped: rows.length };
  const byKey = new Map<string, PartTimeEntry>();
  let skipped = 0;
  for (const row of rows) {
    const key = partKey(row[cols.material]);
    const minutes = num(row[cols.time], 0);
    if (!key || !(minutes > 0)) {
      skipped++;
      continue;
    }
    byKey.set(key, [key, Math.round(minutes * 1000) / 1000, cols.name ? str(row[cols.name]) : '']);
  }
  return { entries: [...byKey.values()], skipped };
}

export function buildPartTimeIndex(entries: PartTimeEntry[]): Map<string, PartTime> {
  const map = new Map<string, PartTime>();
  for (const [key, minutes, name] of entries) map.set(key, { minutes, name: name || undefined });
  return map;
}

/** Only the part times the current workload needs, so the planner worker receives a small object. */
export function pickPartTimes(index: Map<string, PartTime>, jobs: Job[]): PartTimeMap {
  const out: PartTimeMap = {};
  for (const j of jobs) {
    const key = partKey(j.matnr);
    const hit = index.get(key);
    if (hit) out[key] = hit;
  }
  return out;
}

export interface PartTimeCoverage {
  jobs: number;
  measuredJobs: number;
  uniqueParts: number;
  measuredParts: number;
}

export function partTimeCoverage(index: Map<string, PartTime>, jobs: Job[]): PartTimeCoverage {
  const parts = new Set<string>();
  const hit = new Set<string>();
  let measuredJobs = 0;
  for (const j of jobs) {
    const key = partKey(j.matnr);
    parts.add(key);
    if (index.has(key)) {
      hit.add(key);
      measuredJobs++;
    }
  }
  return { jobs: jobs.length, measuredJobs, uniqueParts: parts.size, measuredParts: hit.size };
}
