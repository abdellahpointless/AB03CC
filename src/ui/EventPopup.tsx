import { Trash2 } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { WorkCalendar, formatDuration } from '../core/calendar';
import type { TimelineEvent, TimelineEventType } from '../core/types';
import { inputCls } from './kit';

export const EVENT_TYPES: Array<{ value: TimelineEventType; label: string; color: string }> = [
  { value: 'breakdown', label: 'Breakdown', color: '#dc2626' },
  { value: 'maintenance', label: 'Maintenance', color: '#0891b2' },
  { value: 'absent', label: 'Operator absent', color: '#7c3aed' },
  { value: 'material_shortage', label: 'No material', color: '#db2777' },
  { value: 'rework', label: 'Rework', color: '#d97706' },
  { value: 'other', label: 'Other', color: '#64748b' },
];

export interface EventDraft extends Omit<TimelineEvent, 'id'> {
  id?: string;
  /** lane the user dragged in (the event itself may apply to ALL machines) */
  lane: string;
  /** part under the selection (rework can go before or after it) */
  overlap?: { jobId: string; boxCode: string };
  anchor: { x: number; top: number; bottom: number };
}

const clock = (d: Date) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

/** Small floating form shown next to the dragged time range. Everything behind it is blurred by the parent. */
export function EventPopup({
  draft,
  cal,
  onChange,
  onSave,
  onCancel,
  onDelete,
}: {
  draft: EventDraft;
  cal: WorkCalendar;
  onChange: (p: Partial<EventDraft>) => void;
  onSave: () => void;
  onCancel: () => void;
  onDelete?: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const W = 320;
  const H = 330;
  const left = Math.max(8, Math.min(draft.anchor.x - W / 2, window.innerWidth - W - 8));
  const below = draft.anchor.bottom + 10;
  const top = below + H > window.innerHeight ? Math.max(8, draft.anchor.top - H - 10) : below;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
      if (e.key === 'Enter' && (e.target as HTMLElement).tagName !== 'TEXTAREA') onSave();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel, onSave]);

  const start = cal.toDate(draft.startMinute);
  const end = cal.toDate(draft.startMinute + draft.durationMinutes, true);

  return (
    <div
      ref={ref}
      style={{ left, top, width: W }}
      className="anim-scale-in fixed z-[60] rounded-xl border border-slate-600 bg-slate-900 p-3 shadow-2xl"
      onMouseDown={e => e.stopPropagation()}
    >
      <div className="mb-2 flex items-baseline justify-between">
        <span className="text-xs font-bold text-white">{draft.id ? 'Edit disruption' : 'New disruption'}</span>
        <span className="mono text-[11px] text-slate-400">
          {clock(start)} → {clock(end)} · {formatDuration(draft.durationMinutes)}
        </span>
      </div>

      <div className="grid grid-cols-3 gap-1.5">
        {EVENT_TYPES.map(t => {
          const on = draft.type === t.value;
          return (
            <button
              key={t.value}
              onClick={() => {
                const wasDefault = EVENT_TYPES.some(x => x.label === draft.title) || draft.title === '';
                onChange({
                  type: t.value,
                  title: wasDefault ? t.label : draft.title,
                  ...(t.value === 'rework' ? { machineId: draft.lane, anchorJobId: draft.overlap?.jobId, placement: draft.placement ?? 'after' } : {}),
                });
              }}
              className={`rounded-md border px-1.5 py-1.5 text-[11px] font-semibold leading-tight transition-colors ${
                on ? 'text-white' : 'border-slate-700 text-slate-300 hover:bg-slate-800'
              }`}
              style={on ? { background: t.color, borderColor: t.color } : undefined}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      <input
        autoFocus
        className={`${inputCls} mt-2`}
        value={draft.title}
        placeholder="Title"
        onChange={e => onChange({ title: e.target.value })}
        aria-label="Title"
      />

      {draft.type === 'rework' && (
        <div className="mt-2 space-y-2">
          <input className={inputCls} placeholder="Box code being reworked (optional)" value={draft.boxCode ?? ''} onChange={e => onChange({ boxCode: e.target.value.trim() })} aria-label="Box code" />
          {draft.overlap ? (
            <div>
              <p className="mb-1 text-[11px] text-slate-400">
                This lands on <b className="text-white">Box {draft.overlap.boxCode}</b>. Parts are never split, so the rework goes:
              </p>
              <div className="grid grid-cols-2 gap-1.5">
                {(['before', 'after'] as const).map(side => (
                  <button
                    key={side}
                    onClick={() => onChange({ anchorJobId: draft.overlap!.jobId, placement: side })}
                    className={`rounded-md border px-2 py-1.5 text-[11px] font-semibold ${
                      (draft.placement ?? 'after') === side ? 'border-amber-500 bg-amber-600 text-white' : 'border-slate-700 text-slate-300 hover:bg-slate-800'
                    }`}
                  >
                    {side === 'before' ? '← Before it' : 'After it →'}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <p className="text-[11px] leading-snug text-slate-500">Planned as its own part in the free time at the selection. Nothing else is moved apart from what it pushes back.</p>
          )}
        </div>
      )}

      <div className="mt-2 flex items-center gap-2">
        <label className="flex items-center gap-1 text-[11px] text-slate-400">
          {draft.type === 'rework' ? 'Run time' : 'Length'}
          <input
            type="number"
            min={5}
            step={5}
            className={`${inputCls} w-20`}
            value={draft.durationMinutes}
            onChange={e => onChange({ durationMinutes: Math.max(1, Math.round(Number(e.target.value) || 1)) })}
            aria-label="Length in minutes"
          />
          min
        </label>
        {draft.type !== 'rework' && (
        <div className="ml-auto flex rounded-md border border-slate-700 p-0.5 text-[11px]">
          {[
            ['This machine', draft.lane],
            ['All', 'ALL'],
          ].map(([label, id]) => (
            <button
              key={id}
              onClick={() => onChange({ machineId: id })}
              className={`rounded px-2 py-1 font-semibold ${draft.machineId === id ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'}`}
            >
              {label}
            </button>
          ))}
        </div>
        )}
      </div>
      <p className="mt-1 truncate text-[11px] text-slate-500">{draft.type !== 'rework' && draft.machineId === 'ALL' ? 'Applies to every machine' : draft.lane}</p>

      <div className="mt-3 flex items-center gap-2">
        {onDelete && (
          <button onClick={onDelete} className="rounded-md border border-rose-800 bg-rose-950/60 p-1.5 text-rose-300 hover:bg-rose-900" aria-label="Delete disruption">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
        <button onClick={onCancel} className="ml-auto rounded-md border border-slate-700 px-3 py-1.5 text-xs font-semibold text-slate-300 hover:bg-slate-800">
          Cancel
        </button>
        <button onClick={onSave} className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-blue-500">
          {draft.id ? 'Save' : 'Add'}
        </button>
      </div>
    </div>
  );
}
