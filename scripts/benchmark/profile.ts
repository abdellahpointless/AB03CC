/** Times the stages of the optimizer on a workload: where do the seconds go? */
import { evaluate, validate } from '../../src/core/optimizer/evaluate';
import { makeDecoder } from '../../src/core/optimizer/decode';
import { DEFAULT_WEIGHTS, annealOrder, makeQueueSearch, makeRng, startingOrders } from '../../src/core/optimizer/search';
import { parseFlags, prepare } from './common';

const flags = parseFlags();
const { inst, appQueues } = prepare(flags);
const rng = makeRng(Number(flags.get('seed', '1')));
const orderIters = Number(flags.get('order-iters', '5000'));
const queueIters = Number(flags.get('iters', '300000'));
const ms = () => Number(process.hrtime.bigint() / 1_000_000n);
let t = ms();
const lap = (what: string) => {
  const now = ms();
  console.log(`${what.padEnd(34)} ${now - t} ms`);
  t = now;
};
const dec = makeDecoder(inst);
const starts = startingOrders(inst);
lap('starting orders');
const cands: number[][][] = [appQueues];
for (const s of starts) {
  const r = annealOrder(inst, s, orderIters, rng);
  cands.push(dec.decode(r.order));
  lap(`order SA ${orderIters} its -> ${r.cost.toFixed(0)}`);
}
const scored = cands.map(q => ({ q, c: evaluate(inst, q).sumW })).sort((a, b) => a.c - b.c);
console.log('candidate costs', scored.map(x => x.c.toFixed(0)).join(' '));
const search = makeQueueSearch(inst, scored[0].q, DEFAULT_WEIGHTS);
lap('queue search setup');
const T0 = search.sampleTemperature(rng) * 0.5;
lap('sample temperature');
search.anneal(queueIters, Math.max(1, T0), Math.max(0.05, T0 / 300), rng);
lap(`queue SA ${queueIters} its`);
const afterSA = search.best();
console.log('after SA', evaluate(inst, afterSA.queues).sumC);
search.load(afterSA.queues);
const improvements = search.descend(4, rng);
lap(`descend (${improvements} improvements)`);
const fin = search.best();
console.log('final', evaluate(inst, fin.queues).sumC, validate(inst, fin.queues).length ? 'INVALID' : 'valid');
