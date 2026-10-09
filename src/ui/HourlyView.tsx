import { X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { formatDuration } from '../core/calendar';
import { computeThroughput, niceTicks, type Granularity, type Throughput, type ThroughputBucket } from '../core/throughput';
import { useStore } from '../state/store';
import { CountUp } from './CountUp';
import { Button, Card, Empty, Segmented } from './kit';

/* Series colours: blue and aqua are the validated dark-surface categorical steps; grey is the neutral "context" series. */
const COLOR = {
  mos: '#3987e5',
  held: '#898781',
  parts: '#199e70',
  grid: 'rgba(148,163,184,0.16)',
  dayLine: 'rgba(148,163,184,0.38)',
};

const UNIT: Record<Granularity, { one: string; many: string; col: number }> = {
  hour: { one: 'hour', many: 'hours', col: 30 },
  shift: { one: 'shift', many: 'shifts', col: 64 },
  day: { one: 'day', many: 'days', col: 92 },
};

const AXIS_W = 40;
const GAP = 2;
const fmt1 = (n: number) => (Math.round(n * 10) / 10).toLocaleString();

interface Segment {
  value: number;
  color: string;
}

export function HourlyView() {
  const { plan, settings } = useStore();
  const [g, setG] = useState<Granularity>('hour');
  const [hover, setHover] = useState<{ idx: number; x: number; y: number } | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [hideEmpty, setHideEmpty] = useState(true);

  const t = useMemo(() => (plan ? computeThroughput(plan, settings.calendar, g) : null), [plan, settings.calendar, g]);
  if (!plan) return null;
  if (!t || t.buckets.length === 0) return <Empty>Nothing is planned yet, so there is no output to show.</Empty>;

  const unit = UNIT[g];
  const col = unit.col;
  const n = t.buckets.length;
  const sel = selected !== null ? t.buckets[selected] : null;

  const mosTicks = niceTicks(t.maxMos, 3);
  const partsTicks = niceTicks(t.maxParts, 4);
  const anyHeld = t.totals.heldMos > 0;
  const avgMos = t.totals.mos / n;
  const avgParts = t.totals.parts / n;
  const busiest = t.peak;

  const stat = (label: string, value: React.ReactNode, sub?: React.ReactNode) => (
    <div className="min-w-[150px]">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{label}</div>
      <div className="text-2xl font-bold leading-tight text-white">{value}</div>
      {sub && <div className="mt-0.5 text-[11px] text-slate-400">{sub}</div>}
    </div>
  );

  return (
    <div className="space-y-3">
      <Card className="flex flex-wrap items-center gap-x-10 gap-y-4 px-5 py-4">
        {stat(
          'Master orders finished',
          <CountUp value={t.totals.mos} />,
          <>
            of {t.totals.mos + t.totals.heldMos} in the plan
            {anyHeld && <span className="text-amber-300"> · {t.totals.heldMos} on hold</span>}
          </>,
        )}
        {stat('Parts finished', <CountUp value={t.totals.parts} />, `${t.totals.pieces.toLocaleString()} pieces`)}
        {stat(`Average per ${unit.one}`, <span><CountUp value={avgMos} decimals={1} /> <span className="text-sm font-medium text-slate-400">MOs</span></span>, `${fmt1(avgParts)} parts per ${unit.one}`)}
        {busiest &&
          stat(
            `Busiest ${unit.one}`,
            <span className="text-lg">{g === 'day' ? busiest.label : `${busiest.dayLabel} ${busiest.label}`}</span>,
            `${busiest.parts.length} parts · ${busiest.mos.length + busiest.heldMos.length} master order${busiest.mos.length + busiest.heldMos.length === 1 ? '' : 's'}`,
          )}
        <div className="ml-auto flex flex-col items-end gap-1.5">
          <Segmented
            value={g}
            onChange={v => {
              setG(v);
              setSelected(null);
              setHover(null);
            }}
            options={[
              { value: 'hour', label: 'Per hour' },
              { value: 'shift', label: 'Per shift' },
              { value: 'day', label: 'Per day' },
            ]}
          />
          <span className="text-[11px] text-slate-500">A part counts in the {unit.one} it finishes in. A module counts when its last part finishes.</span>
        </div>
      </Card>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto pb-1">
          <div style={{ width: AXIS_W + n * col + 12 }} key={g}>
            <ChartRow
              title="Master orders finished"
              legend={
                anyHeld
                  ? [
                      { color: COLOR.mos, label: 'Finished' },
                      { color: COLOR.held, label: 'CNC done, module on hold' },
                    ]
                  : undefined
              }
              t={t}
              col={col}
              height={112}
              ticks={mosTicks}
              seg={b => [
                { value: b.mos.length, color: COLOR.mos },
                { value: b.heldMos.length, color: COLOR.held },
              ]}
              selected={selected}
              hover={hover?.idx ?? null}
              onHover={setHover}
              onSelect={setSelected}
            />
            <ChartRow
              title="Parts finished"
              t={t}
              col={col}
              height={150}
              ticks={partsTicks}
              seg={b => [{ value: b.parts.length, color: COLOR.parts }]}
              selected={selected}
              hover={hover?.idx ?? null}
              onHover={setHover}
              onSelect={setSelected}
            />
            <XAxis t={t} col={col} />
          </div>
        </div>
      </Card>

      {hover && <Tip b={t.buckets[hover.idx]} x={hover.x} y={hover.y} g={g} />}

      {sel && <Detail b={sel} g={g} onClose={() => setSelected(null)} />}

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 px-4 py-2.5">
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300">Output by {unit.one}</h3>
          <label className="flex items-center gap-1.5 text-xs text-slate-400">
            <input type="checkbox" className="accent-blue-500" checked={hideEmpty} onChange={e => setHideEmpty(e.target.checked)} /> Hide {unit.many} with nothing finishing
          </label>
        </div>
        <div className="max-h-[420px] overflow-auto">
          <table className="w-full min-w-[720px] max-w-5xl text-xs">
            <thead className="sticky top-0 z-10 bg-slate-900 text-left text-[11px] uppercase tracking-wide text-slate-400">
              <tr>
                <th className="px-4 py-2">{g === 'day' ? 'Day' : 'Time'}</th>
                <th className="px-3 text-right">Master orders</th>
                <th className="px-3 text-right">On hold</th>
                <th className="px-3 text-right">Parts</th>
                <th className="px-3 text-right">Pieces</th>
                <th className="px-3 text-right">Machines busy</th>
                <th className="px-3 text-right">MOs so far</th>
                <th className="px-3 text-right">Parts so far</th>
              </tr>
            </thead>
            <tbody>
              {t.days.map(day => {
                const rows = t.buckets.filter(b => b.dayIndex === day.dayIndex && (!hideEmpty || b.parts.length + b.mos.length + b.heldMos.length > 0));
                return (
                  <DayRows key={day.dayIndex} day={day} showHeader={g !== 'day'}>
                    {rows.map(b => (
                      <tr
                        key={b.index}
                        onClick={() => setSelected(s => (s === b.index ? null : b.index))}
                        className={`cursor-pointer border-b border-slate-900 transition-colors hover:bg-slate-900/80 ${selected === b.index ? 'bg-blue-950/40' : ''} ${
                          b.parts.length === 0 && b.mos.length === 0 ? 'text-slate-600' : 'text-slate-200'
                        }`}
                      >
                        <td className="mono px-4 py-1.5">{b.label}</td>
                        <td className="mono px-3 text-right font-semibold">{b.mos.length || '·'}</td>
                        <td className="mono px-3 text-right text-amber-300/90">{b.heldMos.length || '·'}</td>
                        <td className="mono px-3 text-right font-semibold">{b.parts.length || '·'}</td>
                        <td className="mono px-3 text-right text-slate-400">{b.pieces || '·'}</td>
                        <td className="mono px-3 text-right text-slate-400">{b.busyPercent}%</td>
                        <td className="mono px-3 text-right text-slate-500">{b.cumulativeMos}</td>
                        <td className="mono px-3 text-right text-slate-500">{b.cumulativeParts}</td>
                      </tr>
                    ))}
                  </DayRows>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function ChartRow({
  title,
  legend,
  t,
  col,
  height,
  ticks,
  seg,
  selected,
  hover,
  onHover,
  onSelect,
}: {
  title: string;
  legend?: Array<{ color: string; label: string }>;
  t: Throughput;
  col: number;
  height: number;
  ticks: number[];
  seg: (b: ThroughputBucket) => Segment[];
  selected: number | null;
  hover: number | null;
  onHover: (h: { idx: number; x: number; y: number } | null) => void;
  onSelect: (i: number | null) => void;
}) {
  const top = ticks[ticks.length - 1] || 1;
  const barW = Math.min(24, col - 8);
  // label only the tallest bar (selective direct labelling)
  const totals = t.buckets.map(b => seg(b).reduce((a, s) => a + s.value, 0));
  const peakValue = Math.max(0, ...totals);
  const peakIdx = peakValue > 0 ? totals.indexOf(peakValue) : -1;

  return (
    <div className="pt-3">
      <div className="sticky left-0 z-20 flex w-[min(100vw,640px)] flex-wrap items-baseline gap-x-4 gap-y-1 px-4 pb-2">
        <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300">{title}</h3>
        {legend?.map(l => (
          <span key={l.label} className="flex items-center gap-1.5 text-[11px] text-slate-400">
            <span className="h-2 w-2 rounded-[2px]" style={{ background: l.color }} /> {l.label}
          </span>
        ))}
      </div>
      <div className="flex">
        <div style={{ width: AXIS_W, height }} className="sticky left-0 z-10 shrink-0 bg-slate-900/95">
          {ticks.map(v => (
            <span key={v} className="mono absolute right-2 text-[10px] leading-none text-slate-500" style={{ bottom: (v / top) * height, transform: 'translateY(50%)' }}>
              {v}
            </span>
          ))}
        </div>
        <div className="relative" style={{ width: t.buckets.length * col, height }}>
          {ticks.map(v => (
            <div key={v} className="absolute inset-x-0" style={{ bottom: (v / top) * height, borderTop: `1px solid ${v === 0 ? 'rgba(148,163,184,0.4)' : COLOR.grid}` }} />
          ))}
          {t.buckets.map(b =>
            b.isDayStart && b.index > 0 ? (
              <div key={`d${b.index}`} className="absolute top-0 h-full" style={{ left: b.index * col, borderLeft: `1px solid ${COLOR.dayLine}` }} />
            ) : null,
          )}
          {t.buckets.map(b => {
            const segs = seg(b).filter(s => s.value > 0);
            const total = totals[b.index];
            const isSel = selected === b.index;
            return (
              <div
                key={b.index}
                role="img"
                tabIndex={0}
                aria-label={`${b.dayLabel} ${b.label}: ${b.mos.length} master orders, ${b.parts.length} parts finished`}
                className={`absolute top-0 h-full cursor-pointer outline-none transition-colors hover:bg-white/[0.05] focus-visible:bg-white/[0.08] ${isSel ? 'bg-white/[0.08]' : ''}`}
                style={{ left: b.index * col, width: col }}
                onPointerMove={e => onHover({ idx: b.index, x: e.clientX, y: e.clientY })}
                onPointerLeave={() => onHover(null)}
                onFocus={e => {
                  const r = e.currentTarget.getBoundingClientRect();
                  onHover({ idx: b.index, x: r.left + r.width / 2, y: r.top });
                }}
                onBlur={() => onHover(null)}
                onClick={() => onSelect(isSel ? null : b.index)}
                onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onSelect(isSel ? null : b.index))}
              >
                <div className="absolute bottom-0 flex flex-col-reverse" style={{ left: (col - barW) / 2, width: barW, gap: GAP }}>
                  {segs.map((s, i) => {
                    const h = Math.max(3, (s.value / top) * height - (i > 0 ? GAP : 0));
                    return (
                      <div
                        key={i}
                        className="bar-grow"
                        style={{
                          height: h,
                          background: s.color,
                          borderRadius: i === segs.length - 1 ? '4px 4px 0 0' : 0,
                          animationDelay: `${Math.min(b.index * 9, 480)}ms`,
                          opacity: hover !== null && hover !== b.index ? 0.55 : 1,
                        }}
                      />
                    );
                  })}
                </div>
                {b.index === peakIdx && total > 0 && (
                  <span
                    className="mono absolute left-1/2 -translate-x-1/2 text-[11px] font-semibold text-slate-200"
                    style={{ bottom: Math.min(height - 14, (total / top) * height + 4) }}
                  >
                    {total}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function XAxis({ t, col }: { t: Throughput; col: number }) {
  return (
    <div className="flex pb-2 pt-1">
      <div style={{ width: AXIS_W }} className="sticky left-0 z-10 shrink-0 bg-slate-900/95" />
      <div className="relative" style={{ width: t.buckets.length * col, height: t.granularity === 'day' ? 22 : 38 }}>
        {t.buckets.map(b => (
          <div key={b.index} className="absolute top-0 text-center" style={{ left: b.index * col, width: col }}>
            {t.granularity !== 'day' && (
              <span className="mono block text-[10px] text-slate-500">{t.granularity === 'hour' ? b.startIso.slice(11, 13) : b.label.slice(0, 5)}</span>
            )}
            {b.isDayStart && (
              <span
                className="absolute left-0 whitespace-nowrap text-[10px] font-semibold text-slate-300"
                style={{ top: t.granularity === 'day' ? 2 : 18, ...(t.granularity === 'day' ? { width: col, textAlign: 'center' as const } : { paddingLeft: 3 }) }}
              >
                {b.dayLabel}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function Tip({ b, x, y, g }: { b: ThroughputBucket; x: number; y: number; g: Granularity }) {
  const left = Math.min(x + 16, window.innerWidth - 320);
  const top = Math.min(y + 16, window.innerHeight - 300);
  const machines = Object.entries(b.byMachine).filter(([, v]) => v > 0);
  const list = (items: Array<{ masterOrder: string; customer: string }>) => (
    <ul className="mt-0.5 space-y-0.5">
      {items.slice(0, 5).map(m => (
        <li key={m.masterOrder} className="flex gap-2 text-[11px] text-slate-400">
          <span className="mono text-slate-200">{m.masterOrder}</span>
          <span className="truncate">{m.customer}</span>
        </li>
      ))}
      {items.length > 5 && <li className="text-[11px] text-slate-500">+ {items.length - 5} more</li>}
    </ul>
  );
  return (
    <div style={{ left, top }} className="anim-fade-in pointer-events-none fixed z-50 w-72 rounded-lg border border-slate-600 bg-slate-900/95 p-3 text-xs shadow-2xl backdrop-blur">
      <div className="flex items-baseline justify-between">
        <span className="font-bold text-white">{b.label}</span>
        <span className="text-[11px] text-slate-400">{g === 'day' ? '' : b.dayLabel}</span>
      </div>
      <div className="mt-2 flex items-baseline justify-between">
        <span className="text-slate-400">Master orders finished</span>
        <span className="mono text-base font-bold text-white">{b.mos.length}</span>
      </div>
      {b.mos.length > 0 && list(b.mos)}
      {b.heldMos.length > 0 && (
        <div className="mt-2 border-t border-slate-800 pt-2">
          <div className="flex items-baseline justify-between">
            <span className="text-slate-400">CNC done, on hold</span>
            <span className="mono font-bold text-amber-300">{b.heldMos.length}</span>
          </div>
          {list(b.heldMos)}
        </div>
      )}
      <div className="mt-2 flex items-baseline justify-between border-t border-slate-800 pt-2">
        <span className="text-slate-400">Parts finished</span>
        <span className="mono text-base font-bold text-white">
          {b.parts.length} <span className="text-[11px] font-normal text-slate-400">({b.pieces} pcs)</span>
        </span>
      </div>
      {machines.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {machines.map(([m, v]) => (
            <span key={m} className="mono whitespace-nowrap rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-300">
              {m} ×{v}
            </span>
          ))}
        </div>
      )}
      <div className="mt-1 text-[11px] text-slate-500">Machines busy {b.busyPercent}% · click to pin these details</div>
    </div>
  );
}

function Detail({ b, g, onClose }: { b: ThroughputBucket; g: Granularity; onClose: () => void }) {
  const all = [...b.mos.map(m => ({ ...m, held: false })), ...b.heldMos.map(m => ({ ...m, held: true }))];
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-bold text-white">
            {b.dayLabel}
            {g !== 'day' && <span className="mono ml-2 text-slate-300">{b.label}</span>}
          </h3>
          <p className="text-xs text-slate-400">
            {b.mos.length} master order{b.mos.length === 1 ? '' : 's'} finished
            {b.heldMos.length > 0 && ` (+${b.heldMos.length} on hold)`} · {b.parts.length} part{b.parts.length === 1 ? '' : 's'} ({b.pieces} pieces) · machines busy {b.busyPercent}% · {formatDuration(b.busyMinutes)} machining
          </p>
        </div>
        <Button size="sm" variant="ghost" onClick={onClose} aria-label="Close details">
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>
      <div className="mt-3 grid gap-4 lg:grid-cols-2">
        <div>
          <h4 className="mb-1 text-[11px] font-bold uppercase tracking-wider text-slate-400">Master orders</h4>
          {all.length === 0 ? (
            <p className="text-xs text-slate-500">No module completes in this {g}.</p>
          ) : (
            <ul className="max-h-56 space-y-1 overflow-y-auto pr-1">
              {all.map(m => (
                <li key={m.masterOrder} className="flex items-center gap-2 rounded-md bg-slate-950/60 px-2 py-1.5 text-xs">
                  <span className="h-2 w-2 shrink-0 rounded-[2px]" style={{ background: m.held ? COLOR.held : COLOR.mos }} />
                  <span className="mono font-semibold text-slate-100">{m.masterOrder}</span>
                  <span className="truncate text-slate-400">{m.customer}</span>
                  <span className="mono ml-auto shrink-0 text-slate-500">{m.parts} parts</span>
                  {m.hold && <span className="shrink-0 rounded border border-amber-800 px-1 text-[10px] text-amber-300">{m.hold === 'carpenter' ? 'carpenter' : 'parts missing'}</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <h4 className="mb-1 text-[11px] font-bold uppercase tracking-wider text-slate-400">Parts</h4>
          {b.parts.length === 0 ? (
            <p className="text-xs text-slate-500">No part finishes in this {g}.</p>
          ) : (
            <ul className="max-h-56 space-y-1 overflow-y-auto pr-1">
              {b.parts.map((p, i) => (
                <li key={i} className="flex items-center gap-2 rounded-md bg-slate-950/60 px-2 py-1.5 text-xs">
                  <span className="mono w-14 shrink-0 font-semibold text-amber-300">{p.rework ? '↻ ' : ''}{p.boxCode}</span>
                  <span className="shrink-0 text-slate-300">{p.machineId}</span>
                  <span className="truncate text-slate-500">{p.materialType}</span>
                  <span className="mono ml-auto shrink-0 text-slate-400">{p.endTime.slice(11, 16)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Card>
  );
}

function DayRows({ day, showHeader, children }: { day: Throughput['days'][number]; showHeader: boolean; children: React.ReactNode }) {
  return (
    <>
      {showHeader && (
        <tr className="bg-slate-900/70">
          <td colSpan={8} className="px-4 py-1.5 text-[11px] font-bold text-slate-300">
            {day.label}
            <span className="ml-3 font-normal text-slate-500">
              {day.mos} master order{day.mos === 1 ? '' : 's'}
              {day.heldMos > 0 && ` (+${day.heldMos} on hold)`} · {day.parts} parts · {day.pieces} pieces
            </span>
          </td>
        </tr>
      )}
      {children}
    </>
  );
}
