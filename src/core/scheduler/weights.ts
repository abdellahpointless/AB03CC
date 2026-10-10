import { FILTER_TYPES, jobMatchesRule } from '../priority';
import type { CarpenterDelayMode, Job, PriorityRule } from '../types';

/** What the planner knows about one master order when it decides how much finishing it early is worth. */
export interface ModuleFacts {
  key: string;
  /** the part of the order that ranks first under the priority rules */
  lead: Job;
  parts: number;
  /** carpenter has parts of this order that are still uncut */
  carpenterBlocked: boolean;
}

/** How much more a prioritised master order counts than an ordinary one, per priority class. */
export const TIER = 25;
/** The earliest production date counts this much more than the latest one (a gentle nudge, not a rule). */
export const DATE_SPREAD = 0.2;
/** A master order that cannot be completed yet because the carpenter is not done counts for less. */
export const CARPENTER_WEIGHT: Record<CarpenterDelayMode, number> = { off: 1, soft: 0.15, hard: 0.04 };

const dateKey = (j: Job) => {
  const d = j.plannedDate ?? j.dueDate;
  return d ? Date.parse(d) : Infinity;
};

/**
 * Turns the priority rules into one number per master order: how many "minutes of waiting" a minute of its completion
 * is worth. The planner minimises the weighted sum of completion times, so a heavier order is finished sooner.
 *
 *  - filter rules (sales order, schedule, customer, material): an order matching a rule of a more important level
 *    counts TIER times more than one matching only less important levels, which count TIER times more than one
 *    matching nothing. Levels are compared like digits, so level 1 always beats level 2.
 *  - production date: closer dates count slightly more (or slightly less when the rule says furthest first).
 *  - "waiting" / "finish full module" with highest first: orders with more parts count more.
 *  - carpenter: orders still waiting for the carpenter count for less.
 *
 * "Fewest parts left first" needs no extra weight: finishing the cheapest orders first is what minimising the sum of
 * completion times does anyway.
 */
export function moduleWeights(mods: ModuleFacts[], rules: PriorityRule[], carpenterMode: CarpenterDelayMode): number[] {
  const active = rules.filter(r => r.enabled);

  // filter levels, most important first
  const levelIds = [...new Set(active.filter(r => FILTER_TYPES.includes(r.type)).map(r => r.level))].sort((a, b) => a - b);
  const levels = levelIds.map(l => active.filter(r => r.level === l && FILTER_TYPES.includes(r.type)));
  const classOf = mods.map(m => levels.reduce((acc, rs, i) => acc + (rs.some(r => jobMatchesRule(m.lead, r)) ? 2 ** (levels.length - 1 - i) : 0), 0));
  const distinct = [...new Set(classOf)].sort((a, b) => a - b);
  const tierRank = new Map(distinct.map((c, i) => [c, Math.min(i, 4)]));

  // production date
  const dateRule = active.find(r => r.type === 'production_date');
  let dateFactor: number[] = mods.map(() => 1);
  if (dateRule && mods.length > 1) {
    const order = mods.map((m, i) => ({ i, d: dateKey(m.lead) })).sort((a, b) => a.d - b.d || a.i - b.i);
    const reverse = dateRule.dateDirection === 'furthest_first';
    dateFactor = new Array<number>(mods.length);
    order.forEach((o, pos) => {
      const f = pos / (mods.length - 1); // 0 = earliest date
      dateFactor[o.i] = 1 + DATE_SPREAD * (reverse ? f : 1 - f);
    });
  }

  // "more parts first"
  const bigFirst = active.some(r => (r.type === 'waiting' || r.type === 'finish_master_order') && r.direction === 'highest_first');
  const sizes = mods.map(m => m.parts).sort((a, b) => a - b);
  const median = sizes.length ? sizes[Math.floor(sizes.length / 2)] : 1;

  return mods.map((m, i) => {
    let w = TIER ** (tierRank.get(classOf[i]) ?? 0);
    w *= dateFactor[i];
    if (bigFirst) w *= Math.min(3, Math.max(0.3, m.parts / Math.max(1, median))) ** 2;
    if (m.carpenterBlocked) w *= CARPENTER_WEIGHT[carpenterMode];
    return w;
  });
}
