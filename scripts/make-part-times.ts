/**
 * Builds src/data/builtin-part-times.json from the parts time list, so a private build can ship it.
 *   npx tsx scripts/make-part-times.ts <parts_time_list.xlsx>
 * The output is gitignored on purpose: it is company data and the repository may be public.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import { parsePartTimes } from '../src/core/parse/partTimes';
import { detectKind, rowsFromBuffer } from '../src/core/parse/workbook';

const path = process.argv[2];
if (!path) {
  console.error('usage: make-part-times <parts_time_list.xlsx>');
  process.exit(1);
}
const buf = readFileSync(path);
const rows = rowsFromBuffer(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength));
if (detectKind(rows) !== 'parttimes') {
  console.error('This file does not look like the parts time list (Material Number + Time per Part).');
  process.exit(1);
}
const { entries, skipped } = parsePartTimes(rows);
mkdirSync('src/data', { recursive: true });
writeFileSync('src/data/builtin-part-times.json', JSON.stringify({ file: basename(path).replace(/^[0-9a-f]{8}-/, ''), entries }));
console.log(`wrote ${entries.length} parts (${skipped} rows skipped)`);
