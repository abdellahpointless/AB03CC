import { AlertOctagon, Gauge, Hammer, History, Lock, Pencil, Plus, Search, Flag, ZoomIn, ZoomOut } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { WorkCalendar, formatClock, formatDuration } from '../core/calendar';
import type { ScheduledJob, TimelineEvent } from '../core/types';
import { swatchFor, type ColorMode } from '../lib/colors';
import { useStore } from '../state/store';
import { Button, Segmented } from './kit';
import { KpiBar } from './KpiBar';

const LABEL_W = 176;
const LANE_H = 76;
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const EVENT_COLORS: Record<TimelineEvent['type'], string> = {
  breakdown: '#dc2626',
  rework: '#d97706',
  absent: '#7c3aed',
  maintenance: '#0891b2',
  material_shortage: '#db2777',
  other: '#64748b',
};

export function GanttView({
  onSelect,
  onEditEvent,
  onCarpenter,
}: {
  onSelect: (item: ScheduledJob) => void;
  onEditEvent: (event: Partial<TimelineEvent>) => void;
  onCarpenter: () => void;
}) {
  const { plan, previousPlan, settings, setLock, updateSettings, notify } = useStore();
  const [zoom, setZoom] = useState(1);
  const [colorMode, setColorMode] = useState<ColorMode>('material');
  const [query, setQuery] = useState('');
  const [showPrevious, setShowPrevious] = useState(false);
  const [showEff, setShowEff] = useState(false);
  const [hoverMo, setHoverMo] = useState<string | null>(null);
  const [tip, setTip] = useState<{ item: ScheduledJob; x: number; y: number } | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);

  const cal = useMemo(() => new WorkCalendar(settings.calendar), [settings.calendar]);
  const machines = settings.machines;
  const pxPerMin = 0.9 * zoom;

  const lastEventEnd = settings.timelineEvents.reduce((m, e) => Math.max(m, e.startMinute + e.durationMinutes), 0);
  const prevMakespan = showPrevious && previousPlan ? previousPlan.kpis.makespanMinutes : 0;
  const axisMinutes = Math.max(plan?.kpis.makespanMinutes ?? 0, prevMakespan, lastEventEnd, 60) + 90;
  const width = axisMinutes * pxPerMin;

  const q = query.trim().toLowerCase();
  const matches = (it: ScheduledJob) =>
    !q ||
    [it.job.boxCode, it.job.masterOrder, it.job.orderNumber, it.job.salesOrder, it.job.customer, it.job.matnr, it.job.materialType]
      .join(' ')
      .toLowerCase()
      .includes(q);

  const nowMinute = useMemo(() => {
    const now = new Date();
    const start = cal.toDate(0);
    return now.getTime() >= start.getTime() ? cal.fromDate(now) : null;
  }, [cal]);

  const prevByJob = useMemo(() => {
    const map = new Map<string, ScheduledJob>();
    if (previousPlan) Object.values(previousPlan.queues).flat().forEach(i => map.set(i.job.id, i));
    return map;
  }, [previousPlan]);

  if (!plan) return null;

  /* ruler */
  const ticks: Array<{ x: number; label: string; major: boolean }> = [];
  const hourStep = zoom >= 1.6 ? 30 : zoom >= 0.7 ? 60 : 120;
  for (let m = 0; m <= axisMinutes; m += hourStep) {
    const d = cal.toDate(m);
    const dayStart = m % cal.dayLen === 0;
    ticks.push({
      x: m * pxPerMin,
      major: dayStart,
      label: dayStart
        ? `${DAY_NAMES[d.getDay()]} ${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`
        : `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`,
    });
  }

  const onDrop = (machineId: string, jobId: string | null) => {
    setDragOver(null);
    if (!jobId) return;
    const current = Object.values(plan.queues)
      .flat()
      .find(i => i.job.id === jobId);
    if (current?.machineId === machineId) return;
    setLock(jobId, { machine: machineId });
    notify(`Box ${current?.job.boxCode ?? jobId} pinned to ${machineId}. Reset it from the job details to unpin.`, 'ok');
  };

  return (
    <div className="space-y-3">
      <KpiBar plan={plan} onCarpenter={onCarpenter} />

      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-800 bg-slate-900/70 px-4 py-2.5">
        <div className="mr-2">
          <div className="text-[11px] font-bold uppercase tracking-wider text-slate-300">Machine timeline</div>
          <div className="text-[11px] text-slate-500">Click a box for details · drag a box onto another machine to pin it there</div>
        </div>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-1.5 h-3.5 w-3.5 text-slate-500" />
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Find box, MO, sales order…"
            className="w-52 rounded-md border border-slate-700 bg-slate-950 py-1.5 pl-7 pr-2 text-xs outline-none focus:border-blue-500"
          />
        </div>
        <Segmented
          value={colorMode}
          onChange={setColorMode}
          options={[
            { value: 'material', label: 'Material' },
            { value: 'masterOrder', label: 'MO #' },
            { value: 'salesOrder', label: 'SO #' },
          ]}
        />
        <div className="flex items-center gap-1">
          <Button size="sm" onClick={() => setZoom(z => Math.max(0.25, +(z / 1.25).toFixed(2)))} aria-label="Zoom out">
            <ZoomOut className="h-3.5 w-3.5" />
          </Button>
          <span className="mono w-10 text-center text-[11px] text-slate-400">{Math.round(zoom * 100)}%</span>
          <Button size="sm" onClick={() => setZoom(z => Math.min(5, +(z * 1.25).toFixed(2)))} aria-label="Zoom in">
            <ZoomIn className="h-3.5 w-3.5" />
          </Button>
        </div>
        <Button size="sm" variant={showPrevious ? 'primary' : 'secondary'} disabled={!previousPlan} onClick={() => setShowPrevious(v => !v)} title="Overlay the schedule from before your last change">
          <History className="h-3.5 w-3.5" /> Previous plan
        </Button>
        <Button size="sm" variant={showEff ? 'primary' : 'secondary'} onClick={() => setShowEff(v => !v)} title="Show the efficiency each box is planned at">
          <Gauge className="h-3.5 w-3.5" /> Eff %: {showEff ? 'ON' : 'OFF'}
        </Button>
        <div className="ml-auto flex items-center gap-2">
          <Button
            size="sm"
            variant={settings.restartJobOnEvent ? 'primary' : 'secondary'}
            onClick={() => updateSettings({ restartJobOnEvent: !settings.restartJobOnEvent })}
            title="When a disruption hits a running job: restart it afterwards instead of pausing and resuming"
          >
            {settings.restartJobOnEvent ? 'Restart on event' : 'Pause & resume'}
          </Button>
          <Button size="sm" variant="danger" onClick={() => onEditEvent({ machineId: 'ALL', startMinute: Math.round(nowMinute ?? 0) })}>
            <Plus className="h-3.5 w-3.5" /> Add event
          </Button>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-800 bg-slate-950">
        <div ref={scroller} className="max-h-[calc(100vh-290px)] min-h-[360px] overflow-auto">
          <div style={{ width: width + LABEL_W, minWidth: '100%' }}>
            {/* ruler */}
            <div className="sticky top-0 z-20 flex h-9 border-b border-slate-800 bg-slate-900">
              <div style={{ width: LABEL_W }} className="sticky left-0 z-30 flex shrink-0 items-center border-r border-slate-800 bg-slate-900 px-3 text-[11px] font-bold uppercase tracking-wider text-slate-300">
                Machine center
              </div>
              <div className="relative flex-1">
                {ticks.map((t, i) => (
                  <div
                    key={i}
                    style={{ left: t.x }}
                    className={`absolute top-0 flex h-full items-center border-l pl-1.5 text-[10px] ${
                      t.major ? 'border-slate-500 font-bold text-slate-200' : 'border-slate-800 text-slate-500'
                    }`}
                  >
                    {t.label}
                  </div>
                ))}
              </div>
            </div>

            {machines.map((machine, laneIdx) => {
              const items = plan.queues[machine.id] ?? [];
              const load = plan.kpis.loadPerMachine[machine.id];
              const finish = plan.kpis.finishPerMachine[machine.id] ?? 0;
              const events = settings.timelineEvents.filter(e => e.machineId === machine.id || e.machineId === 'ALL');
              const down = machine.isDown;
              return (
                <div
                  key={machine.id}
                  className={`flex border-b border-slate-800 ${dragOver === machine.id ? 'bg-blue-950/30' : ''}`}
                  style={{ height: LANE_H + 14 }}
                  onDragOver={e => (e.preventDefault(), setDragOver(machine.id))}
                  onDragLeave={() => setDragOver(null)}
                  onDrop={e => (e.preventDefault(), onDrop(machine.id, e.dataTransfer.getData('text/plain')))}
                >
                  <div style={{ width: LABEL_W }} className="sticky left-0 z-10 flex shrink-0 flex-col justify-between border-r border-slate-800 bg-slate-900 px-3 py-2">
                    <div className="flex items-center justify-between gap-1">
                      <div className="flex items-center gap-1.5">
                        <span className={`h-2 w-2 rounded-full ${down ? 'bg-rose-500' : 'bg-emerald-400'}`} />
                        <span className="text-sm font-bold text-white">{machine.name}</span>
                      </div>
                      <button
                        onClick={() => onEditEvent({ machineId: machine.id, startMinute: Math.round(nowMinute ?? 0) })}
                        className="rounded border border-slate-700 px-1.5 py-0.5 text-[10px] text-slate-300 hover:bg-slate-800"
                      >
                        + Event
                      </button>
                    </div>
                    <div className="mono text-[11px] text-slate-400">
                      {down ? (
                        <span className="text-rose-400">MACHINE DOWN</span>
                      ) : (
                        <>
                          {load?.jobs ?? 0} boxes · <span className="text-amber-300">{((load?.machineMinutes ?? 0) / 60).toFixed(1)}h</span>
                        </>
                      )}
                    </div>
                    <div className="mono text-[10px] text-slate-500">
                      Finish: <span className="text-slate-300">{items.length ? finishLabel(cal, finish) : '—'}</span>
                    </div>
                  </div>

                  <div className="relative flex-1" style={{ background: laneIdx % 2 ? 'rgba(15,23,42,0.35)' : 'transparent' }}>
                    {ticks.map((t, i) => (
                      <div key={i} style={{ left: t.x }} className={`absolute top-0 h-full border-l ${t.major ? 'border-slate-700' : 'border-slate-900'}`} />
                    ))}

                    {events.map(ev => (
                      <button
                        key={ev.id}
                        onClick={() => onEditEvent(ev)}
                        title={`${ev.title} (${formatDuration(ev.durationMinutes)})`}
                        className="hatch absolute top-0 z-[5] flex h-full items-start overflow-hidden border-x text-left text-[10px] font-bold text-white"
                        style={{
                          left: ev.startMinute * pxPerMin,
                          width: Math.max(4, ev.durationMinutes * pxPerMin),
                          background: `${EVENT_COLORS[ev.type]}99`,
                          borderColor: EVENT_COLORS[ev.type],
                        }}
                      >
                        <span className="m-1 flex items-center gap-1 whitespace-nowrap">
                          <AlertOctagon className="h-3 w-3" /> {ev.title}
                        </span>
                      </button>
                    ))}

                    {items.map(it => {
                      const sw = swatchFor(it.job, colorMode);
                      const dim = (q && !matches(it)) || (hoverMo && hoverMo !== it.job.masterOrder);
                      const prev = showPrevious ? prevByJob.get(it.job.id) : undefined;
                      return (
                        <div key={it.job.id}>
                          {it.setupBefore > 0 && (
                            <div
                              className="hatch absolute z-[6] rounded-l border border-slate-700 bg-slate-800/50 opacity-70"
                              style={{ left: (it.startMinute - it.setupBefore) * pxPerMin, width: it.setupBefore * pxPerMin, top: 10, height: LANE_H - 20 }}
                              title={`Changeover ${it.setupBefore} min`}
                            />
                          )}
                          {it.segments.map((seg, si) => {
                            const w = Math.max(3, (seg.endMinute - seg.startMinute) * pxPerMin);
                            return (
                              <div
                                key={si}
                                draggable
                                onDragStart={e => (e.dataTransfer.setData('text/plain', it.job.id), (e.dataTransfer.effectAllowed = 'move'))}
                                onClick={() => onSelect(it)}
                                onMouseEnter={e => (setHoverMo(it.job.masterOrder), setTip({ item: it, x: e.clientX, y: e.clientY }))}
                                onMouseMove={e => setTip({ item: it, x: e.clientX, y: e.clientY })}
                                onMouseLeave={() => (setHoverMo(null), setTip(null))}
                                className="absolute z-10 cursor-pointer overflow-hidden rounded-md border text-left shadow-md transition-opacity"
                                style={{
                                  left: seg.startMinute * pxPerMin,
                                  width: w,
                                  top: 8,
                                  height: LANE_H - 16,
                                  background: sw.bg,
                                  borderColor: hoverMo === it.job.masterOrder ? '#fff' : sw.border,
                                  borderWidth: hoverMo === it.job.masterOrder ? 2 : 1,
                                  opacity: dim ? 0.25 : 1,
                                }}
                              >
                                {it.isLate && <div className="absolute inset-x-0 top-0 h-[3px] bg-rose-500" />}
                                {si === 0 && <BlockLabel it={it} width={w} showEff={showEff} />}
                              </div>
                            );
                          })}
                          {prev && (
                            <div
                              className="absolute z-[4] h-1.5 rounded-full border"
                              style={{
                                left: prev.startMinute * pxPerMin,
                                width: Math.max(3, (prev.endMinute - prev.startMinute) * pxPerMin),
                                bottom: 3,
                                borderColor: prev.machineId === it.machineId ? '#94a3b8' : '#fbbf24',
                                background: prev.machineId === it.machineId ? '#475569' : '#78350f',
                              }}
                              title={`Before: ${prev.machineId} ${formatClock(prev.startTime)}`}
                            />
                          )}
                        </div>
                      );
                    })}

                    {nowMinute !== null && nowMinute < axisMinutes && (
                      <div className="pointer-events-none absolute top-0 z-20 h-full w-px bg-orange-400" style={{ left: nowMinute * pxPerMin }} />
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <Legend mode={colorMode} />
      {tip && <Tooltip tip={tip} />}
    </div>
  );
}

function finishLabel(cal: WorkCalendar, minute: number): string {
  const iso = cal.toIso(minute, true);
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)} ${iso.slice(11, 16)}`;
}

function BlockLabel({ it, width, showEff }: { it: ScheduledJob; width: number; showEff: boolean }) {
  if (width < 26) return null;
  return (
    <div className="flex h-full flex-col justify-between p-1 text-white">
      <div className="flex items-center justify-between gap-1">
        <span className="truncate text-[11px] font-bold leading-none">{width > 52 ? `Box ${it.job.boxCode}` : it.job.boxCode}</span>
        <span className="flex shrink-0 items-center gap-0.5">
          {it.carpenterOpen && width > 40 && <Hammer className="h-2.5 w-2.5 text-amber-300" />}
          {(it.userLocked || it.manualDuration || it.manualStart) && width > 40 && (it.userLocked ? <Lock className="h-2.5 w-2.5" /> : <Pencil className="h-2.5 w-2.5" />)}
          {it.closesBox && width > 40 && <Flag className="h-2.5 w-2.5 text-emerald-200" />}
        </span>
      </div>
      {width > 44 && (
        <div className="flex items-center gap-1 text-[9px] font-semibold leading-none">
          <span className="rounded bg-black/30 px-1 py-0.5">{it.job.materialType}</span>
          {width > 90 && <span className="truncate opacity-90">MO …{it.job.masterOrder.slice(-5)}</span>}
          {showEff && <span className="mono rounded bg-black/30 px-1 py-0.5">{it.efficiencyPercent}%</span>}
        </div>
      )}
      {width > 70 && (
        <div className="mono truncate text-[9px] leading-none opacity-85">
          {formatClock(it.startTime)} → {formatClock(it.endTime)}
          {width > 120 && ` · ${formatDuration(it.durationMin)}`}
        </div>
      )}
    </div>
  );
}

function Tooltip({ tip }: { tip: { item: ScheduledJob; x: number; y: number } }) {
  const { item: it } = tip;
  const left = Math.min(tip.x + 14, window.innerWidth - 300);
  const top = Math.min(tip.y + 14, window.innerHeight - 200);
  return (
    <div style={{ left, top }} className="pointer-events-none fixed z-50 w-72 rounded-lg border border-slate-600 bg-slate-900 p-3 text-xs shadow-2xl">
      <div className="flex items-center justify-between">
        <span className="font-bold text-white">Box {it.job.boxCode}</span>
        <span className="mono text-slate-400">#{it.sequence} on {it.machineId}</span>
      </div>
      <div className="mt-1 text-slate-300">{it.job.customer}</div>
      <dl className="mono mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[11px] text-slate-400">
        <dt>Master order</dt><dd className="text-slate-200">{it.job.masterOrder}</dd>
        <dt>Matnr</dt><dd className="text-slate-200">{it.job.matnr} · {it.job.materialType}</dd>
        <dt>Run</dt><dd className="text-slate-200">{formatClock(it.startTime)} → {formatClock(it.endTime)} ({formatDuration(it.durationMin)})</dd>
        <dt>Setup</dt><dd className="text-slate-200">{it.setupBefore} min</dd>
        <dt>Efficiency</dt><dd className="text-slate-200">{it.efficiencyPercent}% ({it.efficiencySource})</dd>
        <dt>Why here</dt><dd className="text-slate-200">{it.decidingRule}</dd>
      </dl>
      {it.carpenterOpen && <div className="mt-2 rounded bg-amber-950 px-2 py-1 text-amber-300">Carpenter parts still open for this module</div>}
      {it.isLate && <div className="mt-2 rounded bg-rose-950 px-2 py-1 text-rose-300">Finishes after its due date ({it.job.dueDate})</div>}
    </div>
  );
}

function Legend({ mode }: { mode: ColorMode }) {
  if (mode !== 'material') {
    return <p className="text-[11px] text-slate-500">Colours group boxes by {mode === 'masterOrder' ? 'master order' : 'sales order'}: boxes of the same group share a colour. Hover a box to highlight its whole module.</p>;
  }
  const mats = ['ALU', 'POM', 'FH', 'PCGF', 'MS', 'PEEK', 'PP', 'INOX', 'FR4'];
  const fake = (m: string) => swatchFor({ materialType: m } as never, 'material');
  return (
    <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-400">
      {mats.map(m => (
        <span key={m} className="flex items-center gap-1">
          <span className="h-2.5 w-2.5 rounded" style={{ background: fake(m).bg, border: `1px solid ${fake(m).border}` }} /> {m}
        </span>
      ))}
      <span className="flex items-center gap-1"><span className="hatch h-2.5 w-4 rounded border border-slate-600 bg-slate-700/60" /> changeover</span>
      <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded border-t-2 border-rose-500 bg-slate-700" /> past due</span>
      <span className="flex items-center gap-1"><span className="h-3 w-px bg-orange-400" /> now</span>
    </div>
  );
}
