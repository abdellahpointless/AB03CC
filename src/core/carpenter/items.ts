/**
 * Carpenter rows -> cut items (pure): status, material, saw group, effective stock, cut size.
 * Strip width and length are filled in later by planCuts (they depend on the other parts of the same stock).
 */
import type { CarpenterPart, CarpenterSettings, CutItem, CutItemStatus, StockKind } from '../types';
import { FH_ALLOWANCE_MM, piecesPerBlank, resolveCut, withAllowance, zIndexOf } from './dims';
import { learnPartNames, materialContext, resolveMaterial, type MaterialOptions } from './material';
import { alertBlocks, stockCatalog, type StockInfo } from './stock';
import { MATERIAL_BY_CODE } from './vocab';

export interface BuildCutItemsOptions {
  /** settings.carpenter (sawGroups, materialTokens and doneWorkOrders are used) */
  settings?: Partial<Pick<CarpenterSettings, 'sawGroups' | 'materialTokens' | 'doneWorkOrders'>>;
  /** settings.materialAliases */
  materialAliases?: Record<string, string>;
  /** material codes the CNC machines know (default: ALU POM FH PCGF MS PEEK PP INOX) */
  cncCodes?: Iterable<string>;
  /** partKey(MaterialNr) -> material type of the same drawing in the loaded workload */
  history?: MaterialOptions['history'];
  /** complete part names; default: rules.json names + the names learned from these parts */
  knownNames?: Set<string>;
}

/** Saw group of a material code: the user's map, else the material's family, else 'other'. */
export function sawGroupOf(code: string | null | undefined, sawGroups: Record<string, string> = {}): string {
  if (!code) return 'other';
  const own = sawGroups[code];
  if (own) return own;
  const fam = MATERIAL_BY_CODE.get(code)?.family;
  return fam && fam !== 'soft' ? fam : 'other';
}

/** What the shop told us: RES (Resopal) and EPO (epoxy / CEM1) are planned as FH. */
export const BUILTIN_MATERIAL_TOKENS: Record<string, string> = { RES: 'FH', EPO: 'FH' };
/** Made on the laser, not cut by the carpenter for the CNC. */
export const LASER_MATERIALS = new Set(['FR4', 'PETP', 'PA', 'PMMA', 'MDF', 'SILICONE']);
/** Turning parts (lathe), not cut by the carpenter for the CNC. */
const TURNING_NAME = /\b(SWITCH\s*PIN|SCHALTSTIFT|BOLT|BOLZEN)\b/i;

export function buildCutItems(parts: CarpenterPart[], opts: BuildCutItemsOptions = {}): CutItem[] {
  const sawGroups = opts.settings?.sawGroups ?? {};
  const done = new Set((opts.settings?.doneWorkOrders ?? []).map(s => String(s).trim()));
  const catalog = stockCatalog(parts);
  const matOpts: MaterialOptions = {
    tokens: { ...BUILTIN_MATERIAL_TOKENS, ...(opts.settings?.materialTokens ?? {}) },
    aliases: opts.materialAliases,
    cncCodes: opts.cncCodes,
    history: opts.history,
    knownNames: opts.knownNames ?? learnPartNames(parts),
    catalog,
  };
  const seen = new Map<string, number>();
  return parts.map((part, i) => {
    const base = `cut:${part.workOrder || `${part.masterOrder}#${i}`}`;
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    const id = n ? `${base}#${n + 1}` : base;

    const ctx = materialContext(part, catalog);
    const mat = resolveMaterial(part, matOpts, ctx);
    const { cut: written, source: cutSource } = resolveCut(part.measure, part.n3);
    const alert = ctx.alert;
    const eff: StockInfo | null = ctx.replacement ?? ctx.desc ?? ctx.box;
    const zi = written ? zIndexOf(written, eff?.thickness ?? null) : undefined;
    // FH: the carpenter saws 3 mm more on the two sizes that are not Z (the CNC squares the part before milling)
    const allowance = written && mat.material === 'FH' ? FH_ALLOWANCE_MM : 0;
    const cut = written && allowance ? withAllowance(written, zi!, allowance) : written;
    const stockKind: StockKind = eff?.kind ?? 'unknown';
    // the saw cuts the bar: its material decides the saw, the part's material when the bar's is unknown
    const sawMaterial = mapped(eff?.materials[0], matOpts) ?? mat.material;

    let status: CutItemStatus = 'to_cut';
    let statusReason: string | undefined;
    const isDone = part.cuttedStatus || Boolean(part.workOrder && done.has(part.workOrder));
    if (isDone) {
      status = 'cut';
      statusReason = part.cuttedStatus ? undefined : 'ticked as cut in the app';
    } else if (mat.material && LASER_MATERIALS.has(mat.material)) {
      status = 'elsewhere';
      statusReason = `laser part (${mat.material}): not made on the CNC`;
    } else if (stockKind === 'round' || (!part.measure && TURNING_NAME.test(`${part.partName ?? ''} ${part.mText ?? ''} ${part.text ?? ''}`))) {
      status = 'elsewhere';
      statusReason = 'turning part: not made on the CNC';
    } else if (stockKind === 'filament') {
      status = 'elsewhere';
      statusReason = '3D-print part: not made on the CNC';
    } else if (!cut) {
      status = 'not_ready';
      statusReason = part.hasNc === false ? 'no NC file and no cut size yet' : 'no cut size (Measure and NC header empty)';
    } else if (alert && alertBlocks(alert) && !alert.replacementStock) {
      status = 'blocked';
      statusReason = alert.text;
    } else if (part.hasNc === false) {
      statusReason = 'no NC file yet';
    }

    const item: CutItem = {
      id,
      part,
      status,
      material: mat.material,
      materialSource: mat.source,
      saw: sawGroupOf(sawMaterial, sawGroups),
      stockNo: eff?.id ?? null,
      stockText: eff?.text || null,
      stockKind,
      thickness: eff?.thickness ?? null,
      cut,
      piecesPerBlank: piecesPerBlank(part.measure, part.n3),
      stripWidth: null,
      length: null,
      qty: Math.max(1, Math.round(part.qty) || 1),
    };
    if (statusReason) item.statusReason = statusReason;
    if (mat.evidence) item.materialEvidence = mat.evidence;
    if (mat.unknownToken && status !== 'elsewhere') item.unknownToken = mat.unknownToken;
    if (mat.conflict) item.conflict = mat.conflict;
    if (cutSource) item.cutSource = cutSource;
    if (zi !== undefined) item.zi = zi;
    if (allowance && written) {
      item.written = written;
      item.allowance = allowance;
    }
    if (alert) {
      item.alert = { kind: alert.kind, text: alert.text };
      if (alert.replacementStock) item.alert.replacementStock = alert.replacementStock;
    }
    return item;
  });
}

function mapped(code: string | undefined, o: MaterialOptions): string | null {
  if (!code) return null;
  let c = code;
  const t = o.tokens?.[c];
  if (t) c = t.trim().toUpperCase();
  const a = o.aliases?.[c];
  return a ? a.trim().toUpperCase() : c;
}
