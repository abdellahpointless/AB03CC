import type { Job } from './types';

/**
 * What kind of work an order is, from how its numbers start (the prefixes are settings; defaults in brackets):
 *  - rework: order starts with a rework prefix (80000); top priority, ahead of every rule
 *  - table:  order and master order start with a table prefix (60000), or a spare prefix with the sales order of a table
 *  - spare:  order starts with a spare prefix (30000) and is not a table
 *  - module: everything else (order and master order 10000)
 */
export type PartKind = 'module' | 'rework' | 'table' | 'spare';

/** Order-number prefixes per kind; several prefixes per kind are allowed. */
export interface PartKindCodes {
  rework: string[];
  table: string[];
  spare: string[];
}
export const DEFAULT_PART_KIND_CODES: PartKindCodes = { rework: ['80000'], table: ['60000'], spare: ['30000'] };

const noZeros = (s: string) => s.trim().replace(/^0+/, '');

/** "80000, 81000" -> ['80000', '81000'] (digits only, empty entries dropped) */
export function parsePrefixes(text: string): string[] {
  return [...new Set(text.split(/[\s,;]+/).map(s => s.replace(/\D/g, '')).filter(Boolean))];
}

/** The codes to use: missing or empty lists fall back to the defaults, so an order is never left without a rule. */
export function kindCodes(codes?: Partial<PartKindCodes> | null): PartKindCodes {
  const pick = (k: keyof PartKindCodes) => (Array.isArray(codes?.[k]) && codes![k]!.length ? codes![k]! : DEFAULT_PART_KIND_CODES[k]);
  return { rework: pick('rework'), table: pick('table'), spare: pick('spare') };
}

const startsWithAny = (s: string, prefixes: string[]) => prefixes.some(p => s.startsWith(p));

export function isReworkOrder(orderNumber: string, codes?: Partial<PartKindCodes> | null): boolean {
  return startsWithAny(orderNumber, kindCodes(codes).rework);
}

export function classifyKinds(jobs: Job[], codes?: Partial<PartKindCodes> | null): Map<string, PartKind> {
  const c = kindCodes(codes);
  const tableSalesOrders = new Set<string>();
  for (const j of jobs) if (startsWithAny(j.orderNumber, c.table) && startsWithAny(j.masterOrder, c.table) && j.salesOrder) tableSalesOrders.add(noZeros(j.salesOrder));
  const out = new Map<string, PartKind>();
  for (const j of jobs) {
    const order = j.orderNumber;
    const master = j.masterOrder;
    let kind: PartKind = 'module';
    if (startsWithAny(order, c.rework)) kind = 'rework';
    else if (startsWithAny(order, c.table) && startsWithAny(master, c.table)) kind = 'table';
    else if (startsWithAny(order, c.spare)) kind = startsWithAny(master, c.spare) && j.salesOrder && tableSalesOrders.has(noZeros(j.salesOrder)) ? 'table' : 'spare';
    out.set(j.id, kind);
  }
  return out;
}

/** "80000" or "80000 / 81000", for help texts */
export const prefixText = (prefixes: string[]) => prefixes.map(p => `${p}*`).join(' / ');

/** Tables and spares are planned from a start and a finish time the user chooses, per sales order. */
export interface PartGroup {
  key: string;
  kind: 'table' | 'spare';
  salesOrder: string;
  customer: string;
  masterOrders: string[];
  jobIds: string[];
}

export function groupKey(kind: 'table' | 'spare', job: Job): string {
  return `${kind}|${job.salesOrder ? noZeros(job.salesOrder) : job.masterOrder}`;
}

export function buildGroups(jobs: Job[], kinds: Map<string, PartKind>): PartGroup[] {
  const groups = new Map<string, PartGroup>();
  for (const j of jobs) {
    const kind = kinds.get(j.id);
    if (kind !== 'table' && kind !== 'spare') continue;
    const key = groupKey(kind, j);
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { key, kind, salesOrder: j.salesOrder || j.masterOrder, customer: j.customer, masterOrders: [], jobIds: [] }));
    if (!g.masterOrders.includes(j.masterOrder)) g.masterOrders.push(j.masterOrder);
    g.jobIds.push(j.id);
  }
  return [...groups.values()].sort((a, b) => a.kind.localeCompare(b.kind) || a.salesOrder.localeCompare(b.salesOrder));
}

/** Parts of the applied emergency orders: same sales order (leading zeros ignored) and, when given, the same schedule. */
export function emergencyJobIds(jobs: Job[], entries: Array<{ salesOrder: string; schedule: number | null; applied?: boolean }>): Set<string> {
  const out = new Set<string>();
  for (const e of entries) {
    if (e.applied === false) continue;
    const so = noZeros(e.salesOrder);
    if (!so) continue;
    for (const j of jobs) if (noZeros(j.salesOrder) === so && (e.schedule === null || j.scheduleNo === e.schedule)) out.add(j.id);
  }
  return out;
}
