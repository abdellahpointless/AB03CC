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
      'Time Basis': it.timeBasis === 'measured' ? 'Measured (parts list)' : it.timeBasis === 'estimated' ? `Estimated (NC x ${settings.estimateMultiplier})` : 'Set by user',
      'Measured Min / Part': it.measuredPerPart ?? '',
      'Efficiency %': it.timeBasis === 'measured' ? '' : it.efficiencyPercent,
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
    ...exRows('NO_ELIGIBLE_MACHINE', ex.noEligibleMachine, j => `No machine can take this part (${j.materialType}, or its part type)`),
    ...exRows('OUT_OF_SCOPE', ex.outOfScope, j => `ERP machine ${j.erpMachine}`),
    ...exRows('MANUAL_30000', ex.manual30000, () => 'Master order 30000* planned manually'),
    ...exRows('NO_WAREHOUSE_PICK', ex.unpickedWarehouse, () => 'Planned, but warehouse pick date missing'),
  ]);

  const k = plan.kpis;
  add('Summary', [
    { Metric: 'Plan generated', Value: plan.generatedAt },
    { Metric: 'Jobs planned', Value: k.plannedJobs },
    { Metric: 'Jobs with measured time', Value: k.measuredJobs },
    { Metric: 'Jobs with estimated time', Value: k.estimatedJobs },
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

/** The claude.ai artifact viewer blocks ordinary downloads; it offers files through this capability instead. */
interface ViewerDownloads {
  save(request: { filename: string; data: ArrayBuffer }): Promise<{ status: string }>;
}
interface ViewerWindow {
  claude?: { use?: (name: string) => Promise<unknown> };
}

export type ExportOutcome = 'saved' | 'declined' | 'failed';

/** Saves the plan as an Excel file: through the viewer's save prompt when hosted in one, as a normal download otherwise. */
export async function downloadPlan(plan: PlanResult, settings: PlannerSettings): Promise<ExportOutcome> {
  const filename = `cnc-plan-${new Date().toISOString().slice(0, 10)}.xlsx`;
  const wb = buildWorkbook(plan, settings);
  const viewer = (window as unknown as ViewerWindow).claude;
  if (typeof viewer?.use === 'function') {
    try {
      const downloads = (await viewer.use('downloads')) as ViewerDownloads | null;
      if (downloads) {
        const data = XLSX.write(wb, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer;
        await downloads.save({ filename, data });
        return 'saved';
      }
    } catch (err) {
      return (err as { code?: string } | null)?.code === 'declined' ? 'declined' : 'failed';
    }
  }
  try {
    XLSX.writeFile(wb, filename);
    return 'saved';
  } catch {
    return 'failed';
  }
}
