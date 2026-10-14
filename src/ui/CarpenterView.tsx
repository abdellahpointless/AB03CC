import { ArrowLeft, ArrowRight, ChevronRight, Download, Hammer, Plus, Trash2 } from 'lucide-react';
import { memo, useEffect, useMemo, useState } from 'react';
import { formatDuration } from '../core/calendar';
import { STEP_LABELS, buildCutLine, type CutLine, type CutStepRule, type CutStepType, type LinePart, type LineStep } from '../core/carpenter/cutLine';
import { buildCutItems } from '../core/carpenter/items';
import { downloadCutLine } from '../core/export';
import { partKey } from '../core/parse/partTimes';
import type { CutItem } from '../core/types';
import { useStore } from '../state/store';
import { CarpenterQuestions, MissingFiles, missingCount, unknownCount } from './CarpenterTabs';
import { Badge, Button, CopyBox, Empty, MaterialBadge, Segmented, inputCls } from './kit';
import { HELPER_CODE } from './ScriptsModal';

const noZeros = (s: string | undefined) => (s ?? '').trim().replace(/^0+/, '');

// the step line and the ticks live outside the planner settings: editing them never re-plans the CNC machines
const STEPS_KEY = 'cnc-planner.v2.carpenterSteps';
const TICKS_KEY = 'cnc-planner.v2.cutTicks';
const DEFAULT_STEPS: CutStepRule[] = [{ id: 'prod', type: 'in_production', value: '', material: '' }];
function loadJson<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}
function saveJson(key: string, v: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* works without remembering */
  }
}

type Tab = 'line' | 'files' | 'questions' | 'other';

/** The carpenter's screen: the admin's step line, and the parts of each step grouped the way they are sawn. */
export function CarpenterView() {
  const { carpenterParts, carpenterFile, jobs, settings, notify } = useStore();
  const [tab, setTab] = useState<Tab>('line');
  const [rules, setRules] = useState<CutStepRule[]>(() => loadJson(STEPS_KEY, DEFAULT_STEPS));
  const [ticks, setTicks] = useState<Set<string>>(() => new Set(loadJson<string[]>(TICKS_KEY, [])));
  const cs = settings.carpenter;

  useEffect(() => saveJson(STEPS_KEY, rules), [rules]);

  const items = useMemo(() => {
    if (!carpenterParts.length) return [];
    const history: Record<string, string> = {};
    for (const j of jobs) if (j.matnr && j.materialType) history[partKey(j.matnr)] = j.materialType;
    return buildCutItems(carpenterParts, {
      settings: { materialTokens: cs.materialTokens, doneWorkOrders: cs.doneWorkOrders, sawGroups: cs.sawGroups },
      materialAliases: settings.materialAliases,
      history,
    });
  }, [carpenterParts, jobs, cs.materialTokens, cs.doneWorkOrders, cs.sawGroups, settings.materialAliases]);

  const producing = useMemo(() => new Set(jobs.map(j => noZeros(j.salesOrder)).filter(Boolean)), [jobs]);
  const urgent = useMemo(() => settings.emergencies.filter(e => e.applied), [settings.emergencies]);

  const line: CutLine | null = useMemo(() => {
    if (!items.length) return null;
    const so = new Map(items.map(i => [i.part.masterOrder, i.part]));
    return buildCutLine(items, rules, {
      inProduction: mo => producing.has(noZeros(so.get(mo)?.salesOrder)),
      urgent: mo => {
        const p = so.get(mo);
        return !!p && urgent.some(e => noZeros(e.salesOrder) === noZeros(p.salesOrder) && (e.schedule === null || e.schedule === p.schedule));
      },
      minutes: cs,
    });
  }, [items, rules, producing, urgent, cs]);

  const materials = useMemo(() => [...new Set(items.map(i => i.material).filter((m): m is string => Boolean(m)))].sort(), [items]);

  if (!line) {
    return <Empty>No carpenter list loaded. Export the carpenter list from the website (Excel button) and import it here like the workload.</Empty>;
  }

  const toggle = (ids: string[], on: boolean) =>
    setTicks(prev => {
      const next = new Set(prev);
      for (const id of ids) {
        if (on) next.add(id);
        else next.delete(id);
      }
      saveJson(TICKS_KEY, [...next]);
      return next;
    });

  const t = line.totals;
  const lo = line.listOrder;
  const others = items.filter(i => i.status === 'elsewhere' || i.status === 'blocked' || i.status === 'not_ready');

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-slate-800 bg-slate-900/70 px-5 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-semibold text-white">
              <Hammer className="h-4 w-4 text-amber-400" /> Carpenter
            </h2>
            <p className="text-xs text-slate-400">
              {carpenterFile} · steps in order; inside a step: material, then board thickness, then strip width, then lengths. FH has its own saw blade; the blade is changed as little as possible.
            </p>
          </div>
          <Button
            variant="secondary"
            onClick={async () => {
              if ((await downloadCutLine(line)) === 'failed') notify('The cut list could not be saved as an Excel file here.', 'error');
            }}
          >
            <Download className="h-4 w-4" /> Excel
          </Button>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-3 lg:grid-cols-6">
          <Stat label="Parts to cut" value={`${t.parts}`} sub={`${t.qty} pieces · ${ticks.size} ticked`} />
          <Stat label="Work" value={formatDuration(Math.round(t.minutes))} sub={`website order: ${formatDuration(Math.round(lo.minutes))}`} />
          <Stat label="Blade changes" value={`${t.bladeChanges}`} sub={`website order: ${lo.bladeChanges}`} />
          <Stat label="Board changes" value={`${t.boardChanges}`} sub={`website order: ${lo.boardChanges}`} />
          <Stat label="Strips" value={`${t.stripChanges}`} sub={`website order: ${lo.stripChanges}`} />
          <Stat label="Steps" value={`${line.steps.length}`} sub="in the order below" />
        </div>
      </div>

      <Segmented<Tab>
        value={tab}
        onChange={setTab}
        options={[
          { value: 'line', label: 'Cut line' },
          { value: 'files', label: `Missing files (${missingCount(items)})` },
          { value: 'questions', label: `Materials to confirm (${unknownCount(items)})` },
          { value: 'other', label: `Not cut here (${others.length})` },
        ]}
      />

      {tab === 'line' && (
        <>
          <StepEditor rules={rules} setRules={setRules} materials={materials} />
          <div className="space-y-2">
            {line.steps.map((st, i) => (
              <StepSection key={`${st.title}-${i}`} step={st} defaultOpen={i === 0} ticks={ticks} onTick={toggle} />
            ))}
          </div>
        </>
      )}
      {tab === 'files' && <MissingFiles items={items} />}
      {tab === 'questions' && <CarpenterQuestions items={items} />}
      {tab === 'other' && <OtherParts items={others} />}

      <details className="rounded-xl border border-slate-800 bg-slate-900/50 px-4 py-3 text-xs text-slate-400">
        <summary className="cursor-pointer text-slate-300">Refresh the carpenter list on the website (shop helper script)</summary>
        <p className="mt-2">Open the carpenter list on the website, press F12, paste this in the Console and press Enter. A panel offers "Refresh them all".</p>
        <CopyBox text={HELPER_CODE} label="Shop helper script" />
      </details>
    </div>
  );
}

/** The admin's line of steps: each takes the parts it matches, in order; the rest comes last. */
function StepEditor({ rules, setRules, materials }: { rules: CutStepRule[]; setRules: (r: CutStepRule[]) => void; materials: string[] }) {
  const edit = (id: string, patch: Partial<CutStepRule>) => setRules(rules.map(r => (r.id === id ? { ...r, ...patch } : r)));
  const move = (i: number, d: number) => {
    const next = rules.slice();
    const [r] = next.splice(i, 1);
    next.splice(i + d, 0, r);
    setRules(next);
  };
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-3">
      <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Cutting order: steps, left to right</div>
      <div className="flex flex-wrap items-stretch gap-2">
        {rules.map((r, i) => (
          <div key={r.id} className="flex items-stretch gap-2">
            <div className="w-64 space-y-1.5 rounded-lg border border-slate-700 bg-slate-950 p-2 text-xs">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-white">Step {i + 1}</span>
                <span className="flex">
                  <IconBtn title="Earlier" disabled={i === 0} onClick={() => move(i, -1)}>
                    <ArrowLeft className="h-3.5 w-3.5" />
                  </IconBtn>
                  <IconBtn title="Later" disabled={i === rules.length - 1} onClick={() => move(i, 1)}>
                    <ArrowRight className="h-3.5 w-3.5" />
                  </IconBtn>
                  <IconBtn title="Remove" onClick={() => setRules(rules.filter(x => x.id !== r.id))}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </IconBtn>
                </span>
              </div>
              <select className={inputCls} value={r.type} onChange={e => edit(r.id, { type: e.target.value as CutStepType, value: '' })}>
                {(Object.keys(STEP_LABELS) as CutStepType[]).map(k => (
                  <option key={k} value={k}>
                    {STEP_LABELS[k]}
                  </option>
                ))}
              </select>
              {r.type === 'in_production' ? (
                <div className="px-1 text-[11px] text-slate-500">Sales orders already in the CNC plan</div>
              ) : (
                <input
                  className={inputCls}
                  type={r.type === 'production_date' ? 'date' : 'text'}
                  placeholder={r.type === 'sales_order' ? 'e.g. 0014102903, 0014102956' : 'e.g. 75, 85'}
                  value={r.value}
                  onChange={e => edit(r.id, { value: e.target.value })}
                />
              )}
              <select className={inputCls} value={r.material} onChange={e => edit(r.id, { material: e.target.value })} title="Material to start this step with">
                <option value="">Start with: the blade on the saw</option>
                {materials.map(m => (
                  <option key={m} value={m}>
                    Start with: {m}
                  </option>
                ))}
              </select>
            </div>
            <ChevronRight className="h-4 w-4 self-center text-slate-600" />
          </div>
        ))}
        <button
          type="button"
          onClick={() => setRules([...rules, { id: `s${Date.now().toString(36)}`, type: 'sales_order', value: '', material: '' }])}
          className="flex w-40 flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-slate-700 text-xs text-slate-400 transition-colors hover:border-blue-500 hover:text-blue-300"
        >
          <Plus className="h-4 w-4" /> Add a step
        </button>
        <ChevronRight className="h-4 w-4 self-center text-slate-600" />
        <div className="flex w-40 items-center justify-center rounded-lg border border-slate-800 px-2 text-center text-xs text-slate-500">Everything else</div>
      </div>
      <p className="mt-2 text-[11px] text-slate-500">Urgent orders (the red button) always come before step 1. A part goes to the first step it matches.</p>
    </div>
  );
}

function IconBtn({ children, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" {...rest} className="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-white disabled:opacity-30 disabled:hover:bg-transparent">
      {children}
    </button>
  );
}

/** One step: collapsed it is one line; open it lists material → board → strip → parts. Rendered only when open. */
const StepSection = memo(function StepSection({ step, defaultOpen, ticks, onTick }: { step: LineStep; defaultOpen: boolean; ticks: Set<string>; onTick: (ids: string[], on: boolean) => void }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="rounded-xl border border-slate-800 bg-slate-950">
      <button type="button" onClick={() => setOpen(o => !o)} className="flex w-full flex-wrap items-center gap-3 px-4 py-3 text-left">
        <ChevronRight className={`h-4 w-4 text-slate-400 transition-transform duration-200 ${open ? 'rotate-90' : ''}`} />
        <span className="font-semibold text-white">
          Step {step.index} · {step.title}
        </span>
        {step.rule?.material && <Badge className="border-slate-700 text-slate-300">starts with {step.rule.material}</Badge>}
        <span className="text-xs text-slate-400">
          {step.parts} parts · {step.qty} pcs · {formatDuration(Math.round(step.minutes))} · {step.bladeChanges} blade change{step.bladeChanges === 1 ? '' : 's'}
        </span>
        <span className="ml-auto flex gap-1">
          {step.materials.map(m => (
            <MaterialBadge key={m.material} material={m.material} />
          ))}
        </span>
      </button>
      {open && (
        <div className="space-y-3 border-t border-slate-800 px-4 py-3">
          {step.materials.map(m => (
            <div key={m.material} className="space-y-2">
              {m.bladeChange && (
                <div className="rounded-md border border-amber-700/60 bg-amber-950/30 px-3 py-1.5 text-xs font-semibold text-amber-300">
                  Change the saw blade → {m.blade === 'FH' ? 'FH blade' : 'blade for ALU / POM / PCGF / MS …'}
                </div>
              )}
              <div className="flex items-center gap-2 text-sm">
                <MaterialBadge material={m.material} />
                <span className="font-semibold text-white">{m.material}</span>
                <span className="text-xs text-slate-400">{m.qty} pcs</span>
              </div>
              {m.boards.map(b => (
                <div key={b.z} className="ml-3 rounded-lg border border-slate-800 bg-slate-900/40">
                  <div className="flex flex-wrap items-baseline gap-2 border-b border-slate-800 px-3 py-1.5 text-xs">
                    <span className="font-semibold text-slate-100">Board Z {b.z} mm</span>
                    <span className="text-slate-400">{b.qty} pcs</span>
                    <span className="truncate text-slate-500">{b.boards.join(' · ')}</span>
                  </div>
                  <div className="divide-y divide-slate-800/70">
                    {b.strips.map(s => (
                      <div key={s.width} className="px-3 py-1.5">
                        <div className="mb-1 flex flex-wrap items-baseline gap-2 text-xs">
                          <span className="mono font-semibold text-sky-300">
                            Strip {s.width} × {b.z} mm
                          </span>
                          <span className="text-slate-400">
                            {s.qty} pcs · {Math.round(s.totalLength)} mm of strip
                          </span>
                        </div>
                        <div className="grid grid-cols-[auto_5rem_3rem_minmax(8rem,1fr)_8rem_8rem_7rem] gap-x-3 text-xs">
                          {mergeSame(s.parts).map(g => {
                            const done = g.ids.every(id => ticks.has(id));
                            const first = g.parts[0].item;
                            const wos = g.parts.map(p => p.item.part.workOrder).filter(Boolean);
                            const boxes = new Set(g.parts.map(p => p.item.part.masterOrder));
                            return (
                              <label key={g.ids[0]} className={`contents cursor-pointer ${done ? '[&>*]:opacity-40' : ''}`} title={wos.join(', ')}>
                                <input type="checkbox" checked={done} onChange={() => onTick(g.ids, !done)} className="mt-0.5" />
                                <span className={`mono font-semibold ${done ? 'line-through' : 'text-white'}`}>{g.length} mm</span>
                                <span className="mono text-right font-semibold text-slate-200">×{g.qty}</span>
                                <span className="truncate text-slate-300">
                                  {first.part.partName ?? first.part.text ?? ''}
                                  {g.parts.some(p => p.item.alert) && <span className="ml-1 text-rose-300" title={g.parts.find(p => p.item.alert)?.item.alert?.text}>⚠</span>}
                                </span>
                                <span className="mono truncate text-slate-400">{wos.length > 1 ? `${wos[0]} +${wos.length - 1}` : wos[0]}</span>
                                <span className="mono truncate text-slate-500">{boxes.size > 1 ? `${boxes.size} boxes` : first.part.masterOrder}</span>
                                <span className="mono truncate text-slate-500">{first.part.materialNr ?? ''}</span>
                              </label>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ))}
          {step.picks.length > 0 && (
            <div className="rounded-lg border border-slate-800 px-3 py-2 text-xs text-slate-400">
              <div className="mb-1 font-semibold text-slate-300">Pre-cut blanks: just pick them ({step.picks.reduce((a, p) => a + p.qty, 0)} pcs)</div>
              {step.picks.map(p => (
                <div key={p.id} className="mono">
                  {p.part.workOrder} · {p.part.partName ?? p.part.text} · {p.stockNo} {p.stockText} ×{p.qty}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
});

/** The same part (same length and drawing) in one strip is shown once, with its total quantity. */
function mergeSame(parts: LinePart[]): Array<{ length: number; qty: number; ids: string[]; parts: LinePart[] }> {
  const map = new Map<string, { length: number; qty: number; ids: string[]; parts: LinePart[] }>();
  for (const p of parts) {
    const k = `${p.length}|${p.item.part.materialNr || p.item.part.partName || p.item.id}`;
    let g = map.get(k);
    if (!g) map.set(k, (g = { length: p.length, qty: 0, ids: [], parts: [] }));
    g.qty += p.item.qty;
    g.ids.push(p.item.id);
    g.parts.push(p);
  }
  return [...map.values()];
}

function OtherParts({ items }: { items: CutItem[] }) {
  if (!items.length) return <Empty>Every part is cut here.</Empty>;
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-950">
      <table className="w-full min-w-[900px] text-xs">
        <thead className="bg-slate-900 text-[11px] uppercase tracking-wide text-slate-400">
          <tr>
            <th className="px-2 py-2 text-left">Work order</th>
            <th className="px-2 py-2 text-left">Box</th>
            <th className="px-2 py-2 text-left">Measure</th>
            <th className="px-2 py-2 text-left">Stock</th>
            <th className="px-2 py-2 text-left">Why</th>
          </tr>
        </thead>
        <tbody>
          {items.map(it => (
            <tr key={it.id} className="border-b border-slate-900">
              <td className="mono px-2 py-1">{it.part.workOrder}</td>
              <td className="mono px-2 py-1 text-slate-400">{it.part.masterOrder}</td>
              <td className="mono px-2 py-1 text-slate-300">{it.part.measure}</td>
              <td className="px-2 py-1 text-slate-400">{it.part.descriptionDe}</td>
              <td className="px-2 py-1 text-slate-400">{it.statusReason ?? it.status}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mono text-base font-semibold tabular-nums text-white">{value}</div>
      <div className="truncate text-[11px] text-slate-500">{sub}</div>
    </div>
  );
}
