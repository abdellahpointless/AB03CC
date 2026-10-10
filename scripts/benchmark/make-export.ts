/** Writes the Excel export exactly as the app's Export button would, for testing the comparison. */
import * as XLSX from 'xlsx';
import { defaultSettings } from '../../src/core/defaults';
import { buildWorkbook } from '../../src/core/export';
import { loadInputs, runApp } from './common';

const args = process.argv.slice(2);
const out = args[args.indexOf('--out') + 1];
const files = args.slice(args.indexOf('--') + 1);
const inp = loadInputs(files, 'src/data/builtin-part-times.json');
const settings = defaultSettings();
settings.calendar.startDate = '2026-10-09';
const plan = runApp(inp, settings);
XLSX.writeFile(buildWorkbook(plan, settings), out);
console.log('export written', out);
