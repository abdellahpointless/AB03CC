import { describe, expect, it } from 'vitest';
import helper from '../../../tools/shop-helper/helper.js?raw';
import { liteOf } from '../../ui/ScriptsModal';
import { defaultSettings, mergeSettings } from '../defaults';
import type { CarpenterPart } from '../types';
import { buildCutItems } from './items';
import { buildCutLine, buildRounds, scanOrder, scanText, sizeLines } from './cutLine';

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
    expect(fh.boards[0].strips.map(x => x.width)).toEqual([103]); // 100x150 and 100x50 (+3 mm) share the 103 mm strip
    const prod = buildCutLine(items, [{ id: 'p', type: 'in_production', value: '', material: 'MS' }], { inProduction: mo => mo === 'B', minutes: s.carpenter });
    expect(prod.steps[0].title).toBe('Boxes in production');
    expect(prod.steps[0].materials.map(m => m.material)).toEqual(['MS', 'FH']);
    expect(prod.totals.bladeChanges).toBeLessThanOrEqual(2);
  });
  it('saws FH 3 mm bigger on the two sizes that are not Z, other materials as written', () => {
    expect(items[0].cut).toEqual([103, 153, 40]);
    expect(items[0].written).toEqual([100, 150, 40]);
    expect(items[0].allowance).toBe(3);
    expect(items[3].cut).toEqual([103, 53, 40]);
    expect(items[2].cut).toEqual([24, 22, 38]);
    expect(items[2].allowance).toBeUndefined();
    // Z is the board's thickness even when it is not the smallest size
    const [thin] = buildCutItems([part('C', '9', 'ZUSATZPLATTE FH/2310117/20X28X10', '103434 - FH8221 20x1000x1000 B1400')], { settings: s.carpenter });
    expect(thin.cut).toEqual([20, 31, 13]);
  });
  it('takes the extra size per material from the settings', () => {
    expect(s.cutAllowances).toEqual({ FH: 3 });
    const own = buildCutItems(parts, { settings: s.carpenter, allowances: { FH: 5, ALU: 1 } });
    expect(own[0].cut).toEqual([105, 155, 40]);
    expect(own[0].allowance).toBe(5);
    expect(own[1].cut).toEqual([25, 15, 36]); // ALU now +1 on the two sizes that are not Z (15 is Z here)
    expect(own[2].allowance).toBeUndefined();
    const none = buildCutItems(parts, { settings: s.carpenter, allowances: {} });
    expect(none[0].cut).toEqual([100, 150, 40]);
    expect(none[0].allowance).toBeUndefined();
    const line = buildCutLine(own, [], { inProduction: () => false, minutes: s.carpenter });
    expect(line.steps[0].materials.find(m => m.material === 'FH')!.allowance).toBe(5);
  });
  it('keeps saved settings without the new fields working', () => {
    const old = mergeSettings({ settingsVersion: 5 } as never);
    expect(old.cutAllowances).toEqual({ FH: 3 });
    expect(old.partKindCodes).toEqual({ rework: ['80000'], table: ['60000'], spare: ['30000'] });
    expect(mergeSettings({ ...defaultSettings(), partKindCodes: { rework: [], table: ['61000'], spare: ['30000'] } }).partKindCodes.rework).toEqual(['80000']);
  });
  it('numbers one sheet line per size and scans material by material, the size with most pieces first', () => {
    const more = [
      ...parts,
      part('C', '5', 'TOP PLATE FH/2572895/100X50X40', '103314 - FH8221 40x1000x1000mm  B1409'),
      part('D', '6', 'TOP PLATE FH/2572896/100X50X40', '103314 - FH8221 40x1000x1000mm  B1409'),
    ];
    const its = buildCutItems(more, { settings: s.carpenter });
    const line = buildCutLine(its, [], { inProduction: () => false, minutes: s.carpenter });
    const lines = sizeLines(line);
    expect(lines.map(l => l.no)).toEqual(lines.map((_, i) => i + 1));
    // three drawings of 100x50 FH are one line of 3
    const small = lines.find(l => l.material === 'FH' && l.length === 53)!;
    expect(small.qty).toBe(3);
    const order = scanOrder(line);
    expect(order.map(e => e.item.part.workOrder)).toEqual(['4', '5', '6', '1', '2', '3']);
    expect(order[0].size).toBe('103 x 53 x 40');
    expect(order[0].lines).toEqual([small.no]);
    expect(scanText(order).split('\n')[0].split('\t')).toEqual(['4', '', '1', 'FH', '103 x 53 x 40', `#${small.no}`, '']);
    expect(scanOrder(line, it => it.part.workOrder === '2').map(e => e.item.part.workOrder)).toEqual(['2']);
  });
  it('stops at End: only the steps before it are cut', () => {
    const line = buildCutLine(items, [{ id: 'p', type: 'in_production', value: '', material: '' }, { id: 'e', type: 'end', value: '', material: '' }], { inProduction: mo => mo === 'B', minutes: s.carpenter });
    expect(line.steps.map(x => x.title)).toEqual(['Boxes in production']);
    expect(line.steps[0].parts).toBe(2);
    expect(line.leftOut).toBe(2);
  });
  it('cuts in rounds of whole boxes, in the steps order, splitting only a box bigger than a round', () => {
    const many: CarpenterPart[] = [];
    for (let b = 0; b < 6; b++) for (let k = 0; k < 3; k++) many.push({ ...part(`MO${b}`, `${b}${k}`, `TOP PLATE FH/25${b}${k}/100X${50 + k * 10}X40`, '103314 - FH8221 40x1000x1000mm  B1409'), qty: 2 });
    many.push(...Array.from({ length: 12 }, (_, k) => ({ ...part('BIG', `9${k}`, `TOP PLATE FH/26${k}/100X${40 + k * 5}X40`, '103314 - FH8221 40x1000x1000mm  B1409'), qty: 3 })));
    const its = buildCutItems(many, { settings: s.carpenter });
    const o = { inProduction: (mo: string) => mo === 'MO5', minutes: s.carpenter };
    const r = buildRounds(its, [{ id: 'p', type: 'in_production', value: '', material: '' }], o, { by: 'pieces', value: 12 });
    expect(r.steps.every(st => st.round && st.qty <= 12)).toBe(true);
    expect(r.totals.qty).toBe(6 * 3 * 2 + 12 * 3);
    // the box in production comes first
    expect(r.steps[0].materials.flatMap(m => m.boards.flatMap(b => b.strips.flatMap(x => x.parts.map(p => p.item.part.masterOrder))))).toContain('MO5');
    // whole boxes: a 6-piece box is never split; only BIG (36 pieces) is
    const roundsOf = new Map<string, Set<number>>();
    for (const st of r.steps) for (const g of st.materials) for (const b of g.boards) for (const x of b.strips) for (const p of x.parts) (roundsOf.get(p.item.part.masterOrder) ?? roundsOf.set(p.item.part.masterOrder, new Set()).get(p.item.part.masterOrder)!).add(st.index);
    for (const [mo, set] of roundsOf) expect(set.size === 1 || mo === 'BIG').toBe(true);
    expect(roundsOf.get('BIG')!.size).toBeGreaterThan(1);
    expect(r.steps.some(st => st.round!.continues.includes('BIG'))).toBe(true);
    // hours: no round over the limit
    const h = buildRounds(its, [], o, { by: 'hours', value: 0.5 });
    expect(h.steps.every(st => st.minutes <= 30 || st.round!.boxes === 1)).toBe(true);
    // modules: N whole boxes per round, never split
    const mods = buildRounds(its, [], o, { by: 'modules', value: 2 });
    expect(mods.steps.map(st => st.round!.boxes)).toEqual([2, 2, 2, 1]);
    expect(mods.steps.every(st => st.round!.continues.length === 0)).toBe(true);
    expect(mods.totals.qty).toBe(6 * 3 * 2 + 12 * 3);
    // no limit: the plain line
    expect(buildRounds(its, [], o, { by: 'none', value: 0 }).steps.every(st => !st.round)).toBe(true);
  });
  it('stops trusting the website\'s Cutted Status in settings saved before version 5', () => {
    expect(mergeSettings({ settingsVersion: 4, carpenterCutColumn: 'cutted_status' }).carpenterCutColumn).toBe('in_list');
    expect(mergeSettings({ ...defaultSettings(), carpenterCutColumn: 'cutted_status' }).carpenterCutColumn).toBe('cutted_status');
    // a row the website marks as cut is still in the list, so still to cut
    const [flagged] = buildCutItems([{ ...part('Z', '77', 'TOP PLATE FH/1/100X50X40', '103314 - FH8221 40x1000x1000mm  B1409'), cuttedStatus: true }], { settings: s.carpenter });
    expect(flagged.status).toBe('to_cut');
  });
  it('bookmark version of the shop helper still parses', () => {
    expect(() => new Function(liteOf(helper))).not.toThrow();
  });
});
