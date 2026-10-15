import type { CarpenterSettings, CutItem } from '../types';
import { zIndexOf } from './dims';

/**
 * The carpenter's cut line: the admin's steps in order (sales order, schedule, production date, boxes in production),
 * and inside each step the parts grouped the way they are sawn:
 *
 *   material (one saw blade for FH, another for everything else)
 *     └ board thickness Z
 *         └ strip width: one long strip of the board at that width …
 *             └ … cut into the parts' lengths
 *
 * Steps are never mixed (that is the planning); inside a step the order changes the saw blade at most once, starting
 * with the step's preferred material, else with the blade already on the saw. Pure and fast: no search.
 *
 * An "end" step stops the line: nothing after it is cut, not even "everything else".
 * With a round limit (buildRounds) the parts go out in rounds instead: whole boxes in the steps' order until the
 * round is full, each round sawn in the fastest order, so the carpenter comes back and scans after each one.
 */

export type CutStepType = 'in_production' | 'sales_order' | 'schedule' | 'production_date' | 'end';
export interface CutStepRule {
  id: string;
  type: CutStepType;
  /** sales orders / schedules (comma separated) or a date YYYY-MM-DD (on or before); unused for in_production */
  value: string;
  /** material to start the step with ('' = whatever is on the saw) */
  material: string;
}

export const STEP_LABELS: Record<CutStepType, string> = {
  in_production: 'Boxes in production',
  sales_order: 'Sales order',
  schedule: 'Schedule',
  production_date: 'Production date on or before',
  end: 'End: nothing else',
};

export type Blade = 'FH' | 'OTHER';
export const bladeOf = (material: string | null): Blade => (material === 'FH' ? 'FH' : 'OTHER');

export interface LinePart {
  item: CutItem;
  /** board thickness, the strip width and the length cut from the strip (mm) */
  z: number;
  width: number;
  length: number;
}
export interface LineStrip {
  width: number;
  parts: LinePart[];
  qty: number;
  /** total strip length needed: Σ length × qty (no saw kerf) */
  totalLength: number;
}
export interface LineBoard {
  z: number;
  /** the stock boards these parts come from, e.g. "103314 FH8221 40x1000x1000mm" */
  boards: string[];
  strips: LineStrip[];
  qty: number;
}
export interface LineMaterial {
  material: string;
  blade: Blade;
  /** the saw blade has to be changed before this group */
  bladeChange: boolean;
  boards: LineBoard[];
  qty: number;
}
export interface LineStep {
  index: number;
  /** set when the line is cut in rounds: the boxes in this round and the steps they come from */
  round?: RoundInfo;
  rule: CutStepRule | null;
  title: string;
  materials: LineMaterial[];
  /** pre-cut blanks: picked, not sawn */
  picks: CutItem[];
  parts: number;
  qty: number;
  minutes: number;
  bladeChanges: number;
}
export interface LineCounts {
  bladeChanges: number;
  boardChanges: number;
  stripChanges: number;
  minutes: number;
}
export interface RoundInfo {
  boxes: number;
  /** the steps the boxes come from */
  from: string[];
  /** boxes too big for one round: their parts go on in the next round */
  continues: string[];
  /** boxes that started in an earlier round */
  continued: string[];
}
export interface CutLine {
  steps: LineStep[];
  /** parts left out by an "end" step */
  leftOut: number;
  /** the blade on the saw after the last step */
  endBlade: Blade | null;
  totals: LineCounts & { parts: number; qty: number };
  /** the same parts in the website's order */
  listOrder: LineCounts;
}

export interface CutLineOptions {
  /** box (master order) -> its sales order is in the CNC plan */
  inProduction: (masterOrder: string) => boolean;
  /** box -> applied emergency (always first) */
  urgent?: (masterOrder: string) => boolean;
  /** minutes: settings.carpenter */
  minutes: Pick<CarpenterSettings, 'minutesPerPiece' | 'sawChangeMin' | 'stockChangeMin' | 'stripChangeMin' | 'lengthChangeMin' | 'premadeMinutes'>;
  /** the blade already on the saw */
  mounted?: Blade | null;
}

const noZeros = (s: string | undefined) => (s ?? '').trim().replace(/^0+/, '');
const list = (v: string) =>
  v
    .split(/[,;\s]+/)
    .map(x => x.trim())
    .filter(Boolean);

export function stepMatches(rule: CutStepRule, it: CutItem, o: Pick<CutLineOptions, 'inProduction'>): boolean {
  const p = it.part;
  switch (rule.type) {
    case 'in_production':
      return o.inProduction(p.masterOrder);
    case 'sales_order':
      return list(rule.value).some(x => noZeros(x) === noZeros(p.salesOrder));
    case 'schedule':
      return p.schedule !== undefined && list(rule.value).some(x => Number(x) === p.schedule);
    case 'production_date':
      return Boolean(rule.value && p.productionDate) && p.productionDate!.slice(0, 10) <= rule.value.slice(0, 10);
    case 'end':
      return false;
  }
}

export function stepTitle(rule: CutStepRule): string {
  if (rule.type === 'in_production' || rule.type === 'end') return STEP_LABELS[rule.type];
  return `${STEP_LABELS[rule.type]} ${rule.value.trim() || '(empty)'}`;
}

/** Z = the board thickness (else the smallest cut size); the other two sizes are the strip width and the length. */
function zOf(it: CutItem): { z: number; rest: [number, number] } {
  const c = it.cut!;
  const zi = it.zi ?? zIndexOf(c, it.thickness);
  const rest = c.filter((_, i) => i !== zi) as [number, number];
  return { z: it.thickness ?? c[zi], rest };
}

const r1 = (v: number) => Math.round(v * 10) / 10;
const stockLabel = (it: CutItem) => (it.stockNo ? `${it.stockNo} ${it.stockText ?? ''}`.trim() : '');

/** Groups one step's parts: material → board Z → strip width → lengths. */
function groupStep(items: CutItem[]): Array<Omit<LineMaterial, 'bladeChange'>> {
  const byMat = new Map<string, Map<number, CutItem[]>>();
  const zs = new Map<string, { z: number; rest: [number, number] }>();
  for (const it of items) {
    const zr = zOf(it);
    zs.set(it.id, zr);
    const mat = it.material ?? '?';
    let m = byMat.get(mat);
    if (!m) byMat.set(mat, (m = new Map()));
    const z = r1(zr.z);
    (m.get(z) ?? m.set(z, []).get(z)!).push(it);
  }
  const out: Array<Omit<LineMaterial, 'bladeChange'>> = [];
  for (const [material, byZ] of byMat) {
    const boards: LineBoard[] = [];
    for (const [z, parts] of byZ) {
      // strip width: of each part's two other sizes, the one most parts of this board share
      const freq = new Map<number, number>();
      for (const it of parts) for (const d of new Set(zs.get(it.id)!.rest)) freq.set(d, (freq.get(d) ?? 0) + it.qty);
      const strips = new Map<number, LinePart[]>();
      for (const it of parts) {
        const [a, b] = zs.get(it.id)!.rest;
        const fa = freq.get(a) ?? 0;
        const fb = freq.get(b) ?? 0;
        const width = fa > fb || (fa === fb && a <= b) ? a : b;
        const length = width === a ? b : a;
        (strips.get(width) ?? strips.set(width, []).get(width)!).push({ item: it, z, width, length });
      }
      const stripList: LineStrip[] = [...strips].map(([width, ps]) => {
        ps.sort((x, y) => y.length - x.length || (x.item.part.productionDate ?? '').localeCompare(y.item.part.productionDate ?? '') || x.item.id.localeCompare(y.item.id));
        return { width, parts: ps, qty: ps.reduce((s, p) => s + p.item.qty, 0), totalLength: ps.reduce((s, p) => s + p.length * p.item.qty, 0) };
      });
      // small fence moves: narrow strips first
      stripList.sort((x, y) => x.width - y.width);
      boards.push({ z, boards: [...new Set(parts.map(stockLabel).filter(Boolean))], strips: stripList, qty: stripList.reduce((s, x) => s + x.qty, 0) });
    }
    boards.sort((x, y) => y.qty - x.qty || x.z - y.z);
    out.push({ material, blade: bladeOf(material), boards, qty: boards.reduce((s, b) => s + b.qty, 0) });
  }
  return out;
}

/** Puts a step's materials in sawing order: preferred material, then its blade's other materials, then the other blade. */
function orderMaterials(mats: Array<Omit<LineMaterial, 'bladeChange'>>, preferred: string, mounted: Blade | null): Array<Omit<LineMaterial, 'bladeChange'>> {
  const first: Blade = mats.some(m => m.material === preferred) ? bladeOf(preferred) : (mounted ?? (mats.find(m => m.blade === 'OTHER') ? 'OTHER' : 'FH'));
  return mats.slice().sort((a, b) => {
    const pa = a.material === preferred ? 0 : 1;
    const pb = b.material === preferred ? 0 : 1;
    const ba = a.blade === first ? 0 : 1;
    const bb = b.blade === first ? 0 : 1;
    return ba - bb || pa - pb || b.qty - a.qty || a.material.localeCompare(b.material);
  });
}

/** The parts still to saw or pick. */
const todoOf = (items: CutItem[]) => items.filter(i => (i.status === 'to_cut' && i.cut) || i.status === 'premade');

export interface AssignedStep {
  rule: CutStepRule | null;
  title: string;
  items: CutItem[];
}
/** Gives each part to the first step that takes it: urgent orders, the admin's steps up to an "end", then the rest. */
export function assignSteps(items: CutItem[], rules: CutStepRule[], o: Pick<CutLineOptions, 'inProduction' | 'urgent'>): { steps: AssignedStep[]; leftOut: CutItem[] } {
  const todo = todoOf(items);
  const used = new Set<string>();
  const end = rules.findIndex(r => r.type === 'end');
  const active = end >= 0 ? rules.slice(0, end) : rules;
  const stepRules: Array<{ rule: CutStepRule | null; title: string; test: (it: CutItem) => boolean }> = [];
  if (o.urgent) stepRules.push({ rule: null, title: 'Urgent orders', test: it => o.urgent!(it.part.masterOrder) });
  for (const r of active) stepRules.push({ rule: r, title: stepTitle(r), test: it => stepMatches(r, it, o) });
  if (end < 0) stepRules.push({ rule: null, title: 'Everything else', test: () => true });
  const steps: AssignedStep[] = [];
  for (const sr of stepRules) {
    const mine = todo.filter(it => !used.has(it.id) && sr.test(it));
    if (!mine.length) continue;
    mine.forEach(it => used.add(it.id));
    steps.push({ rule: sr.rule, title: sr.title, items: mine });
  }
  return { steps, leftOut: todo.filter(it => !used.has(it.id)) };
}

/** One step of the line: its parts grouped and ordered for the saw, with its minutes. Moves `state.mounted` on. */
function makeStep(index: number, rule: CutStepRule | null, title: string, mine: CutItem[], state: { mounted: Blade | null }, m: CutLineOptions['minutes']): LineStep {
  const sawn = mine.filter(it => it.status === 'to_cut');
  const picks = mine.filter(it => it.status === 'premade');
  const ordered = orderMaterials(groupStep(sawn), rule?.material ?? '', state.mounted);
  let minutes = 0;
  let bladeChanges = 0;
  const materials: LineMaterial[] = ordered.map(g => {
    const bladeChange = state.mounted !== null && state.mounted !== g.blade;
    if (bladeChange) {
      bladeChanges++;
      minutes += m.sawChangeMin;
    }
    state.mounted = g.blade;
    for (const b of g.boards) {
      minutes += m.stockChangeMin;
      for (const s of b.strips) minutes += m.stripChangeMin + new Set(s.parts.map(p => p.length)).size * m.lengthChangeMin + s.qty * m.minutesPerPiece;
    }
    return { ...g, bladeChange };
  });
  const pickQty = picks.reduce((s, p) => s + p.qty, 0);
  minutes += pickQty * m.premadeMinutes;
  const qty = materials.reduce((s, g) => s + g.qty, 0) + pickQty;
  return { index, rule, title, materials, picks, parts: mine.length, qty, minutes: r1(minutes), bladeChanges };
}

function totalsOf(steps: LineStep[]): CutLine['totals'] {
  const t = { parts: 0, qty: 0, bladeChanges: 0, boardChanges: 0, stripChanges: 0, minutes: 0 };
  for (const st of steps) {
    t.parts += st.parts;
    t.qty += st.qty;
    t.bladeChanges += st.bladeChanges;
    t.minutes += st.minutes;
    for (const g of st.materials) {
      t.boardChanges += g.boards.length;
      for (const b of g.boards) t.stripChanges += b.strips.length;
    }
  }
  t.minutes = r1(t.minutes);
  return t;
}

/** Builds the carpenter's line. `items` are all cut items; only those still to saw or to pick are placed. */
export function buildCutLine(items: CutItem[], rules: CutStepRule[], o: CutLineOptions): CutLine {
  const { steps: assigned, leftOut } = assignSteps(items, rules, o);
  const state = { mounted: o.mounted ?? null };
  const steps = assigned.map((a, i) => makeStep(i + 1, a.rule, a.title, a.items, state, o.minutes));
  return { steps, leftOut: leftOut.length, endBlade: state.mounted, totals: totalsOf(steps), listOrder: listOrderCounts(assigned.flatMap(a => a.items), o.minutes) };
}

/* ------------------------------------------------------------ rounds */

/** How much the carpenter cuts before he comes back to scan: hours of sawing, or pieces; 'none' = one long line. */
export interface RoundLimit {
  by: 'hours' | 'pieces' | 'none';
  value: number;
}

/** A quick, additive estimate of a round's sawing minutes (or pieces), so boxes can be tried one by one. */
class RoundCost {
  pieces = 0;
  private blades = new Set<Blade>();
  private boards = new Set<string>();
  private strips = new Set<string>();
  private lengths = new Set<string>();
  constructor(
    private m: CutLineOptions['minutes'],
    private byPieces: boolean,
  ) {}
  private keys(it: CutItem) {
    const { z, rest } = zOf(it);
    const board = `${it.material}|${r1(z)}`;
    const strip = `${board}|${Math.min(...rest)}`;
    return { blade: bladeOf(it.material), board, strip, length: `${strip}|${Math.max(...rest)}` };
  }
  value(): number {
    if (this.byPieces) return this.pieces;
    const m = this.m;
    return Math.max(0, this.blades.size - 1) * m.sawChangeMin + this.boards.size * m.stockChangeMin + this.strips.size * m.stripChangeMin + this.lengths.size * m.lengthChangeMin + this.pieces * m.minutesPerPiece;
  }
  /** the value with these parts added (nothing is kept) */
  with(parts: CutItem[]): number {
    if (this.byPieces) return this.pieces + parts.reduce((s, p) => s + p.qty, 0);
    const save = { pieces: this.pieces, blades: new Set(this.blades), boards: new Set(this.boards), strips: new Set(this.strips), lengths: new Set(this.lengths) };
    this.add(parts);
    const v = this.value();
    Object.assign(this, save);
    return v;
  }
  add(parts: CutItem[]) {
    for (const it of parts) {
      this.pieces += it.qty;
      if (this.byPieces || it.status !== 'to_cut') continue;
      const k = this.keys(it);
      this.blades.add(k.blade);
      this.boards.add(k.board);
      this.strips.add(k.strip);
      this.lengths.add(k.length);
    }
  }
}

/** how many waiting boxes of a step are looked at to fill a round (the earlier ones keep their head start) */
const WINDOW = 12;

/** sorts parts the way they are sawn, so a split box goes out in tidy pieces */
const sawOrder = (a: CutItem, b: CutItem) => {
  if (!a.cut || !b.cut) return (a.cut ? 0 : 1) - (b.cut ? 0 : 1);
  const za = zOf(a);
  const zb = zOf(b);
  return (
    bladeOf(a.material).localeCompare(bladeOf(b.material)) ||
    (a.material ?? '').localeCompare(b.material ?? '') ||
    za.z - zb.z ||
    Math.min(...za.rest) - Math.min(...zb.rest) ||
    Math.max(...zb.rest) - Math.max(...za.rest)
  );
};

/**
 * The line in rounds. Boxes (master orders) go in whole, in the steps' order (inside a step: earliest production date
 * first, then the list's order) until the round is full; when the next box does not fit, smaller boxes of the same step
 * may still fill the round, but never boxes of a later step. A box bigger than a whole round is split over rounds.
 * Each round is one step of the returned line, sawn in the fastest order.
 */
export function buildRounds(items: CutItem[], rules: CutStepRule[], o: CutLineOptions, limit: RoundLimit): CutLine {
  if (limit.by === 'none' || !(limit.value > 0)) return buildCutLine(items, rules, o);
  const cap = limit.by === 'hours' ? limit.value * 60 : limit.value;
  const byPieces = limit.by === 'pieces';
  const { steps: assigned, leftOut } = assignSteps(items, rules, o);

  type Box = { mo: string; step: number; parts: CutItem[]; part: number };
  const queue: Box[] = [];
  assigned.forEach((a, si) => {
    const byMo = new Map<string, CutItem[]>();
    for (const it of a.items) (byMo.get(it.part.masterOrder) ?? byMo.set(it.part.masterOrder, []).get(it.part.masterOrder)!).push(it);
    const date = (mo: string) => byMo.get(mo)!.reduce((d, it) => (it.part.productionDate && (!d || it.part.productionDate < d) ? it.part.productionDate : d), '' as string) || '9999';
    const boxes = [...byMo.keys()];
    const first = new Map(boxes.map((mo, i) => [mo, i]));
    boxes.sort((x, y) => date(x).localeCompare(date(y)) || first.get(x)! - first.get(y)!);
    for (const mo of boxes) queue.push({ mo, step: si, parts: byMo.get(mo)!, part: 0 });
  });

  const rounds: Array<{ parts: CutItem[]; boxes: Set<string>; steps: Set<number>; continues: string[]; continued: string[] }> = [];
  const state = { mounted: o.mounted ?? null };
  while (queue.length) {
    const cost = new RoundCost(o.minutes, byPieces);
    const r = { parts: [] as CutItem[], boxes: new Set<string>(), steps: new Set<number>(), continues: [] as string[], continued: [] as string[] };
    const take = (b: Box) => {
      cost.add(b.parts);
      r.parts.push(...b.parts);
      r.boxes.add(b.mo);
      r.steps.add(b.step);
      if (b.part > 0) r.continued.push(b.mo);
    };
    const head = queue[0];
    if (cost.with(head.parts) > cap) {
      // too big for one round: as many of its parts as fit, sawn-order, the rest goes on in the next round
      const sorted = head.parts.slice().sort(sawOrder);
      const now: CutItem[] = [];
      for (const it of sorted) {
        if (now.length && cost.with([...now, it]) > cap) break;
        now.push(it);
      }
      const rest = sorted.slice(now.length);
      take({ ...head, parts: now });
      if (rest.length) {
        r.continues.push(head.mo);
        queue[0] = { ...head, parts: rest, part: head.part + 1 };
      } else queue.shift();
    } else {
      const taken: Box[] = [];
      const takeAt = (i: number) => {
        const [b] = queue.splice(i, 1);
        take(b);
        taken.push(b);
      };
      takeAt(0);
      // then the boxes of the same step that fit and share the most with the round (boards, strips, sizes): a
      // later step only when every box of this one is in
      while (queue.length && cost.value() < cap) {
        const step = queue[0].step;
        let best = -1;
        let bestScore = Infinity;
        for (let i = 0, seen = 0; i < queue.length && seen < WINDOW && queue[i].step === step; i++, seen++) {
          const v = cost.with(queue[i].parts);
          if (v > cap) continue;
          const pcs = queue[i].parts.reduce((a, p) => a + p.qty, 0);
          const score = (v - cost.value()) / Math.max(1, pcs) + seen * 0.01;
          if (score < bestScore) {
            bestScore = score;
            best = i;
          }
        }
        if (best < 0) break;
        takeAt(best);
      }
      // the estimate can be a little short: drop the last boxes while the real sawing time is over the limit
      if (!byPieces)
        while (taken.length > 1 && makeStep(0, null, '', r.parts, { mounted: state.mounted }, o.minutes).minutes > cap) {
          const b = taken.pop()!;
          r.parts = r.parts.filter(p => !b.parts.includes(p));
          r.boxes.delete(b.mo);
          queue.unshift(b);
        }
    }
    rounds.push(r);
    state.mounted = makeStep(0, null, '', r.parts, { mounted: state.mounted }, o.minutes).materials.at(-1)?.blade ?? state.mounted;
  }

  state.mounted = o.mounted ?? null;
  const steps = rounds.map((r, i) => {
    const st = makeStep(i + 1, null, `Round ${i + 1}`, r.parts, state, o.minutes);
    st.round = { boxes: r.boxes.size, from: [...r.steps].sort((a, b) => a - b).map(si => assigned[si].title), continues: r.continues, continued: r.continued };
    return st;
  });
  return { steps, leftOut: leftOut.length, endBlade: state.mounted, totals: totalsOf(steps), listOrder: listOrderCounts(assigned.flatMap(a => a.items), o.minutes) };
}

/** The same parts sawn in the order of the website's list. */
function listOrderCounts(items: CutItem[], m: CutLineOptions['minutes']): LineCounts {
  const c: LineCounts = { bladeChanges: 0, boardChanges: 0, stripChanges: 0, minutes: 0 };
  let blade: Blade | null = null;
  let board = '';
  let strip = '';
  for (const it of items) {
    if (it.status === 'premade') {
      c.minutes += it.qty * m.premadeMinutes;
      continue;
    }
    const { z, rest } = zOf(it);
    const b = bladeOf(it.material);
    const bk = `${it.material}|${r1(z)}`;
    const sk = `${bk}|${Math.min(...rest)}`;
    if (blade !== null && b !== blade) {
      c.bladeChanges++;
      c.minutes += m.sawChangeMin;
    }
    if (bk !== board) {
      c.boardChanges++;
      c.minutes += m.stockChangeMin;
    }
    if (sk !== strip) {
      c.stripChanges++;
      c.minutes += m.stripChangeMin;
    }
    blade = b;
    board = bk;
    strip = sk;
    c.minutes += it.qty * m.minutesPerPiece + m.lengthChangeMin;
  }
  c.minutes = r1(c.minutes);
  return c;
}

/* ------------------------------------------------------------ the printed sheet and the scan order */

/** One line of the printed sheet: one size of one strip, whatever drawings it is for, with the total to cut. */
export interface SizeLine {
  /** line number on the sheet (1, 2, 3 … top to bottom) */
  no: number;
  step: LineStep;
  material: string;
  z: number;
  width: number;
  length: number;
  qty: number;
  parts: LinePart[];
}

const fmt = (n: number) => String(Math.round(n * 10) / 10);
/** "103 x 53 x 40": the two sawn sizes, longest first, then Z */
export function sizeText(length: number, width: number, z: number, sep = ' x '): string {
  const [a, b] = length >= width ? [length, width] : [width, length];
  return [a, b, z].map(fmt).join(sep);
}

/** A strip's parts with the same length, together (first one first). */
export function sameLength(parts: LinePart[]): Array<{ length: number; qty: number; parts: LinePart[] }> {
  const map = new Map<number, { length: number; qty: number; parts: LinePart[] }>();
  for (const p of parts) {
    let g = map.get(p.length);
    if (!g) map.set(p.length, (g = { length: p.length, qty: 0, parts: [] }));
    g.qty += p.item.qty;
    g.parts.push(p);
  }
  return [...map.values()];
}

/** The sheet's lines, numbered top to bottom in cutting order. */
export function sizeLines(line: CutLine): SizeLine[] {
  const out: SizeLine[] = [];
  for (const step of line.steps)
    for (const m of step.materials)
      for (const b of m.boards)
        for (const s of b.strips)
          for (const g of sameLength(s.parts)) out.push({ no: out.length + 1, step, material: m.material, z: b.z, width: s.width, length: g.length, qty: g.qty, parts: g.parts });
  return out;
}

/** One part to scan, with what the carpenter needs to know at the screen. */
export interface ScanEntry {
  item: CutItem;
  /** the step (or round) it was cut in */
  step: LineStep;
  material: string;
  /** "103 x 53 x 40" */
  size: string;
  /** the sheet lines this size is on */
  lines: number[];
}

/**
 * The scan order: step by step (round by round), and inside a step the parts as the carpenter takes them out of his
 * box of cut parts. One material after the other (the one with most pieces first), and inside it one size after the
 * other, the size with most pieces first; all the work orders of a size follow each other, so he picks that size once
 * and shares it out over its boxes.
 */
export function scanOrder(line: CutLine, keep: (it: CutItem) => boolean = () => true, only?: (step: LineStep) => boolean): ScanEntry[] {
  type Group = { step: LineStep; material: string; size: string; qty: number; lines: number[]; first: number; parts: CutItem[] };
  const out: ScanEntry[] = [];
  const all = sizeLines(line);
  for (const step of line.steps) {
    if (only && !only(step)) continue;
    const groups = new Map<string, Group>();
    for (const l of all) {
      if (l.step !== step) continue;
      for (const p of l.parts) {
        if (!keep(p.item)) continue;
        const size = sizeText(l.length, l.width, l.z);
        const k = `${l.material}|${size}`;
        let g = groups.get(k);
        if (!g) groups.set(k, (g = { step, material: l.material, size, qty: 0, lines: [], first: l.no, parts: [] }));
        g.qty += p.item.qty;
        if (!g.lines.includes(l.no)) g.lines.push(l.no);
        g.parts.push(p.item);
      }
    }
    const matQty = new Map<string, { qty: number; first: number }>();
    for (const g of groups.values()) {
      const m = matQty.get(g.material);
      if (!m) matQty.set(g.material, { qty: g.qty, first: g.first });
      else m.qty += g.qty;
    }
    const list = [...groups.values()].sort((a, b) => {
      const ma = matQty.get(a.material)!;
      const mb = matQty.get(b.material)!;
      return mb.qty - ma.qty || ma.first - mb.first || b.qty - a.qty || a.first - b.first;
    });
    for (const g of list) for (const item of g.parts) out.push({ item, step, material: g.material, size: g.size, lines: g.lines });
  }
  return out;
}

/** The scan list as text for the shop helper: Work Order, MaterialNr, Qty, Material, Size, Line, Part (tab separated). */
export function scanText(entries: ScanEntry[]): string {
  return entries
    .map(e => [e.item.part.workOrder ?? '', e.item.part.materialNr ?? '', e.item.qty, e.material, e.size, e.lines.map(n => `#${n}`).join(' '), e.item.part.partName ?? ''].join('\t'))
    .join('\n');
}
