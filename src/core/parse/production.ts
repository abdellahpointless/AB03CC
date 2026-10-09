import type { ImportReport, Job } from '../types';
import { RowReader, num, str, toIsoDate, type Row } from './cells';

export interface ProductionImport {
  jobs: Job[];
  report: ImportReport;
}

const REQUIRED: Array<{ label: string; names: string[] }> = [
  { label: 'Box Code', names: ['boxcode'] },
  { label: 'Master Order Number', names: ['masterordernumber', 'mainorder'] },
  { label: 'Order Number', names: ['ordernumber', 'subordernumber'] },
  { label: 'Nc File Minute', names: ['ncfileminute'] },
  { label: 'Material Type', names: ['materialtype'] },
];

export function missingProductionColumns(rows: Row[]): string[] {
  const r = new RowReader(rows[0]);
  return REQUIRED.filter(c => !r.has(...c.names)).map(c => c.label);
}

const padDigits = (v: string, len: number) => (/^\d+$/.test(v) && v.length < len ? v.padStart(len, '0') : v);

export function parseProduction(rows: Row[], fileName?: string): ProductionImport {
  const r = new RowReader(rows[0]);
  const warnings: string[] = [];
  const seen = new Map<string, number>();
  const jobs: Job[] = [];
  const erpLoads: ImportReport['erpLoads'] = {};
  const materialCounts: Record<string, number> = {};
  let zeroNc = 0;
  let duplicates = 0;

  rows.forEach((row, index) => {
    const rawOrder = str(r.get(row, 'ordernumber', 'subordernumber')) || `ROW_${index + 1}`;
    const dup = seen.get(rawOrder) ?? 0;
    seen.set(rawOrder, dup + 1);
    if (dup > 0) duplicates++;
    const id = dup > 0 ? `${rawOrder}#${dup + 1}` : rawOrder;

    const boxCode = padDigits(str(r.get(row, 'boxcode')) || '0', 4);
    const masterOrder = str(r.get(row, 'masterordernumber', 'mainorder')) || rawOrder;
    const materialType = (str(r.get(row, 'materialtype')) || 'UNKNOWN').toUpperCase();
    materialCounts[materialType] = (materialCounts[materialType] ?? 0) + 1;

    let ncMinutes = num(r.get(row, 'ncfileminute'), 0);
    if (ncMinutes <= 0) {
      zeroNc++;
      ncMinutes = 1;
    }
    const qty = Math.max(1, Math.round(num(r.get(row, 'qty'), 1)));

    const machineRaw = str(r.get(row, 'machine'));
    const erpMachine = machineRaw || null;
    if (erpMachine) {
      const l = (erpLoads[erpMachine] ??= { count: 0, minutes: 0 });
      l.count += 1;
      l.minutes += ncMinutes * qty;
    }

    const productionStatus = str(r.get(row, 'productionstatus')) || null;
    const discontinuedReason = str(r.get(row, 'discontinuedreason')) || null;
    const discontinuedText = str(r.get(row, 'discontinuedtext')) || null;
    const blocked = productionStatus === '11' || Boolean(discontinuedReason) || Boolean(discontinuedText);
    const blockedReason = blocked
      ? [discontinuedReason, discontinuedText, productionStatus === '11' ? 'Status 11 - on hold' : null]
          .filter(Boolean)
          .join(' - ')
      : null;

    const plannedDate = toIsoDate(r.get(row, 'planneddate'));
    const ocd = toIsoDate(r.get(row, 'ocd'));
    // The production (planned) date is the target the shop floor works to; OCD only fills in when it is missing.
    const dueDate = plannedDate ?? ocd;

    const cuttingCount = Math.max(0, Math.round(num(r.get(row, 'cuttingcount'), 1))) || 1;
    const finishedCount = Math.max(0, Math.round(num(r.get(row, 'finishedcount'), 0)));
    const scheduleRaw = r.get(row, 'plannedschedulednumber', 'schedule');
    const scheduleNo = scheduleRaw === undefined || !Number.isFinite(Number(scheduleRaw)) ? null : Number(scheduleRaw);

    jobs.push({
      id,
      boxCode,
      masterOrder,
      orderNumber: rawOrder,
      matnr: str(r.get(row, 'matnr')) || 'UNKNOWN',
      materialNo: str(r.get(row, 'materialno')) || 'UNKNOWN',
      materialType,
      ncMinutes,
      qty,
      waitingDays: num(r.get(row, 'waiting'), 0),
      salesOrder: padDigits(str(r.get(row, 'salesorder')), 10),
      customer: str(r.get(row, 'customername')) || 'Without Customer',
      scheduleNo,
      plannedDate,
      ocd,
      dueDate,
      warehousePickDate: toIsoDate(r.get(row, 'warehousepickdate')),
      cuttingCount,
      finishedCount,
      boxRemaining: Math.max(0, cuttingCount - finishedCount),
      erpMachine,
      productionStatus,
      discontinuedReason,
      discontinuedText,
      blocked,
      blockedReason,
    });
  });

  if (zeroNc > 0) warnings.push(`${zeroNc} row(s) had a missing or zero NC time and were set to 1 minute.`);
  if (duplicates > 0) warnings.push(`${duplicates} duplicate order number(s) were kept and renamed with a "#n" suffix.`);

  const unassigned = jobs.filter(j => !j.erpMachine);
  const report: ImportReport = {
    fileName,
    totalRows: jobs.length,
    uniqueOrders: seen.size,
    uniqueMasterOrders: new Set(jobs.map(j => j.masterOrder)).size,
    uniqueMatnr: new Set(jobs.map(j => j.matnr)).size,
    assignedInErp: jobs.length - unassigned.length,
    unassigned: unassigned.length,
    unassignedMinutes: unassigned.reduce((a, j) => a + j.ncMinutes * j.qty, 0),
    erpLoads,
    materialCounts,
    warnings,
  };
  return { jobs, report };
}
