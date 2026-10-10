import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { demoCarpenterParts, demoJobs } from '../core/demo';
import { defaultSettings, mergeSettings } from '../core/defaults';
import { parseCarpenter } from '../core/parse/carpenter';
import {
  buildPartTimeIndex,
  parsePartTimes,
  partTimeCoverage,
  pickPartTimes,
  type PartTimeCoverage,
  type PartTimeEntry,
} from '../core/parse/partTimes';
import { missingProductionColumns, parseProduction } from '../core/parse/production';
import { detectKind, readRows } from '../core/parse/workbook';
import { planProduction } from '../core/scheduler/plan';
import PlanWorker from '../core/worker?worker&inline';
import type { PlanReply, PlanRequest } from '../core/worker';
import type {
  CarpenterPart,
  ImportReport,
  Job,
  PlanResult,
  PlannerSettings,
  TimelineEvent,
  UserLock,
} from '../core/types';

const KEYS = {
  settings: 'cnc-planner.v2.settings',
  locks: 'cnc-planner.v2.locks',
  jobs: 'cnc-planner.v2.jobs',
  report: 'cnc-planner.v2.report',
  carpenter: 'cnc-planner.v2.carpenter',
  partTimes: 'cnc-planner.v2.parttimes',
};

interface StoredPartList {
  file: string | null;
  entries: PartTimeEntry[];
}

/**
 * Optional list shipped with a private build (src/data/builtin-part-times.json, never committed).
 * Without that file the glob is empty and the list has to be imported once.
 */
const builtinList: StoredPartList | null =
  (Object.values(import.meta.glob<StoredPartList>('../data/builtin-part-times.json', { eager: true, import: 'default' }))[0] as
    | StoredPartList
    | undefined) ?? null;

export interface PartListInfo {
  source: 'builtin' | 'imported' | 'none';
  file: string | null;
  count: number;
  hasBuiltin: boolean;
  builtinCount: number;
}

function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function save(key: string, value: unknown) {
  try {
    if (value === null || value === undefined) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage full or unavailable: the app keeps working in memory */
  }
}

export interface Toast {
  id: number;
  tone: 'ok' | 'warn' | 'error';
  text: string;
}

export interface ImportOutcome {
  ok: boolean;
  kind: 'production' | 'carpenter' | 'parttimes' | 'unknown';
  message: string;
}

interface Store {
  jobs: Job[];
  report: ImportReport | null;
  carpenterParts: CarpenterPart[];
  carpenterFile: string | null;
  settings: PlannerSettings;
  locks: Record<string, UserLock>;
  plan: PlanResult | null;
  previousPlan: PlanResult | null;
  /** waiting for the first plan of this request */
  planning: boolean;
  /** a quick plan is on screen and the optimizer is still improving it */
  improving: boolean;
  /** how far the optimizer is (0..1) */
  progress: number;
  planError: string | null;
  toasts: Toast[];
  partList: PartListInfo;
  partCoverage: PartTimeCoverage;

  importFile(file: File): Promise<ImportOutcome>;
  loadDemo(): void;
  clearData(): void;
  clearCarpenter(): void;
  clearImportedPartList(): void;
  updateSettings(patch: Partial<PlannerSettings> | ((s: PlannerSettings) => PlannerSettings)): void;
  resetSettings(): void;
  setLock(jobId: string, patch: Partial<UserLock>): void;
  clearLock(jobId: string): void;
  clearAllLocks(): void;
  setPartEfficiency(jobIds: string[], percent: number | undefined): void;
  saveEvent(event: TimelineEvent): void;
  removeEvent(id: string): void;
  replanNow(): void;
  notify(text: string, tone?: Toast['tone']): void;
  dismissToast(id: number): void;
}

const Ctx = createContext<Store | null>(null);

export function useStore(): Store {
  const v = useContext(Ctx);
  if (!v) throw new Error('useStore outside provider');
  return v;
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [jobs, setJobs] = useState<Job[]>(() => load<Job[]>(KEYS.jobs, []));
  const [report, setReport] = useState<ImportReport | null>(() => load<ImportReport | null>(KEYS.report, null));
  const [carpenter, setCarpenter] = useState<{ parts: CarpenterPart[]; file: string | null }>(() =>
    load(KEYS.carpenter, { parts: [], file: null }),
  );
  const [settings, setSettings] = useState<PlannerSettings>(() => mergeSettings(load(KEYS.settings, null)));
  const [locks, setLocks] = useState<Record<string, UserLock>>(() => load(KEYS.locks, {}));
  const [plan, setPlan] = useState<PlanResult | null>(null);
  const [previousPlan, setPreviousPlan] = useState<PlanResult | null>(null);
  const [planning, setPlanning] = useState(false);
  const [improving, setImproving] = useState(false);
  const [progress, setProgress] = useState(0);
  const [planError, setPlanError] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [importedList, setImportedList] = useState<StoredPartList | null>(() => load<StoredPartList | null>(KEYS.partTimes, null));

  const activeList = importedList ?? builtinList;
  const partIndex = useMemo(() => buildPartTimeIndex(activeList?.entries ?? []), [activeList]);
  const partTimes = useMemo(() => pickPartTimes(partIndex, jobs), [partIndex, jobs]);
  const partCoverage = useMemo(() => partTimeCoverage(partIndex, jobs), [partIndex, jobs]);
  const partList: PartListInfo = useMemo(
    () => ({
      source: importedList ? 'imported' : builtinList ? 'builtin' : 'none',
      file: activeList?.file ?? null,
      count: activeList?.entries.length ?? 0,
      hasBuiltin: Boolean(builtinList),
      builtinCount: builtinList?.entries.length ?? 0,
    }),
    [importedList, activeList],
  );
  const jobsRef = useRef<Job[]>(jobs);
  jobsRef.current = jobs;

  const toastId = useRef(0);
  const notify = useCallback((text: string, tone: Toast['tone'] = 'ok') => {
    const id = ++toastId.current;
    setToasts(t => [...t, { id, tone, text }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), tone === 'error' ? 8000 : 4500);
  }, []);
  const dismissToast = useCallback((id: number) => setToasts(t => t.filter(x => x.id !== id)), []);

  /* ---- persistence ---- */
  useEffect(() => save(KEYS.settings, settings), [settings]);
  useEffect(() => save(KEYS.locks, locks), [locks]);
  useEffect(() => save(KEYS.jobs, jobs.length ? jobs : null), [jobs]);
  useEffect(() => save(KEYS.report, report), [report]);
  useEffect(() => save(KEYS.carpenter, carpenter.parts.length ? carpenter : null), [carpenter]);
  useEffect(() => save(KEYS.partTimes, importedList), [importedList]);

  /* ---- planning (web worker with synchronous fallback) ---- */
  const workerRef = useRef<Worker | null>(null);
  const requestId = useRef(0);
  const planRef = useRef<PlanResult | null>(null);
  const resetPrevious = useRef(true);
  planRef.current = plan;

  const busy = useRef(false); // a request is still being worked on by the current worker

  const shownFor = useRef(0); // the request whose plan is on screen

  const accept = useCallback((result: PlanResult, requestIdOf: number) => {
    setPlanError(null);
    // "Previous plan" means the plan from before the change: the quick and the optimized plan of one request share it
    if (shownFor.current !== requestIdOf) setPreviousPlan(resetPrevious.current ? null : planRef.current);
    shownFor.current = requestIdOf;
    resetPrevious.current = false;
    setPlan(result);
  }, []);

  const spawnWorker = useCallback((): Worker | null => {
    try {
      const w = new PlanWorker();
      w.onmessage = (e: MessageEvent<PlanReply>) => {
        const m = e.data;
        if (m.id !== requestId.current) return; // stale result of a request that was replaced
        if ('progress' in m) {
          setProgress(m.progress);
          return;
        }
        if ('error' in m) {
          busy.current = false;
          setPlanning(false);
          setImproving(false);
          setPlanError(m.error);
          return;
        }
        setPlanning(false);
        accept(m.plan, m.id);
        if (m.final) {
          busy.current = false;
          setImproving(false);
          setProgress(1);
        } else {
          setImproving(true);
        }
      };
      w.onerror = () => {
        // the worker died: later requests run on the main thread, and this one is reported instead of hanging
        workerRef.current = null;
        if (busy.current) setPlanError('The background planner stopped unexpectedly. Press Re-optimize to plan again.');
        busy.current = false;
        setPlanning(false);
        setImproving(false);
      };
      return w;
    } catch {
      return null;
    }
  }, [accept]);

  useEffect(() => {
    workerRef.current = spawnWorker();
    return () => workerRef.current?.terminate();
  }, [spawnWorker]);

  const lastJobs = useRef<Job[] | null>(null);
  const replan = useCallback(() => {
    if (jobs.length === 0) {
      requestId.current++; // whatever a worker is still computing is no longer wanted
      if (workerRef.current && busy.current) {
        workerRef.current.terminate();
        workerRef.current = spawnWorker();
        busy.current = false;
      }
      setPlan(null);
      setPreviousPlan(null);
      setPlanning(false);
      setImproving(false);
      return;
    }
    const id = ++requestId.current;
    const req: PlanRequest = { id, jobs, settings, locks, carpenterParts: carpenter.parts, partTimes };
    setPlanning(true);
    setImproving(false);
    setProgress(0);
    // The search runs in one go and cannot be interrupted, so a new request throws the busy worker away.
    if (workerRef.current && busy.current) {
      workerRef.current.terminate();
      workerRef.current = spawnWorker();
    }
    if (workerRef.current) {
      busy.current = true;
      workerRef.current.postMessage(req);
    } else {
      // Fallback: run on the main thread after paint. Without a worker the screen would freeze while the optimizer
      // works, so it only gets its quickest effort here.
      setTimeout(() => {
        if (id !== requestId.current) return;
        try {
          accept(planProduction(jobs, { ...settings, planningEffort: 'quick' }, locks, carpenter.parts, partTimes), id);
        } catch (err) {
          setPlanError(err instanceof Error ? err.message : String(err));
        }
        setPlanning(false);
      }, 0);
    }
  }, [jobs, settings, locks, carpenter.parts, partTimes, spawnWorker, accept]);

  useEffect(() => {
    if (lastJobs.current !== jobs) {
      lastJobs.current = jobs;
      resetPrevious.current = true;
    }
    const t = setTimeout(replan, 120);
    return () => clearTimeout(t);
  }, [replan, jobs]);

  /* ---- actions ---- */
  const importFile = useCallback(
    async (file: File): Promise<ImportOutcome> => {
      try {
        const rows = await readRows(file);
        if (rows.length === 0) return { ok: false, kind: 'unknown', message: `"${file.name}" has no data rows.` };
        const kind = detectKind(rows);
        if (kind === 'production') {
          const missing = missingProductionColumns(rows);
          if (missing.length) return { ok: false, kind, message: `Missing required columns: ${missing.join(', ')}` };
          const parsed = parseProduction(rows, file.name);
          setJobs(parsed.jobs);
          setReport(parsed.report);
          setLocks({});
          return { ok: true, kind, message: `Loaded ${parsed.jobs.length} production rows from ${file.name}.` };
        }
        if (kind === 'carpenter') {
          const parsed = parseCarpenter(rows);
          if (parsed.parts.length === 0) return { ok: false, kind, message: 'No master order numbers found in the carpenter list.' };
          setCarpenter({ parts: parsed.parts, file: file.name });
          return {
            ok: true,
            kind,
            message: `Loaded ${parsed.parts.length} carpenter parts across ${parsed.uniqueMasterOrders} master orders.`,
          };
        }
        if (kind === 'parttimes') {
          const parsed = parsePartTimes(rows);
          if (parsed.entries.length === 0) return { ok: false, kind, message: 'No usable rows (material number + time per part) found in the parts time list.' };
          setImportedList({ file: file.name, entries: parsed.entries });
          const cov = partTimeCoverage(buildPartTimeIndex(parsed.entries), jobsRef.current);
          const tail = cov.jobs ? ` ${cov.measuredParts} of ${cov.uniqueParts} parts in the current workload have a real time.` : '';
          return { ok: true, kind, message: `Loaded real times for ${parsed.entries.length.toLocaleString()} parts from ${file.name}.${tail}` };
        }
        return {
          ok: false,
          kind,
          message: `Could not recognise "${file.name}". Expected a production export (Box Code, Nc File Minute...), a carpenter list (Master Order No, Cutted Status...) or the parts time list (Material Number, Time per Part).`,
        };
      } catch (err) {
        return { ok: false, kind: 'unknown', message: `Failed to read "${file.name}": ${err instanceof Error ? err.message : err}` };
      }
    },
    [],
  );

  const loadDemo = useCallback(() => {
    const demo = demoJobs();
    setJobs(demo);
    setReport({
      fileName: 'Demo data',
      totalRows: demo.length,
      uniqueOrders: demo.length,
      uniqueMasterOrders: new Set(demo.map(j => j.masterOrder)).size,
      uniqueMatnr: new Set(demo.map(j => j.matnr)).size,
      assignedInErp: demo.filter(j => j.erpMachine).length,
      unassigned: demo.filter(j => !j.erpMachine).length,
      unassignedMinutes: demo.filter(j => !j.erpMachine).reduce((a, j) => a + j.ncMinutes * j.qty, 0),
      erpLoads: {},
      materialCounts: {},
      warnings: [],
    });
    setCarpenter({ parts: demoCarpenterParts(demo), file: 'Demo carpenter list' });
    setLocks({});
  }, []);

  const clearData = useCallback(() => {
    setJobs([]);
    setReport(null);
    setCarpenter({ parts: [], file: null });
    setLocks({});
  }, []);

  const store = useMemo<Store>(
    () => ({
      jobs,
      report,
      carpenterParts: carpenter.parts,
      carpenterFile: carpenter.file,
      settings,
      locks,
      plan,
      previousPlan,
      planning,
      improving,
      progress,
      planError,
      toasts,
      partList,
      partCoverage,
      importFile,
      loadDemo,
      clearData,
      clearCarpenter: () => setCarpenter({ parts: [], file: null }),
      clearImportedPartList: () => setImportedList(null),
      updateSettings: patch => setSettings(s => mergeSettings(typeof patch === 'function' ? patch(s) : { ...s, ...patch })),
      resetSettings: () => setSettings(defaultSettings()),
      setLock: (jobId, patch) =>
        setLocks(l => {
          const merged = Object.fromEntries(Object.entries({ ...l[jobId], ...patch }).filter(([, v]) => v !== undefined)) as UserLock;
          const { [jobId]: _old, ...rest } = l;
          return Object.keys(merged).length ? { ...rest, [jobId]: merged } : rest;
        }),
      clearLock: jobId =>
        setLocks(l => {
          const { [jobId]: _removed, ...rest } = l;
          return rest;
        }),
      clearAllLocks: () => setLocks({}),
      setPartEfficiency: (ids, percent) =>
        setSettings(s => {
          const next = { ...s.partEfficiencyOverrides };
          ids.forEach(id => (percent && percent > 0 ? (next[id] = percent) : delete next[id]));
          return { ...s, partEfficiencyOverrides: next };
        }),
      saveEvent: event =>
        setSettings(s => {
          const exists = s.timelineEvents.some(e => e.id === event.id);
          return {
            ...s,
            timelineEvents: exists ? s.timelineEvents.map(e => (e.id === event.id ? event : e)) : [...s.timelineEvents, event],
          };
        }),
      removeEvent: id => setSettings(s => ({ ...s, timelineEvents: s.timelineEvents.filter(e => e.id !== id) })),
      replanNow: replan,
      notify,
      dismissToast,
    }),
    [jobs, report, carpenter, settings, locks, plan, previousPlan, planning, improving, progress, planError, toasts, partList, partCoverage, importFile, loadDemo, clearData, replan, notify, dismissToast],
  );

  return <Ctx.Provider value={store}>{children}</Ctx.Provider>;
}
