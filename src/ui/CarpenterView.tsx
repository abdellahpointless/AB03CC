import { Download, Hammer, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { WorkCalendar, formatDuration, planStartOffset } from '../core/calendar';
import { buildCutItems } from '../core/carpenter/items';
import { planCuts } from '../core/carpenter/cutPlan';
import { boxLevel, type BoxFacts } from '../core/carpenter/priority';
import { downloadCutList } from '../core/export';
import { partKey } from '../core/parse/partTimes';
import { useStore } from '../state/store';
import type { CutPlan, CutStep } from '../core/types';
import { Badge, Button, CopyBox, Empty, MaterialBadge, Segmented, inputCls } from './kit';
import { HELPER_CODE } from './ScriptsModal';
import { CarpenterPriority, MissingFiles, missingCount } from './CarpenterTabs';

const noZeros = (s: string | undefined) => (s ?? '').replace(/^0+/, '');
const TICKS_KEY = 'cnc-planner.v2.cutTicks';
const loadTicks = (): Set<string> => {
  try {
    return new Set(JSON.parse(localStorage.getItem(TICKS_KEY) || '[]') as string[]);
  } catch {
    return new Set();
  }
};

type Tab = 'order' | 'priority' | 'files' | 'questions' | 'notready';

/** The carpenter's list: what to cut, in which order, so boxes are finished early and the saw and bar change rarely. */
export function CarpenterView() {
  const { carpenterParts, carpenterFile, jobs, settings, updateSettings, notify } = useStore();
  const [tab, setTab] = useState<Tab>('order');
  const [query, setQuery] = useState('');
  const [ticks, setTicks] = useState(loadTicks);
  const [hideTicked, setHideTicked] = useState(false);

  const items = useMemo(() => {
    if (!carpenterParts.length) return [];
    const history: Record<string, string> = {};
    for (const j of jobs) if (j.matnr && j.materialType) history[partKey(j.matnr)] = j.materialType;
    return buildCutItems(carpenterParts, { settings: settings.carpenter, materialAliases: settings.materialAliases, history });
  }, [carpenterParts, jobs, settings.carpenter, settings.materialAliases]);

  // what each box is: in production (its sales order is in the CNC plan), urgent, and what the admin's rules see
  const facts = useMemo(() => {
    const urgent = settings.emergencies.filter(e => e.applied);
    const producing = new Set(jobs.map(j => noZeros(j.salesOrder)).filter(Boolean));
    const map = new Map<string, BoxFacts>();
    for (const it of items) {
      const p = it.part;
      let f = map.get(p.masterOrder);
      if (!f) {
        f = {
          masterOrder: p.masterOrder,
          salesOrder: p.salesOrder,
          schedule: p.schedule,
          customer: p.customer,
          productionDate: p.productionDate,
          materials: [],
          inProduction: producing.has(noZeros(p.salesOrder)),
          urgent: urgent.some(e => noZeros(e.salesOrder) === noZeros(p.salesOrder) && (e.schedule === null || e.schedule === p.schedule)),
        };
        map.set(p.masterOrder, f);
      }
      if (it.material && !f.materials.includes(it.material)) f.materials.push(it.material);
    }
    return map;
  }, [items, jobs, settings.emergencies]);

  const cut: CutPlan | null = useMemo(() => {
    if (!items.length) return null;
    const cs = settings.carpenter;
    const levels = new Map([...facts].map(([mo, f]) => [mo, boxLevel(f, cs)]));
    const cal = new WorkCalendar(settings.calendar);
    return planCuts(items, {
      calendar: settings.calendar,
      settings: cs,
      startMinute: planStartOffset(settings.calendar),
      effort: 'quick',
      moTier: mo => levels.get(mo)?.level ?? 0,
      moReason: mo => levels.get(mo)?.reason,
      moUrgent: mo => facts.get(mo)?.urgent ?? false,
      moInGantt: mo => facts.get(mo)?.inProduction ?? false,
      moDue: mo => {
        const d = facts.get(mo)?.productionDate;
        return cs.earliestDateFirst && d ? cal.fromIso(d.slice(0, 10) + 'T23:59') : null;
      },
    });
  }, [items, facts, settings.carpenter, settings.calendar]);

  if (!cut) {
    return (
      <Empty>
        No carpenter list loaded. Export the carpenter list from the website (CarpenterProduceList, Excel button) and import it here like the workload.
      </Empty>
    );
  }

  const toggle = (id: string) => {
    const next = new Set(ticks);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setTicks(next);
    try {
      localStorage.setItem(TICKS_KEY, JSON.stringify([...next]));
    } catch {
      /* the list still works without remembering */
    }
  };

  const q = query.trim().toLowerCase();
  const match = (s: CutStep) =>
    !q ||
    [s.item.part.workOrder, s.item.part.masterOrder, s.item.part.salesOrder, s.item.part.partName, s.item.material, s.item.stockNo, s.item.part.measure].some(v => (v ?? '').toLowerCase().includes(q));
  const steps = cut.steps.filter(s => match(s) && !(hideTicked && ticks.has(s.item.id)));
  const done = cut.steps.filter(s => ticks.has(s.item.id)).length;
  const last = cut.steps[cut.steps.length - 1];
  const st = cut.stats;
  const nv = cut.naive;
  const seriesById = new Map(cut.series.map(s => [s.id, s]));
  const questions = cut.unknownMaterials.length + cut.conflicts.length;

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-slate-800 bg-slate-900/70 px-5 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-semibold text-white">
              <Hammer className="h-4 w-4 text-amber-400" /> Carpenter cut list
            </h2>
            <p className="text-xs text-slate-400">
              {carpenterFile} · cut from top to bottom: boxes we are producing first, then the priority set in the Priority tab; each box is finished as soon as possible and parts of the same bar and size are cut in one go.
            </p>
          </div>
          <Button
            variant="secondary"
            onClick={async () => {
              if ((await downloadCutList(cut)) === 'failed') notify('The cut list could not be saved as an Excel file here.', 'error');
            }}
          >
            <Download className="h-4 w-4" /> Excel
          </Button>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-3 lg:grid-cols-6">
          <Stat label="Parts to cut" value={`${st.parts}`} sub={`${st.pieces} pieces · ${done} ticked`} />
          <Stat label="Work" value={formatDuration(Math.round(st.cutMinutes + st.setupMinutes))} sub={`${formatDuration(Math.round(st.setupMinutes))} of it changing`} />
          <Stat label="Saw changes" value={`${st.sawChanges}`} sub={`list order: ${nv.sawChanges}`} />
          <Stat label="Bar changes" value={`${st.stockChanges}`} sub={`list order: ${nv.stockChanges}`} />
          <Stat label="Strip changes" value={`${st.stripChanges}`} sub={`list order: ${nv.stripChanges}`} />
          <Stat label="All cut by" value={last ? last.endTime.slice(5, 16).replace('T', ' ') : '—'} sub={`list order: ${formatDuration(Math.round(nv.finishMinute - st.finishMinute))} later`} />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Segmented<Tab>
          value={tab}
          onChange={setTab}
          options={[
            { value: 'order', label: `Cut order (${cut.steps.length})` },
            { value: 'priority', label: 'Priority' },
            { value: 'files', label: `Missing files (${missingCount(items)})` },
            { value: 'questions', label: `Materials to confirm (${questions})` },
            { value: 'notready', label: `Not ready / other departments (${cut.notReady.length + cut.blocked.length + cut.elsewhere.length})` },
          ]}
        />
        {tab === 'order' && (
          <>
            <div className="relative">
              <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
              <input className={`${inputCls} w-56! pl-7`} placeholder="Work order, box, part, bar…" value={query} onChange={e => setQuery(e.target.value)} />
            </div>
            <label className="flex items-center gap-1.5 text-xs text-slate-400">
              <input type="checkbox" checked={hideTicked} onChange={e => setHideTicked(e.target.checked)} /> hide ticked
            </label>
          </>
        )}
      </div>

      {tab === 'order' && (
        <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-950">
          <table className="w-full min-w-[1100px] text-xs">
            <thead className="sticky top-0 bg-slate-900 text-[11px] uppercase tracking-wide text-slate-400">
              <tr>
                <th className="w-8 px-2 py-2" />
                <th className="px-2 py-2 text-right">#</th>
                <th className="px-2 py-2 text-left">Cut size</th>
                <th className="px-2 py-2 text-right">Qty</th>
                <th className="px-2 py-2 text-left">Part</th>
                <th className="px-2 py-2 text-left">Work order</th>
                <th className="px-2 py-2 text-left">Box (master order)</th>
                <th className="px-2 py-2 text-left">Sales order</th>
                <th className="px-2 py-2 text-left">Start</th>
                <th className="px-2 py-2 text-left">Why here</th>
              </tr>
            </thead>
            <tbody>
              {steps.map((s, i) => {
                const prev = steps[i - 1];
                const series = seriesById.get(s.seriesId);
                const newSeries = !prev || prev.seriesId !== s.seriesId;
                const ticked = ticks.has(s.item.id);
                return [
                  newSeries && series ? (
                    <tr key={`s${s.seriesId}-${s.index}`} className="border-b border-slate-800 bg-slate-900/80">
                      <td colSpan={10} className="px-3 py-1.5">
                        <span className="flex flex-wrap items-center gap-2">
                          {s.setup === 'saw' && <Badge className="border-amber-700 text-amber-300">change saw: {series.saw}</Badge>}
                          {series.material && <MaterialBadge material={series.material} />}
                          <span className="font-semibold text-slate-200">{series.stockNo ? `${series.stockNo} ${series.stockText ?? ''}` : 'no stock in the list'}</span>
                          {series.stripWidth !== null && <span className="text-slate-400">strip {series.stripWidth} mm{series.thickness ? ` × ${series.thickness}` : ''}</span>}
                          <span className="text-slate-500">
                            #{series.first}–{series.last} · {series.pieces} pcs
                          </span>
                        </span>
                      </td>
                    </tr>
                  ) : null,
                  <tr key={s.item.id} className={`border-b border-slate-900 hover:bg-slate-900/60 ${ticked ? 'opacity-40' : ''}`}>
                    <td className="px-2 py-1 text-center">
                      <input type="checkbox" checked={ticked} onChange={() => toggle(s.item.id)} title="Cut" />
                    </td>
                    <td className="mono px-2 py-1 text-right text-slate-500">{s.index}</td>
                    <td className={`mono px-2 py-1 font-semibold ${ticked ? 'line-through' : 'text-white'}`}>{s.item.cut ? s.item.cut.join(' × ') : '—'}</td>
                    <td className="mono px-2 py-1 text-right">{s.item.qty}</td>
                    <td className="px-2 py-1 text-slate-300">
                      {s.item.part.partName ?? s.item.part.text ?? ''}
                      {s.item.alert && <span className="ml-1 text-rose-300" title={s.item.alert.text}>⚠</span>}
                    </td>
                    <td className="mono px-2 py-1 text-slate-300">{s.item.part.workOrder}</td>
                    <td className="mono px-2 py-1 text-slate-400">{s.item.part.masterOrder}</td>
                    <td className="mono px-2 py-1 text-slate-400">{s.item.part.salesOrder}</td>
                    <td className="mono whitespace-nowrap px-2 py-1 text-slate-500">{s.startTime.slice(5, 16).replace('T', ' ')}</td>
                    <td className="px-2 py-1 text-slate-400">{s.why.join(' · ')}</td>
                  </tr>,
                ];
              })}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'questions' && (
        <div className="space-y-2">
          <p className="text-xs text-slate-400">
            These texts did not tell the material for sure. Type the material it means (for example ALU, FH, POM, PCGF, MS, INOX) and press Save: every part with that word follows it.
          </p>
          {cut.unknownMaterials.length === 0 && cut.conflicts.length === 0 && <Empty>Every material was understood.</Empty>}
          {cut.unknownMaterials.map(u => (
            <TokenRow key={u.token} token={u.token} count={u.count} examples={u.examples} current={settings.carpenter.materialTokens[u.token]} onSave={code => updateSettings(s => ({ ...s, carpenter: { ...s.carpenter, materialTokens: { ...s.carpenter.materialTokens, [u.token]: code } } }))} />
          ))}
          {cut.conflicts.map(c => (
            <div key={c.text} className="rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-2 text-xs">
              <div className="text-amber-300">
                {c.text} <span className="text-slate-500">({c.count} rows)</span>
              </div>
              {c.examples.map((e, i) => (
                <div key={i} className="mono text-slate-400">
                  {e.workOrder} · {e.measure} · {e.descriptionDe}
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      {tab === 'notready' && (
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
              {[...cut.blocked, ...cut.notReady, ...cut.elsewhere, ...cut.premade].map(it => (
                <tr key={it.id} className="border-b border-slate-900">
                  <td className="mono px-2 py-1">{it.part.workOrder}</td>
                  <td className="mono px-2 py-1 text-slate-400">{it.part.masterOrder}</td>
                  <td className="mono px-2 py-1 text-slate-300">{it.part.measure}</td>
                  <td className="px-2 py-1 text-slate-400">{it.part.descriptionDe}</td>
                  <td className="px-2 py-1 text-slate-400">{it.statusReason ?? (it.status === 'premade' ? 'pre-cut blank: only pick it' : it.status)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'priority' && <CarpenterPriority facts={facts} />}
      {tab === 'files' && <MissingFiles items={items} />}

      <details className="rounded-xl border border-slate-800 bg-slate-900/50 px-4 py-3 text-xs text-slate-400">
        <summary className="cursor-pointer text-slate-300">Refresh the carpenter list on the website (shop helper script)</summary>
        <p className="mt-2">Open the carpenter list on the website, press F12, paste this in the Console and press Enter. A panel offers "Refresh them all".</p>
        <CopyBox text={HELPER_CODE} label="Shop helper script" />
      </details>
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

function TokenRow({
  token,
  count,
  examples,
  current,
  onSave,
}: {
  token: string;
  count: number;
  examples: CutPlan['unknownMaterials'][number]['examples'];
  current?: string;
  onSave: (code: string) => void;
}) {
  const [v, setV] = useState(current ?? '');
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-2 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <span className="mono font-semibold text-white">“{token}”</span>
        <span className="text-slate-500">{count} rows</span>
        <input className={`${inputCls} w-28!`} placeholder="material" value={v} onChange={e => setV(e.target.value.toUpperCase())} />
        <Button size="sm" variant="secondary" disabled={!v.trim()} onClick={() => onSave(v.trim())}>
          Save
        </Button>
        {current && <span className="text-emerald-400">now: {current}</span>}
      </div>
      {examples.map((e, i) => (
        <div key={i} className="mono mt-0.5 text-slate-400">
          {e.workOrder} · {e.measure || '(no measure)'} · {e.descriptionDe || '(no stock)'} · {e.text}
        </div>
      ))}
    </div>
  );
}
