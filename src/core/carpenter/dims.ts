/**
 * Cut sizes of the carpenter list (pure). Mirrors rules.json `dimensions` / analyse.py:
 *  1. Measure: the size after CUT / ZUSCHNITT / ROHTEIL / RAW MTL ("31.5X38X15 CUT:36X42X30" -> 36x42x30)
 *  2. Measure: the last 3-number group (without a CUT keyword the finished size is the cut size)
 *  3. N3 line of the NC header: the size after ZUSCHNITT
 *  4. N3: the last 3-number group
 * Measure is cut at 40 characters by the website: when it ends inside the last number and N3 has the same first two
 * numbers with a third that starts like Measure's, N3 wins ("ZUSCHNITT:26X18X2" -> 26X18X22).
 */

export type Dims3 = [number, number, number];

/** The website cuts Measure at this many characters. */
export const MEASURE_MAX = 40;

const NUM = String.raw`\d+(?:[.,]\d+)?`;
const DIMS_SRC = String.raw`(${NUM})\s*[X*×]+\s*(${NUM})(?:\s*[X*×]+\s*(${NUM}))?`;
const DIMS_G = new RegExp(DIMS_SRC, 'gi');
const DIMS_Y = new RegExp(DIMS_SRC, 'iy');
const CUT_KEY_G = /(?:CUT|ZUSCHNITT|ROHTEIL|RAW\s*MTL|ZUSCH\.?)\s*:?\s*/gi;

export function toNum(s: string): number {
  return Number(s.replace(',', '.'));
}

export interface DimsMatch {
  dims: number[];
  start: number;
  end: number;
}

function groups(m: RegExpExecArray): number[] {
  const out: number[] = [];
  for (let i = 1; i <= 3; i++) if (m[i] !== undefined) out.push(toNum(m[i]));
  return out;
}

/** Every "AxB" / "AxBxC" group of a text, left to right (separators x, X, *, ×; "17.8XX10X6" counts). */
export function allDims(text: string | undefined): DimsMatch[] {
  const out: DimsMatch[] = [];
  if (!text) return out;
  DIMS_G.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = DIMS_G.exec(text))) out.push({ dims: groups(m), start: m.index, end: m.index + m[0].length });
  return out;
}

/** The size right after the first CUT-like keyword that is followed by a size (2 or 3 numbers), else null. */
export function cutDimsFrom(text: string | undefined): number[] | null {
  if (!text) return null;
  CUT_KEY_G.lastIndex = 0;
  let k: RegExpExecArray | null;
  while ((k = CUT_KEY_G.exec(text))) {
    DIMS_Y.lastIndex = k.index + k[0].length;
    const m = DIMS_Y.exec(text);
    if (m) return groups(m);
  }
  return null;
}

export type MeasureFormat = 'empty' | 'name/matnr/rest' | 'sap_text' | 'free_text';

export interface MeasureInfo {
  raw: string;
  fmt: MeasureFormat;
  /** part name: before the first "/" ("TOP PLATE FH"), or the text before the last size for SAP / free text */
  name: string;
  matnr: string;
  /** after the second "/" (name/matnr/rest only) */
  rest: string;
  /** SAP / free text: the text after the last size ("-FH" in "=~top plate 100x100x40-FH") */
  tail: string;
  truncated: boolean;
  dims: Dims3 | null;
  dimsSrc: 'measure_cut' | 'measure_dims' | 'measure_text' | null;
  /** the 40-character cut may have taken digits off the last number */
  dimsAtEnd: boolean;
}

const as3 = (d: number[] | null | undefined): Dims3 | null => (d && d.length === 3 ? [d[0], d[1], d[2]] : null);

const measureCache = new Map<string, MeasureInfo>();

/** Splits a Measure cell: "NAME/MaterialNr/DIMS", SAP text "=~top plate 100x100x40-FH", or free text. */
export function parseMeasure(raw: string | undefined): MeasureInfo {
  const m = (raw ?? '').trim();
  const hit = measureCache.get(m);
  if (hit) return hit;
  const r: MeasureInfo = { raw: m, fmt: 'empty', name: '', matnr: '', rest: '', tail: '', truncated: false, dims: null, dimsSrc: null, dimsAtEnd: false };
  if (m) {
    r.truncated = m.length >= MEASURE_MAX;
    const sap = /^(.)~\s*([\s\S]*)$/.exec(m);
    const parts = m.split('/');
    let body: string | null = null;
    if (sap) {
      r.fmt = 'sap_text';
      body = sap[2];
    } else if (parts.length >= 3) {
      r.fmt = 'name/matnr/rest';
      r.name = parts[0];
      r.matnr = parts[1].trim();
      r.rest = parts.slice(2).join('/');
    } else {
      r.fmt = 'free_text';
      body = m;
    }
    if (body !== null) {
      const ds = allDims(body);
      if (ds.length) {
        const last = ds[ds.length - 1];
        r.dims = as3(last.dims);
        r.dimsSrc = r.dims ? 'measure_text' : null;
        r.name = body.slice(0, last.start).trim();
        r.tail = body.slice(last.end);
        r.dimsAtEnd = last.end >= body.length && r.truncated;
        const up = body.toUpperCase();
        if (up.includes('CUT') || up.includes('ZUSCHNITT')) {
          const c = as3(cutDimsFrom(body));
          if (c) {
            r.dims = c;
            r.dimsSrc = 'measure_cut';
          }
        }
      } else {
        r.name = body;
      }
    } else {
      const c = as3(cutDimsFrom(r.rest));
      const ds = allDims(r.rest);
      if (c) {
        r.dims = c;
        r.dimsSrc = 'measure_cut';
      } else if (ds.length && ds[ds.length - 1].dims.length === 3 && !/CUT\s*:?\s*\d+\s*$/i.test(r.rest)) {
        r.dims = as3(ds[ds.length - 1].dims);
        r.dimsSrc = 'measure_dims';
      }
      r.dimsAtEnd = r.truncated && new RegExp(`${NUM}\\s*$`).test(r.rest);
    }
  }
  if (measureCache.size > 20000) measureCache.clear();
  measureCache.set(m, r);
  return r;
}

export interface N3Info {
  /** the N3 text without "N3 (" and ")" */
  body: string;
  /** the part name: first "/" segment up to its first size */
  name: string;
  dims: Dims3 | null;
  dimsSrc: 'n3_cut' | 'n3_last' | null;
  /** the first size (finished size) */
  finished: Dims3 | null;
}

/** "CONTOUR PIECE POM / 120X55X33.5 / ZUSCHNITT: 124X60X42" -> name CONTOUR PIECE POM, cut 124x60x42. */
export function parseN3(n3: string | undefined): N3Info {
  const body = (n3 ?? '').trim();
  const r: N3Info = { body, name: '', dims: null, dimsSrc: null, finished: null };
  if (!body) return r;
  let first = body.split('/')[0];
  const df = allDims(first);
  if (df.length) first = first.slice(0, df[0].start);
  r.name = first.trim();
  const c = as3(cutDimsFrom(body));
  const ds = allDims(body);
  if (c) {
    r.dims = c;
    r.dimsSrc = 'n3_cut';
  } else if (ds.length && ds[ds.length - 1].dims.length === 3) {
    r.dims = as3(ds[ds.length - 1].dims);
    r.dimsSrc = 'n3_last';
  }
  if (ds.length && ds[0].dims.length === 3) r.finished = as3(ds[0].dims);
  return r;
}

const fmtG = (n: number) => String(Number(n.toPrecision(6)));

/** The cut size of a row and where it came from (null when neither Measure nor N3 has one). */
export function resolveCut(measure: string | undefined, n3: string | undefined): { cut: Dims3 | null; source?: string } {
  const m = parseMeasure(measure);
  const n = parseN3(n3);
  const md = m.dims;
  const nd = n.dims;
  if (md && m.dimsAtEnd && nd && md[0] === nd[0] && md[1] === nd[1] && md[2] !== nd[2] && fmtG(nd[2]).startsWith(fmtG(md[2])))
    return { cut: nd, source: 'n3_fixes_truncated_measure' };
  if (md) return { cut: md, source: m.dimsSrc ?? undefined };
  if (nd) return { cut: nd, source: n.dimsSrc ?? undefined };
  return { cut: null };
}

const PIECES_RE = /(?<![\d.,])(\d{1,3})\s*(?:ST(?:K|UCK|ÜCK|UECK)?\.?|PIECES?|PCS\.?)(?![A-Z0-9])/i;

/** "5 ST. aus Roht." / "Roh x 5 Stuck" / "SERIES DE 5 PIECES": one sawn blank gives that many parts; else 1. */
export function piecesPerBlank(...texts: Array<string | undefined>): number {
  for (const t of texts) {
    if (!t) continue;
    const m = PIECES_RE.exec(t);
    if (m) {
      const n = Number(m[1]);
      if (n >= 2 && n <= 100) return n;
    }
  }
  return 1;
}
