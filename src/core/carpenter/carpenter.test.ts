import { describe, expect, it } from 'vitest';
import helper from '../../../tools/shop-helper/helper.js?raw';
import { liteOf } from '../../ui/ScriptsModal';
import { defaultSettings } from '../defaults';
import type { CarpenterPart } from '../types';
import { buildCutItems } from './items';
import { buildCutLine } from './cutLine';

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
  it('follows the steps, then material, board Z and strip width, changing the blade at most once per step', () => {
    const line = buildCutLine(items, [{ id: 's', type: 'sales_order', value: '0014102903', material: 'FH' }], {
      inProduction: mo => mo === 'B',
      minutes: s.carpenter,
    });
    // no part carries that sales order: the step is empty and skipped
    expect(line.steps.map(x => x.title)).toEqual(['Everything else']);
    const all = line.steps.flatMap(st => st.materials.flatMap(m => m.boards.flatMap(b => b.strips.flatMap(x => x.parts.map(p => p.item.id)))));
    expect(new Set(all).size).toBe(4);
    const fh = line.steps[0].materials.find(m => m.material === 'FH')!;
    expect(fh.boards.map(b => b.z)).toEqual([40]);
    expect(fh.boards[0].strips.map(x => x.width)).toEqual([100]); // 100x150 and 100x50 share the 100 mm strip
    const prod = buildCutLine(items, [{ id: 'p', type: 'in_production', value: '', material: 'MS' }], { inProduction: mo => mo === 'B', minutes: s.carpenter });
    expect(prod.steps[0].title).toBe('Boxes in production');
    expect(prod.steps[0].materials.map(m => m.material)).toEqual(['MS', 'FH']);
    expect(prod.totals.bladeChanges).toBeLessThanOrEqual(2);
  });
  it('bookmark version of the shop helper still parses', () => {
    expect(() => new Function(liteOf(helper))).not.toThrow();
  });
});
