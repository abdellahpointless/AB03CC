import type { Borders, Cell, Fill, Worksheet } from 'exceljs';
import type { CutLine, LinePart } from './carpenter/cutLine';
import { formatDuration } from './calendar';
import { MATERIAL_HUE } from '../lib/colors';

/**
 * The carpenter's cut list as a formatted workbook that reads like the app: steps, blade changes, one coloured block
 * per material, boards (Z), strips and the lengths to cut. Column A holds a ☐/☑ box (a small drop-down): ticking a
 * line turns it green, and ticking a material, board or strip line turns everything under it green too.
 */

const OFF = '☐';
const ON = '☑';

function hex(h: number, s: number, l: number): string {
  s /= 100;
  l /= 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0), f(8), f(4)].map(x => Math.round(x * 255).toString(16).padStart(2, '0')).join('').toUpperCase();
}
const tone = (material: string, l: number) => {
  const h = MATERIAL_HUE[material];
  return 'FF' + (h === undefined ? hex(215, 10, l) : hex(h, 65, l));
};
const fill = (argb: string): Fill => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });
const thin = { style: 'thin' as const, color: { argb: 'FFD1D5DB' } };
const box: Partial<Borders> = { top: thin, bottom: thin, left: thin, right: thin };

function merge(ws: Worksheet, r: number, from: number, to: number) {
  ws.mergeCells(r, from, r, to);
}
function checkCell(c: Cell) {
  c.value = OFF;
  c.dataValidation = { type: 'list', allowBlank: true, formulae: [`"${OFF},${ON}"`] };
  c.alignment = { horizontal: 'center', vertical: 'middle' };
  c.font = { size: 14 };
}
/** green and struck through when this line, or a line above it in the same group, is ticked */
function doneWhen(ws: Worksheet, first: number, last: number, parents: number[]) {
  const terms = [`$A${first}="${ON}"`, ...parents.map(p => `$A$${p}="${ON}"`)];
  ws.addConditionalFormatting({
    ref: `A${first}:G${last}`,
    rules: [
      {
        type: 'expression',
        priority: 1,
        formulae: [terms.length > 1 ? `OR(${terms.join(',')})` : terms[0]],
        style: { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: 'FFDCFCE7' } }, font: { strike: true, color: { argb: 'FF6B7280' } } },
      },
    ],
  });
}

function mergeSame(parts: LinePart[]) {
  const map = new Map<string, { length: number; qty: number; parts: LinePart[] }>();
  for (const p of parts) {
    const k = `${p.length}|${p.item.part.materialNr || p.item.part.partName || p.item.id}`;
    let g = map.get(k);
    if (!g) map.set(k, (g = { length: p.length, qty: 0, parts: [] }));
    g.qty += p.item.qty;
    g.parts.push(p);
  }
  return [...map.values()];
}

export async function buildCutLineXlsx(line: CutLine): Promise<ArrayBuffer> {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'CNC Smart Planner';
  const ws = wb.addWorksheet('Cut list', {
    views: [{ state: 'frozen', ySplit: 4, showGridLines: false }],
    pageSetup: { orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.3, right: 0.3, top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2 } },
  });
  ws.columns = [{ width: 5 }, { width: 13 }, { width: 8 }, { width: 36 }, { width: 13 }, { width: 30 }, { width: 11 }];
  ws.pageSetup.printTitlesRow = '4:4';

  // title, summary, how to tick, column names
  const t = line.totals;
  ws.getCell('A1').value = 'Carpenter cut list';
  ws.getCell('A1').font = { size: 20, bold: true, color: { argb: 'FF0F172A' } };
  merge(ws, 1, 1, 7);
  ws.getCell('A2').value = `${t.qty} pieces · ${formatDuration(Math.round(t.minutes))} of cutting · ${t.bladeChanges} blade change${t.bladeChanges === 1 ? '' : 's'} · ${new Date().toLocaleString()}`;
  ws.getCell('A2').font = { size: 11, color: { argb: 'FF475569' } };
  merge(ws, 2, 1, 7);
  ws.getCell('A3').value = `Cut from top to bottom. When done, set the box in column A to ${ON} (click it, pick from the little list): the line turns green. Ticking a material, board or strip line ticks everything under it.`;
  ws.getCell('A3').font = { size: 10, italic: true, color: { argb: 'FF64748B' } };
  ws.getCell('A3').alignment = { wrapText: true, vertical: 'middle' };
  ws.getRow(3).height = 30;
  merge(ws, 3, 1, 7);
  const head = ws.getRow(4);
  head.values = ['✓', 'Cut length', 'Qty', 'Part', 'MaterialNr', 'Work orders', 'Boxes'];
  head.eachCell(c => {
    c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    c.fill = fill('FF334155');
    c.alignment = { vertical: 'middle', horizontal: 'center' };
  });
  head.height = 20;

  let r = 5;
  for (const st of line.steps) {
    r++; // breathing room
    const sr = ws.getRow(r);
    sr.getCell(1).value = `STEP ${st.index}  ·  ${st.title}`;
    sr.getCell(6).value = `${st.qty} pcs · ${formatDuration(Math.round(st.minutes))}`;
    merge(ws, r, 1, 5);
    merge(ws, r, 6, 7);
    for (let c = 1; c <= 7; c++) {
      sr.getCell(c).fill = fill('FF1E3A8A');
      sr.getCell(c).font = { bold: true, size: 14, color: { argb: 'FFFFFFFF' } };
      sr.getCell(c).alignment = { vertical: 'middle', horizontal: c >= 6 ? 'right' : 'left', indent: 1 };
    }
    sr.height = 26;
    r++;

    for (const m of st.materials) {
      if (m.bladeChange) {
        const br = ws.getRow(r);
        br.getCell(1).value = `⚠  CHANGE THE SAW BLADE  →  ${m.blade === 'FH' ? 'FH blade' : 'blade for ALU / POM / PCGF / MS …'}`;
        merge(ws, r, 1, 7);
        br.getCell(1).fill = fill('FFFDE68A');
        br.getCell(1).font = { bold: true, size: 12, color: { argb: 'FF92400E' } };
        br.getCell(1).alignment = { vertical: 'middle', indent: 1 };
        br.height = 22;
        r++;
      }
      const matRow = r;
      const mr = ws.getRow(r);
      checkCell(mr.getCell(1));
      mr.getCell(2).value = `${m.material}  —  ${m.qty} pcs`;
      merge(ws, r, 2, 7);
      mr.getCell(1).fill = fill(tone(m.material, 38));
      mr.getCell(1).font = { size: 14, color: { argb: 'FFFFFFFF' } };
      mr.getCell(2).fill = fill(tone(m.material, 38));
      mr.getCell(2).font = { bold: true, size: 14, color: { argb: 'FFFFFFFF' } };
      mr.getCell(2).alignment = { vertical: 'middle', indent: 1 };
      mr.height = 24;
      doneWhen(ws, r, r, []);
      r++;

      for (const b of m.boards) {
        const boardRow = r;
        const bRow = ws.getRow(r);
        checkCell(bRow.getCell(1));
        bRow.getCell(2).value = `Board Z ${b.z} mm`;
        bRow.getCell(3).value = `${b.qty} pcs`;
        bRow.getCell(4).value = b.boards.join('  ·  ');
        merge(ws, r, 4, 7);
        for (let c = 1; c <= 7; c++) {
          bRow.getCell(c).fill = fill(tone(m.material, 86));
          bRow.getCell(c).border = box;
        }
        bRow.getCell(2).font = { bold: true, size: 13 };
        bRow.getCell(3).font = { bold: true };
        bRow.getCell(4).font = { size: 9, color: { argb: 'FF475569' } };
        bRow.height = 20;
        doneWhen(ws, r, r, [matRow]);
        r++;

        for (const s of b.strips) {
          const stripRow = r;
          const sRow = ws.getRow(r);
          checkCell(sRow.getCell(1));
          sRow.getCell(2).value = `Strip ${s.width} mm`;
          sRow.getCell(3).value = `${s.qty} pcs`;
          sRow.getCell(4).value = `${Math.round(s.totalLength)} mm of strip (${s.width} × ${b.z} mm)`;
          merge(ws, r, 4, 7);
          for (let c = 1; c <= 7; c++) {
            sRow.getCell(c).fill = fill(tone(m.material, 94));
            sRow.getCell(c).border = box;
          }
          sRow.getCell(2).font = { bold: true, color: { argb: 'FF0369A1' } };
          sRow.getCell(4).font = { size: 9, color: { argb: 'FF475569' } };
          doneWhen(ws, r, r, [boardRow, matRow]);
          r++;

          const first = r;
          for (const g of mergeSame(s.parts)) {
            const p = g.parts[0].item.part;
            const wos = g.parts.map(x => x.item.part.workOrder).filter(Boolean) as string[];
            const boxes = new Set(g.parts.map(x => x.item.part.masterOrder)).size;
            const row = ws.getRow(r);
            checkCell(row.getCell(1));
            row.getCell(2).value = `${g.length} mm`;
            row.getCell(3).value = `×${g.qty}`;
            row.getCell(4).value = (p.partName ?? p.text ?? '') + (g.parts.some(x => x.item.alert) ? '  ⚠' : '');
            row.getCell(5).value = p.materialNr ?? '';
            row.getCell(6).value = wos.length > 3 ? `${wos.slice(0, 3).join(', ')} +${wos.length - 3}` : wos.join(', ');
            row.getCell(7).value = boxes > 1 ? `${boxes} boxes` : p.masterOrder;
            for (let c = 1; c <= 7; c++) row.getCell(c).border = box;
            row.getCell(2).font = { bold: true, size: 12 };
            row.getCell(3).font = { bold: true, size: 12 };
            row.getCell(3).alignment = { horizontal: 'center' };
            row.getCell(5).font = { size: 9, color: { argb: 'FF64748B' } };
            row.getCell(6).font = { size: 9, color: { argb: 'FF64748B' } };
            row.getCell(7).font = { size: 9, color: { argb: 'FF64748B' } };
            r++;
          }
          if (r > first) doneWhen(ws, first, r - 1, [stripRow, boardRow, matRow]);
        }
      }
    }
  }

  // the same parts, one line per work order: what the shop helper scans
  const sc = wb.addWorksheet('Scan order', { views: [{ state: 'frozen', ySplit: 1 }] });
  sc.columns = [
    { header: '✓', width: 5 },
    { header: 'Seq', width: 6 },
    { header: 'Work Order', width: 15 },
    { header: 'MaterialNr', width: 12 },
    { header: 'Cut size', width: 14 },
    { header: 'Qty', width: 6 },
    { header: 'Part', width: 34 },
    { header: 'Box (master order)', width: 16 },
    { header: 'Material', width: 9 },
    { header: 'Step', width: 30 },
  ];
  sc.getRow(1).eachCell(c => {
    c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    c.fill = fill('FF334155');
  });
  let seq = 0;
  for (const st of line.steps)
    for (const m of st.materials)
      for (const b of m.boards)
        for (const s of b.strips)
          for (const p of s.parts) {
            const row = sc.addRow([OFF, ++seq, p.item.part.workOrder ?? '', p.item.part.materialNr ?? '', p.item.cut?.join(' x ') ?? '', p.item.qty, p.item.part.partName ?? '', p.item.part.masterOrder, m.material, `${st.index}. ${st.title}`]);
            checkCell(row.getCell(1));
            row.getCell(9).fill = fill(tone(m.material, 86));
          }
  if (seq) doneWhen(sc, 2, seq + 1, []);
  sc.autoFilter = { from: 'A1', to: 'J1' };

  return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}
