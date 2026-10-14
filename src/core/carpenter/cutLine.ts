import type { CarpenterSettings, CutItem } from '../types';

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
 */

export type CutStepType = 'in_production' | 'sales_order' | 'schedule' | 'production_date';
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
export interface CutLine {
  steps: LineStep[];
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
  }
}

export function stepTitle(rule: CutStepRule): string {
  if (rule.type === 'in_production') return STEP_LABELS.in_production;
  return `${STEP_LABELS[rule.type]} ${rule.value.trim() || '(empty)'}`;
}

/** Z = the board thickness (else the smallest cut size); the other two sizes are the strip width and the length. */
function zOf(it: CutItem): { z: number; rest: [number, number] } {
  const c = it.cut!;
  const dims = [...c];
  let zi = -1;
  if (it.thickness !== null) {
    let best = Infinity;
    dims.forEach((d, i) => {
      const diff = Math.abs(d - it.thickness!);
      if (diff <= 2 && diff < best) {
        best = diff;
        zi = i;
      }
    });
  }
  if (zi < 0) zi = dims.indexOf(Math.min(...dims));
  const rest = dims.filter((_, i) => i !== zi) as [number, number];
  return { z: it.thickness ?? dims[zi], rest };
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

/** Builds the carpenter's line. `items` are all cut items; only those still to saw or to pick are placed. */
export function buildCutLine(items: CutItem[], rules: CutStepRule[], o: CutLineOptions): CutLine {
  const m = o.minutes;
  const todo = items.filter(i => (i.status === 'to_cut' && i.cut) || i.status === 'premade');
  const used = new Set<string>();
  const stepRules: Array<{ rule: CutStepRule | null; title: string; test: (it: CutItem) => boolean }> = [];
  if (o.urgent) stepRules.push({ rule: null, title: 'Urgent orders', test: it => o.urgent!(it.part.masterOrder) });
  for (const r of rules) stepRules.push({ rule: r, title: stepTitle(r), test: it => stepMatches(r, it, o) });
  stepRules.push({ rule: null, title: 'Everything else', test: () => true });

  let mounted: Blade | null = null;
  const steps: LineStep[] = [];
  const totals = { parts: 0, qty: 0, bladeChanges: 0, boardChanges: 0, stripChanges: 0, minutes: 0 };
  for (const sr of stepRules) {
    const mine = todo.filter(it => !used.has(it.id) && sr.test(it));
    if (!mine.length) continue;
    mine.forEach(it => used.add(it.id));
    const sawn = mine.filter(it => it.status === 'to_cut');
    const picks = mine.filter(it => it.status === 'premade');
    const ordered = orderMaterials(groupStep(sawn), sr.rule?.material ?? '', mounted);
    let minutes = 0;
    let bladeChanges = 0;
    const materials: LineMaterial[] = ordered.map(g => {
      const bladeChange = mounted !== null && mounted !== g.blade;
      if (bladeChange) {
        bladeChanges++;
        minutes += m.sawChangeMin;
      }
      mounted = g.blade;
      for (const b of g.boards) {
        totals.boardChanges++;
        minutes += m.stockChangeMin;
        for (const s of b.strips) {
          totals.stripChanges++;
          minutes += m.stripChangeMin + new Set(s.parts.map(p => p.length)).size * m.lengthChangeMin + s.qty * m.minutesPerPiece;
        }
      }
      return { ...g, bladeChange };
    });
    const pickQty = picks.reduce((s, p) => s + p.qty, 0);
    minutes += pickQty * m.premadeMinutes;
    const qty = materials.reduce((s, g) => s + g.qty, 0) + pickQty;
    steps.push({ index: steps.length + 1, rule: sr.rule, title: sr.title, materials, picks, parts: mine.length, qty, minutes: r1(minutes), bladeChanges });
    totals.parts += mine.length;
    totals.qty += qty;
    totals.bladeChanges += bladeChanges;
    totals.minutes += minutes;
  }
  totals.minutes = r1(totals.minutes);
  return { steps, totals, listOrder: listOrderCounts(todo, m) };
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
