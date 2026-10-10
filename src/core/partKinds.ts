import type { Job } from './types';

/**
 * What kind of work an order is, from how its numbers start:
 *  - module: order and master order start with 10000
 *  - rework: order starts with 80000 (its master order with 10000); top priority, ahead of every rule
 *  - table:  order and master order start with 60000, or 30000 with the same sales order as a 60000 order
 *  - spare:  order starts with 30000 (anything that is not a table)
 */
export type PartKind = 'module' | 'rework' | 'table' | 'spare';

const noZeros = (s: string) => s.trim().replace(/^0+/, '');

export function classifyKinds(jobs: Job[]): Map<string, PartKind> {
  const tableSalesOrders = new Set<string>();
  for (const j of jobs) if (j.orderNumber.startsWith('60000') && j.masterOrder.startsWith('60000') && j.salesOrder) tableSalesOrders.add(noZeros(j.salesOrder));
  const out = new Map<string, PartKind>();
  for (const j of jobs) {
    const order = j.orderNumber;
    const master = j.masterOrder;
    let kind: PartKind = 'module';
    if (order.startsWith('80000')) kind = 'rework';
    else if (order.startsWith('60000') && master.startsWith('60000')) kind = 'table';
    else if (order.startsWith('30000')) kind = master.startsWith('30000') && j.salesOrder && tableSalesOrders.has(noZeros(j.salesOrder)) ? 'table' : 'spare';
    out.set(j.id, kind);
  }
  return out;
}

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
