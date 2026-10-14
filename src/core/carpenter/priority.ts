import type { CarpenterRule, CarpenterRuleType, CarpenterSettings } from '../types';

/** What the carpenter priority knows about one box (master order). */
export interface BoxFacts {
  masterOrder: string;
  salesOrder?: string;
  schedule?: number;
  customer?: string;
  productionDate?: string;
  materials: string[];
  /** its sales order (and schedule) is in the CNC plan: we are producing it */
  inProduction: boolean;
  /** an applied emergency */
  urgent: boolean;
}

export const RULE_LABELS: Record<CarpenterRuleType, string> = {
  sales_order: 'Sales order',
  schedule: 'Schedule',
  customer: 'Customer',
  master_order: 'Box (master order)',
  material: 'Material',
  production_before: 'Production date on or before',
};

const noZeros = (s: string | undefined) => (s ?? '').trim().replace(/^0+/, '');
const list = (v: string) =>
  v
    .split(/[,;\s]+/)
    .map(x => x.trim())
    .filter(Boolean);

export function ruleMatches(r: CarpenterRule, b: BoxFacts): boolean {
  const v = r.value.trim();
  if (!v) return false;
  switch (r.type) {
    case 'sales_order':
      return list(v).some(x => noZeros(x) === noZeros(b.salesOrder));
    case 'master_order':
      return list(v).some(x => noZeros(x) === noZeros(b.masterOrder));
    case 'schedule':
      return b.schedule !== undefined && list(v).some(x => Number(x) === b.schedule);
    case 'customer':
      return (b.customer ?? '').toLowerCase().includes(v.toLowerCase());
    case 'material':
      return list(v.toUpperCase()).some(x => b.materials.includes(x));
    case 'production_before':
      return Boolean(b.productionDate) && b.productionDate!.slice(0, 10) <= v.slice(0, 10);
  }
}

/**
 * Level of a box, 0 = cut first: urgent orders and boxes already in production, then the admin's rules in their order
 * (the first rule a box matches decides), then everything else. `reason` is shown to the carpenter.
 */
export function boxLevel(b: BoxFacts, s: Pick<CarpenterSettings, 'productionFirst' | 'priorityRules'>): { level: number; reason?: string } {
  if (b.urgent) return { level: 0, reason: 'urgent order' };
  if (s.productionFirst && b.inProduction) return { level: 0, reason: 'in production' };
  const rules = s.priorityRules.filter(r => r.enabled && r.value.trim());
  const i = rules.findIndex(r => ruleMatches(r, b));
  if (i >= 0) return { level: i + 1, reason: `priority ${i + 1}: ${RULE_LABELS[rules[i].type].toLowerCase()} ${rules[i].value.trim()}` };
  return { level: rules.length + 1 };
}
