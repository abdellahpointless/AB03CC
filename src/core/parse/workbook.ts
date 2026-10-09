import * as XLSX from 'xlsx';

export type Row = Record<string, unknown>;

export function normalizeHeader(key: string): string {
  return String(key ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s_.\-/]+/g, '');
}

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

/** Header-index helper: finds a column by any of several normalized names. */
export class RowReader {
  private readonly lookup = new Map<string, string>();

  constructor(sample: Row | undefined) {
    if (sample) for (const k of Object.keys(sample)) this.lookup.set(normalizeHeader(k), k);
  }

  has(...names: string[]): boolean {
    return names.some(n => this.lookup.has(n));
  }

  get(row: Row, ...names: string[]): unknown {
    for (const n of names) {
      const key = this.lookup.get(n);
      if (key === undefined) continue;
      const v = row[key];
      if (v !== undefined && v !== null && v !== '') return v;
    }
    return undefined;
  }
}

export function str(v: unknown): string {
  if (v === undefined || v === null) return '';
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(v);
  return String(v).trim();
}

export function num(v: unknown, fallback = 0): number {
  if (v === undefined || v === null || v === '') return fallback;
  const n = typeof v === 'number' ? v : Number(String(v).replace(',', '.').trim());
  return Number.isFinite(n) ? n : fallback;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Converts Excel serials, Date objects and common text formats to yyyy-mm-dd. */
export function toIsoDate(v: unknown): string | null {
  if (v === undefined || v === null || v === '') return null;
  if (v instanceof Date) {
    return isNaN(v.getTime()) ? null : `${v.getFullYear()}-${pad(v.getMonth() + 1)}-${pad(v.getDate())}`;
  }
  if (typeof v === 'number') {
    if (v < 20000 || v > 90000) return null;
    // Excel serial day -> calendar date (1899-12-30 epoch handles the 1900 leap-year bug)
    const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(v) * 86400000);
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  }
  const s = String(v).trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{1,2})[/.](\d{1,2})[/.](\d{4})/.exec(s);
  if (m) return `${m[3]}-${pad(+m[2])}-${pad(+m[1])}`;
  const t = new Date(s);
  return isNaN(t.getTime()) ? null : `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`;
}

export function toBool(v: unknown): boolean {
  if (v === true || v === 1) return true;
  if (typeof v === 'string') {
    return ['true', '1', 'yes', 'y', 'done', 'cut', 'oui'].includes(v.trim().toLowerCase());
  }
  return false;
}

export type FileKind = 'production' | 'carpenter' | 'unknown';

/** Decides what a spreadsheet contains from its headers so one Import button can serve both files. */
export function detectKind(rows: Row[]): FileKind {
  if (rows.length === 0) return 'unknown';
  const r = new RowReader(rows[0]);
  if (r.has('ncfileminute') && r.has('boxcode')) return 'production';
  if (r.has('cuttedstatus', 'carpenterstatus') && r.has('masterorderno', 'masterorder', 'masterordernumber')) {
    return 'carpenter';
  }
  if (r.has('ncfileminute')) return 'production';
  return 'unknown';
}
