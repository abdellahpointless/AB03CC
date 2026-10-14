import { ArrowLeft, ArrowRight, Check, ChevronRight, Download, Hammer, Plus, ScanLine, X } from 'lucide-react';
import { memo, useEffect, useMemo, useState } from 'react';
import { formatDuration } from '../core/calendar';
import { STEP_LABELS, buildCutLine, type CutLine, type CutStepRule, type CutStepType, type LinePart, type LineStep, type LineStrip } from '../core/carpenter/cutLine';
import { buildCutItems } from '../core/carpenter/items';
import { downloadCutLine } from '../core/export';
import { partKey } from '../core/parse/partTimes';
import type { CutItem } from '../core/types';
import { materialBadgeStyle } from '../lib/colors';
import { useStore } from '../state/store';
import { CarpenterQuestions, MissingFiles, missingCount, unknownCount } from './CarpenterTabs';
import { Button, CopyBox, Empty, MaterialBadge, Segmented, inputCls } from './kit';
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

/** Every part of the line in cutting order (what the carpenter cuts, and later scans, one after another). */
function inOrder(line: CutLine): Array<{ step: LineStep; strip: LineStrip; z: number; material: string; part: LinePart }> {
  const out: Array<{ step: LineStep; strip: LineStrip; z: number; material: string; part: LinePart }> = [];
  for (const step of line.steps) for (const m of step.materials) for (const b of m.boards) for (const strip of b.strips) for (const part of strip.parts) out.push({ step, strip, z: b.z, material: m.material, part });
  return out;
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
    // the step's starting material is not used any more: each step simply keeps the blade that is on the saw
    return buildCutLine(
      items,
      rules.map(r => ({ ...r, material: '' })),
      {
        inProduction: mo => producing.has(noZeros(so.get(mo)?.salesOrder)),
        urgent: mo => {
          const p = so.get(mo);
          return !!p && urgent.some(e => noZeros(e.salesOrder) === noZeros(p.salesOrder) && (e.schedule === null || e.schedule === p.schedule));
        },
        minutes: cs,
      },
    );
  }, [items, rules, producing, urgent, cs]);

  const order = useMemo(() => (line ? inOrder(line) : []), [line]);
  const scanList = useMemo(
    () =>
      order
        .map(o => [o.part.item.part.workOrder ?? '', o.part.item.part.materialNr ?? '', o.part.item.qty, o.material, o.part.item.cut?.join(' x ') ?? '', o.part.item.part.partName ?? ''].join('\t'))
        .join('\n'),
    [order],
  );

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
  const doneQty = order.reduce((s, o) => s + (ticks.has(o.part.item.id) ? o.part.item.qty : 0), 0);
  const next = order.find(o => !ticks.has(o.part.item.id));
  // the same part of the same strip is one row on screen: show its whole quantity
  const nextQty = next ? mergeSame(next.strip.parts).find(g => g.ids.includes(next.part.item.id))!.qty : 0;
  const others = items.filter(i => i.status === 'elsewhere' || i.status === 'blocked' || i.status === 'not_ready');

  return (
    <div className="space-y-4">
      {/* what matters at a glance */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="flex items-center gap-2 text-xl font-semibold text-white">
            <Hammer className="h-5 w-5 text-amber-400" /> Carpenter
            <span className="text-xs font-normal text-slate-500">{carpenterFile}</span>
          </h2>
          <Button
            variant="secondary"
            onClick={async () => {
              if ((await downloadCutLine(line)) === 'failed') notify('The cut list could not be saved as an Excel file here.', 'error');
            }}
          >
            <Download className="h-4 w-4" /> Excel
          </Button>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Big label="Pieces to cut" value={`${t.qty}`} hint={`${t.parts} parts`} />
          <Big label="Cutting time" value={formatDuration(Math.round(t.minutes))} hint={`list order would take ${formatDuration(Math.round(lo.minutes))}`} />
          <Big label="Blade changes" value={`${t.bladeChanges}`} hint={`list order: ${lo.bladeChanges}`} />
          <div className="rounded-xl border border-slate-800 bg-slate-950/60 px-4 py-3">
            <div className="text-[11px] uppercase tracking-wide text-slate-500">Done</div>
            <div className="mono text-2xl font-semibold tabular-nums text-white">{t.qty ? Math.round((doneQty / t.qty) * 100) : 0}%</div>
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-800">
              <div className="h-full origin-left rounded-full bg-emerald-500 transition-transform duration-300" style={{ transform: `scaleX(${t.qty ? doneQty / t.qty : 0})` }} />
            </div>
          </div>
        </div>
        {next && (
          <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border border-blue-700/60 bg-blue-950/30 px-4 py-3">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-blue-300">Next</span>
            <span className="flex items-center gap-2 text-sm text-slate-300">
              <MaterialBadge material={next.material} /> board <b className="mono text-white">Z {next.z}</b> · strip <b className="mono text-white">{next.strip.width} mm</b>
            </span>
            <span className="text-lg text-white">
              cut <b className="mono">{next.part.length} mm</b> <span className="mono text-slate-300">×{nextQty}</span>
            </span>
            <span className="text-xs text-slate-400">{next.part.item.part.partName}</span>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
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
      </div>

      {tab === 'line' && (
        <>
          <StepEditor rules={rules} setRules={setRules} />
          <div className="space-y-3">
            {line.steps.map((st, i) => (
              <StepSection key={`${st.title}-${i}`} step={st} defaultOpen={i === 0} ticks={ticks} onTick={toggle} />
            ))}
          </div>
          <details className="rounded-xl border border-slate-800 bg-slate-900/50 px-4 py-3 text-xs text-slate-400">
            <summary className="flex cursor-pointer items-center gap-2 text-slate-300">
              <ScanLine className="h-4 w-4" /> Scan the cut parts on the website, in this order
            </summary>
            <ol className="mt-2 list-decimal space-y-0.5 pl-5">
              <li>Open the carpenter list on the website and run the shop helper (Scripts button at the top, or the box below).</li>
              <li>Copy this list and paste it into the helper's "Scan" box, then press "Start scanning".</li>
              <li>For each part the helper finds the row and presses Finish; you type the box code and press OK, it goes on with the next part.</li>
            </ol>
            <CopyBox text={scanList} label={`Scan order (${order.length} parts)`} rows={3} />
            <CopyBox text={HELPER_CODE} label="Shop helper script (also refreshes the carpenter list)" rows={2} />
          </details>
        </>
      )}
      {tab === 'files' && <MissingFiles items={items} />}
      {tab === 'questions' && <CarpenterQuestions items={items} />}
      {tab === 'other' && <OtherParts items={others} />}
    </div>
  );
}

function Big({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950/60 px-4 py-3">
      <div className="text-[11px] uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mono text-2xl font-semibold tabular-nums text-white">{value}</div>
      <div className="truncate text-[11px] text-slate-500">{hint}</div>
    </div>
  );
}

/** The admin's line of steps: each takes the parts it matches, in order; the rest comes last. */
function StepEditor({ rules, setRules }: { rules: CutStepRule[]; setRules: (r: CutStepRule[]) => void }) {
  const edit = (id: string, patch: Partial<CutStepRule>) => setRules(rules.map(r => (r.id === id ? { ...r, ...patch } : r)));
  const move = (i: number, d: number) => {
    const next = rules.slice();
    const [r] = next.splice(i, 1);
    next.splice(i + d, 0, r);
    setRules(next);
  };
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/40 px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="mr-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Order</span>
        {rules.map((r, i) => (
          <div key={r.id} className="flex items-center gap-2">
            <div className="group flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-950 py-1 pl-2 pr-1 text-xs">
              <span className="mono flex h-5 w-5 items-center justify-center rounded-full bg-blue-600 text-[10px] font-bold text-white">{i + 1}</span>
              <select className={`${inputCls} w-40! border-transparent! bg-transparent! px-1!`} value={r.type} onChange={e => edit(r.id, { type: e.target.value as CutStepType, value: '' })}>
                {(Object.keys(STEP_LABELS) as CutStepType[]).map(k => (
                  <option key={k} value={k}>
                    {STEP_LABELS[k]}
                  </option>
                ))}
              </select>
              {r.type !== 'in_production' && (
                <input
                  className={`${inputCls} w-36!`}
                  type={r.type === 'production_date' ? 'date' : 'text'}
                  placeholder={r.type === 'sales_order' ? '0014102903, …' : '75, 85'}
                  value={r.value}
                  onChange={e => edit(r.id, { value: e.target.value })}
                />
              )}
              <span className="flex opacity-60 transition-opacity group-hover:opacity-100">
                <IconBtn title="Earlier" disabled={i === 0} onClick={() => move(i, -1)}>
                  <ArrowLeft className="h-3.5 w-3.5" />
                </IconBtn>
                <IconBtn title="Later" disabled={i === rules.length - 1} onClick={() => move(i, 1)}>
                  <ArrowRight className="h-3.5 w-3.5" />
                </IconBtn>
                <IconBtn title="Remove" onClick={() => setRules(rules.filter(x => x.id !== r.id))}>
                  <X className="h-3.5 w-3.5" />
                </IconBtn>
              </span>
            </div>
            <ChevronRight className="h-3.5 w-3.5 text-slate-600" />
          </div>
        ))}
        <button
          type="button"
          onClick={() => setRules([...rules, { id: `s${Date.now().toString(36)}`, type: 'sales_order', value: '', material: '' }])}
          className="flex items-center gap-1 rounded-lg border border-dashed border-slate-700 px-2.5 py-1.5 text-xs text-slate-400 transition-colors hover:border-blue-500 hover:text-blue-300"
        >
          <Plus className="h-3.5 w-3.5" /> Step
        </button>
        <ChevronRight className="h-3.5 w-3.5 text-slate-600" />
        <span className="rounded-lg border border-slate-800 px-2.5 py-1.5 text-xs text-slate-500">Everything else</span>
      </div>
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

/** One step: one line when closed; open, each material is a card with its boards, strips and the lengths to cut. */
const StepSection = memo(function StepSection({ step, defaultOpen, ticks, onTick }: { step: LineStep; defaultOpen: boolean; ticks: Set<string>; onTick: (ids: string[], on: boolean) => void }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-950">
      <button type="button" onClick={() => setOpen(o => !o)} className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-slate-900/60">
        <span className="mono flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-600 text-sm font-bold text-white">{step.index}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-semibold text-white">{step.title}</span>
          <span className="text-xs text-slate-400">
            {step.qty} pcs · {formatDuration(Math.round(step.minutes))}
            {step.bladeChanges > 0 && <span className="text-amber-400"> · {step.bladeChanges} blade change</span>}
          </span>
        </span>
        <span className="hidden gap-1 sm:flex">
          {step.materials.map(m => (
            <MaterialBadge key={m.material} material={m.material} />
          ))}
        </span>
        <ChevronRight className={`h-4 w-4 shrink-0 text-slate-500 transition-transform duration-200 ${open ? 'rotate-90' : ''}`} />
      </button>
      {open && (
        <div className="space-y-3 border-t border-slate-800 bg-slate-950 p-3">
          {step.materials.map(m => {
            const color = materialBadgeStyle(m.material).borderColor;
            return (
              <div key={m.material}>
                {m.bladeChange && (
                  <div className="mb-2 flex items-center gap-2 rounded-lg bg-amber-500/10 px-3 py-2 text-sm font-semibold text-amber-300 ring-1 ring-amber-600/50">
                    ⚠ Change the saw blade: {m.blade === 'FH' ? 'FH blade' : 'blade for ALU / POM / PCGF / MS'}
                  </div>
                )}
                <div className="rounded-xl border border-slate-800 bg-slate-900/40" style={{ borderLeft: `4px solid ${color}` }}>
                  <div className="flex items-baseline gap-2 px-4 pt-3">
                    <span className="text-lg font-semibold text-white">{m.material}</span>
                    <span className="text-xs text-slate-400">{m.qty} pcs</span>
                  </div>
                  <div className="space-y-2 p-3">
                    {m.boards.map(b => (
                      <div key={b.z} className="flex gap-3 rounded-lg bg-slate-950/70 p-3">
                        <div className="w-20 shrink-0" title={b.boards.join('\n')}>
                          <div className="text-[10px] uppercase tracking-wide text-slate-500">Board</div>
                          <div className="mono text-xl font-bold text-white">Z {b.z}</div>
                          <div className="text-[11px] text-slate-500">{b.qty} pcs</div>
                        </div>
                        <div className="min-w-0 flex-1 space-y-2">
                          {b.strips.map(s => (
                            <div key={s.width}>
                              <div className="mb-1 flex items-baseline gap-2">
                                <span className="mono text-sm font-semibold text-sky-300">Strip {s.width} mm</span>
                                <span className="text-[11px] text-slate-500">
                                  {s.qty} pcs · {Math.round(s.totalLength)} mm long
                                </span>
                              </div>
                              <div className="flex flex-wrap gap-1.5">
                                {mergeSame(s.parts).map(g => {
                                  const done = g.ids.every(id => ticks.has(id));
                                  const first = g.parts[0].item;
                                  const alert = g.parts.find(p => p.item.alert)?.item.alert;
                                  return (
                                    <button
                                      type="button"
                                      key={g.ids[0]}
                                      onClick={() => onTick(g.ids, !done)}
                                      title={`${first.part.partName ?? ''}\nWork orders: ${g.parts.map(p => p.item.part.workOrder).join(', ')}\nMaterialNr: ${first.part.materialNr ?? ''}${alert ? `\n⚠ ${alert.text}` : ''}`}
                                      className={`flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-left transition-colors ${
                                        done ? 'border-emerald-800 bg-emerald-950/40 text-emerald-300/70' : 'border-slate-700 bg-slate-900 hover:border-slate-500'
                                      }`}
                                    >
                                      <span className={`flex h-4 w-4 items-center justify-center rounded border ${done ? 'border-emerald-500 bg-emerald-600' : 'border-slate-600'}`}>
                                        {done && <Check className="h-3 w-3 text-white" />}
                                      </span>
                                      <span className={`mono text-sm font-semibold ${done ? 'line-through' : 'text-white'}`}>{g.length} mm</span>
                                      <span className="mono text-sm text-slate-300">×{g.qty}</span>
                                      <span className="max-w-[11rem] truncate text-[11px] text-slate-500">
                                        {first.part.partName ?? ''}
                                        {alert && <span className="text-rose-300"> ⚠</span>}
                                      </span>
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
});

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
