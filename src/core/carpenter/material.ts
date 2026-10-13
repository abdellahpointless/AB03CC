/**
 * Material of a carpenter row (pure). Mirrors rules.json `materialResolutionOrder` / analyse.py:
 *
 *   user token map > Measure token > cut-off material word at the end of the Measure name > N3 token
 *   > Description De stock > Box Information stock > alert replacement stock > MaterialType column > Text / M.text
 *   > the same drawing's material in the loaded workload (history)
 *
 * False positives are removed first (MS-240 / MS230 module families, "module-MS", "Pin-Modul MS", RAL colours, B14xx
 * grades). A lone trailing "M" after the part name means brass (MS), "V" stainless (INOX), "A"/"AL" aluminium, "PO"
 * POM, "PC"/"PCG" PCGF; "P" is POM, PCGF, PEEK or PETP and is settled with N3 or the stock. A cut-off word only
 * counts when the words before it are a complete known part name, or the whole name is not the start of a known part
 * name ("TOP P" is a cut-off TOP PLATE, not a POM top).
 */
import { partKey } from '../parse/partTimes';
import type { CarpenterPart, CutMaterialSource } from '../types';
import { allDims, parseMeasure, parseN3, type MeasureInfo, type N3Info } from './dims';
import { parseAlert, parseStock, replacementStock, type ParsedAlert, type StockInfo } from './stock';
import {
  DEFAULT_CNC_CODES,
  KNOWN_PART_NAMES,
  MATERIALS,
  cncEquivalent,
  findMaterialHits,
  stripFalsePositives,
  truncCandidates,
  type MaterialHit,
} from './vocab';

export {
  DEFAULT_CNC_CODES,
  FALSE_POSITIVES,
  KNOWN_PART_NAMES,
  MATERIALS,
  MATERIAL_BY_CODE,
  TRUNC_WORDS,
  cncEquivalent,
  findMaterialHits,
  findMaterials,
  stripFalsePositives,
  truncCandidates,
} from './vocab';

export interface MaterialOptions {
  /** the user's answers: token (upper case) -> material code. Matched as a word in Measure, N3, Text and M.text first;
   * a resolved code that is itself a key is mapped too (so an answer for "EPO" applies to every epoxy row). */
  tokens?: Record<string, string>;
  /** settings.materialAliases ("ALU B" -> "ALU"), applied to the result */
  aliases?: Record<string, string>;
  /** codes the CNC machines know; any other result carries `unknownToken`. Default: DEFAULT_CNC_CODES */
  cncCodes?: Iterable<string>;
  /** complete part names (upper case) for the cut-off guard; default: KNOWN_PART_NAMES */
  knownNames?: Set<string>;
  /** partKey(MaterialNr) -> material type of the same drawing in loaded workload / plan data */
  history?: Record<string, string> | Map<string, string>;
  /** stock id -> stock of the whole list, to read alert replacement ids */
  catalog?: Map<string, StockInfo>;
}

export interface MaterialResolution {
  material: string | null;
  source: CutMaterialSource | null;
  evidence?: string;
  unknownToken?: string;
  conflict?: string;
  /** what the part itself says (user / Measure / cut-off word / N3), before aliases */
  partMaterial: string | null;
  /** material of the effective stock (alert replacement > Description De > Box Information) */
  stockMaterial: string | null;
  /** every source that named a material */
  candidates: Partial<Record<CutMaterialSource, string>>;
  notes: string[];
}

const ORDER: CutMaterialSource[] = ['user', 'measure', 'measure_suffix', 'n3', 'stock', 'box_info', 'alert_stock', 'column', 'text', 'history'];
const PART_SOURCES = new Set<CutMaterialSource>(['user', 'measure', 'measure_suffix', 'n3']);

const collapse = (s: string) => s.replace(/\s+/g, ' ').trim();
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

let builtinNames: Set<string> | null = null;
/** The part names of rules.json. */
export function defaultKnownNames(): Set<string> {
  return (builtinNames ??= new Set(KNOWN_PART_NAMES));
}

const MATERIAL_WORDS = MATERIALS.flatMap(m => m.patterns.map(p => new RegExp(p.source + String.raw`[\w.,\-]*`, 'g')));
const COLOURS = /\b(?:SCHWARZ|NATUR|NATURAL|BLACK|WHITE)\b/g;

function nameWithoutMaterial(txt: string): string {
  let t = stripFalsePositives(' ' + txt.toUpperCase() + ' ');
  for (const re of MATERIAL_WORDS) t = t.replace(re, ' ');
  t = t.replace(COLOURS, ' ');
  return collapse(t).replace(/^[\s\-:]+|[\s\-:]+$/g, '');
}

/**
 * Complete part names of a list (learned like analyse.py): N3 names and Measure names that carry a material, with the
 * material words removed, plus M.text names. Merged with the rules.json list.
 */
export function learnPartNames(parts: CarpenterPart[], base: Iterable<string> = defaultKnownNames()): Set<string> {
  const names = new Set<string>(base);
  for (const p of parts) {
    const m = parseMeasure(p.measure);
    const n3 = parseN3(p.n3);
    const measureName = measureMaterialHits(m).length ? m.name : '';
    for (const txt of [n3.name, measureName]) {
      if (!txt) continue;
      const t = nameWithoutMaterial(txt);
      if (t.length >= 3 && !allDims(t).length) names.add(t);
    }
    const mt = (p.mText ?? '').trim();
    if (mt && !/^\d+$/.test(mt)) {
      const t = mt.toUpperCase().replace(/\s+\d{6,}$/, '').trim();
      if (!allDims(t).length) names.add(collapse(t));
    }
  }
  return names;
}

function measureMaterialHits(m: MeasureInfo): MaterialHit[] {
  if (m.fmt === 'empty') return [];
  const tail = findMaterialHits(m.tail);
  return tail.length ? tail : findMaterialHits(m.name);
}

function n3MaterialHits(n: N3Info): MaterialHit[] {
  const h = findMaterialHits(n.name);
  return h.length ? h : findMaterialHits(n.body);
}

/** The last word of a "NAME/..." Measure name; two words when they form a cut-off material ("KONTAKTEINSATZ PC G"). */
export function truncToken(name: string): string {
  const toks = name.trimEnd().split(' ');
  let last = toks[toks.length - 1] ?? '';
  if (toks.length >= 3 && truncCandidates(toks[toks.length - 2] + ' ' + last).length) last = toks[toks.length - 2] + ' ' + last;
  return last;
}

function userToken(tokens: Record<string, string>, texts: Array<string | undefined>): { key: string; code: string } | null {
  const keys = Object.keys(tokens).filter(k => k.trim() && tokens[k]);
  if (!keys.length) return null;
  for (const txt of texts) {
    if (!txt) continue;
    const up = txt.toUpperCase();
    let best: { key: string; at: number } | null = null;
    for (const k of keys) {
      const re = new RegExp(`(?<![A-Z0-9])${escapeRe(k.trim().toUpperCase())}(?![A-Z0-9])`);
      const m = re.exec(up);
      if (m && (!best || m.index < best.at || (m.index === best.at && k.length > best.key.length))) best = { key: k, at: m.index };
    }
    if (best) return { key: best.key, code: tokens[best.key].trim().toUpperCase() };
  }
  return null;
}

function historyOf(h: MaterialOptions['history'], materialNr: string | undefined): string | undefined {
  if (!h || !materialNr) return undefined;
  const k = partKey(materialNr);
  const v = h instanceof Map ? h.get(k) : h[k];
  return v ? String(v).trim().toUpperCase() || undefined : undefined;
}

/** What to ask the user when nothing was found: the last word of the Measure name, else the part name. */
function askToken(part: CarpenterPart, m: MeasureInfo): string | undefined {
  const name = collapse(m.name.toUpperCase());
  if (name) {
    const w = name.split(' ');
    return w[w.length - 1].replace(/^[\s\-:]+|[\s\-:]+$/g, '') || undefined;
  }
  const pn = (part.partName ?? part.mText ?? part.text ?? '').toUpperCase();
  const cleaned = collapse(pn.replace(/\b\d{6,}\b/g, ' ').replace(/\d+(?:[.,]\d+)?\s*[X*×]\s*\d+(?:[.,]\d+)?(?:\s*[X*×]\s*\d+(?:[.,]\d+)?)?/gi, ' '));
  return cleaned.split(' ').slice(0, 3).join(' ') || undefined;
}

export interface MaterialContext {
  measure: MeasureInfo;
  n3: N3Info;
  desc: StockInfo | null;
  box: StockInfo | null;
  alert: ParsedAlert | null;
  /** alert replacement stock (catalog entry or the alert's own text) */
  replacement: StockInfo | null;
}

/** Parses everything the resolution looks at (shared with buildCutItems). */
export function materialContext(part: CarpenterPart, catalog?: Map<string, StockInfo>): MaterialContext {
  const alert = parseAlert(part.alertMessage);
  return {
    measure: parseMeasure(part.measure),
    n3: parseN3(part.n3),
    desc: parseStock(part.descriptionDe),
    box: parseStock(part.boxInfo),
    alert,
    replacement: alert ? replacementStock(alert, catalog) : null,
  };
}

/** The material of one carpenter row. */
export function resolveMaterial(part: CarpenterPart, opts: MaterialOptions = {}, ctx: MaterialContext = materialContext(part, opts.catalog)): MaterialResolution {
  const { measure: m, n3, desc, box, replacement } = ctx;
  const names = opts.knownNames ?? defaultKnownNames();
  const tokens = opts.tokens ?? {};
  const cand: Partial<Record<CutMaterialSource, string>> = {};
  const evidence: Partial<Record<CutMaterialSource, string>> = {};
  const notes: string[] = [];

  const user = userToken(tokens, [part.measure, part.n3, part.text, part.mText]);
  if (user) {
    cand.user = user.code;
    evidence.user = user.key;
  }

  const mh = measureMaterialHits(m);
  if (mh.length) {
    cand.measure = mh[0].code;
    evidence.measure = mh[0].text;
  } else if (m.fmt === 'name/matnr/rest') {
    const tok = truncToken(m.name);
    const name = collapse(m.name.toUpperCase());
    const tokT = tok.trim();
    const head = tokT ? collapse(name.slice(0, name.length - tokT.length)) : name;
    const tc = tokT ? truncCandidates(tok) : [];
    let namePrefix = false;
    for (const k of names) if (k !== name && k.startsWith(name)) { namePrefix = true; break; }
    const headKnown = names.has(head) || names.has(head.replace(/[\s-]*\d+$/, ''));
    if (tc.length && (headKnown || !namePrefix)) {
      if (tc.length === 1) cand.measure_suffix = tc[0];
      else {
        const n3First = n3MaterialHits(n3)[0]?.code;
        const stockFirst = (desc ?? box)?.materials[0];
        const pick = n3First && tc.includes(n3First) ? n3First : stockFirst && tc.includes(stockFirst) ? stockFirst : null;
        if (pick) cand.measure_suffix = pick;
        notes.push(`ambiguous_suffix:${tokT}->${tc.join('|')}`);
      }
      if (cand.measure_suffix) evidence.measure_suffix = `"${tokT}" (cut-off)`;
    } else if (tokT) notes.push(`name_truncated:${name}`);
    else notes.push('material_cut_off');
  }

  const nh = n3MaterialHits(n3);
  if (nh.length) {
    cand.n3 = nh[0].code;
    evidence.n3 = nh[0].text;
  }
  if (desc?.materials.length) {
    cand.stock = desc.materials[0];
    evidence.stock = desc.text;
  }
  if (box?.materials.length) {
    cand.box_info = box.materials[0];
    evidence.box_info = box.text;
  }
  if (replacement?.materials.length) {
    cand.alert_stock = replacement.materials[0];
    evidence.alert_stock = `${replacement.id} ${replacement.text}`.trim();
  }
  const column = (part.materialType ?? '').trim().toUpperCase();
  if (column) {
    cand.column = column;
    evidence.column = `MaterialType ${column}`;
  }
  for (const t of [part.text, part.mText]) {
    const th = findMaterialHits(t);
    if (th.length) {
      cand.text = th[0].code;
      evidence.text = th[0].text;
      break;
    }
  }
  const hist = historyOf(opts.history, part.materialNr);
  if (hist) {
    cand.history = hist;
    evidence.history = `drawing ${part.materialNr} in the workload`;
  }

  let source: CutMaterialSource | null = null;
  for (const s of ORDER)
    if (cand[s]) {
      source = s;
      break;
    }
  let material = source ? cand[source]! : null;
  const partMaterial = ORDER.filter(s => PART_SOURCES.has(s)).map(s => cand[s]).find(Boolean) ?? null;

  // the effective stock: the alert's replacement, else Description De, else Box Information
  const eff = replacement ?? desc ?? box;
  const stockMaterial = eff?.materials[0] ?? null;

  // the user's answer for a code, then the aliases
  const mapCode = (code: string): string => {
    let c = code;
    if (source !== 'user' && tokens[c]) c = tokens[c].trim().toUpperCase();
    const a = opts.aliases?.[c];
    return a ? a.trim().toUpperCase() : c;
  };
  if (material) material = mapCode(material);

  const cnc = new Set(opts.cncCodes ?? DEFAULT_CNC_CODES);
  let unknownToken: string | undefined;
  if (!material) unknownToken = askToken(part, m);
  else if (material === 'ALU' && eff?.kind === 'profile' && source !== 'user') {
    // the workload calls aluminium profile parts "ALU B": ask once, then follow the answer
    const answer = tokens['ALU B'] ?? opts.aliases?.['ALU B'];
    if (answer) material = answer.trim().toUpperCase();
    else unknownToken = 'ALU B';
  } else if (!cnc.has(material)) unknownToken = material;

  let conflict: string | undefined;
  if (partMaterial && stockMaterial && cncEquivalent(partMaterial) !== cncEquivalent(stockMaterial))
    conflict = `part says ${partMaterial}, stock ${eff?.id ?? ''} is ${stockMaterial}`.replace('stock  is', 'stock is');
  else if (cand.n3 && (cand.measure ?? cand.measure_suffix) && cncEquivalent(cand.n3) !== cncEquivalent(cand.measure ?? cand.measure_suffix))
    conflict = `Measure says ${cand.measure ?? cand.measure_suffix}, NC header says ${cand.n3}`;

  return {
    material,
    source,
    evidence: source ? evidence[source] : undefined,
    unknownToken,
    conflict,
    partMaterial,
    stockMaterial,
    candidates: cand,
    notes,
  };
}
