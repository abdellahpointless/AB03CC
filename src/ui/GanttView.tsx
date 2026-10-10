import { AlertOctagon, Gauge, Hammer, History, Lock, Maximize2, Pencil, Search, Flag, ZoomIn, ZoomOut } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { WorkCalendar, formatClock, formatDuration } from '../core/calendar';
import type { ScheduledJob, TimelineEvent } from '../core/types';
import { swatchFor, type ColorMode } from '../lib/colors';
import { timeBasisNote } from '../lib/timeBasis';
import { useStore } from '../state/store';
import { Button, Segmented, TimeMark } from './kit';
import { EVENT_TYPES, EventPopup, type EventDraft } from './EventPopup';
import { KpiBar } from './KpiBar';

const LABEL_W = 176;
const LANE_H = 76;
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const EVENT_COLORS = Object.fromEntries(EVENT_TYPES.map(t => [t.value, t.color])) as Record<TimelineEvent['type'], string>;
const STRIP_H = 18;
const SNAP = 5;

export function GanttView({ onSelect, onCarpenter }: { onSelect: (item: ScheduledJob) => void; onCarpenter: () => void }) {
  const { plan, previousPlan, settings, setLock, updateSettings, notify, saveEvent, removeEvent } = useStore();
  const [draft, setDraft] = useState<EventDraft | null>(null);
  const [drag, setDrag] = useState<{ lane: string; a: number; b: number } | null>(null);
  const [zoom, setZoom] = useState(1);
  const [colorMode, setColorMode] = useState<ColorMode>('material');
  const [query, setQuery] = useState('');
  const [showPrevious, setShowPrevious] = useState(false);
  const [showEff, setShowEff] = useState(false);
  const [hoverMo, setHoverMo] = useState<string | null>(null);
  const [tip, setTip] = useState<{ item: ScheduledJob; x: number; y: number } | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  // blocks glide to their new place after a re-plan, but must not lag behind the ruler while zooming
  const lastZoom = useRef(zoom);
  const zoomChanged = lastZoom.current !== zoom;
  useEffect(() => {
    lastZoom.current = zoom;
  });

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
  const hourStep = zoom >= 1.6 ? 30 : zoom >= 0.7 ? 60 : zoom >= 0.35 ? 120 : 240;
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

  const snap = (v: number) => Math.max(0, Math.round(v / SNAP) * SNAP);
  const minuteAt = (e: React.PointerEvent<HTMLElement>) => snap((e.clientX - e.currentTarget.getBoundingClientRect().left) / pxPerMin);

  const startDrag = (lane: string, e: React.PointerEvent<HTMLElement>) => {
    if (e.button !== 0 || draft) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const m = minuteAt(e);
    setDrag({ lane, a: m, b: m });
  };
  const moveDrag = (e: React.PointerEvent<HTMLElement>) => drag && setDrag({ ...drag, b: minuteAt(e) });
  const endDrag = (e: React.PointerEvent<HTMLElement>) => {
    if (!drag) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const start = Math.min(drag.a, drag.b);
    let len = Math.abs(drag.b - drag.a);
    if (len < SNAP) len = 60; // a plain click adds a one-hour disruption
    const type = EVENT_TYPES[0];
    const end = start + len;
    const hit = (plan?.queues[drag.lane] ?? []).filter(it => it.segments.some(sg => sg.startMinute < end && sg.endMinute > start && !it.job.isRework));
    const under = hit.find(it => it.segments.some(sg => sg.startMinute <= start && sg.endMinute > start)) ?? hit[0];
    const mid = under ? (under.startMinute + under.endMinute) / 2 : 0;
    setDraft({
      overlap: under ? { jobId: under.job.id, boxCode: under.job.boxCode } : undefined,
      placement: under && start < mid ? 'before' : 'after',
      lane: drag.lane,
      machineId: drag.lane,
      type: type.value,
      title: type.label,
      startMinute: start,
      durationMinutes: len,
      anchor: { x: rect.left + (start + len / 2) * pxPerMin, top: rect.top, bottom: rect.bottom },
    });
    setDrag(null);
  };
  const editEvent = (ev: TimelineEvent, lane: string, el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    setDraft({ ...ev, lane, anchor: { x: r.left + r.width / 2, top: r.top, bottom: r.bottom } });
  };
  const saveDraft = () => {
    if (!draft || draft.durationMinutes < 1) return;
    const { lane: _l, anchor: _a, overlap: _o, ...rest } = draft;
    const label = EVENT_TYPES.find(t => t.value === draft.type)?.label ?? 'Disruption';
    saveEvent({ ...rest, ...(draft.type === 'rework' ? { machineId: draft.lane } : { anchorJobId: undefined, placement: undefined }), id: draft.id ?? `ev-${Date.now().toString(36)}`, title: draft.title.trim() || label });
    setDraft(null);
  };

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
          <div className="text-[11px] text-slate-500">Click a box for details · drag a box onto another machine to pin it · drag along a machine's bottom strip to add a disruption</div>
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
          <Button size="sm" onClick={() => setZoom(z => Math.max(0.1, +(z / 1.25).toFixed(2)))} aria-label="Zoom out">
            <ZoomOut className="h-3.5 w-3.5" />
          </Button>
          <span className="mono w-10 text-center text-[11px] text-slate-400">{Math.round(zoom * 100)}%</span>
          <Button size="sm" onClick={() => setZoom(z => Math.min(5, +(z * 1.25).toFixed(2)))} aria-label="Zoom in">
            <ZoomIn className="h-3.5 w-3.5" />
          </Button>
          <Button
            size="sm"
            title="Fit the whole plan on screen"
            onClick={() => {
              const w = (scroller.current?.clientWidth ?? 1200) - LABEL_W - 16;
              setZoom(Math.min(5, Math.max(0.1, +(w / axisMinutes / 0.9).toFixed(2))));
              scroller.current?.scrollTo({ left: 0, behavior: 'smooth' });
            }}
          >
            <Maximize2 className="h-3.5 w-3.5" /> Fit
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
        </div>
      </div>

      {draft && <div className="fixed inset-0 z-40 bg-slate-950/60 backdrop-blur-sm" onMouseDown={() => setDraft(null)} />}
      <div className={`overflow-hidden rounded-xl border bg-slate-950 ${draft ? 'relative z-50 border-blue-500 shadow-2xl' : 'border-slate-800'}`}>
        <div ref={scroller} className="max-h-[calc(100vh-290px)] min-h-[360px] overflow-auto">
          <div style={{ width: width + LABEL_W, minWidth: '100%' }}>
            {/* ruler */}
            <div className="sticky top-0 z-40 flex h-9 border-b border-slate-800 bg-slate-900">
              <div style={{ width: LABEL_W }} className="sticky left-0 z-50 flex shrink-0 items-center border-r border-slate-800 bg-slate-900 px-3 text-[11px] font-bold uppercase tracking-wider text-slate-300">
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
                  <div style={{ width: LABEL_W }} className="sticky left-0 z-30 flex shrink-0 flex-col justify-between border-r border-slate-800 bg-slate-900 px-3 py-2 shadow-[4px_0_8px_-4px_rgba(0,0,0,0.6)]">
                    <div className="flex items-center justify-between gap-1">
                      <div className="flex items-center gap-1.5">
                        <span className={`h-2 w-2 rounded-full ${down ? 'bg-rose-500' : 'bg-emerald-400'}`} />
                        <span className="text-sm font-bold text-white">{machine.name}</span>
                      </div>
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

                  <div className="relative isolate min-w-0 flex-1 overflow-hidden" style={{ background: laneIdx % 2 ? 'rgba(15,23,42,0.35)' : 'transparent' }}>
                    {ticks.map((t, i) => (
                      <div key={i} style={{ left: t.x }} className={`absolute top-0 h-full border-l ${t.major ? 'border-slate-700' : 'border-slate-900'}`} />
                    ))}

                    {events.filter(ev => ev.id !== draft?.id).map(ev => (
                      <div key={ev.id}>
                        {ev.type !== 'rework' && <div
                          className="hatch pointer-events-none absolute top-0 z-[5] h-full border-x"
                          style={{ left: ev.startMinute * pxPerMin, width: Math.max(4, ev.durationMinutes * pxPerMin), backgroundColor: `${EVENT_COLORS[ev.type]}66`, borderColor: EVENT_COLORS[ev.type] }}
                        />}
                        <button
                          onClick={e => editEvent(ev, machine.id, e.currentTarget)}
                          title={`${ev.title} (${formatDuration(ev.durationMinutes)}) · click to edit`}
                          className="absolute z-[12] flex items-center gap-1 overflow-hidden whitespace-nowrap rounded-sm px-1 text-left text-[10px] font-bold text-white"
                          style={{ left: ev.startMinute * pxPerMin, width: Math.max(4, ev.durationMinutes * pxPerMin), bottom: 0, height: STRIP_H, background: EVENT_COLORS[ev.type] }}
                        >
                          <AlertOctagon className="h-3 w-3 shrink-0" /> {ev.title}
                        </button>
                      </div>
                    ))}

                    {/* disruption strip: drag here to select a time range */}
                    <div
                      onPointerDown={e => startDrag(machine.id, e)}
                      onPointerMove={moveDrag}
                      onPointerUp={endDrag}
                      onPointerCancel={() => setDrag(null)}
                      className="absolute inset-x-0 bottom-0 z-[11] cursor-crosshair border-t border-dashed border-slate-700/70 bg-slate-900/30 hover:bg-slate-800/50"
                      style={{ height: STRIP_H }}
                      title="Drag to add a disruption"
                    />
                    {((drag && drag.lane === machine.id) || (draft && draft.lane === machine.id)) &&
                      (() => {
                        const s0 = drag ? Math.min(drag.a, drag.b) : draft!.startMinute;
                        const len = drag ? Math.abs(drag.b - drag.a) : draft!.durationMinutes;
                        return (
                          <div
                            className="pointer-events-none absolute top-0 z-[13] h-full border-x-2 border-blue-400 bg-blue-500/25"
                            style={{ left: s0 * pxPerMin, width: Math.max(2, len * pxPerMin) }}
                          >
                            <span className="mono absolute left-1 top-1 rounded bg-blue-600 px-1 text-[10px] font-bold text-white">{formatDuration(len)}</span>
                          </div>
                        );
                      })()}

                    {items.map((it, itemIdx) => {
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
                                className={`gantt-block block-in absolute z-10 cursor-pointer overflow-hidden rounded-md border text-left shadow-md ${zoomChanged ? 'no-glide' : ''}`}
                                style={{
                                  '--glow': sw.bg,
                                  animationDelay: `${Math.min(laneIdx * 90 + itemIdx * 5, 760)}ms`,
                                  left: seg.startMinute * pxPerMin,
                                  width: w,
                                  top: 8,
                                  height: LANE_H - 16,
                                  background: sw.bg,
                                  borderColor: hoverMo === it.job.masterOrder ? '#fff' : it.job.isRework ? '#fbbf24' : sw.border,
                                  borderWidth: hoverMo === it.job.masterOrder ? 2 : 1,
                                  opacity: dim ? 0.25 : 1,
                                } as React.CSSProperties}
                              >
                                {it.isLate && <div className="absolute inset-x-0 top-0 h-[3px] bg-rose-500" />}
                                {si === 0 && <BlockLabel it={it} width={w} showEff={showEff} />}
                                {si === 0 && w >= 18 && it.timeBasis !== 'manual' && (
                                  <span
                                    className={`pointer-events-none absolute bottom-[3px] right-[3px] block h-[5px] w-[5px] rounded-full opacity-60 ${
                                      it.timeBasis === 'measured' ? 'bg-white' : 'border border-white'
                                    }`}
                                  />
                                )}
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
                      <div className="pointer-events-none absolute top-0 z-20 h-full w-px bg-orange-400 shadow-[0_0_8px_rgba(251,146,60,0.9)]" style={{ left: nowMinute * pxPerMin }} />
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {draft && (
        <EventPopup
          draft={draft}
          cal={cal}
          onChange={p => setDraft(d => (d ? { ...d, ...p } : d))}
          onSave={saveDraft}
          onCancel={() => setDraft(null)}
          onDelete={draft.id ? () => (removeEvent(draft.id!), setDraft(null)) : undefined}
        />
      )}
      <Legend mode={colorMode} multiplier={settings.estimateMultiplier} />
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
        <span className="truncate text-[11px] font-bold leading-none">{it.job.isRework ? '↻ ' : ''}{width > 52 ? `Box ${it.job.boxCode}` : it.job.boxCode}</span>
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
          {showEff && <span className="mono rounded bg-black/30 px-1 py-0.5">{it.timeBasis === 'measured' ? 'real' : `${it.efficiencyPercent}%`}</span>}
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
  const { settings } = useStore();
  const left = Math.min(tip.x + 14, window.innerWidth - 300);
  const top = Math.min(tip.y + 14, window.innerHeight - 200);
  return (
    <div style={{ left, top }} className="anim-fade-in pointer-events-none fixed z-50 w-72 rounded-lg border border-slate-600 bg-slate-900/95 p-3 text-xs shadow-2xl backdrop-blur">
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
        <dt>Time</dt>
        <dd className="text-slate-200">
          <TimeMark basis={it.timeBasis} className="-ml-1 text-slate-300" />
          {it.timeBasis === 'measured' ? `measured · ${Math.round((it.measuredPerPart ?? 0) * 10) / 10} min/part` : it.timeBasis === 'estimated' ? `estimated · ${it.efficiencyPercent}% eff.` : 'set by you'}
        </dd>
        <dt>Why here</dt><dd className="text-slate-200">{it.decidingRule}</dd>
      </dl>
      {it.partName && <div className="mt-1.5 text-[11px] text-slate-400">{it.partName}</div>}
      <div className="mt-1 text-[10px] leading-snug text-slate-500">{timeBasisNote(it, settings.estimateMultiplier)}</div>
      {it.carpenterOpen && <div className="mt-2 rounded bg-amber-950 px-2 py-1 text-amber-300">Carpenter parts still open for this module</div>}
      {it.isLate && <div className="mt-2 rounded bg-rose-950 px-2 py-1 text-rose-300">Finishes after its due date ({it.job.dueDate})</div>}
    </div>
  );
}

function Legend({ mode, multiplier }: { mode: ColorMode; multiplier: number }) {
  const mats = ['ALU', 'POM', 'FH', 'PCGF', 'MS', 'PEEK', 'PP', 'INOX', 'FR4'];
  const fake = (m: string) => swatchFor({ materialType: m } as never, 'material');
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-400">
      {mode === 'material' ? (
        mats.map(m => (
          <span key={m} className="flex items-center gap-1">
            <span className="h-2.5 w-2.5 rounded" style={{ background: fake(m).bg, border: `1px solid ${fake(m).border}` }} /> {m}
          </span>
        ))
      ) : (
        <span className="text-slate-500">
          Colours group boxes by {mode === 'masterOrder' ? 'master order' : 'sales order'}. Hover a box to highlight its whole module.
        </span>
      )}
      <span className="flex items-center gap-1"><span className="hatch h-2.5 w-4 rounded border border-slate-600 bg-slate-700/60" /> changeover</span>
      <span className="flex items-center gap-1"><TimeMark basis="measured" /> measured time</span>
      <span className="flex items-center gap-1"><TimeMark basis="estimated" /> estimated (NC × {multiplier})</span>
      <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded border-t-2 border-rose-500 bg-slate-700" /> past due</span>
      <span className="flex items-center gap-1"><span className="h-3 w-px bg-orange-400" /> now</span>
    </div>
  );
}
