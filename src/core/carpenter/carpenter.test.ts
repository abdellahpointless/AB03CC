import { describe, expect, it } from 'vitest';
import helper from '../../../tools/shop-helper/helper.js?raw';
import { liteOf } from '../../ui/ScriptsModal';
import { defaultSettings } from '../defaults';
import { planStartOffset } from '../calendar';
import type { CarpenterPart, CarpenterRule } from '../types';
import { buildCutItems } from './items';
import { planCuts } from './cutPlan';
import { boxLevel, type BoxFacts } from './priority';

const part = (mo: string, wo: string, measure: string, desc: string): CarpenterPart => ({
  masterOrder: mo, workOrder: wo, measure, descriptionDe: desc, qty: 1, cuttedStatus: false, carpenterStatus: false, hasNc: true,
});

describe('carpenter cut list', () => {
  const s = defaultSettings();
  const parts = [
    part('A', '1', 'TOP PLATE FH/2572893/100X150X40', '103314 - FH8221 40x1000x1000mm  B1409'),
    part('A', '2', 'CONTUR INSERT-1 A/200099749/CUT:24X15X35', '103392 - Alu 750x1000x20mm'),
    part('B', '3', 'ANGLE BRACKET M/200088482/CUT: 24X22X38', '120437 - Brass 20x10'),
    part('B', '4', 'TOP PLATE FH/2572894/100X50X40', '103314 - FH8221 40x1000x1000mm  B1409'),
  ];
  const items = buildCutItems(parts, { settings: s.carpenter });
  it('reads material and cut size', () => {
    expect(items.map(i => i.material)).toEqual(['FH', 'ALU', 'MS', 'FH']);
    expect(items[1].cut).toEqual([24, 15, 35]);
  });
  it('cuts every part once, deterministically, grouping the same bar', () => {
    const opts = { calendar: s.calendar, settings: s.carpenter, startMinute: planStartOffset(s.calendar), effort: 'quick' as const };
    const a = planCuts(items, opts);
    const b = planCuts(items, opts);
    expect(a.steps.map(x => x.item.id)).toEqual(b.steps.map(x => x.item.id));
    expect(new Set(a.steps.map(x => x.item.id)).size).toBe(4);
    expect(a.stats.stockChanges).toBeLessThanOrEqual(a.naive.stockChanges);
  });
  it('bookmark version of the shop helper still parses', () => {
    expect(() => new Function(liteOf(helper))).not.toThrow();
  });
});

describe('carpenter priority', () => {
  const box = (o: Partial<BoxFacts>): BoxFacts => ({ masterOrder: 'M1', materials: ['FH'], inProduction: false, urgent: false, ...o });
  const rules: CarpenterRule[] = [
    { id: 'a', type: 'schedule', value: '75, 85', enabled: true },
    { id: 'b', type: 'sales_order', value: '14102903', enabled: true },
    { id: 'c', type: 'customer', value: 'leoni', enabled: false },
  ];
  const s = { productionFirst: true, priorityRules: rules };
  it('puts boxes in production and urgent ones first, then the rules in order', () => {
    expect(boxLevel(box({ inProduction: true, schedule: 75 }), s).level).toBe(0);
    expect(boxLevel(box({ urgent: true }), s).level).toBe(0);
    expect(boxLevel(box({ schedule: 85, salesOrder: '0014102903' }), s).level).toBe(1);
    expect(boxLevel(box({ salesOrder: '0014102903' }), s).level).toBe(2);
    expect(boxLevel(box({ customer: 'Leoni Agadir' }), s).level).toBe(3); // the customer rule is off
    expect(boxLevel(box({ inProduction: true }), { ...s, productionFirst: false }).level).toBe(3);
  });
});
