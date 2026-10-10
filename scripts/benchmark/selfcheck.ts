import { defaultSettings } from '../../src/core/defaults';
import { evaluate, validate } from '../../src/core/optimizer/evaluate';
import { makeQueueSearch, makeRng } from '../../src/core/optimizer/search';
import { instanceFromPlan, loadInputs, runApp } from './common';

const inp = loadInputs(process.argv.slice(2), 'src/data/builtin-part-times.json');
const settings = defaultSettings();
settings.calendar.startDate = '2026-10-09';
const plan = runApp(inp, settings);
const { inst, appQueues } = instanceFromPlan(plan, settings, inp.partTimes);
const rng = makeRng(5);
const s = makeQueueSearch(inst, appQueues);
console.log('initial check:', s.selfCheck());
const T0 = s.sampleTemperature(rng);
console.log('median uphill delta', T0, 'check after sampling:', s.selfCheck());
let bad = 0;
for (let round = 0; round < 40; round++) {
  s.anneal(5000, T0, T0 / 50, rng);
  const msg = s.selfCheck();
  if (msg) {
    bad++;
    console.log('MISMATCH round', round, msg);
    break;
  }
}
const q = s.queues();
console.log('validate:', validate(inst, q), 'bad rounds', bad);
const m = evaluate(inst, q);
console.log('sumC', m.sumC, 'makespan', m.makespan, 'setup', m.setupTotal);
const t0 = Date.now();
s.anneal(200000, T0 * 0.3, T0 * 0.01, rng);
console.log('200k moves in', Date.now() - t0, 'ms; check', s.selfCheck(), 'best', s.best().cost.toFixed(0));
