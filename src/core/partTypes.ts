import type { PartTimeMap } from './types';

/** A part is "small" when its real time per part is below this many minutes, "big" from there on. */
export const SMALL_PART_MINUTES = 15;

export type PartSize = 'small' | 'big';

export interface PartTypeRef {
  /** standard name, lower case: "contact pin plate" */
  key: string;
  size: PartSize;
}

// Trailing words that only number or version a part: "Contact pin plate 001", "Switch pin plate V4", "Sub plate 2",
// the long drawing code some names end with, "(2)", "rev A".
const NUMBERING = /^(?:(?:v|rev|r|no|nr|n°|#)\.?\d+[a-z]?|\d+(?:[.,]\d+)*[a-z]?|[a-z]\d+|\(\d+\)|-)$/i;

/** The standard name of a part: its name without numbering, so "Contact pin plate 001" and "Contact pin plate 2" agree. */
export function standardPartName(name: string): string {
  const tokens = name.trim().toLowerCase().replace(/\s+/g, ' ').split(' ').filter(Boolean);
  while (tokens.length > 1 && NUMBERING.test(tokens[tokens.length - 1])) tokens.pop();
  // "rev a" style: a lone revision letter after "rev"
  if (tokens.length > 2 && /^(?:rev|v)$/.test(tokens[tokens.length - 2]) && /^[a-z]$/.test(tokens[tokens.length - 1])) tokens.length -= 2;
  return tokens.join(' ');
}

export function partTypeLabel(key: string): string {
  return key ? key.charAt(0).toUpperCase() + key.slice(1) : key;
}

export function sizeOfMinutes(minutesPerPart: number): PartSize {
  return minutesPerPart < SMALL_PART_MINUTES ? 'small' : 'big';
}

/** Part type and size from the parts list entry, or null for a part that is not in the list (no name, no real time). */
export function partTypeFromEntry(entry: { name?: string; minutes: number } | undefined): PartTypeRef | null {
  if (!entry?.name) return null;
  const key = standardPartName(entry.name);
  return key ? { key, size: sizeOfMinutes(entry.minutes) } : null;
}

export interface PartTypeInfo {
  key: string;
  label: string;
  /** parts of this type in the whole list */
  inList: number;
  /** parts of this type in the loaded workload, split by size */
  small: number;
  big: number;
}

export function buildPartTypeInfo(
  entries: Array<[string, number, string]>,
  workload: Array<{ matnr: string }>,
  keyOf: (matnr: string) => string,
  times: PartTimeMap,
): PartTypeInfo[] {
  const map = new Map<string, PartTypeInfo>();
  const get = (key: string) => {
    let t = map.get(key);
    if (!t) map.set(key, (t = { key, label: partTypeLabel(key), inList: 0, small: 0, big: 0 }));
    return t;
  };
  for (const [, , name] of entries) {
    const key = name ? standardPartName(name) : '';
    if (key) get(key).inList++;
  }
  for (const j of workload) {
    const ref = partTypeFromEntry(times[keyOf(j.matnr)]);
    if (ref) get(ref.key)[ref.size]++;
  }
  return [...map.values()].sort((a, b) => b.small + b.big - (a.small + a.big) || b.inList - a.inList || a.key.localeCompare(b.key));
}
