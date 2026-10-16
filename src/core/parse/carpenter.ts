import type {
  CarpenterCutColumn,
  CarpenterMoInfo,
  CarpenterPart,
  CarpenterReport,
} from '../types';
import { RowReader, num, str, toBool, toIsoDate, type Row } from './cells';

/** Master order keys differ in formatting between exports ("123.0", spaces) - compare them normalized. */
export function normalizeMo(raw: unknown): string {
  let s = str(raw).replace(/\s+/g, '');
  if (s.endsWith('.0')) s = s.slice(0, -2);
  return s;
}

const padDigits = (v: string, len: number) => (/^\d+$/.test(v) && v.length < len ? v.padStart(len, '0') : v);

/** Numbers re-saved by Excel come back as "200170251.0". */
function keyText(v: unknown): string {
  const s = str(v);
  return /^\d+\.0+$/.test(s) ? s.replace(/\.0+$/, '') : s;
}

/**
 * Whether a PDF / NC file cell holds files. The export writes a JSON list ("[{...}]"); an empty list, "[]", "null" or
 * an empty cell means none. Anything else that is not empty counts as files (a re-saved sheet may hold plain text).
 */
export function hasFiles(v: unknown): boolean {
  if (v === undefined || v === null) return false;
  if (Array.isArray(v)) return v.length > 0;
  const s = String(v).trim();
  if (!s || s === '[]' || s === '{}' || s.toLowerCase() === 'null') return false;
  if (s.startsWith('[') || s.startsWith('{')) {
    try {
      const parsed: unknown = JSON.parse(s);
      if (Array.isArray(parsed)) return parsed.length > 0;
      if (parsed && typeof parsed === 'object') return Object.keys(parsed).length > 0;
      return Boolean(parsed);
    } catch {
      return true;
    }
  }
  return true;
}

/** The content of the "N<k> ( ... )" line of an NC header, or undefined. */
export function ncHeaderLine(ncDescription: string, k: number): string | undefined {
  for (const raw of ncDescription.split(/\r?\n/)) {
    const line = raw.trim();
    const m = new RegExp(`^N${k}(?![0-9])\\s*\\(?(.*)$`, 'i').exec(line);
    if (!m) continue;
    const body = m[1].replace(/\)\s*$/, '').trim();
    return body || undefined;
  }
  return undefined;
}

export function parseCarpenter(rows: Row[]): { parts: CarpenterPart[]; uniqueMasterOrders: number } {
  const r = new RowReader(rows[0]);
  const parts: CarpenterPart[] = [];
  const mos = new Set<string>();
  const hasPdfColumn = r.has('pdffiles', 'pdffile', 'pdf');
  const hasNcColumn = r.has('ncfiles', 'ncfile');
  for (const row of rows) {
    const masterOrder = normalizeMo(r.get(row, 'masterorderno', 'masterorder', 'masterordernumber', 'mainorder'));
    if (!masterOrder) continue;
    mos.add(masterOrder);
    const alert = str(r.get(row, 'alertmessage', 'alert', 'warning'));
    const text = str(r.get(row, 'text', 'description', 'partname')) || undefined;
    const mText = str(r.get(row, 'mtext', 'materialtext')) || undefined;
    const materialNr = keyText(r.get(row, 'materialnr', 'matnr', 'partnumber')) || undefined;
    const modulNo = keyText(r.get(row, 'modulno', 'modul', 'module', 'modulnumber')) || undefined;
    const scheduleRaw = r.get(row, 'schedule', 'plannedschedulednumber');
    const schedule = scheduleRaw === undefined ? NaN : num(scheduleRaw, NaN);
    const nc = str(r.get(row, 'ncdescription'));
    const salesOrder = padDigits(keyText(r.get(row, 'salesorder')), 10);
    const part: CarpenterPart = {
      masterOrder,
      workOrder: keyText(r.get(row, 'workorder', 'works')) || undefined,
      text,
      mText,
      materialType: str(r.get(row, 'materialtype')) || undefined,
      qty: Math.max(1, num(r.get(row, 'qty', 'quantity'), 1)),
      cuttedStatus: toBool(r.get(row, 'cuttedstatus', 'cutstatus', 'cutted')),
      carpenterStatus: toBool(r.get(row, 'carpenterstatus')),
      alertMessage: alert || undefined,
      customer: str(r.get(row, 'customername', 'customer')) || undefined,
    };
    const optional: Partial<CarpenterPart> = {
      salesOrder: salesOrder || undefined,
      schedule: Number.isFinite(schedule) ? schedule : undefined,
      materialNr,
      modulNo,
      measure: str(r.get(row, 'measure')) || undefined,
      descriptionDe: str(r.get(row, 'descriptionde')) || undefined,
      boxInfo: str(r.get(row, 'boxinformation', 'boxinfo')) || undefined,
      n3: nc ? ncHeaderLine(nc, 3) : undefined,
      ncProgram: nc ? ncHeaderLine(nc, 1) : undefined,
      hasPdf: hasPdfColumn ? hasFiles(r.get(row, 'pdffiles', 'pdffile', 'pdf')) : undefined,
      hasNc: hasNcColumn ? hasFiles(r.get(row, 'ncfiles', 'ncfile')) : undefined,
      productionDate: toIsoDate(r.get(row, 'productiondate', 'proddate')) ?? undefined,
      plannedPickDate: toIsoDate(r.get(row, 'plannedpickdate')) ?? undefined,
      warehousePickDate: toIsoDate(r.get(row, 'warehousepickdate')) ?? undefined,
      partName: mText && !/^\d+$/.test(mText) ? mText : text,
      moduleName: modulNo !== undefined && modulNo !== materialNr ? text : undefined,
    };
    // only fields that hold something, so the saved list stays small and old shapes compare equal
    for (const [k, v] of Object.entries(optional)) if (v !== undefined) (part as unknown as Record<string, unknown>)[k] = v;
    parts.push(part);
  }
  return { parts, uniqueMasterOrders: mos.size };
}

/** Is this row of the carpenter list done? With 'in_list' (the default) never: a part in the list is still there. */
export function isPartCut(p: CarpenterPart, column: CarpenterCutColumn): boolean {
  if (column === 'in_list') return false;
  if (column === 'carpenter_status') return p.carpenterStatus;
  if (column === 'either') return p.cuttedStatus || p.carpenterStatus;
  return p.cuttedStatus;
}

/** Joins the carpenter list to the production master orders. */
export function buildCarpenterMap(
  parts: CarpenterPart[],
  productionMasterOrders: Iterable<string>,
  column: CarpenterCutColumn,
  simulatedUncut: string[] = [],
  /** per production master order: parts still at the carpenter by the workload's own counters */
  counters: Record<string, number> = {},
): { map: Record<string, CarpenterMoInfo>; report: CarpenterReport } {
  const production = new Set<string>();
  for (const mo of productionMasterOrders) production.add(normalizeMo(mo));
  const simulated = new Set(simulatedUncut.map(normalizeMo));

  const byMo = new Map<string, CarpenterPart[]>();
  for (const p of parts) {
    const k = normalizeMo(p.masterOrder);
    (byMo.get(k) ?? byMo.set(k, []).get(k)!).push(p);
  }

  const map: Record<string, CarpenterMoInfo> = {};
  let matched = 0;
  let open = 0;

  byMo.forEach((list, mo) => {
    const isMatched = production.has(mo);
    if (isMatched) matched++;
    const sim = simulated.has(mo);
    const openList: CarpenterMoInfo['openPartsList'] = [];
    let openQty = 0;
    let cut = 0;
    let alert = false;
    for (const p of list) {
      if (!sim && isPartCut(p, column)) {
        cut++;
        continue;
      }
      openQty += p.qty;
      const msg = p.alertMessage ?? (sim ? 'Simulated uncut part' : undefined);
      if (msg) alert = true;
      openList.push({ text: p.text, mText: p.mText, materialType: p.materialType, qty: p.qty, alertMessage: msg });
    }
    const openParts = list.length - cut;
    const hasOpen = openParts > 0;
    if (hasOpen && isMatched) open++;
    map[mo] = {
      masterOrder: mo,
      totalParts: list.length,
      cutParts: cut,
      openParts,
      openQty,
      hasOpenParts: hasOpen,
      hasMaterialAlert: alert,
      status: !hasOpen ? 'all_cut' : alert ? 'material_issue' : 'has_open',
      openPartsList: openList,
      customer: list[0]?.customer,
      simulated: sim || undefined,
    };
  });

  // Simulation of a production MO that has no carpenter rows at all.
  simulated.forEach(mo => {
    if (map[mo] || !production.has(mo)) return;
    matched++;
    open++;
    map[mo] = {
      masterOrder: mo,
      totalParts: 1,
      cutParts: 0,
      openParts: 1,
      openQty: 1,
      hasOpenParts: true,
      hasMaterialAlert: true,
      status: 'material_issue',
      openPartsList: [{ text: 'Simulated uncut part', qty: 1, alertMessage: 'Simulated carpenter delay' }],
      simulated: true,
    };
  });

  // the workload's own counters (Sub Order Count − Cutting Count): parts still at the carpenter that the list does not
  // show, when the list is older than the workload or filtered
  for (const [rawMo, left] of Object.entries(counters)) {
    const mo = normalizeMo(rawMo);
    if (!(left > 0) || !production.has(mo)) continue;
    const info = map[mo];
    const listed = info?.openParts ?? 0;
    if (left <= listed) continue;
    const extra = left - listed;
    if (!info) {
      open++;
      map[mo] = { masterOrder: mo, totalParts: extra, cutParts: 0, openParts: extra, openQty: extra, hasOpenParts: true, hasMaterialAlert: false, status: 'has_open', openPartsList: [], notInList: extra };
    } else {
      if (!info.hasOpenParts) open++;
      info.totalParts += extra;
      info.openParts += extra;
      info.openQty += extra;
      info.hasOpenParts = true;
      if (info.status === 'all_cut') info.status = 'has_open';
      info.notInList = extra;
    }
  }

  return {
    map,
    report: {
      totalParts: parts.length,
      uniqueMasterOrders: byMo.size,
      matchedMasterOrders: matched,
      openMasterOrders: open,
    },
  };
}
