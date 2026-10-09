import { WorkCalendar, formatClock } from '../calendar';
import { buildCarpenterMap, normalizeMo } from '../parse/carpenter';
import { compareByRules, decidingRule, type RankContext } from '../priority';
import type {
  Bottleneck,
  CarpenterMoInfo,
  CarpenterPart,
  Job,
  MachineConfig,
  MoSync,
  PlanKpis,
  PlanResult,
  PlannerSettings,
  ScheduledJob,
  UserLock,
  WaitingOnCarpenter,
} from '../types';
import { SimContext, simulateQueue, step, type MachineState, type QueueSim } from './simulate';

/* ------------------------------------------------------------------ */
/* Eligibility                                                         */
/* ------------------------------------------------------------------ */

export function isEligible(job: Job, machine: MachineConfig, s: PlannerSettings, ctx?: SimContext): boolean {
  if (machine.isDown) return false;
  let allowed = machine.allowedMaterials.includes(job.materialType);
  if (!allowed && s.allowHaas5Overflow && machine.overflowMaterials?.includes(job.materialType)) allowed = true;
  if (!allowed) return false;
  if (machine.maxNcMinutes && machine.maxNcMinutes > 0) {
    const perPiece =
      s.fanuc2UsesIdealMinutes || !ctx
        ? job.ncMinutes
        : ctx.duration(job, machine).durationMin / Math.max(1, job.qty);
    if (perPiece >= machine.maxNcMinutes) return false;
  }
  return true;
}

/* ------------------------------------------------------------------ */
/* Small deterministic PRNG so the same input always gives the same plan */
/* ------------------------------------------------------------------ */

function makeRandom(seed: number) {
  let x = seed >>> 0;
  return () => {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
    return x / 4294967296;
  };
}

interface Score {
  makespan: number;
  sumMo: number;
  setup: number;
}

function betterScore(a: Score, b: Score): boolean {
  if (a.makespan !== b.makespan) return a.makespan < b.makespan;
  if (a.sumMo < b.sumMo && a.setup <= b.setup) return true;
  return a.sumMo === b.sumMo && a.setup < b.setup;
}

function combine(evals: Iterable<QueueSim>): Score {
  let makespan = 0;
  let setup = 0;
  const moEnd = new Map<string, number>();
  for (const e of evals) {
    makespan = Math.max(makespan, e.finish);
    setup += e.setup;
    e.moEnd.forEach((v, k) => {
      if (v > (moEnd.get(k) ?? 0)) moEnd.set(k, v);
    });
  }
  let sumMo = 0;
  moEnd.forEach(v => (sumMo += v));
  return { makespan, sumMo, setup };
}

function moEndsOf(evals: Iterable<QueueSim>): Map<string, number> {
  const moEnd = new Map<string, number>();
  for (const e of evals)
    e.moEnd.forEach((v, k) => {
      if (v > (moEnd.get(k) ?? 0)) moEnd.set(k, v);
    });
  return moEnd;
}

const tieBreak = (a: Job, b: Job) =>
  a.matnr.localeCompare(b.matnr) ||
  a.materialNo.localeCompare(b.materialNo) ||
  a.materialType.localeCompare(b.materialType) ||
  a.ncMinutes - b.ncMinutes ||
  a.boxCode.localeCompare(b.boxCode) ||
  a.id.localeCompare(b.id);

/* ------------------------------------------------------------------ */
/* Main entry                                                          */
/* ------------------------------------------------------------------ */

export function planProduction(
  inputJobs: Job[],
  settings: PlannerSettings,
  locksIn: Record<string, UserLock> = {},
  carpenterParts: CarpenterPart[] = [],
): PlanResult {
  let locks = locksIn;
  const aliases = settings.materialAliases ?? {};
  const jobs: Job[] = inputJobs.map(j => (aliases[j.materialType] ? { ...j, materialType: aliases[j.materialType] } : j));

  // Rework events become new parts: they are produced in addition to the imported workload,
  // starting no earlier than the event and running for its length. They never add time to the original box.
  const reworkLocks: Record<string, UserLock> = {};
  const reworkJobs: Job[] = [];
  for (const ev of settings.timelineEvents) {
    if (ev.type !== 'rework' || ev.durationMinutes <= 0) continue;
    const src = ev.boxCode ? jobs.find(j => j.boxCode === ev.boxCode || j.id === ev.boxCode || j.orderNumber === ev.boxCode) : undefined;
    const lane = ev.machineId !== 'ALL' ? settings.machines.find(m => m.id === ev.machineId && !m.isDown) : undefined;
    const id = `rework-${ev.id}`;
    const material = src?.materialType ?? lane?.allowedMaterials[0] ?? 'ALU';
    reworkJobs.push({
      id,
      boxCode: src?.boxCode ?? ev.boxCode ?? 'RW',
      masterOrder: `RW-${src?.masterOrder ?? ev.id}`,
      orderNumber: `${src?.orderNumber ?? ev.id}-RW`,
      matnr: src?.matnr ?? 'REWORK',
      materialNo: src?.materialNo ?? 'UNKNOWN',
      materialType: material,
      ncMinutes: ev.durationMinutes,
      qty: 1,
      waitingDays: src?.waitingDays ?? 0,
      salesOrder: src?.salesOrder ?? '',
      customer: src?.customer ?? 'Rework',
      scheduleNo: src?.scheduleNo ?? null,
      plannedDate: src?.plannedDate ?? null,
      ocd: src?.ocd ?? null,
      dueDate: src?.dueDate ?? null,
      warehousePickDate: src?.warehousePickDate ?? 'rework',
      cuttingCount: 1,
      finishedCount: 0,
      boxRemaining: 1,
      erpMachine: null,
      productionStatus: null,
      discontinuedReason: null,
      discontinuedText: null,
      blocked: false,
      blockedReason: null,
      isRework: true,
    });
    reworkLocks[id] = { durationMin: ev.durationMinutes, startMinute: ev.startMinute, ...(lane ? { machine: lane.id } : {}) };
  }
  jobs.push(...reworkJobs);
  locks = { ...locks, ...reworkLocks };

  const active = settings.machines.filter(m => !m.isDown);
  const activeIds = new Set(active.map(m => m.id));
  const ctx = new SimContext(settings, active);
  const cal = new WorkCalendar(settings.calendar);

  for (const [id, lock] of Object.entries(locks)) {
    if (lock.durationMin && lock.durationMin > 0) ctx.manualDuration.set(id, lock.durationMin);
    if (lock.startMinute !== undefined && lock.startMinute >= 0) ctx.manualStart.set(id, lock.startMinute);
  }

  /* ---- carpenter join ------------------------------------------------ */
  const carpenter = buildCarpenterMap(
    carpenterParts,
    jobs.map(j => j.masterOrder),
    settings.carpenterCutColumn,
    settings.simulatedUncutMasterOrders,
  );
  const carpenterOf = (mo: string): CarpenterMoInfo | undefined => carpenter.map[normalizeMo(mo)];
  const carpenterBlocked = (mo: string) => Boolean(carpenterOf(mo)?.hasOpenParts);

  /* ---- classification ------------------------------------------------ */
  const exceptions: PlanResult['exceptions'] = {
    blocked: [],
    noEligibleMachine: [],
    outOfScope: [],
    manual30000: [],
    unpickedWarehouse: [],
  };
  const lockedBy = new Map<string, 'user' | 'erp'>();
  const lockedQueues: Record<string, Job[]> = {};
  active.forEach(m => (lockedQueues[m.id] = []));
  const free: Job[] = [];
  const outOfScope = new Set(settings.outOfScopeMachines);

  for (const job of jobs) {
    if (job.blocked) {
      exceptions.blocked.push(job);
      continue;
    }
    if (job.erpMachine && outOfScope.has(job.erpMachine)) {
      exceptions.outOfScope.push(job);
      continue;
    }
    if (!job.warehousePickDate) exceptions.unpickedWarehouse.push(job);

    const lock = locks[job.id];
    if (lock?.machine && activeIds.has(lock.machine)) {
      lockedBy.set(job.id, 'user');
      lockedQueues[lock.machine].push(job);
      continue;
    }
    if (settings.keepErpAssignments && job.erpMachine && activeIds.has(job.erpMachine)) {
      lockedBy.set(job.id, 'erp');
      lockedQueues[job.erpMachine].push(job);
      continue;
    }
    if (settings.excludeMasterOrders30000 && job.masterOrder.startsWith('30000')) {
      exceptions.manual30000.push(job);
      continue;
    }
    free.push(job);
  }

  /* ---- priority ranking ---------------------------------------------- */
  const partsLeft: Record<string, number> = {};
  for (const j of free) partsLeft[j.masterOrder] = (partsLeft[j.masterOrder] ?? 0) + 1;
  const rankCtx: RankContext = { partsLeft };
  const rules = settings.priorityRules;
  const byPriority = (a: Job, b: Job) => compareByRules(a, b, rules, rankCtx) || tieBreak(a, b);

  const allSchedulable = [...free, ...Object.values(lockedQueues).flat()].sort(byPriority);
  const rankOf = new Map<string, number>();
  allSchedulable.forEach((j, i) => rankOf.set(j.id, i + 1));
  for (const m of active) lockedQueues[m.id].sort((a, b) => rankOf.get(a.id)! - rankOf.get(b.id)!);

  /* ---- eligibility --------------------------------------------------- */
  const eligible = new Map<string, MachineConfig[]>();
  const plannable: Job[] = [];
  for (const j of free) {
    const list = active.filter(m => isEligible(j, m, settings, ctx));
    if (list.length === 0) exceptions.noEligibleMachine.push(j);
    else {
      eligible.set(j.id, list);
      plannable.push(j);
    }
  }

  /* ---- master order ordering ------------------------------------------ */
  const moParts = new Map<string, Job[]>();
  for (const j of [...plannable].sort(byPriority)) (moParts.get(j.masterOrder) ?? moParts.set(j.masterOrder, []).get(j.masterOrder)!).push(j);
  const firstSeen = new Map<string, number>();
  inputJobs.forEach((j, i) => !firstSeen.has(j.masterOrder) && firstSeen.set(j.masterOrder, i));

  let moOrder = [...moParts.keys()].sort((a, b) => {
    const c = compareByRules(moParts.get(a)![0], moParts.get(b)![0], rules, rankCtx);
    if (c !== 0) return c;
    if (settings.carpenterDelayMode !== 'off') {
      const ba = carpenterBlocked(a);
      const bb = carpenterBlocked(b);
      if (ba !== bb) return ba ? 1 : -1;
    }
    return (firstSeen.get(a) ?? 0) - (firstSeen.get(b) ?? 0);
  });

  if (settings.carpenterDelayMode === 'hard') moOrder = applyHardCarpenterDelay(moOrder, moParts, carpenterBlocked, settings, active.length);

  /* ---- assignment ------------------------------------------------------ */
  const queues: Record<string, Job[]> = {};
  const tails: Record<string, MachineState> = {};
  const finalLocked = new Set(lockedBy.keys());
  for (const m of active) {
    queues[m.id] = [...lockedQueues[m.id]];
    const state: MachineState = { t: 0, prev: null };
    for (const j of queues[m.id]) step(state, j, m, ctx, { respectManualStart: false });
    tails[m.id] = state;
  }

  const forced: Record<string, number> = {};
  const forcedOf = new Map<string, { machine: string; minutes: number }>();
  active.forEach(m => (forced[m.id] = 0));
  for (const j of plannable) {
    const el = eligible.get(j.id)!;
    if (el.length === 1) {
      const minutes = ctx.duration(j, el[0]).durationMin;
      forced[el[0].id] += minutes;
      forcedOf.set(j.id, { machine: el[0].id, minutes });
    }
  }

  const moEndSoFar = new Map<string, number>();
  for (const m of active) simulateQueue(queues[m.id], m, ctx).moEnd.forEach((v, k) => moEndSoFar.set(k, Math.max(v, moEndSoFar.get(k) ?? 0)));

  const prefPenalty = (job: Job, m: MachineConfig) => (m.minNcMinutesPref && job.ncMinutes < m.minNcMinutesPref ? 1 : 0);

  for (const mo of moOrder) {
    const parts = moParts.get(mo)!;
    for (const p of parts) {
      const f = forcedOf.get(p.id);
      if (f) forced[f.machine] -= f.minutes;
    }

    const evaluate = (assign: MachineConfig[]) => {
      const states: Record<string, MachineState> = {};
      let setup = 0;
      let pref = 0;
      let moEnd = moEndSoFar.get(mo) ?? 0;
      parts.forEach((p, i) => {
        const m = assign[i];
        const st = (states[m.id] ??= { ...tails[m.id] });
        const r = step(st, p, m, ctx, { respectManualStart: false });
        setup += r.setup;
        moEnd = Math.max(moEnd, r.endMinute);
        pref += prefPenalty(p, m);
      });
      let virtual = 0;
      let makespan = 0;
      let balance = 0;
      for (const m of active) {
        const fin = (states[m.id] ?? tails[m.id]).t;
        makespan = Math.max(makespan, fin);
        const v = fin + forced[m.id];
        virtual = Math.max(virtual, v);
        balance += v * v;
      }
      return [virtual, moEnd, setup, makespan, balance, pref];
    };

    const place = (p: Job, m: MachineConfig) => {
      const r = step(tails[m.id], p, m, ctx, { respectManualStart: false });
      queues[m.id].push(p);
      moEndSoFar.set(mo, Math.max(moEndSoFar.get(mo) ?? 0, r.endMinute));
    };

    if (parts.length <= 4) {
      // Small module: try every machine combination and keep the best.
      let best: MachineConfig[] = [];
      let bestScore: number[] | null = null;
      const combo: MachineConfig[] = [];
      const walk = (i: number) => {
        if (i === parts.length) {
          const score = evaluate(combo);
          if (!bestScore || lexLess(score, bestScore)) {
            bestScore = score;
            best = [...combo];
          }
          return;
        }
        for (const m of eligible.get(parts[i].id)!) {
          combo.push(m);
          walk(i + 1);
          combo.pop();
        }
      };
      walk(0);
      parts.forEach((p, i) => place(p, best[i]));
    } else {
      // Large module: place part by part, each on the machine that keeps the plan tightest.
      for (const p of parts) {
        let bestM = eligible.get(p.id)![0];
        let bestScore: number[] | null = null;
        for (const m of eligible.get(p.id)!) {
          const trial = { ...tails[m.id] };
          const r = step(trial, p, m, ctx, { respectManualStart: false });
          let virtual = 0;
          let balance = 0;
          for (const mm of active) {
            const v = (mm.id === m.id ? trial.t : tails[mm.id].t) + forced[mm.id];
            virtual = Math.max(virtual, v);
            balance += v * v;
          }
          const score = [virtual, r.endMinute, r.setup, 0, balance, prefPenalty(p, m)];
          if (!bestScore || lexLess(score, bestScore)) {
            bestScore = score;
            bestM = m;
          }
        }
        place(p, bestM);
      }
    }
  }

  /* ---- sequencing: finish modules as early as possible ------------------ */
  const isLocked = (j: Job) => finalLocked.has(j.id);
  const evalAll = () => {
    const out = new Map<string, QueueSim>();
    for (const m of active) out.set(m.id, simulateQueue(queues[m.id], m, ctx));
    return out;
  };
  const moIndex = new Map(moOrder.map((m, i) => [m, i]));

  for (let pass = 0; pass < 8; pass++) {
    const ends = moEndsOf(evalAll().values());
    let changed = false;
    for (const m of active) {
      const q = queues[m.id];
      const head = q.filter(isLocked);
      const rest = q.filter(j => !isLocked(j));
      if (rest.length <= 1) continue;
      const sorted = [...rest].sort(
        (a, b) =>
          (ends.get(a.masterOrder) ?? 0) - (ends.get(b.masterOrder) ?? 0) ||
          (moIndex.get(a.masterOrder) ?? 0) - (moIndex.get(b.masterOrder) ?? 0) ||
          tieBreak(a, b),
      );
      if (sorted.some((j, i) => j !== rest[i])) {
        queues[m.id] = [...head, ...sorted];
        changed = true;
      }
    }
    if (!changed) break;
  }

  /* ---- polish (seeded local search) ------------------------------------- */
  polish(active, queues, isLocked, eligible, ctx, plannable.length);

  /* ---- pinned start times: slot manual-start jobs by time ---------------- */
  for (const m of active) queues[m.id] = slotPinnedJobs(queues[m.id], m, ctx);

  /* ---- final simulation & result objects -------------------------------- */
  const finalQueues: Record<string, ScheduledJob[]> = {};
  const finish: Record<string, number> = {};
  const loads: PlanKpis['loadPerMachine'] = {};
  let totalSetup = 0;
  let totalMachining = 0;
  let cautiousExtraMax = 0;
  let unsortedSetup = 0;
  const firstShiftEnd = settings.calendar.continuous247 ? 8 * 60 : settings.calendar.hoursPerShift * 60;
  let boxesClosed = 0;
  let lateJobs = 0;

  const rankFor = (j: Job) => rankOf.get(j.id) ?? 0;

  for (const m of active) {
    const sim = simulateQueue(queues[m.id], m, ctx, { record: true, respectManualStart: true });
    finish[m.id] = sim.finish;
    let cautiousExtra = 0;
    const items: ScheduledJob[] = sim.steps!.map((st, idx) => {
      const d = ctx.duration(st.job, m);
      cautiousExtra += d.cautiousDurationMin - d.durationMin;
      const closesBox = st.job.boxRemaining <= 1;
      const blockedByCarpenter = carpenterBlocked(st.job.masterOrder);
      if (closesBox && st.endMinute <= firstShiftEnd && !blockedByCarpenter) boxesClosed++;
      const startTime = cal.toIso(st.startMinute);
      const endTime = cal.toIso(st.endMinute, true);
      const isLate = Boolean(st.job.dueDate && endTime.slice(0, 10) > st.job.dueDate);
      if (isLate) lateJobs++;
      totalSetup += st.setup;
      totalMachining += st.durationMin;
      return {
        job: st.job,
        machineId: m.id,
        sequence: idx + 1,
        setupBefore: st.setup,
        startMinute: st.startMinute,
        endMinute: st.endMinute,
        durationMin: st.durationMin,
        cautiousDurationMin: d.cautiousDurationMin,
        idealMinutes: d.idealMinutes,
        efficiencyPercent: d.efficiencyPercent,
        efficiencySource: d.source,
        materialOffset: d.materialOffset,
        segments: st.segments,
        startTime,
        endTime,
        rank: rankFor(st.job),
        decidingRule: decidingRule(st.job, rules, rankCtx, rankFor(st.job)),
        isLate,
        closesBox,
        userLocked: lockedBy.get(st.job.id) === 'user',
        erpLocked: lockedBy.get(st.job.id) === 'erp',
        manualDuration: ctx.manualDuration.has(st.job.id),
        manualStart: ctx.manualStart.has(st.job.id),
        carpenterOpen: blockedByCarpenter,
      };
    });
    finalQueues[m.id] = items;
    cautiousExtraMax = Math.max(cautiousExtraMax, sim.finish + cautiousExtra);
    loads[m.id] = {
      jobs: items.length,
      machineMinutes: items.reduce((a, i) => a + i.durationMin, 0),
      setupMinutes: items.reduce((a, i) => a + i.setupBefore, 0),
    };
    // baseline: same jobs run in plain priority order
    const baseline = [...queues[m.id]].sort((a, b) => rankFor(a) - rankFor(b));
    unsortedSetup += simulateQueue(baseline, m, ctx).setup;
  }

  /* ---- master order sync & carpenter waiting list ------------------------ */
  const byMo = new Map<string, ScheduledJob[]>();
  Object.values(finalQueues)
    .flat()
    .forEach(i => (byMo.get(i.job.masterOrder) ?? byMo.set(i.job.masterOrder, []).get(i.job.masterOrder)!).push(i));

  const moSync: Record<string, MoSync> = {};
  const waiting: WaitingOnCarpenter[] = [];
  let syncCount = 0;
  let sumMo = 0;
  byMo.forEach((items, mo) => {
    const ends = items.map(i => i.endMinute);
    const first = Math.min(...ends);
    const last = Math.max(...ends);
    const lastItem = items.find(i => i.endMinute === last)!;
    const blocked = carpenterBlocked(mo);
    const sync = last - first <= settings.syncToleranceMin && !blocked;
    if (sync) syncCount++;
    sumMo += last;
    moSync[mo] = {
      masterOrder: mo,
      customer: lastItem.job.customer,
      parts: items.length,
      firstFinish: first,
      lastFinish: last,
      spread: last - first,
      synchronized: sync,
      machines: [...new Set(items.map(i => i.machineId))],
      finishTime: formatClock(lastItem.endTime),
      carpenterBlocked: blocked,
    };
    const info = carpenterOf(mo);
    if (blocked && info) {
      waiting.push({
        masterOrder: mo,
        customer: lastItem.job.customer,
        boxCodes: items.map(i => i.job.boxCode),
        openParts: info.openPartsList,
        totalParts: info.totalParts,
        openQty: info.openQty,
        lastFinishMinute: last,
        lastFinishTime: lastItem.endTime,
        hasAlert: info.hasMaterialAlert,
      });
    }
  });
  waiting.sort((a, b) => a.lastFinishMinute - b.lastFinishMinute);

  /* ---- kpis ----------------------------------------------------------------- */
  const makespan = Math.max(0, ...Object.values(finish));
  const util: Record<string, number> = {};
  const avgLoad = totalMachining / Math.max(1, active.length);
  const bottlenecks: Bottleneck[] = [];
  for (const m of active) {
    util[m.id] = makespan > 0 ? Math.round((loads[m.id].machineMinutes / makespan) * 100) : 0;
    const load = loads[m.id].machineMinutes + loads[m.id].setupMinutes;
    if (avgLoad > 0 && load > avgLoad * 1.3 && load > 300) {
      const pct = Math.round((load / avgLoad) * 100);
      bottlenecks.push({
        machineId: m.id,
        loadMinutes: load,
        loadPercent: pct,
        severity: load > avgLoad * 1.5 ? 'critical' : 'warning',
        message: `${m.name} carries ${pct}% of the average machine load.`,
      });
    }
  }
  const plannedJobs = Object.values(finalQueues).reduce((a, q) => a + q.length, 0);
  const kpis: PlanKpis = {
    plannedJobs,
    plannedHours: Math.round((totalMachining / 60) * 10) / 10,
    changeoverMinutes: totalSetup,
    setupSavedMinutes: Math.max(0, unsortedSetup - totalSetup),
    overdueJobs: lateJobs,
    boxesClosedFirstShift: boxesClosed,
    synchronizedMos: syncCount,
    totalMos: byMo.size,
    makespanMinutes: makespan,
    cautiousMakespanMinutes: Math.max(makespan, cautiousExtraMax),
    sumMoCompletion: sumMo,
    avgMoCompletion: byMo.size ? Math.round((sumMo / byMo.size) * 10) / 10 : 0,
    waitingOnCarpenter: waiting.length,
    finishPerMachine: finish,
    loadPerMachine: loads,
    utilizationPerMachine: util,
    bottlenecks,
  };

  return {
    generatedAt: new Date().toISOString(),
    queues: finalQueues,
    moSync,
    carpenter: carpenter.map,
    carpenterReport: carpenterParts.length || settings.simulatedUncutMasterOrders.length ? carpenter.report : null,
    waitingOnCarpenter: waiting,
    exceptions,
    kpis,
    summary: `Scheduled ${plannedJobs} jobs on ${active.length} machines; ${syncCount} of ${byMo.size} master orders finish together.`,
  };

}

function lexLess(a: number[], b: number[]) {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] < b[i];
  return false;
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function applyHardCarpenterDelay(
  order: string[],
  parts: Map<string, Job[]>,
  blocked: (mo: string) => boolean,
  s: PlannerSettings,
  machineCount: number,
): string[] {
  const maxDelay = Math.max(0, s.carpenterMaxDelayHours) * 60;
  const out: string[] = [];
  const deferred: Array<{ mo: string; at: number }> = [];
  let elapsed = 0; // approximate machine-time consumed so far
  const minutesOf = (mo: string) =>
    parts.get(mo)!.reduce((a, j) => a + j.ncMinutes * j.qty, 0) / Math.max(1, machineCount);

  const release = () => {
    for (let i = 0; i < deferred.length; ) {
      if (elapsed - deferred[i].at >= maxDelay) {
        const [d] = deferred.splice(i, 1);
        out.push(d.mo);
        elapsed += minutesOf(d.mo);
      } else i++;
    }
  };
  for (const mo of order) {
    release();
    if (blocked(mo)) deferred.push({ mo, at: elapsed });
    else {
      out.push(mo);
      elapsed += minutesOf(mo);
    }
  }
  release();
  out.push(...deferred.map(d => d.mo));
  return out;
}

/** Jobs with a user-pinned start minute are slotted into the queue where the clock reaches their start. */
function slotPinnedJobs(queue: Job[], machine: MachineConfig, ctx: SimContext): Job[] {
  const pinned = queue.filter(j => ctx.manualStart.has(j.id)).sort((a, b) => ctx.manualStart.get(a.id)! - ctx.manualStart.get(b.id)!);
  if (pinned.length === 0) return queue;
  const rest = queue.filter(j => !ctx.manualStart.has(j.id));
  const out: Job[] = [];
  const state: MachineState = { t: 0, prev: null };
  while (pinned.length || rest.length) {
    const nextPinned = pinned[0];
    const takePinned = nextPinned && (rest.length === 0 || state.t >= ctx.manualStart.get(nextPinned.id)!);
    const job = takePinned ? pinned.shift()! : rest.shift()!;
    out.push(job);
    step(state, job, machine, ctx, { respectManualStart: true });
  }
  return out;
}

function polish(
  active: MachineConfig[],
  queues: Record<string, Job[]>,
  isLocked: (j: Job) => boolean,
  eligible: Map<string, MachineConfig[]>,
  ctx: SimContext,
  freeCount: number,
) {
  if (active.length === 0 || freeCount < 2) return;
  const rand = makeRandom(42);
  const sims = new Map<string, QueueSim>();
  for (const m of active) sims.set(m.id, simulateQueue(queues[m.id], m, ctx));
  let best = combine(sims.values());
  const iterations = Math.min(6000, Math.max(300, freeCount * 12));
  const canHost = (j: Job, m: MachineConfig) => eligible.get(j.id)?.some(x => x.id === m.id) ?? false;

  const tryApply = (changes: Record<string, Job[]>) => {
    const trial = new Map(sims);
    for (const [id, q] of Object.entries(changes)) trial.set(id, simulateQueue(q, active.find(m => m.id === id)!, ctx));
    const score = combine(trial.values());
    if (!betterScore(score, best)) return false;
    for (const [id, q] of Object.entries(changes)) queues[id] = q;
    trial.forEach((v, k) => sims.set(k, v));
    best = score;
    return true;
  };

  for (let it = 0; it < iterations; it++) {
    const sources = active.filter(m => queues[m.id].some(j => !isLocked(j)));
    if (sources.length === 0) return;
    const src = sources[Math.floor(rand() * sources.length)];
    const q1 = queues[src.id];
    const movable = q1.map((job, idx) => ({ job, idx })).filter(x => !isLocked(x.job));
    const pick = movable[Math.floor(rand() * movable.length)];
    const roll = rand();

    if (roll < 0.35) {
      const dests = active.filter(m => m.id !== src.id && canHost(pick.job, m));
      if (!dests.length) continue;
      const dst = dests[Math.floor(rand() * dests.length)];
      const q2 = queues[dst.id];
      const lockedHead = q2.filter(isLocked).length;
      const pos = lockedHead + Math.floor(rand() * (q2.length - lockedHead + 1));
      const n1 = q1.filter((_, i) => i !== pick.idx);
      const n2 = [...q2.slice(0, pos), pick.job, ...q2.slice(pos)];
      tryApply({ [src.id]: n1, [dst.id]: n2 });
    } else if (roll < 0.7) {
      const others = active.filter(m => m.id !== src.id);
      if (!others.length) continue;
      const dst = others[Math.floor(rand() * others.length)];
      if (!canHost(pick.job, dst)) continue;
      const q2 = queues[dst.id];
      const cands = q2.map((job, idx) => ({ job, idx })).filter(x => !isLocked(x.job) && canHost(x.job, src));
      if (!cands.length) continue;
      const other = cands[Math.floor(rand() * cands.length)];
      const n1 = [...q1];
      const n2 = [...q2];
      n1[pick.idx] = other.job;
      n2[other.idx] = pick.job;
      tryApply({ [src.id]: n1, [dst.id]: n2 });
    } else if (movable.length > 1) {
      const other = movable[Math.floor(rand() * movable.length)];
      if (other.idx === pick.idx) continue;
      const n = [...q1];
      [n[pick.idx], n[other.idx]] = [n[other.idx], n[pick.idx]];
      tryApply({ [src.id]: n });
    }
  }
}
