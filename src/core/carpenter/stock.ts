/**
 * Stock bars and alerts of the carpenter list (pure). Mirrors rules.json `stock` / `alerts`:
 *  - Description De: "<id> - <text>", e.g. "103314 - FH8221 40x1000x1000mm  B1409"
 *  - Box Information: the same plus " - <qty> <M2|CM2|M|KG>"
 *  - plate = 3 sizes (thickness = smallest), blank = 3 sizes all under 300 mm (pre-made, not sawn), bar = 2 sizes,
 *    profile = "profile" in the text, round = "D4", sheet = a single "1.5mm", filament = 3D-print material.
 *  - AlertMessage: "... change it by 114926 POM 20 mm" / "Please cut from 111645 Inox 40x40" name the stock to use.
 */
import type { CutAlert, StockKind } from '../types';
import { allDims, toNum } from './dims';
import { findMaterialHits, type MaterialHit } from './vocab';

export interface StockInfo {
  id: string | null;
  /** the stock text without its id and Box Information quantity, spaces collapsed */
  text: string;
  kind: StockKind;
  /** sizes, smallest first */
  dims: number[] | null;
  /** smallest size (plate thickness, bar side) when known */
  thickness: number | null;
  qty?: number;
  unit?: string;
  /** material codes in the text, first one first */
  materials: string[];
  /** the text fragment that named the first material */
  evidence?: string;
}

const NUM = String.raw`\d+(?:[.,]\d+)?`;
const BOX_RE = new RegExp(String.raw`^\s*(\d{5,7})\s*-\s*(.+?)(?:\s+-\s+(${NUM})\s*(M2|CM2|MM2|M|KG|ST|PC))?\s*$`, 'i');
const ROUND_RE = new RegExp(String.raw`\bD\s?(${NUM})`);
const SHEET_RE = new RegExp(String.raw`(${NUM})\s*MM`);

/** Stock-only words for a material (a NetMod profile is aluminium). */
const STOCK_EXTRA: Array<[RegExp, string]> = [[/\bNETMOD\b/, 'ALU']];

function stockHits(body: string): MaterialHit[] {
  const hits = findMaterialHits(body);
  if (hits.length) return hits;
  const up = body.toUpperCase();
  for (const [re, code] of STOCK_EXTRA) {
    const m = re.exec(up);
    if (m) return [{ code, index: m.index, text: m[0] }];
  }
  return [];
}

const cache = new Map<string, StockInfo | null>();

/** Parses a Description De / Box Information / alert stock text; null when empty. */
export function parseStock(text: string | null | undefined): StockInfo | null {
  const t = (text ?? '').trim();
  if (!t) return null;
  if (cache.has(t)) return cache.get(t)!;
  const out = parseStockUncached(t);
  if (cache.size > 5000) cache.clear();
  cache.set(t, out);
  return out;
}

/** Sizes and shape of a stock text without id ("FH8221 40x1000x1000mm", "Brass 20x20", "Steel 1.4305 D4"). */
export function stockShape(body: string): Pick<StockInfo, 'kind' | 'dims' | 'thickness'> {
  // steel grades and alloy names are not sizes
  const clean = body.replace(/\b1\.4\d{3}\b/g, ' ').replace(/AlMg\d+(?:\.\d+)?Mn/gi, ' ');
  const ds = allDims(clean);
  const up = body.toUpperCase();
  if (up.includes('FILAMENT')) return { kind: 'filament', dims: null, thickness: null };
  if (ds.length && ds[0].dims.length === 3) {
    const dims = [...ds[0].dims].sort((a, b) => a - b);
    return { kind: dims[2] < 300 ? 'blank' : 'plate', dims, thickness: dims[0] };
  }
  if (ds.length && ds[0].dims.length === 2) {
    const dims = [...ds[0].dims].sort((a, b) => a - b);
    return { kind: up.includes('PROFILE') ? 'profile' : 'bar', dims, thickness: dims[0] };
  }
  const round = ROUND_RE.exec(up);
  if (round) return { kind: 'round', dims: [toNum(round[1])], thickness: null };
  if (up.includes('PROFILE')) return { kind: 'profile', dims: null, thickness: null };
  const sheet = SHEET_RE.exec(up);
  if (sheet) {
    const th = toNum(sheet[1]);
    return { kind: 'sheet', dims: [th], thickness: th };
  }
  return { kind: 'unknown', dims: null, thickness: null };
}

function parseStockUncached(t: string): StockInfo {
  const m = BOX_RE.exec(t);
  const body = m ? m[2] : t;
  const hits = stockHits(body);
  const shape = stockShape(body);
  return {
    id: m ? m[1] : null,
    text: body.replace(/\s+/g, ' ').trim(),
    ...shape,
    qty: m && m[3] ? toNum(m[3]) : undefined,
    unit: m && m[4] ? m[4].toUpperCase() : undefined,
    materials: hits.map(h => h.code),
    evidence: hits[0]?.text,
  };
}

/** The first material of a stock text, or null. */
export function stockMaterial(s: StockInfo | null | undefined): string | null {
  return s?.materials[0] ?? null;
}

export interface ParsedAlert extends CutAlert {
  /** the alert forbids cutting the listed stock */
  dontCut: boolean;
  /** what follows the replacement id ("POM 20 mm", "Inox 40x40") */
  replacementText?: string;
}

const REPLACEMENT_RE = /(?:by|from)\s+(\d{5,7})/i;

/**
 * Alert kinds: dont_cut ("don't cut") > blocked > not_available ("not available", "not exist") > other_material
 * ("part with", "please cut from") > other. The replacement stock follows "by" or "from".
 */
export function parseAlert(text: string | null | undefined): ParsedAlert | null {
  const t = (text ?? '').trim();
  if (!t) return null;
  const dontCut = /don['’]?t\s+cut/i.test(t);
  let kind: CutAlert['kind'] = 'other';
  if (dontCut) kind = 'dont_cut';
  else if (/\bblocked\b/i.test(t)) kind = 'blocked';
  else if (/not\s+(?:be\s+)?available|not\s+exist/i.test(t)) kind = 'not_available';
  else if (/part with|please cut from/i.test(t)) kind = 'other_material';
  const rep = REPLACEMENT_RE.exec(t);
  const out: ParsedAlert = { kind, text: t.replace(/\s+/g, ' '), dontCut };
  if (rep) {
    out.replacementStock = rep[1];
    const tail = t.slice(rep.index + rep[0].length).replace(/\s+/g, ' ').trim();
    if (tail) out.replacementText = tail;
  }
  return out;
}

/** An alert that stops the part from being cut unless it names a replacement stock. */
export function alertBlocks(a: ParsedAlert | null | undefined): boolean {
  return Boolean(a && (a.kind === 'dont_cut' || a.kind === 'blocked' || a.kind === 'not_available'));
}

/**
 * Stock catalog of a list: stock id -> its Description De / Box Information text, so an alert that only names a
 * replacement id ("change it by 103432") still gets the bar's material and size.
 */
export function stockCatalog(parts: Array<{ descriptionDe?: string; boxInfo?: string }>): Map<string, StockInfo> {
  const map = new Map<string, StockInfo>();
  for (const p of parts) {
    for (const raw of [p.descriptionDe, p.boxInfo]) {
      const s = parseStock(raw);
      if (s?.id && !map.has(s.id)) map.set(s.id, s);
    }
  }
  return map;
}

/** The stock an alert replacement points at: the catalog entry, else the text after the id ("POM 20 mm"). */
export function replacementStock(a: ParsedAlert, catalog?: Map<string, StockInfo>): StockInfo | null {
  if (!a.replacementStock) return null;
  const known = catalog?.get(a.replacementStock);
  if (known) return known;
  const text = a.replacementText ?? '';
  const hits = stockHits(text);
  const shape = text ? stockShape(text) : { kind: 'unknown' as StockKind, dims: null, thickness: null };
  // "POM 20 mm": a plate of that thickness rather than a thin sheet
  const kind: StockKind = shape.kind === 'sheet' && (shape.thickness ?? 0) >= 3 ? 'plate' : shape.kind;
  return {
    id: a.replacementStock,
    text,
    kind,
    dims: shape.dims,
    thickness: shape.thickness,
    materials: hits.map(h => h.code),
    evidence: hits[0]?.text,
  };
}
