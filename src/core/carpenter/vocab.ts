/**
 * Material vocabulary of the carpenter list (pure data + matching), mirrored from rules.json / analyse.py.
 * All matching runs on UPPER-CASED text with the false positives removed first.
 */

export interface MaterialDef {
  code: string;
  /** the code the CNC workload uses (BoxShelf "Material Type"); null = none seen yet: the user is asked */
  cnc: string | null;
  /** which saw cuts it, by default */
  family: 'metal' | 'plastic' | 'laminate' | 'wood' | 'soft';
  patterns: RegExp[];
}

const def = (code: string, cnc: string | null, family: MaterialDef['family'], patterns: string[]): MaterialDef => ({
  code,
  cnc,
  family,
  patterns: patterns.map(p => new RegExp(p)),
});

/** In the order of rules.json (the order breaks ties between codes found at the same place). */
export const MATERIALS: MaterialDef[] = [
  def('PCGF', 'PCGF', 'plastic', [String.raw`\bPC[\s\-]?GF`, String.raw`\bPCGF\d*\b`]),
  def('POM', 'POM', 'plastic', [String.raw`\bPOM\b`, 'TECAFORM', 'DELRIN', String.raw`\bACETAL`, String.raw`\bPOM-?C\b`]),
  def('PEEK', 'PEEK', 'plastic', [String.raw`\bPEEK\b`]),
  def('PETP', null, 'plastic', [String.raw`\bPET-?P\b`, 'ERTALYTE', String.raw`\bERTA\b`]),
  def('PA', null, 'plastic', ['TECAMID', String.raw`\bPA\s?6{1,2}\b`]),
  def('PP', 'PP', 'plastic', [String.raw`\bPP\b`]),
  def('PMMA', null, 'plastic', ['PLEXIGLAS', 'ACRY', String.raw`\bPMMA\b`]),
  def('ABS', null, 'plastic', [String.raw`\bABS\b`]),
  def('SILICONE', null, 'soft', ['SILICON']),
  def('FH', 'FH', 'laminate', [String.raw`\bFH\d*\b`, String.raw`\bHGW\b`, 'HARTGEWEBE', 'PERTINAX']),
  def('RES', 'FH', 'laminate', ['RESOPAL', String.raw`\bRESO\b`, String.raw`\bRES\b`, String.raw`\bHPL\b`]),
  def('EPO', null, 'laminate', [String.raw`\bEPO\b`, 'EPOXI', 'EPOXY', String.raw`\bCEM[\s\-]?1\b`]),
  def('FR4', null, 'laminate', [String.raw`\bFR[\s\-]?4\b`, String.raw`BASE MATERIAL FR\b`]),
  def('MDF', null, 'wood', [String.raw`\bMDF\b`]),
  def('MS', 'MS', 'metal', [String.raw`\bMS\s?58`, String.raw`\bMS\b`, 'MESSING', String.raw`\bBRASS\b`, 'LAITON', String.raw`\bCUZN`]),
  def('INOX', 'INOX', 'metal', [String.raw`\bINOX\b`, String.raw`\bVA\b`, String.raw`\b1\.4[0-9]{3}\b`, 'EDELSTAHL', 'STAINLESS', String.raw`\bV2A\b`, String.raw`\bV4A\b`]),
  def('ALU', 'ALU', 'metal', [String.raw`\bALU(?:MINIUM|MINUM)?\b`, String.raw`\bAL\b`, String.raw`\bALMG`, String.raw`\bALCU`, String.raw`\bALZN`, String.raw`\bALSI`, String.raw`\bAW-?\d{4}`]),
];

export const MATERIAL_BY_CODE = new Map(MATERIALS.map(m => [m.code, m]));

/**
 * Material codes the CNC machines know by default. RES has the CNC code FH in rules.json but is kept apart until the
 * user confirms it (it is asked like EPO, FR4, PETP ...).
 */
export const DEFAULT_CNC_CODES = ['ALU', 'POM', 'FH', 'PCGF', 'MS', 'PEEK', 'PP', 'INOX'];

/** Same CNC material for comparisons (a RES part on an FH plate is no conflict). */
export function cncEquivalent(code: string | null | undefined): string | null {
  if (!code) return null;
  return MATERIAL_BY_CODE.get(code)?.cnc ?? code;
}

/** Text that looks like a material but is not one: module families (MS-240, MS230), module names, colours, grades. */
export const FALSE_POSITIVES: RegExp[] = [
  /\bMS[\s-]?\d{3}\b/g, // MS-240, MS230, MS 540: module families, not brass (MS58 = 2 digits = brass)
  /MODULE?-MS\b/g, // "Test module-MS SEBN-V1-..."
  /PIN-MODUL MS\b/g, // "=~Pin-Modul MS Yel 100x50x21" is an MDF plate
  /\bRAL\s?\d{4}\b/g, // colour codes
  /\bB14\d\d\b/g, // FH8221 grade suffix (B1400 / B1409)
];

export function stripFalsePositives(upper: string): string {
  let t = upper;
  for (const p of FALSE_POSITIVES) t = t.replace(p, ' ');
  return t;
}

export interface MaterialHit {
  code: string;
  index: number;
  /** the matched text */
  text: string;
}

const hitCache = new Map<string, MaterialHit[]>();

/** Every material code found in a text, by first position (then code), with the text that matched. */
export function findMaterialHits(text: string | null | undefined): MaterialHit[] {
  if (!text) return [];
  const cached = hitCache.get(text);
  if (cached) return cached;
  const t = stripFalsePositives(' ' + text.toUpperCase() + ' ');
  const hits: MaterialHit[] = [];
  for (const m of MATERIALS) {
    let best: RegExpExecArray | null = null;
    for (const p of m.patterns) {
      const mm = p.exec(t);
      if (mm && (best === null || mm.index < best.index)) best = mm;
    }
    if (best) hits.push({ code: m.code, index: best.index, text: best[0].trim() });
  }
  hits.sort((a, b) => a.index - b.index || (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
  if (hitCache.size > 50000) hitCache.clear();
  hitCache.set(text, hits);
  return hits;
}

export function findMaterials(text: string | null | undefined): string[] {
  return findMaterialHits(text).map(h => h.code);
}

/** Material words a 40-character cut can leave a prefix of ("TEST PIN INSERT P" -> POM / PCGF / PEEK / PETP). */
export const TRUNC_WORDS: Array<[string, string]> = [
  ['ALU', 'ALU'],
  ['POM', 'POM'],
  ['PCGF', 'PCGF'],
  ['PC GF', 'PCGF'],
  ['PC-GF', 'PCGF'],
  ['PEEK', 'PEEK'],
  ['PETP', 'PETP'],
  ['MS58', 'MS'],
  ['MESSING', 'MS'],
  ['FH', 'FH'],
  ['RESOPAL', 'RES'],
  ['EPO', 'EPO'],
  ['VA', 'INOX'],
  ['INOX', 'INOX'],
];

/** Codes whose material word starts with this cut-off token ('P' -> POM, PCGF, PEEK, PETP; 'M' -> MS; 'V' -> INOX). */
export function truncCandidates(token: string): string[] {
  const tok = token.toUpperCase().trim();
  if (!tok || tok.replace(/ /g, '').length > 5) return [];
  const out: string[] = [];
  for (const [w, code] of TRUNC_WORDS) if (w.startsWith(tok) && !out.includes(code)) out.push(code);
  return out;
}

/** Complete part names seen in the carpenter exports (material words removed), from rules.json. */
export const KNOWN_PART_NAMES: string[] = [
  'ABDECKPLATTE', 'ABDECKUNG', 'ADAPTER PLATE', 'ANGLE BRACKET', 'ANGLE BRACKET 1', 'ANGLE BRACKET 2',
  'ASSEMBLY PLATE', 'ASSEMBLY PLATE 2', 'ATTACHMENT BOLT', 'AUFNAHMEPLATTE', 'AUFNAHMEPLATTE HAZAS',
  'BEFES. ROH X 5 STUCK', 'BEFESTIGUNG VERZOEGERUNGSPLATINE', 'BEFESTIGUNGSWKL', 'BLOCK', 'BRACKET', 'BRIDGE',
  'BRUCKE', 'CODING PLATE', 'CONTACT MANAGEMENT INSERT', 'CONTACT PIN', 'CONTACT PIN PLATE', 'CONTACT PIN PLATE 1',
  'CONTACT PIN PLATE 2', 'CONTACT PIN PLATE 5', 'CONTACT PIN PLATE 7', 'CONTACT PIN PLATE 8', 'CONTOUR #NSERT',
  'CONTOUR #NSERT 2', 'CONTOUR BLOCK', 'CONTOUR BLOCK-1', 'CONTOUR INSERT', 'CONTOUR INSERT 1', 'CONTOUR INSERT 2',
  'CONTOUR INSERT 3', 'CONTOUR INSERT1', 'CONTOUR PICE', 'CONTOUR PIECE', 'CONTOUR PIECE 1', 'CONTOUR PIECE 3',
  'CONTOUR PIECE 4', 'CONTOUR PIECE-4', 'CONTOUR PIECE6', 'CONTUR INSERT', 'CONTUR INSERT-1', 'COVER', 'COVER 2',
  'COVER2', 'DECKEL', 'DICHTKAEFIG', 'DRUCKPLATTE', 'EBENE', 'EINSATZ', 'FIXTURE', 'GEHAEUSETEIL',
  'GEHÄUSETEIL ROHTEIL', 'GROUND PLATE', 'GROUND PLATE 2', 'GROUND PLATE 6', 'GUIDING PLATE', 'HALTEPLATTE',
  'HALTERUNG PLATINE', 'HATEPLATTE', 'HOLDER', 'HOLDER PLATE', 'HOLDING PLATE', 'HOUSING PART', 'INSERT',
  'INSERT (TOP PLATE', 'KODIEREINSATZ', 'KODIERPLATTE', 'KONTACKTEINSATZ 30', 'KONTAKTEINSATZ', 'KONTAKTEINSATZ 30',
  'KONTAKTEINSATZ ZUSCHNITT', 'KONTAKTFUEHRUNG', 'KONTAKTFUEHRUNG ZUSCH.', 'KONTAKTFUEHRUNGSEINSATZ 30',
  'KONTAKTFUEHRUNGSEINSATZ A.', 'KONTAKTFUHRUNGSEINSATZ', 'KONTAKTTRAEGERPLATTE', 'KONTAKTTRAGERPLATTE',
  'KONTUREINSATZ', 'KONTUREINSATZ 30', 'KOPFSTUECK', 'MOUNTING BLOCK', 'NETMOD HOUSING BASIC 195',
  'NETMOD HOUSING COVER 195', 'OBERPLATTE', 'POLARITY INSERT -1', 'POLARITY INSERT -2', 'POLARITY PLATE',
  'PRESSURE PLATE', 'PRUEFWINKEL', 'PRUFWINKEL', 'SEAL CAGE', 'SEAL CAGE ZN40 PB', 'SONDERHALTEWINKEL', 'SUB PLATE',
  'SUB PLATE 1', 'SUB PLATE 2', 'SUB PLATE 4', 'SUB PLATE N', 'SUB PLATE1', 'SUB PLATTE', 'SUPORT PART',
  'SUPPORT PART', 'SWITCH PIN', 'SWITCH PIN PLATE', 'TEST BRACKET', 'TEST BRACKET - 1', 'TEST BRACKET 1',
  'TEST BRACKET 2', 'TEST PIN INSERT', 'TEST PIN INSERT 30', 'TEST PIN PLATE', 'TOP COVER', 'TOP COVER 1',
  'TOP COVER 2', 'TOP COVER 3', 'TOP COVER 4', 'TOP PLATE', 'TOP PLATE -240', 'TOP PLATE 2', 'ZUSATPLATTE',
  'ZUSATZPLATTE', 'ZUSATZPLATTE-2',
];
