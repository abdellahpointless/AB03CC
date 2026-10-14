import * as XLSX from 'xlsx';
import { formatClock } from './calendar';
import type { CutLine } from './carpenter/cutLine';
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
    ...exRows('NO_ELIGIBLE_MACHINE', ex.noEligibleMachine, j => plan.refusals?.[j.id] ?? `No machine can take this part (${j.materialType})`),
    ...exRows('ERP_MACHINE_REFUSED', ex.erpRefused ?? [], j => `${plan.refusals?.[j.id] ?? `ERP machine ${j.erpMachine} does not take it`} (planned elsewhere)`),
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
  return saveWorkbook(buildWorkbook(plan, settings), `cnc-plan-${new Date().toISOString().slice(0, 10)}.xlsx`);
}

/** The carpenter's cut line in order: one row per part, with its step, material, board, strip and length. */
export function buildCutLineWorkbook(line: CutLine): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  const rows: object[] = [];
  let seq = 0;
  for (const st of line.steps) {
    for (const m of st.materials)
      for (const b of m.boards)
        for (const s of b.strips)
          for (const p of s.parts)
            rows.push({
              Seq: ++seq,
              Step: `${st.index}. ${st.title}`,
              'Blade change': m.bladeChange && b === m.boards[0] && s === b.strips[0] && p === s.parts[0] ? 'yes' : '',
              Material: m.material,
              'Board Z (mm)': b.z,
              Boards: b.boards.join(' | '),
              'Strip width (mm)': s.width,
              'Length (mm)': p.length,
              Qty: p.item.qty,
              'Cut size': p.item.cut?.join(' x ') ?? '',
              Part: p.item.part.partName ?? p.item.part.text ?? '',
              'Work Order': p.item.part.workOrder ?? '',
              'Master Order': p.item.part.masterOrder,
              'Sales Order': p.item.part.salesOrder ?? '',
              Schedule: p.item.part.schedule ?? '',
              'Production date': p.item.part.productionDate?.slice(0, 10) ?? '',
              MaterialNr: p.item.part.materialNr ?? '',
            });
    for (const p of st.picks)
      rows.push({ Seq: ++seq, Step: `${st.index}. ${st.title}`, Material: p.material ?? '', Boards: 'pre-cut blank (pick)', Qty: p.qty, Part: p.part.partName ?? '', 'Work Order': p.part.workOrder ?? '', 'Master Order': p.part.masterOrder });
  }
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows.length ? rows : [{ Info: 'No rows' }]), 'Cut_Line');
  const strips = line.steps.flatMap(st =>
    st.materials.flatMap(m => m.boards.flatMap(b => b.strips.map(s => ({ Step: `${st.index}. ${st.title}`, Material: m.material, 'Board Z (mm)': b.z, 'Strip width (mm)': s.width, Pieces: s.qty, 'Strip length needed (mm)': Math.round(s.totalLength) })))),
  );
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(strips.length ? strips : [{ Info: 'No rows' }]), 'Strips');
  return wb;
}

export function downloadCutLine(line: CutLine): Promise<ExportOutcome> {
  return saveWorkbook(buildCutLineWorkbook(line), `carpenter-cut-line-${new Date().toISOString().slice(0, 10)}.xlsx`);
}

async function saveWorkbook(wb: XLSX.WorkBook, filename: string): Promise<ExportOutcome> {
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
