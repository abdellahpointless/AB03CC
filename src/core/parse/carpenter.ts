import type {
  CarpenterCutColumn,
  CarpenterMoInfo,
  CarpenterPart,
  CarpenterReport,
} from '../types';
import { RowReader, num, str, toBool, type Row } from './cells';

/** Master order keys differ in formatting between exports ("123.0", spaces) - compare them normalized. */
export function normalizeMo(raw: unknown): string {
  let s = str(raw).replace(/\s+/g, '');
  if (s.endsWith('.0')) s = s.slice(0, -2);
  return s;
}

export function parseCarpenter(rows: Row[]): { parts: CarpenterPart[]; uniqueMasterOrders: number } {
  const r = new RowReader(rows[0]);
  const parts: CarpenterPart[] = [];
  const mos = new Set<string>();
  for (const row of rows) {
    const masterOrder = normalizeMo(r.get(row, 'masterorderno', 'masterorder', 'masterordernumber', 'mainorder'));
    if (!masterOrder) continue;
    mos.add(masterOrder);
    const alert = str(r.get(row, 'alertmessage', 'alert', 'warning'));
    parts.push({
      masterOrder,
      workOrder: str(r.get(row, 'workorder', 'works')) || undefined,
      text: str(r.get(row, 'text', 'description', 'partname')) || undefined,
      mText: str(r.get(row, 'mtext', 'materialtext')) || undefined,
      materialType: str(r.get(row, 'materialtype')) || undefined,
      qty: Math.max(1, num(r.get(row, 'qty'), 1)),
      cuttedStatus: toBool(r.get(row, 'cuttedstatus', 'cutstatus', 'cutted')),
      carpenterStatus: toBool(r.get(row, 'carpenterstatus')),
      alertMessage: alert || undefined,
      customer: str(r.get(row, 'customername', 'customer')) || undefined,
    });
  }
  return { parts, uniqueMasterOrders: mos.size };
}

export function isPartCut(p: CarpenterPart, column: CarpenterCutColumn): boolean {
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
