/** Writes the Excel export exactly as the app's Export button would, for testing the comparison. */
import * as XLSX from 'xlsx';
import { buildWorkbook } from '../../src/core/export';
import { parseFlags, prepare } from './common';

const flags = parseFlags();
const out = flags.get('out', 'plan.xlsx')!;
const { plan, settings } = prepare(flags);
XLSX.writeFile(buildWorkbook(plan, settings), out);
console.log('export written', out);
