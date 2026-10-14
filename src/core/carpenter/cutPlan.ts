/**
 * The carpenter's cut order (pure, deterministic: seeded search with fixed step counts).
 *
 * Objective (minimised): Σ_box tierFactor(tier) · weight · (done − start + max(0, done − due)) + ε · setup minutes,
 * tierFactor = 30^(maxTier − tier). Boxes that cannot complete (a part not ready or blocked) weigh nothing and go last.
 *
 * Decoder (box order π, series window W minutes): keep the current setup (saw, stock, strip, length). Take the head box
 * (first in π with work left); among its remaining (stock, strip) groups take the cheapest setup from the current one
 * (same strip < same stock < same saw < other; ties: most pieces inside the window); cut that group's parts of every
 * box from the head on whose cumulative remaining cut time from the head is ≤ W (always the head), sorted by length,
 * drawing and box order. A box's pre-made blanks are picked right after its last sawn part.
 *
 * Search: every W in {0, 20, 45, 90, 180, 360, 720, 1440}, each with a late-acceptance hill climb over π (swap or
 * move boxes inside their tier, move a box next to the box it shares the most stock groups with). Step counts, not
 * the clock, bound the work.
 */
import { WorkCalendar, breakWindows } from '../calendar';
import type { CalendarSettings, CarpenterSettings, CutItem, CutModule, CutPlan, CutSeries, CutStats, CutStep, PlanningEffort } from '../types';

export interface PlanCutsOptions {
  calendar: CalendarSettings;
  settings: CarpenterSettings;
  /** first carpenter minute on the plan axis (planStartOffset(calendar) for "now") */
  startMinute: number;
  /** priority class of a box: 0 = most urgent (default 0) */
  moTier?: (mo: string) => number;
  /** weight inside its class (default 1); multiplied by settings.inGanttBoost when moInGantt says so */
  moWeight?: (mo: string) => number;
  /** due plan minute, or null */
  moDue?: (mo: string) => number | null;
  /** its sales order (+ schedule) already has boxes in the workload */
  moInGantt?: (mo: string) => boolean;
  /** why the box has its place (shown first on its steps), e.g. 'in production', 'priority 2: schedule 75' */
  moReason?: (mo: string) => string | undefined;
  /** shown as 'urgent order' on its steps (e.g. an applied emergency) */
  moUrgent?: (mo: string) => boolean;
  effort: PlanningEffort;
  seed?: number;
}

/** Series windows tried, in minutes of remaining cut time. */
export const SERIES_WINDOWS = [0, 20, 45, 90, 180, 360, 720, 1440];

/** Search size: item-decodes per effort (1500 parts at 'quick' ≈ 0.3 s on a laptop core). */
const EFFORT_UNITS: Record<PlanningEffort, number> = { quick: 1_500_000, standard: 7_500_000, thorough: 20_000_000 };
const LAHC_LENGTH = 30;
const TIER_BASE = 30;

const SETUP_NAMES = [null, 'saw', 'stock', 'strip', 'length'] as const;
type SetupCode = 0 | 1 | 2 | 3 | 4; // none, saw, stock, strip, length

/* ------------------------------------------------------------------ */
/* strip / length per stock                                             */
/* ------------------------------------------------------------------ */

export function stockGroupKey(it: CutItem): string {
  return `${it.saw}\u0001${it.stockNo ?? `mat:${it.material ?? '?'}`}`;
}

/**
 * Per stock group: the thickness dim is the cut dim equal (±2 mm) to the stock thickness (else the smallest); the strip
 * width is the other dim shared by most parts of that stock (ties: the larger); the length is the remaining dim.
 * Returns strip and length by item id (to_cut items with a cut size only).
 */
export function assignStrips(items: CutItem[]): Map<string, { stripWidth: number; length: number }> {
  const groups = new Map<string, CutItem[]>();
  for (const it of items) {
    if (it.status !== 'to_cut' || !it.cut) continue;
    const k = stockGroupKey(it);
    (groups.get(k) ?? groups.set(k, []).get(k)!).push(it);
  }
  const out = new Map<string, { stripWidth: number; length: number }>();
  groups.forEach(list => {
    const thick = list.find(i => i.thickness !== null)?.thickness ?? null;
    const rest = list.map(it => {
      const d = [...it.cut!];
      let at = -1;
      if (thick !== null) {
        let bestDiff = Infinity;
        d.forEach((x, i) => {
          const diff = Math.abs(x - thick);
          if (diff <= 2 && diff < bestDiff) {
            bestDiff = diff;
            at = i;
          }
        });
      }
      if (at < 0) {
        at = 0;
        for (let i = 1; i < 3; i++) if (d[i] < d[at]) at = i;
      }
      d.splice(at, 1);
      return d as [number, number];
    });
    const freq = new Map<number, number>();
    for (const [a, b] of rest) {
      freq.set(a, (freq.get(a) ?? 0) + 1);
      if (b !== a) freq.set(b, (freq.get(b) ?? 0) + 1);
    }
    list.forEach((it, i) => {
      const [a, b] = rest[i];
      const fa = freq.get(a)!;
      const fb = freq.get(b)!;
      const strip = fa > fb ? a : fb > fa ? b : Math.max(a, b);
      out.set(it.id, { stripWidth: strip, length: strip === a ? b : a });
    });
  });
  return out;
}

/* ------------------------------------------------------------------ */
/* time on the carpenter's axis (pauses across breaks)                 */
/* ------------------------------------------------------------------ */

class Clock {
  constructor(private readonly w: Float64Array) {}

  private firstAfter(t: number): number {
    const w = this.w;
    let lo = 0;
    let hi = w.length >> 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (w[mid * 2 + 1] <= t) lo = mid + 1;
      else hi = mid;
    }
    return lo * 2;
  }

  /** `t`, or the end of the break it falls in */
  skip(t: number): number {
    const w = this.w;
    if (w.length === 0) return t;
    const i = this.firstAfter(t);
    return i < w.length && w[i] <= t ? w[i + 1] : t;
  }

  /** end of `d` working minutes from `t` (not inside a break), pausing across breaks */
  end(t: number, d: number): number {
    const w = this.w;
    if (w.length === 0 || d <= 0) return t + Math.max(0, d);
    let remaining = d;
    let cursor = t;
    for (let i = this.firstAfter(t); i < w.length; i += 2) {
      const room = w[i] - cursor;
      if (remaining <= room) return cursor + remaining;
      if (room > 0) remaining -= room;
      cursor = Math.max(cursor, w[i + 1]);
    }
    return cursor + remaining;
  }
}

/* ------------------------------------------------------------------ */
/* seeded random numbers                                                */
/* ------------------------------------------------------------------ */

function rng(seed: number) {
  let s = seed >>> 0 || 0x9e3779b9;
  const next = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return { next, int: (n: number) => Math.floor(next() * n) };
}

/* ------------------------------------------------------------------ */
/* the instance                                                         */
/* ------------------------------------------------------------------ */

interface Box {
  mo: string;
  items: CutItem[];
  sawn: number[];
  premade: CutItem[];
  completable: boolean;
  blockedBy?: string;
  tier: number;
  weight: number;
  due: number | null;
  inGantt: boolean;
  firstSeen: number;
}

interface Recorded {
  /** 0 = sawn item, 1 = pick */
  kind: number;
  /** sawn item index, or the pick's item */
  idx: number;
  pick?: CutItem;
  start: number;
  end: number;
  setup: SetupCode;
  setupMin: number;
  /** box at the head of the order when the step was cut */
  head: number;
}

function stats(): CutStats {
  return { parts: 0, pieces: 0, cutMinutes: 0, setupMinutes: 0, sawChanges: 0, stockChanges: 0, stripChanges: 0, finishMinute: 0 };
}

function countSetup(s: CutStats, code: SetupCode, minutes: number) {
  s.setupMinutes += minutes;
  if (code === 1) s.sawChanges++;
  if (code === 1 || code === 2) s.stockChanges++;
  if (code >= 1 && code <= 3) s.stripChanges++;
}

const r2 = (x: number) => Math.round(x * 1000) / 1000;

export function planCuts(itemsIn: CutItem[], opts: PlanCutsOptions): CutPlan {
  const cs = opts.settings;
  const start = opts.startMinute;
  const perPiece = Math.max(0, cs.minutesPerPiece);
  const pickPerPiece = Math.max(0, cs.premadeMinutes);
  const setupMinutes = [0, Math.max(0, cs.sawChangeMin), Math.max(0, cs.stockChangeMin), Math.max(0, cs.stripChangeMin), Math.max(0, cs.lengthChangeMin)];
  const cal = new WorkCalendar(opts.calendar);
  const wins = breakWindows(opts.calendar).filter(w => w.end > start);
  const clockW = new Float64Array(wins.length * 2);
  wins.forEach((w, i) => {
    clockW[i * 2] = w.start;
    clockW[i * 2 + 1] = w.end;
  });
  const clock = new Clock(clockW);

  // strips and lengths: copies of the items, the input stays untouched
  const strips = assignStrips(itemsIn);
  const items = itemsIn.map(it => {
    const s = strips.get(it.id);
    return s ? { ...it, stripWidth: s.stripWidth, length: s.length } : it;
  });

  const notReady = items.filter(i => i.status === 'not_ready');
  const blocked = items.filter(i => i.status === 'blocked');
  const premade = items.filter(i => i.status === 'premade');
  const elsewhere = items.filter(i => i.status === 'elsewhere');
  const alreadyCut = items.filter(i => i.status === 'cut').length;
  const sawnItems = items.filter(i => i.status === 'to_cut');

  /* ---------- boxes ---------- */
  const rowsPerMo = new Map<string, number>();
  for (const it of items) rowsPerMo.set(it.part.masterOrder, (rowsPerMo.get(it.part.masterOrder) ?? 0) + 1);
  const boxIndex = new Map<string, number>();
  const boxes: Box[] = [];
  items.forEach((it, i) => {
    if (it.status === 'cut' || it.status === 'elsewhere') return;
    const mo = it.part.masterOrder;
    let b = boxIndex.get(mo);
    if (b === undefined) {
      b = boxes.length;
      boxIndex.set(mo, b);
      boxes.push({ mo, items: [], sawn: [], premade: [], completable: true, tier: 0, weight: 0, due: null, inGantt: false, firstSeen: i });
    }
    boxes[b].items.push(it);
  });
  sawnItems.forEach((it, i) => boxes[boxIndex.get(it.part.masterOrder)!].sawn.push(i));
  for (const it of premade) boxes[boxIndex.get(it.part.masterOrder)!].premade.push(it);
  const boost = cs.inGanttBoost > 0 ? cs.inGanttBoost : 1;
  for (const b of boxes) {
    const nr = b.items.filter(i => i.status === 'not_ready').length;
    const bl = b.items.filter(i => i.status === 'blocked');
    if (nr || bl.length) {
      b.completable = false;
      b.blockedBy = [nr ? `${nr} part${nr > 1 ? 's' : ''} not ready (no cut size / NC file)` : '', bl.length ? `${bl.length} blocked: ${bl[0].alert?.text ?? bl[0].statusReason ?? ''}` : '']
        .filter(Boolean)
        .join('; ');
    }
    const tier = opts.moTier?.(b.mo) ?? 0;
    b.tier = Number.isFinite(tier) ? Math.max(0, Math.round(tier)) : 0;
    b.inGantt = opts.moInGantt?.(b.mo) ?? false;
    const w = opts.moWeight?.(b.mo) ?? 1;
    b.weight = (Number.isFinite(w) && w > 0 ? w : 0) * (b.inGantt ? boost : 1);
    const due = opts.moDue?.(b.mo) ?? null;
    b.due = due !== null && Number.isFinite(due) ? due : null;
  }

  /* ---------- flat arrays for the decoder ---------- */
  const n = sawnItems.length;
  const B = boxes.length;
  const sawId = new Map<string, number>();
  const stockId = new Map<string, number>();
  const groupId = new Map<string, number>();
  const groupSaw: number[] = [];
  const groupStock: number[] = [];
  const groupStrip: number[] = [];
  const iBox = new Int32Array(n);
  const iSaw = new Int32Array(n);
  const iStock = new Int32Array(n);
  const iGroup = new Int32Array(n);
  const iStrip = new Float64Array(n);
  const iLen = new Float64Array(n);
  const iDur = new Float64Array(n);
  const iPieces = new Float64Array(n);
  const iMat = new Int32Array(n);
  const matKeys = [...new Set(sawnItems.map(i => i.part.materialNr ?? ''))].sort();
  const matRank = new Map(matKeys.map((k, i) => [k, i]));
  sawnItems.forEach((it, i) => {
    const sk = stockGroupKey(it);
    let s = sawId.get(it.saw);
    if (s === undefined) sawId.set(it.saw, (s = sawId.size));
    let st = stockId.get(sk);
    if (st === undefined) stockId.set(sk, (st = stockId.size));
    const strip = it.stripWidth ?? -1;
    const gk = `${sk}\u0001${strip}`;
    let g = groupId.get(gk);
    if (g === undefined) {
      groupId.set(gk, (g = groupId.size));
      groupSaw.push(s);
      groupStock.push(st);
      groupStrip.push(strip);
    }
    iBox[i] = boxIndex.get(it.part.masterOrder)!;
    iSaw[i] = s;
    iStock[i] = st;
    iGroup[i] = g;
    iStrip[i] = strip;
    iLen[i] = it.length ?? -1;
    const pieces = Math.ceil(it.qty / Math.max(1, it.piecesPerBlank));
    iPieces[i] = pieces;
    iDur[i] = pieces * perPiece;
    iMat[i] = matRank.get(it.part.materialNr ?? '')!;
  });
  const G = groupId.size;
  const byLen = (a: number, b: number) => iLen[a] - iLen[b] || iMat[a] - iMat[b] || a - b;

  // box-group pairs, box by box; their items sorted by length then drawing
  const bgBox: number[] = [];
  const bgGroup: number[] = [];
  const bgDur: number[] = [];
  const bgPieces: number[] = [];
  const bgItemStart: number[] = [];
  const bgItems: number[] = [];
  const boxBgStart = new Int32Array(B + 1);
  for (let b = 0; b < B; b++) {
    boxBgStart[b] = bgBox.length;
    const per = new Map<number, number[]>();
    for (const i of boxes[b].sawn) (per.get(iGroup[i]) ?? per.set(iGroup[i], []).get(iGroup[i])!).push(i);
    per.forEach((list, g) => {
      list.sort(byLen);
      bgBox.push(b);
      bgGroup.push(g);
      bgItemStart.push(bgItems.length);
      let d = 0;
      let p = 0;
      for (const i of list) {
        bgItems.push(i);
        d += iDur[i];
        p += iPieces[i];
      }
      bgDur.push(d);
      bgPieces.push(p);
    });
  }
  boxBgStart[B] = bgBox.length;
  bgItemStart.push(bgItems.length);
  const M = bgBox.length;
  const gOff = new Int32Array(G + 1);
  for (let k = 0; k < M; k++) gOff[bgGroup[k] + 1]++;
  for (let g = 0; g < G; g++) gOff[g + 1] += gOff[g];

  const boxDur = new Float64Array(B);
  const boxSawnCount = new Int32Array(B);
  const boxPick = new Float64Array(B);
  for (let b = 0; b < B; b++) {
    for (const i of boxes[b].sawn) boxDur[b] += iDur[i];
    boxSawnCount[b] = boxes[b].sawn.length;
    for (const p of boxes[b].premade) boxPick[b] += p.qty * pickPerPiece;
  }

  // the order's classes: completable boxes by tier, then the boxes that cannot complete
  const workBoxes = boxes.map((_, b) => b).filter(b => boxSawnCount[b] > 0 || boxes[b].premade.length > 0);
  const maxTier = Math.max(0, ...workBoxes.filter(b => boxes[b].completable).map(b => boxes[b].tier));
  const pseudoTier = (b: number) => (boxes[b].completable ? Math.min(boxes[b].tier, maxTier) : maxTier + 1);
  const base = new Float64Array(B);
  for (const b of workBoxes) if (boxes[b].completable) base[b] = TIER_BASE ** (maxTier - pseudoTier(b)) * boxes[b].weight;
  const dueArr = new Float64Array(B).fill(Infinity);
  for (let b = 0; b < B; b++) if (boxes[b].due !== null) dueArr[b] = boxes[b].due!;
  let minBase = Infinity;
  for (const b of workBoxes) if (base[b] > 0 && base[b] < minBase) minBase = base[b];
  const eps = (Number.isFinite(minBase) ? minBase : 1) * 1e-3;

  const initial = Int32Array.from(
    [...workBoxes].sort(
      (a, b) =>
        pseudoTier(a) - pseudoTier(b) ||
        boxes[b].weight - boxes[a].weight ||
        dueArr[a] - dueArr[b] ||
        boxDur[a] + boxPick[a] - (boxDur[b] + boxPick[b]) ||
        boxes[a].firstSeen - boxes[b].firstSeen,
    ),
  );
  const P = initial.length;

  /* ---------- decoder ---------- */
  const pos = new Int32Array(B);
  const rem = new Float64Array(B);
  const bgDone = new Uint8Array(M);
  const bgLeft = new Int32Array(B);
  const itemsLeft = new Int32Array(B);
  const boxDone = new Uint8Array(B);
  const doneAt = new Float64Array(B);
  const gList = new Int32Array(M);
  const gFill = new Int32Array(G);
  const gPtr = new Int32Array(G);
  const series = new Int32Array(Math.max(1, n));
  const seriesSort = (a: number, b: number) => iLen[a] - iLen[b] || iMat[a] - iMat[b] || pos[iBox[a]] - pos[iBox[b]] || a - b;

  function decode(perm: Int32Array, W: number, rec?: Recorded[]): number {
    for (let i = 0; i < P; i++) pos[perm[i]] = i;
    rem.set(boxDur);
    bgDone.fill(0);
    boxDone.fill(0);
    for (let b = 0; b < B; b++) {
      bgLeft[b] = boxBgStart[b + 1] - boxBgStart[b];
      itemsLeft[b] = boxSawnCount[b];
    }
    for (let g = 0; g < G; g++) gFill[g] = gPtr[g] = gOff[g];
    for (let i = 0; i < P; i++) {
      const b = perm[i];
      for (let k = boxBgStart[b]; k < boxBgStart[b + 1]; k++) gList[gFill[bgGroup[k]]++] = k;
    }
    let t = start;
    let cost = 0;
    let setupTotal = 0;
    let curSaw = -1;
    let curStock = -1;
    let curStrip = NaN;
    let curLen = NaN;
    let head = 0;
    let k = -1;
    let S = 0;

    const finish = (b: number, at: number, headBox: number): number => {
      let tt = at;
      if (boxPick[b] > 0) {
        const s0 = clock.skip(tt);
        if (rec) {
          let c = s0;
          for (const p of boxes[b].premade) {
            const e = clock.end(c, p.qty * pickPerPiece);
            rec.push({ kind: 1, idx: -1, pick: p, start: c, end: e, setup: 0, setupMin: 0, head: headBox });
            c = clock.skip(e);
          }
        }
        tt = clock.end(s0, boxPick[b]);
      }
      boxDone[b] = 1;
      doneAt[b] = tt;
      if (base[b] > 0) cost += base[b] * (tt - start + Math.max(0, tt - dueArr[b]));
      return tt;
    };

    for (;;) {
      while (head < P && boxDone[perm[head]]) head++;
      if (head >= P) break;
      const h = perm[head];
      if (bgLeft[h] === 0) {
        t = finish(h, t, h);
        continue;
      }
      if (k < head) {
        k = head;
        S = rem[h];
      }
      while (k + 1 < P && S + rem[perm[k + 1]] <= W + 1e-9) {
        k++;
        S += rem[perm[k]];
      }
      // the head's cheapest group from the current setup; ties: most pieces in the window
      let bestBg = -1;
      let bestCls = 9;
      let bestPieces = -1;
      let ties = 0;
      for (let q = boxBgStart[h]; q < boxBgStart[h + 1]; q++) {
        if (bgDone[q]) continue;
        const g = bgGroup[q];
        const cls = curSaw < 0 ? 3 : groupSaw[g] !== curSaw ? 3 : groupStock[g] !== curStock ? 2 : groupStrip[g] !== curStrip ? 1 : 0;
        if (cls < bestCls) {
          bestCls = cls;
          bestBg = q;
          ties = 1;
        } else if (cls === bestCls) ties++;
      }
      if (ties > 1) {
        const cls0 = bestCls;
        bestBg = -1;
        for (let q = boxBgStart[h]; q < boxBgStart[h + 1]; q++) {
          if (bgDone[q]) continue;
          const g = bgGroup[q];
          const cls = curSaw < 0 ? 3 : groupSaw[g] !== curSaw ? 3 : groupStock[g] !== curStock ? 2 : groupStrip[g] !== curStrip ? 1 : 0;
          if (cls !== cls0) continue;
          let sum = 0;
          for (let p = gPtr[g]; p < gOff[g + 1]; p++) {
            const o = gList[p];
            if (pos[bgBox[o]] > k) break;
            if (!bgDone[o]) sum += bgPieces[o];
          }
          if (sum > bestPieces) {
            bestPieces = sum;
            bestBg = q;
          }
        }
      }
      const g = bgGroup[bestBg];
      while (gPtr[g] < gOff[g + 1] && bgDone[gList[gPtr[g]]]) gPtr[g]++;
      let cnt = 0;
      for (let p = gPtr[g]; p < gOff[g + 1]; p++) {
        const o = gList[p];
        const ob = bgBox[o];
        if (pos[ob] > k) break;
        if (bgDone[o]) continue;
        for (let x = bgItemStart[o]; x < bgItemStart[o + 1]; x++) series[cnt++] = bgItems[x];
        bgDone[o] = 1;
        bgLeft[ob]--;
        rem[ob] -= bgDur[o];
        S -= bgDur[o];
      }
      const run = series.subarray(0, cnt);
      if (cnt > 1) run.sort(seriesSort);
      for (let x = 0; x < cnt; x++) {
        const i = run[x];
        let code: SetupCode = 0;
        if (curSaw >= 0) {
          if (iSaw[i] !== curSaw) code = 1;
          else if (iStock[i] !== curStock) code = 2;
          else if (iStrip[i] !== curStrip) code = 3;
          else if (iLen[i] !== curLen) code = 4;
        }
        const sm = setupMinutes[code];
        const s0 = clock.skip(t);
        const e = clock.end(s0, sm + iDur[i]);
        setupTotal += sm;
        if (rec) rec.push({ kind: 0, idx: i, start: s0, end: e, setup: code, setupMin: sm, head: h });
        t = e;
        curSaw = iSaw[i];
        curStock = iStock[i];
        curStrip = iStrip[i];
        curLen = iLen[i];
        const b = iBox[i];
        if (--itemsLeft[b] === 0) t = finish(b, t, h);
      }
    }
    return cost + eps * setupTotal;
  }

  /* ---------- search ---------- */
  const R = rng((opts.seed ?? 20261013) ^ (n * 2654435761));
  const totalDur = boxDur.reduce((a, x) => a + x, 0);
  const windows: number[] = [];
  for (const W of SERIES_WINDOWS) {
    windows.push(W);
    if (W >= totalDur) break;
  }
  // classes (segments of the order) that the search may reorder
  const segStart = new Int32Array(P);
  const segEnd = new Int32Array(P);
  for (let i = 0; i < P; ) {
    let j = i;
    while (j < P && pseudoTier(initial[j]) === pseudoTier(initial[i])) j++;
    for (let x = i; x < j; x++) {
      segStart[x] = i;
      segEnd[x] = j;
    }
    i = j;
  }
  const movable: number[] = [];
  for (let i = 0; i < P; i++) if (segEnd[i] - segStart[i] >= 2 && base[initial[i]] > 0) movable.push(i);

  // for each box: up to 3 boxes of its class that share the most stock groups with it
  const partners: number[][] = Array.from({ length: B }, () => []);
  if (movable.length) {
    const boxesOfGroup: number[][] = Array.from({ length: G }, () => []);
    for (let q = 0; q < M; q++) boxesOfGroup[bgGroup[q]].push(bgBox[q]);
    const tierOfBox = new Int32Array(B).fill(-1);
    for (const i of movable) tierOfBox[initial[i]] = pseudoTier(initial[i]);
    const count = new Map<number, number>();
    for (const i of movable) {
      const a = initial[i];
      count.clear();
      for (let q = boxBgStart[a]; q < boxBgStart[a + 1]; q++) {
        const list = boxesOfGroup[bgGroup[q]];
        if (list.length > 400) continue; // a stock nearly everybody uses says little
        for (const o of list) if (o !== a && tierOfBox[o] === tierOfBox[a]) count.set(o, (count.get(o) ?? 0) + 1);
      }
      partners[a] = [...count.entries()].sort((x, y) => y[1] - x[1] || x[0] - y[0]).slice(0, 3).map(e => e[0]);
    }
  }

  const units = EFFORT_UNITS[opts.effort] ?? EFFORT_UNITS.standard;
  const totalDecodes = movable.length ? Math.min(60_000, Math.max(windows.length * 24, Math.floor(units / Math.max(n + P, 40)))) : 0;
  const perW = Math.floor(totalDecodes / windows.length);

  const curPos = new Int32Array(B);
  function neighbour(perm: Int32Array<ArrayBuffer>): Int32Array<ArrayBuffer> {
    const cand = perm.slice();
    const i = movable[R.int(movable.length)];
    const s = segStart[i];
    const e = segEnd[i];
    const len = e - s;
    const r = R.next();
    const moveTo = (from: number, to: number) => {
      if (from === to) return;
      const v = cand[from];
      if (from < to) cand.copyWithin(from, from + 1, to + 1);
      else cand.copyWithin(to + 1, to, from);
      cand[to] = v;
    };
    if (r < 0.3) {
      let j = s + R.int(len);
      if (j === i) j = s + ((j - s + 1) % len);
      const v = cand[i];
      cand[i] = cand[j];
      cand[j] = v;
    } else if (r < 0.7 || !partners[cand[i]].length) {
      let j: number;
      if (R.next() < 0.5) {
        const d = 1 + R.int(Math.min(6, len - 1));
        j = Math.min(e - 1, Math.max(s, R.next() < 0.5 ? i - d : i + d));
      } else j = s + R.int(len);
      moveTo(i, j);
    } else {
      const list = partners[cand[i]];
      const other = list[R.int(list.length)];
      const j = curPos[other];
      if (j > i) moveTo(i, j);
      else moveTo(i, j + 1);
    }
    return cand;
  }

  let bestPerm = initial.slice();
  let bestW = windows[0];
  let bestCost = Infinity;
  for (const W of windows) {
    let perm = initial.slice();
    let cost = decode(perm, W);
    if (cost < bestCost - 1e-9) {
      bestCost = cost;
      bestPerm = perm.slice();
      bestW = W;
    }
    if (perW <= 0) continue;
    for (let i = 0; i < P; i++) curPos[perm[i]] = i;
    const hist = new Float64Array(LAHC_LENGTH).fill(cost);
    for (let it = 0; it < perW; it++) {
      const cand = neighbour(perm);
      const c = decode(cand, W);
      const v = it % LAHC_LENGTH;
      if (c <= cost || c <= hist[v]) {
        perm = cand;
        cost = c;
        for (let i = 0; i < P; i++) curPos[perm[i]] = i;
        if (c < bestCost - 1e-9) {
          bestCost = c;
          bestPerm = perm.slice();
          bestW = W;
        }
      }
      hist[v] = cost;
    }
  }

  /* ---------- the chosen order, recorded ---------- */
  const rec: Recorded[] = [];
  decode(bestPerm, bestW, rec);
  const fmtDay = (minute: number) => {
    const iso = cal.toIso(minute);
    return `${iso.slice(8, 10)}.${iso.slice(5, 7)}`;
  };
  const steps: CutStep[] = [];
  const seriesList: CutSeries[] = [];
  const planStats = stats();
  let cur: CutSeries | null = null;
  let lastKey = '';
  let lastPart: CutItem | null = null;
  const boxLastStep = new Int32Array(B).fill(-1);
  rec.forEach((r, x) => {
    const it = r.kind === 0 ? sawnItems[r.idx] : r.pick!;
    boxLastStep[boxIndex.get(it.part.masterOrder)!] = x;
  });
  rec.forEach((r, x) => {
    const item = r.kind === 0 ? sawnItems[r.idx] : r.pick!;
    const b = boxIndex.get(item.part.masterOrder)!;
    const box = boxes[b];
    const index = x + 1;
    if (r.kind === 0) {
      const key = `${iSaw[r.idx]}|${iStock[r.idx]}|${iStrip[r.idx]}`;
      if (!cur || key !== lastKey) {
        cur = {
          id: seriesList.length + 1,
          saw: item.saw,
          stockNo: item.stockNo,
          stockText: item.stockText,
          material: item.material,
          thickness: item.thickness,
          stripWidth: item.stripWidth,
          first: index,
          last: index,
          pieces: 0,
          startMinute: r.start,
          endMinute: r.end,
        };
        seriesList.push(cur);
        lastKey = key;
      }
      cur.last = index;
      cur.pieces += iPieces[r.idx];
      cur.endMinute = r.end;
      countSetup(planStats, r.setup, r.setupMin);
      planStats.cutMinutes += iDur[r.idx];
      planStats.pieces += iPieces[r.idx];
      lastPart = item;
    } else {
      planStats.cutMinutes += item.qty * pickPerPiece;
      planStats.pieces += item.qty;
      if (cur) cur.endMinute = Math.max(cur.endMinute, r.end);
    }
    planStats.parts++;
    planStats.finishMinute = Math.max(planStats.finishMinute, r.end);

    const why: string[] = [];
    const reason = opts.moReason?.(box.mo);
    if (reason) why.push(reason);
    else if (opts.moUrgent?.(box.mo)) why.push('urgent order');
    else if (box.inGantt) why.push('in production');
    if (box.due !== null) why.push(`due ${fmtDay(box.due)}`);
    if (r.kind === 1) why.push('pre-made blank: pick it');
    else if (r.head !== b && cur && cur.first < index) why.push(`same bar as #${cur.first}`);
    if (item.alert?.replacementStock && item.stockNo === item.alert.replacementStock) why.push(`cut from ${item.stockNo} (alert)`);
    if (boxLastStep[b] === x && box.completable) why.push('finishes its box');
    steps.push({
      index,
      item,
      startMinute: r2(r.start),
      endMinute: r2(r.end),
      startTime: cal.toIso(r.start),
      endTime: cal.toIso(r.end, true),
      setup: SETUP_NAMES[r.setup],
      setupMinutes: r.setupMin,
      seriesId: cur ? cur.id : 0,
      why,
    });
  });
  void lastPart;
  for (const s of seriesList) {
    s.startMinute = r2(s.startMinute);
    s.endMinute = r2(s.endMinute);
  }
  planStats.finishMinute = r2(steps.length ? planStats.finishMinute : start);
  planStats.cutMinutes = r2(planStats.cutMinutes);
  planStats.setupMinutes = r2(planStats.setupMinutes);

  /* ---------- modules ---------- */
  const inPlan = new Uint8Array(B);
  for (const b of initial) inPlan[b] = 1;
  const modules: CutModule[] = boxes.map((box, b) => {
    const first = box.items[0].part;
    const m: CutModule = {
      masterOrder: box.mo,
      parts: rowsPerMo.get(box.mo) ?? box.items.length,
      toCut: box.sawn.length,
      doneMinute: box.completable && inPlan[b] ? r2(doneAt[b]) : null,
      tier: box.tier,
      weight: box.weight,
      inGantt: box.inGantt,
    };
    if (first.salesOrder) m.salesOrder = first.salesOrder;
    if (first.schedule !== undefined) m.schedule = first.schedule;
    if (first.customer) m.customer = first.customer;
    const name = box.items.find(i => i.part.moduleName)?.part.moduleName;
    if (name) m.moduleName = name;
    if (m.doneMinute !== null) m.doneTime = cal.toIso(m.doneMinute, true);
    if (box.blockedBy) m.blockedBy = box.blockedBy;
    else if (!inPlan[b]) m.blockedBy = 'nothing to cut or pick';
    return m;
  });
  modules.sort((a, b) => (a.doneMinute ?? Infinity) - (b.doneMinute ?? Infinity) || (a.masterOrder < b.masterOrder ? -1 : a.masterOrder > b.masterOrder ? 1 : 0));

  /* ---------- the same parts in file order ---------- */
  const naive = stats();
  {
    let t = start;
    let cs2 = -1;
    let ck = -1;
    let cp = NaN;
    let cl = NaN;
    const sawnIndex = new Map(sawnItems.map((it, i) => [it.id, i]));
    for (const it of items) {
      if (it.status === 'to_cut') {
        const i = sawnIndex.get(it.id)!;
        let code: SetupCode = 0;
        if (cs2 >= 0) {
          if (iSaw[i] !== cs2) code = 1;
          else if (iStock[i] !== ck) code = 2;
          else if (iStrip[i] !== cp) code = 3;
          else if (iLen[i] !== cl) code = 4;
        }
        const sm = setupMinutes[code];
        t = clock.end(clock.skip(t), sm + iDur[i]);
        countSetup(naive, code, sm);
        naive.cutMinutes += iDur[i];
        naive.pieces += iPieces[i];
        naive.parts++;
        cs2 = iSaw[i];
        ck = iStock[i];
        cp = iStrip[i];
        cl = iLen[i];
      } else if (it.status === 'premade') {
        t = clock.end(clock.skip(t), it.qty * pickPerPiece);
        naive.cutMinutes += it.qty * pickPerPiece;
        naive.pieces += it.qty;
        naive.parts++;
      }
    }
    naive.finishMinute = r2(t);
    naive.cutMinutes = r2(naive.cutMinutes);
    naive.setupMinutes = r2(naive.setupMinutes);
  }

  return {
    steps,
    series: seriesList,
    modules,
    notReady,
    blocked,
    premade,
    elsewhere,
    alreadyCut,
    unknownMaterials: collectUnknown(items),
    conflicts: collectConflicts(items),
    stats: planStats,
    naive,
  };
}

function collectUnknown(items: CutItem[]): CutPlan['unknownMaterials'] {
  const map = new Map<string, CutPlan['unknownMaterials'][number]>();
  for (const it of items) {
    if (it.status === 'cut' || it.status === 'elsewhere' || !it.unknownToken) continue;
    let e = map.get(it.unknownToken);
    if (!e) map.set(it.unknownToken, (e = { token: it.unknownToken, count: 0, examples: [] }));
    e.count++;
    if (e.examples.length < 3 && !e.examples.some(x => x.measure === it.part.measure && x.descriptionDe === it.part.descriptionDe))
      e.examples.push({ workOrder: it.part.workOrder, measure: it.part.measure, descriptionDe: it.part.descriptionDe, text: it.part.partName ?? it.part.text });
  }
  return [...map.values()].sort((a, b) => b.count - a.count || (a.token < b.token ? -1 : 1));
}

function collectConflicts(items: CutItem[]): CutPlan['conflicts'] {
  const map = new Map<string, CutPlan['conflicts'][number]>();
  for (const it of items) {
    if (it.status === 'cut' || it.status === 'elsewhere' || !it.conflict) continue;
    let e = map.get(it.conflict);
    if (!e) map.set(it.conflict, (e = { text: it.conflict, count: 0, examples: [] }));
    e.count++;
    if (e.examples.length < 3 && !e.examples.some(x => x.measure === it.part.measure))
      e.examples.push({ workOrder: it.part.workOrder, measure: it.part.measure, descriptionDe: it.part.descriptionDe });
  }
  return [...map.values()].sort((a, b) => b.count - a.count || (a.text < b.text ? -1 : 1));
}
