import * as XLSX from 'xlsx';
import { formatClock } from './calendar';
import type { PlanResult, PlannerSettings } from './types';

/** Builds the Excel workbook: overview, one sheet per machine, an ERP import sheet, exceptions and a summary. */
export function buildWorkbook(plan: PlanResult, settings: PlannerSettings): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  const add = (name: string, rows: Record<string, unknown>[]) =>
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows.length ? rows : [{ Info: 'No rows' }]), name.slice(0, 31));

  const all = Object.entries(plan.queues).flatMap(([machine, items]) =>
    items.map(it => ({
      Machine: machine,
      Sequence: it.sequence,
      'Box Code': it.job.boxCode,
      'Order Number': it.job.orderNumber,
      'Master Order': it.job.masterOrder,
      'Sales Order': it.job.salesOrder,
      Customer: it.job.customer,
      Matnr: it.job.matnr,
      'Material Type': it.job.materialType,
      'Material No': it.job.materialNo,
      'NC Minutes': it.job.ncMinutes,
      Qty: it.job.qty,
      'Planned Minutes': it.durationMin,
      'Efficiency %': it.efficiencyPercent,
      'Setup Before (min)': it.setupBefore,
      'Start Minute': it.startMinute,
      'End Minute': it.endMinute,
      Start: it.startTime.replace('T', ' '),
      End: it.endTime.replace('T', ' '),
      'Priority Rank': it.rank,
      'Deciding Rule': it.decidingRule,
      'Closes Box': it.closesBox ? 'YES' : '',
      Pinned: it.userLocked ? 'USER' : it.erpLocked ? 'ERP' : '',
      'Carpenter Open': it.carpenterOpen ? 'YES' : '',
      'Past Due': it.isLate ? 'YES' : '',
    })),
  );
  add('Plan_All', all);

  for (const m of settings.machines) {
    add(
      m.id.replace(/[^a-zA-Z0-9]+/g, '_'),
      (plan.queues[m.id] ?? []).map(it => ({
        Seq: it.sequence,
        Box: it.job.boxCode,
        'Order Number': it.job.orderNumber,
        'Master Order': it.job.masterOrder,
        Customer: it.job.customer,
        Matnr: it.job.matnr,
        Material: it.job.materialType,
        'Duration (min)': it.durationMin,
        'Setup (min)': it.setupBefore,
        Start: `${it.startTime.slice(5, 10)} ${formatClock(it.startTime)}`,
        End: `${it.endTime.slice(5, 10)} ${formatClock(it.endTime)}`,
      })),
    );
  }

  add(
    'ERP_Import',
    Object.entries(plan.queues).flatMap(([machine, items]) =>
      items.map(it => ({ 'Order Number': it.job.orderNumber, Machine: machine, Sequence: it.sequence })),
    ),
  );

  const ex = plan.exceptions;
  const exRows = (cat: string, list: typeof ex.blocked, reason: (j: (typeof ex.blocked)[number]) => string) =>
    list.map(j => ({ Category: cat, 'Order Number': j.orderNumber, 'Master Order': j.masterOrder, 'Box Code': j.boxCode, Matnr: j.matnr, Material: j.materialType, Reason: reason(j) }));
  add('Exceptions', [
    ...exRows('BLOCKED', ex.blocked, j => j.blockedReason ?? 'On hold'),
    ...exRows('NO_ELIGIBLE_MACHINE', ex.noEligibleMachine, j => `No machine accepts ${j.materialType}`),
    ...exRows('OUT_OF_SCOPE', ex.outOfScope, j => `ERP machine ${j.erpMachine}`),
    ...exRows('MANUAL_30000', ex.manual30000, () => 'Master order 30000* planned manually'),
    ...exRows('NO_WAREHOUSE_PICK', ex.unpickedWarehouse, () => 'Planned, but warehouse pick date missing'),
  ]);

  const k = plan.kpis;
  add('Summary', [
    { Metric: 'Plan generated', Value: plan.generatedAt },
    { Metric: 'Jobs planned', Value: k.plannedJobs },
    { Metric: 'Machining hours', Value: k.plannedHours },
    { Metric: 'Makespan (min)', Value: k.makespanMinutes },
    { Metric: 'Total changeover (min)', Value: k.changeoverMinutes },
    { Metric: 'Setup saved vs priority order (min)', Value: k.setupSavedMinutes },
    { Metric: 'Sum of master order completion (min)', Value: k.sumMoCompletion },
    { Metric: 'Synchronized master orders', Value: `${k.synchronizedMos}/${k.totalMos}` },
    { Metric: 'Past-due jobs', Value: k.overdueJobs },
    { Metric: 'Master orders waiting on carpenter', Value: k.waitingOnCarpenter },
    ...Object.entries(k.finishPerMachine).map(([m, v]) => ({ Metric: `Finish ${m} (min)`, Value: v })),
  ]);
  return wb;
}

export function downloadPlan(plan: PlanResult, settings: PlannerSettings) {
  const stamp = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(buildWorkbook(plan, settings), `cnc-plan-${stamp}.xlsx`);
}
