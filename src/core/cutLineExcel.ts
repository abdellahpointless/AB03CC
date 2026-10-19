import type { Borders, Cell, Fill, Worksheet } from 'exceljs';
import { scanOrder, sizeLines, sizeText, type CutLine, type LineStep, type SizeLine } from './carpenter/cutLine';
import type { Workbook } from 'exceljs';
import { formatDuration } from './calendar';
import { MATERIAL_HUE } from '../lib/colors';

/**
 * The carpenter's cut list, made to be printed: steps, blade changes, one coloured block per material, boards (Z),
 * and under each board one numbered line per size (in strip order, no strip rows) with the whole size to saw and
 * how many. He cuts from the paper, writes what he cut in the empty "Cut" box, and the line numbers come back when
 * he scans the parts on the website.
 * On screen, column A holds a ☐/☑ box (a small drop-down): ticking a line turns it green, and ticking a material
 * or board line turns everything under it green too.
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

const PAGE = { orientation: 'portrait' as const, fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.3, right: 0.3, top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2 } };
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : w.endsWith('x') ? 'es' : 's'}`;

/**
 * One printable cut sheet: a title, how to use it, then its steps (or its round) line by line.
 * `lineOf` gives the numbered sheet line of each line's first part.
 */
function cutSheet(wb: Workbook, name: string, title: string, sub: string, steps: LineStep[], lineOf: Map<string, SizeLine>, showStepBars: boolean) {
  const ws = wb.addWorksheet(name, {
    views: [{ state: 'frozen', ySplit: 4, showGridLines: false }],
    pageSetup: PAGE,
  });
  ws.columns = [{ width: 5 }, { width: 6 }, { width: 22 }, { width: 8 }, { width: 9 }, { width: 34 }, { width: 11 }];
  ws.pageSetup.printTitlesRow = '4:4';
  ws.headerFooter.oddFooter = `&L${title}&RPage &P of &N`;

  // title, summary, how to tick, column names
  ws.getCell('A1').value = title;
  ws.getCell('A1').font = { size: 20, bold: true, color: { argb: 'FF0F172A' } };
  merge(ws, 1, 1, 7);
  ws.getCell('A2').value = sub;
  ws.getCell('A2').font = { size: 11, color: { argb: 'FF475569' } };
  merge(ws, 2, 1, 7);
  ws.getCell('A3').value = `Cut from top to bottom. Sizes are in mm, the longest first, Z last; sizes already include the material's extra mm where one is set (not on Z). Write how many you cut in the "Cut" box. On the computer: set column A to ${ON} and the line turns green.`;
  ws.getCell('A3').font = { size: 10, italic: true, color: { argb: 'FF64748B' } };
  ws.getCell('A3').alignment = { wrapText: true, vertical: 'middle' };
  ws.getRow(3).height = 30;
  merge(ws, 3, 1, 7);
  const head = ws.getRow(4);
  head.values = ['✓', '#', 'Size to saw', 'Qty', 'Cut', 'Parts', 'Boxes'];
  head.eachCell(c => {
    c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    c.fill = fill('FF334155');
    c.alignment = { vertical: 'middle', horizontal: 'center' };
  });
  head.height = 20;

  let r = 5;
  for (const st of steps) {
    if (showStepBars) {
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
    }

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
      mr.getCell(2).value = `${m.material}  —  ${m.qty} pcs${m.allowance ? `   (sizes +${m.allowance} mm, not Z)` : ''}`;
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
        merge(ws, r, 2, 3);
        bRow.getCell(4).value = `${b.qty} pcs`;
        bRow.getCell(5).value = b.boards.join('  ·  ');
        merge(ws, r, 5, 7);
        for (let c = 1; c <= 7; c++) {
          bRow.getCell(c).fill = fill(tone(m.material, 86));
          bRow.getCell(c).border = box;
        }
        bRow.getCell(2).font = { bold: true, size: 13 };
        bRow.getCell(4).font = { bold: true };
        bRow.getCell(5).font = { size: 9, color: { argb: 'FF475569' } };
        bRow.height = 20;
        doneWhen(ws, r, r, [matRow]);
        r++;

        // the size lines straight under their board: the carpenter sees the strips himself
        for (const s of b.strips) {
          const first = r;
          for (const p of s.parts) {
            const l = lineOf.get(p.item.id);
            if (!l) continue;
            const names = [...new Set(l.parts.map(x => x.item.part.partName ?? x.item.part.text ?? '').filter(Boolean))];
            const boxes = new Set(l.parts.map(x => x.item.part.masterOrder)).size;
            const row = ws.getRow(r);
            checkCell(row.getCell(1));
            row.getCell(2).value = l.no;
            row.getCell(3).value = sizeText(l.length, l.width, l.z, ' × ');
            row.getCell(4).value = l.qty;
            row.getCell(5).value = '';
            row.getCell(6).value = (names[0] ?? '') + (names.length > 1 ? `  +${names.length - 1} more` : '') + (l.parts.some(x => x.item.alert) ? '  ⚠' : '');
            row.getCell(7).value = boxes > 1 ? `${boxes} boxes` : l.parts[0].item.part.masterOrder;
            for (let c = 1; c <= 7; c++) row.getCell(c).border = box;
            row.getCell(5).border = { top: thin, left: thin, right: thin, bottom: { style: 'medium', color: { argb: 'FF94A3B8' } } };
            row.getCell(2).font = { bold: true, size: 11, color: { argb: 'FF64748B' } };
            row.getCell(2).alignment = { horizontal: 'center', vertical: 'middle' };
            row.getCell(3).font = { bold: true, size: 13 };
            row.getCell(3).alignment = { vertical: 'middle' };
            row.getCell(4).font = { bold: true, size: 13 };
            row.getCell(4).alignment = { horizontal: 'center', vertical: 'middle' };
            row.getCell(6).font = { size: 9, color: { argb: 'FF64748B' } };
            row.getCell(7).font = { size: 9, color: { argb: 'FF64748B' } };
      row.getCell(7).alignment = { wrapText: true, vertical: 'top' };
            row.height = 20;
            r++;
          }
          if (r > first) doneWhen(ws, first, r - 1, [boardRow, matRow]);
        }
      }
    }
  }

}

export async function buildCutLineXlsx(line: CutLine): Promise<ArrayBuffer> {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'CNC Smart Planner';
  const t = line.totals;
  const when = new Date().toLocaleString();
  // the numbered lines, looked up by their first part
  const lineOf = new Map<string, SizeLine>();
  for (const l of sizeLines(line)) lineOf.set(l.parts[0].item.id, l);

  const rounds = line.steps.some(st => st.round);
  if (!rounds) {
    cutSheet(wb, 'Cut list', 'Carpenter cut list', `${t.qty} pieces · ${formatDuration(Math.round(t.minutes))} of cutting · ${plural(t.bladeChanges, 'blade change')} · ${when}`, line.steps, lineOf, true);
  } else {
    // the overview, then one sheet (one paper) per round: File > Print > "Print entire workbook" prints them all
    const ov = wb.addWorksheet('Rounds', { views: [{ showGridLines: false }], pageSetup: PAGE });
    ov.columns = [{ width: 10 }, { width: 9 }, { width: 11 }, { width: 8 }, { width: 30 }, { width: 13 }, { width: 42 }];
    ov.getCell('A1').value = 'Carpenter rounds';
    ov.getCell('A1').font = { size: 20, bold: true, color: { argb: 'FF0F172A' } };
    merge(ov, 1, 1, 7);
    ov.getCell('A2').value = `${plural(line.steps.length, 'round')} · ${t.qty} pieces · ${formatDuration(Math.round(t.minutes))} of cutting · ${when}`;
    ov.getCell('A2').font = { size: 11, color: { argb: 'FF475569' } };
    merge(ov, 2, 1, 7);
    ov.getCell('A3').value = 'Each round has its own sheet: cut it, come back, scan it, then take the next. Print every sheet at once with File > Print > "Print entire workbook".';
    ov.getCell('A3').font = { size: 10, italic: true, color: { argb: 'FF64748B' } };
    ov.getCell('A3').alignment = { wrapText: true, vertical: 'middle' };
    ov.getRow(3).height = 30;
    merge(ov, 3, 1, 7);
    const oh = ov.getRow(5);
    oh.values = ['Round', 'Pieces', 'Cutting', 'Boxes', 'From', 'Sheet lines', 'Notes'];
    oh.eachCell(c => {
      c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      c.fill = fill('FF334155');
    });
    let orow = 6;
    for (const st of line.steps) {
      const nos = [...lineOf.values()].filter(l => l.step === st).map(l => l.no);
      const ri = st.round!;
      const notes = [ri.continued.length ? `rest of box ${ri.continued.join(', ')}` : '', ri.continues.length ? `box ${ri.continues.join(', ')} goes on in the next round` : '', st.bladeChanges ? plural(st.bladeChanges, 'blade change') : '']
        .filter(Boolean)
        .join(' · ');
      const row = ov.getRow(orow++);
      row.values = [st.title, st.qty, formatDuration(Math.round(st.minutes)), ri.boxes, ri.from.join(' + '), nos.length ? `#${Math.min(...nos)} – #${Math.max(...nos)}` : '', notes];
      row.eachCell({ includeEmpty: true }, c => (c.border = box));
      row.getCell(1).font = { bold: true };
      row.getCell(7).font = { size: 9, color: { argb: 'FF64748B' } };
      row.getCell(7).alignment = { wrapText: true, vertical: 'top' };
    }
    line.steps.forEach(st => {
      const ri = st.round!;
      const sub = `${st.qty} pieces · ${formatDuration(Math.round(st.minutes))} of cutting · ${plural(ri.boxes, 'box')} · ${ri.from.join(' + ')}${ri.continues.length ? ` · box ${ri.continues.join(', ')} goes on in the next round` : ''}`;
      cutSheet(wb, st.title, `${st.title} of ${line.steps.length}`, sub, [st], lineOf, false);
    });
  }

  // the same parts, one line per work order, in the order he scans them: material by material, the size with most
  // pieces first. Columns A to F are what the shop helper needs (select them and copy), the rest is for reading.
  const sc = wb.addWorksheet('Scan order', { views: [{ state: 'frozen', ySplit: 1 }] });
  sc.columns = [
    { header: 'Work Order', width: 15 },
    { header: 'MaterialNr', width: 12 },
    { header: 'Qty', width: 6 },
    { header: 'Material', width: 9 },
    { header: 'Size', width: 16 },
    { header: 'Line', width: 9 },
    { header: 'Part', width: 34 },
    { header: 'Box (master order)', width: 17 },
    { header: '✓', width: 5 },
  ];
  sc.getRow(1).eachCell((c, col) => {
    c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    c.fill = fill(col <= 6 ? 'FF1E3A8A' : 'FF334155');
  });
  const order = scanOrder(line);
  order.forEach((e, k) => {
    if (line.steps.length > 1 && (k === 0 || order[k - 1].step !== e.step)) {
      // one block per round (or step): select that block's rows to scan it
      const hr = sc.addRow([`${e.step.title.toUpperCase()}  ·  ${e.step.qty} pcs`]);
      sc.mergeCells(hr.number, 1, hr.number, 9);
      hr.getCell(1).fill = fill('FF1E3A8A');
      hr.getCell(1).font = { bold: true, size: 12, color: { argb: 'FFFFFFFF' } };
      hr.height = 20;
    }
    const row = sc.addRow([e.item.part.workOrder ?? '', e.item.part.materialNr ?? '', e.item.qty, e.material, e.size, e.lines.map(n => `#${n}`).join(' '), e.item.part.partName ?? '', e.item.part.masterOrder, OFF]);
    checkCell(row.getCell(9));
    row.getCell(4).fill = fill(tone(e.material, 86));
    row.getCell(3).alignment = { horizontal: 'center' };
    // a line between sizes
    const prev = order[k - 1];
    if (prev && (prev.material !== e.material || prev.size !== e.size)) row.eachCell({ includeEmpty: true }, c => (c.border = { top: { style: prev.material !== e.material ? 'medium' : 'thin', color: { argb: 'FF94A3B8' } } }));
  });
  const n = sc.rowCount;
  if (n > 1)
    sc.addConditionalFormatting({
      ref: `A2:I${n}`,
      rules: [{ type: 'expression', priority: 1, formulae: [`$I2="${ON}"`], style: { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: 'FFDCFCE7' } }, font: { strike: true, color: { argb: 'FF6B7280' } } } }],
    });
  sc.autoFilter = { from: 'A1', to: 'I1' };

  return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}
