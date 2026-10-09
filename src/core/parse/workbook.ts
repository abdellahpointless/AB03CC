import * as XLSX from 'xlsx';
import { RowReader, normalizeHeader, type Row } from './cells';

export { RowReader, normalizeHeader, num, str, toBool, toIsoDate, type Row } from './cells';

/** Reads the first sheet of an .xlsx/.xls/.csv file into plain row objects. */
export async function readRows(file: File): Promise<Row[]> {
  const buf = await file.arrayBuffer();
  return rowsFromBuffer(buf);
}

export function rowsFromBuffer(buf: ArrayBuffer | Uint8Array): Row[] {
  const wb = XLSX.read(buf, { type: 'array' });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  if (!sheet) return [];
  return XLSX.utils.sheet_to_json<Row>(sheet, { raw: true, defval: null });
}

export type FileKind = 'production' | 'carpenter' | 'parttimes' | 'unknown';

/** Decides what a spreadsheet contains from its headers so one Import button can serve both files. */
export function detectKind(rows: Row[]): FileKind {
  if (rows.length === 0) return 'unknown';
  const r = new RowReader(rows[0]);
  if (r.has('ncfileminute') && r.has('boxcode')) return 'production';
  if (r.has('cuttedstatus', 'carpenterstatus') && r.has('masterorderno', 'masterorder', 'masterordernumber')) {
    return 'carpenter';
  }
  if (r.has('ncfileminute')) return 'production';
  if (r.has('materialnumber') && Object.keys(rows[0]).some(k => normalizeHeader(k).startsWith('timeperpart'))) return 'parttimes';
  return 'unknown';
}
