import type { Job, PriorityRule, PriorityRuleType } from './types';

export const FILTER_TYPES: PriorityRuleType[] = ['sales_order', 'schedule', 'customer', 'material_type'];
export const RANKING_TYPES: PriorityRuleType[] = ['waiting', 'finish_master_order', 'production_date'];

/** Context a comparison needs besides the two jobs. */
export interface RankContext {
  /** Parts still to plan per master order. */
  partsLeft: Record<string, number>;
}

const stripZeros = (s: string) => s.replace(/^0+/, '');

export function valueMatches(jobValue: string, target: string): boolean {
  if (!jobValue || !target) return false;
  const a = jobValue.trim().toLowerCase();
  const b = target.trim().toLowerCase();
  if (a === b) return true;
  const za = stripZeros(a);
  return za !== '' && za === stripZeros(b);
}

/** Does a "filter" style rule (sales order, schedule, customer, material) select this job? */
export function jobMatchesRule(job: Job, rule: PriorityRule): boolean {
  if (!rule.enabled) return false;
  const values = rule.values ?? [];
  switch (rule.type) {
    case 'sales_order':
      return values.some(v => valueMatches(job.salesOrder, v));
    case 'customer':
      return values.some(v => valueMatches(job.customer, v));
    case 'material_type':
      return values.some(v => valueMatches(job.materialType, v));
    case 'schedule': {
      if (job.scheduleNo === null) return false;
      if (rule.scheduleMode === 'range') {
        const min = rule.scheduleMin ?? -Infinity;
        const max = rule.scheduleMax ?? Infinity;
        return job.scheduleNo >= min && job.scheduleNo <= max;
      }
      if (rule.scheduleSingle !== null && rule.scheduleSingle !== undefined) return job.scheduleNo === rule.scheduleSingle;
      return values.some(v => valueMatches(String(job.scheduleNo), v));
    }
    default:
      return false;
  }
}

function levelsOf(rules: PriorityRule[]): Array<[number, PriorityRule[]]> {
  const map = new Map<number, PriorityRule[]>();
  rules
    .filter(r => r.enabled)
    .forEach(r => (map.get(r.level) ?? map.set(r.level, []).get(r.level)!).push(r));
  return [...map.entries()].sort((a, b) => a[0] - b[0]);
}

const dateKey = (j: Job) => {
  const d = j.plannedDate ?? j.dueDate;
  return d ? Date.parse(d) : Infinity;
};

/**
 * Lexicographic comparison across priority levels. Inside one level, a job that
 * matches any filter rule beats one that doesn't; ranking rules then order the rest.
 * Returns <0 when `a` goes first.
 */
export function compareByRules(a: Job, b: Job, rules: PriorityRule[], ctx: RankContext): number {
  for (const [, levelRules] of levelsOf(rules)) {
    const filters = levelRules.filter(r => FILTER_TYPES.includes(r.type));
    if (filters.length) {
      const am = filters.some(r => jobMatchesRule(a, r));
      const bm = filters.some(r => jobMatchesRule(b, r));
      if (am !== bm) return am ? -1 : 1;
    }
    for (const rule of levelRules.filter(r => RANKING_TYPES.includes(r.type))) {
      if (rule.type === 'waiting' || rule.type === 'finish_master_order') {
        const ca = ctx.partsLeft[a.masterOrder];
        const cb = ctx.partsLeft[b.masterOrder];
        if (ca !== undefined && cb !== undefined && ca !== cb) {
          return rule.direction === 'highest_first' ? cb - ca : ca - cb;
        }
        if (a.waitingDays !== b.waitingDays) {
          return rule.direction === 'highest_first' ? b.waitingDays - a.waitingDays : a.waitingDays - b.waitingDays;
        }
      } else if (rule.type === 'production_date') {
        const da = dateKey(a);
        const db = dateKey(b);
        if (da !== db) return rule.dateDirection === 'furthest_first' ? db - da : da - db;
      }
    }
  }
  return 0;
}

/** Human readable "why is this job here" label. */
export function decidingRule(job: Job, rules: PriorityRule[], ctx: RankContext, rank: number): string {
  for (const [level, levelRules] of levelsOf(rules)) {
    for (const rule of levelRules) {
      if (FILTER_TYPES.includes(rule.type) && jobMatchesRule(job, rule)) {
        switch (rule.type) {
          case 'sales_order':
            return `Level ${level}: Sales order ${job.salesOrder}`;
          case 'customer':
            return `Level ${level}: Customer ${job.customer}`;
          case 'material_type':
            return `Level ${level}: Material ${job.materialType}`;
          default:
            return rule.scheduleMode === 'range'
              ? `Level ${level}: Schedule ${rule.scheduleMin ?? '*'}-${rule.scheduleMax ?? '*'}`
              : `Level ${level}: Schedule ${job.scheduleNo}`;
        }
      }
    }
    for (const rule of levelRules) {
      const left = ctx.partsLeft[job.masterOrder] ?? 1;
      if (rule.type === 'finish_master_order')
        return `Level ${level}: Finish full module (${left} ${left === 1 ? 'part' : 'parts'} left)`;
      if (rule.type === 'waiting') return `Level ${level}: Waiting (${left} ${left === 1 ? 'part' : 'parts'} left)`;
      if (rule.type === 'production_date') return `Level ${level}: Production date ${(job.plannedDate ?? job.dueDate) ?? 'n/a'}`;
    }
  }
  const d = job.plannedDate ?? job.dueDate;
  return d ? `Default: production date ${d}` : `Priority rank #${rank}`;
}

export function ruleTypeLabel(type: PriorityRuleType): string {
  return {
    sales_order: 'Sales Order',
    schedule: 'Schedule Number',
    customer: 'Customer',
    material_type: 'Material',
    waiting: 'Waiting (fewest parts left)',
    finish_master_order: 'Finish Full Module',
    production_date: 'Production Date',
  }[type];
}
