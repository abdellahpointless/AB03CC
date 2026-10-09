import { Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { WorkCalendar, formatDuration } from '../core/calendar';
import type { TimelineEvent, TimelineEventType } from '../core/types';
import { useStore } from '../state/store';
import { Button, Field, Modal, NumberInput, inputCls } from './kit';

const TYPES: Array<{ value: TimelineEventType; label: string; title: string }> = [
  { value: 'breakdown', label: 'Machine breakdown', title: 'Breakdown' },
  { value: 'maintenance', label: 'Scheduled maintenance', title: 'Maintenance' },
  { value: 'absent', label: 'Operator absent', title: 'Operator absent' },
  { value: 'material_shortage', label: 'Material shortage', title: 'Material shortage' },
  { value: 'rework', label: 'Rework (adds minutes to a box)', title: 'Rework' },
  { value: 'other', label: 'Other', title: 'Disruption' },
];

export function EventModal({ initial, onClose }: { initial: Partial<TimelineEvent>; onClose: () => void }) {
  const { settings, saveEvent, removeEvent } = useStore();
  const cal = useMemo(() => new WorkCalendar(settings.calendar), [settings.calendar]);
  const isEdit = Boolean(initial.id);
  const [ev, setEv] = useState<TimelineEvent>({
    id: initial.id ?? `ev-${Date.now().toString(36)}`,
    machineId: initial.machineId ?? 'ALL',
    type: initial.type ?? 'breakdown',
    title: initial.title ?? 'Breakdown',
    startMinute: initial.startMinute ?? 0,
    durationMinutes: initial.durationMinutes ?? 60,
    boxCode: initial.boxCode,
    extraMinutes: initial.extraMinutes,
    note: initial.note,
  });
  const patch = (p: Partial<TimelineEvent>) => setEv(e => ({ ...e, ...p }));
  const valid = ev.durationMinutes > 0 && ev.startMinute >= 0 && (ev.type !== 'rework' || (ev.boxCode && (ev.extraMinutes ?? 0) > 0) || ev.durationMinutes > 0);

  const start = cal.toDate(ev.startMinute);
  const end = cal.toDate(ev.startMinute + ev.durationMinutes, true);
  const fmt = (d: Date) => `${d.toDateString().slice(0, 10)} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

  return (
    <Modal
      title={isEdit ? 'Edit disruption' : 'Add disruption'}
      subtitle="Time on the machine is blocked; running jobs pause and resume afterwards (or restart, see the Gantt toolbar)."
      onClose={onClose}
      footer={
        <>
          {isEdit && (
            <Button variant="danger" className="mr-auto" onClick={() => (removeEvent(ev.id), onClose())}>
              <Trash2 className="h-3.5 w-3.5" /> Delete
            </Button>
          )}
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!valid} onClick={() => (saveEvent(ev), onClose())}>
            Save
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Machine">
          <select className={inputCls} value={ev.machineId} onChange={e => patch({ machineId: e.target.value })}>
            <option value="ALL">All machines</option>
            {settings.machines.map(m => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Type">
          <select
            className={inputCls}
            value={ev.type}
            onChange={e => {
              const t = TYPES.find(x => x.value === e.target.value)!;
              const wasDefault = TYPES.some(x => x.title === ev.title);
              patch({ type: t.value, title: wasDefault ? t.title : ev.title });
            }}
          >
            {TYPES.map(t => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Title">
          <input className={inputCls} value={ev.title} onChange={e => patch({ title: e.target.value })} />
        </Field>
        <Field label="Start (working minutes from plan start)" hint={`${fmt(start)} → ${fmt(end)}`}>
          <NumberInput value={ev.startMinute} min={0} onChange={v => patch({ startMinute: Math.max(0, Math.round(v ?? 0)) })} />
        </Field>
        <Field label="Duration (minutes)" hint={formatDuration(ev.durationMinutes)}>
          <NumberInput value={ev.durationMinutes} min={1} onChange={v => patch({ durationMinutes: Math.max(0, Math.round(v ?? 0)) })} />
        </Field>
        <div className="flex items-end gap-1.5">
          {[30, 60, 120, 240, cal.dayLen].map(m => (
            <Button key={m} size="sm" onClick={() => patch({ durationMinutes: m })}>
              {m === cal.dayLen ? '1 day' : formatDuration(m)}
            </Button>
          ))}
        </div>
        {ev.type === 'rework' && (
          <>
            <Field label="Box code to rework" hint="Extra minutes are added to this box's run time.">
              <input className={inputCls} value={ev.boxCode ?? ''} onChange={e => patch({ boxCode: e.target.value.trim() })} />
            </Field>
            <Field label="Extra minutes on that box">
              <NumberInput value={ev.extraMinutes} min={0} onChange={v => patch({ extraMinutes: v })} />
            </Field>
          </>
        )}
        <div className="sm:col-span-2">
          <Field label="Note">
            <input className={inputCls} value={ev.note ?? ''} onChange={e => patch({ note: e.target.value })} />
          </Field>
        </div>
      </div>
    </Modal>
  );
}
