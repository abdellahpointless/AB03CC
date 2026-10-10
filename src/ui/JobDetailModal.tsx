import { Hammer, Lock, RotateCcw } from 'lucide-react';
import { useMemo, useState } from 'react';
import { formatClock, formatDayMonth, formatDuration } from '../core/calendar';
import type { ScheduledJob } from '../core/types';
import { useStore } from '../state/store';
import { timeBasisLabel, timeBasisNote } from '../lib/timeBasis';
import { Badge, Button, Field, MaterialBadge, Modal, NumberInput, TimeMark, inputCls } from './kit';

export function JobDetailModal({ jobId, onClose }: { jobId: string; onClose: () => void }) {
  const { plan, settings, locks, setLock, clearLock, setPartEfficiency } = useStore();
  const mult = settings.estimateMultiplier;
  const item: ScheduledJob | undefined = useMemo(
    () => (plan ? Object.values(plan.queues).flat().find(i => i.job.id === jobId) : undefined),
    [plan, jobId],
  );
  const lock = locks[jobId] ?? {};
  const [machine, setMachine] = useState(lock.machine ?? '');
  const [duration, setDuration] = useState<number | undefined>(lock.durationMin);
  const [start, setStart] = useState<number | undefined>(lock.startMinute);
  const [eff, setEff] = useState<number | undefined>(settings.partEfficiencyOverrides[jobId]);

  if (!item || !plan) {
    return (
      <Modal title="Job not in plan" onClose={onClose}>
        <p className="text-sm text-slate-400">This job is no longer part of the current plan.</p>
      </Modal>
    );
  }
  const j = item.job;
  const siblings = Object.values(plan.queues)
    .flat()
    .filter(i => i.job.masterOrder === j.masterOrder)
    .sort((a, b) => a.endMinute - b.endMinute);
  const sync = plan.moSync[j.masterOrder];
  const carp = plan.carpenter[j.masterOrder];

  const apply = () => {
    const next = { ...lock };
    if (machine) next.machine = machine;
    else delete next.machine;
    if (duration && duration > 0) next.durationMin = Math.round(duration);
    else delete next.durationMin;
    if (start !== undefined && start >= 0) next.startMinute = Math.round(start);
    else delete next.startMinute;
    if (Object.keys(next).length) setLock(jobId, { machine: undefined, durationMin: undefined, startMinute: undefined, ...next });
    else clearLock(jobId);
    if (item.timeBasis !== 'measured') setPartEfficiency([jobId], eff);
    onClose();
  };
  const reset = () => {
    clearLock(jobId);
    setPartEfficiency([jobId], undefined);
    onClose();
  };
  const hasOverrides = Object.keys(lock).length > 0 || settings.partEfficiencyOverrides[jobId] !== undefined;

  const row = (k: string, v: React.ReactNode) => (
    <div className="flex justify-between gap-3 border-b border-slate-800/70 py-1.5 text-xs">
      <dt className="text-slate-400">{k}</dt>
      <dd className="mono text-right text-slate-100">{v}</dd>
    </div>
  );

  return (
    <Modal
      width="max-w-3xl"
      title={
        <span className="flex flex-wrap items-center gap-2">
          Box {j.boxCode} <MaterialBadge material={j.materialType} />
          {item.userLocked && (
            <Badge className="border-blue-600 text-blue-300">
              <Lock className="mr-1 h-2.5 w-2.5" /> pinned
            </Badge>
          )}
          {item.erpLocked && <Badge className="border-slate-600 text-slate-300">ERP assigned</Badge>}
          {item.isLate && <Badge className="border-rose-700 text-rose-300">past due</Badge>}
          {item.closesBox && <Badge className="border-emerald-700 text-emerald-300">closes box</Badge>}
        </span>
      }
      subtitle={`${j.customer} · Order ${j.orderNumber} · Master order ${j.masterOrder}`}
      onClose={onClose}
      footer={
        <>
          {hasOverrides && (
            <Button className="mr-auto" onClick={reset}>
              <RotateCcw className="h-3.5 w-3.5" /> Reset to automatic
            </Button>
          )}
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={apply}>
            Apply &amp; re-plan
          </Button>
        </>
      }
    >
      <div className="grid gap-6 md:grid-cols-2">
        <section>
          <h3 className="mb-1 text-[11px] font-bold uppercase tracking-wider text-slate-400">Plan</h3>
          <dl>
            {row('Machine', `${item.machineId} · #${item.sequence}`)}
            {row('Runs', `${formatDayMonth(item.startTime)} ${formatClock(item.startTime)} → ${formatDayMonth(item.endTime)} ${formatClock(item.endTime)}`)}
            {row('Duration', formatDuration(item.durationMin))}
            {row('Changeover before', `${item.setupBefore} min`)}
            {row('Ideal NC time', `${j.ncMinutes} min × ${j.qty} = ${item.idealMinutes} min`)}
            {row(
              'Time basis',
              <span className="inline-flex items-center justify-end gap-1">
                <TimeMark basis={item.timeBasis} />
                {timeBasisLabel(item.timeBasis)}
                {item.timeBasis === 'measured' && ` · ${Math.round((item.measuredPerPart ?? 0) * 10) / 10} min/part`}
              </span>,
            )}
            {item.timeBasis === 'estimated' && row('Efficiency', `${item.efficiencyPercent}% (${item.efficiencySource})`)}
            {item.timeBasis === 'estimated' && row('Material offset', `+${item.materialOffset} %`)}
            {row('Priority rank', `#${item.rank}`)}
            {row('Why here', item.decidingRule)}
          </dl>
          <p className="mt-2 text-[11px] leading-snug text-slate-500">{timeBasisNote(item, mult)}</p>
          <h3 className="mb-1 mt-4 text-[11px] font-bold uppercase tracking-wider text-slate-400">Order data</h3>
          <dl>
            {row('Matnr (drawing)', j.matnr)}
            {item.partName && row('Part name', item.partName)}
            {row('Material no. (stock)', j.materialNo)}
            {row('Sales order', j.salesOrder || '—')}
            {row('Schedule no.', j.scheduleNo ?? '—')}
            {row('Due date', j.dueDate ?? '—')}
            {row('Box progress', `${j.finishedCount}/${j.cuttingCount} finished`)}
            {row('Waiting', `${j.waitingDays} days`)}
          </dl>
        </section>

        <section className="space-y-4">
          <div>
            <h3 className="mb-2 text-[11px] font-bold uppercase tracking-wider text-slate-400">Manual overrides</h3>
            <div className="grid gap-3">
              <Field label="Pin to machine" hint="Pinned jobs are never moved by the optimizer.">
                <select className={inputCls} value={machine} onChange={e => setMachine(e.target.value)}>
                  <option value="">Automatic</option>
                  {settings.machines.map(m => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Run time (minutes)" hint={item.manualDuration ? 'Set by you. Clear the field to return to automatic.' : `Automatic: ${formatDuration(item.durationMin)}`}>
                <NumberInput value={duration} min={1} placeholder="automatic" onChange={setDuration} />
              </Field>
              <Field label="Earliest start (working minutes from plan start)">
                <NumberInput value={start} min={0} placeholder="automatic" onChange={setStart} />
              </Field>
              <Field
                label="Runs-at efficiency for this part (%)"
                hint={item.timeBasis === 'measured' ? 'Not used: this part has a real time in your parts list.' : 'Overrides the matrix / material / global efficiency.'}
              >
                <NumberInput value={item.timeBasis === 'measured' ? undefined : eff} min={10} max={200} placeholder={item.timeBasis === 'measured' ? 'measured time' : 'from settings'} onChange={setEff} disabled={item.timeBasis === 'measured'} />
              </Field>
            </div>
          </div>

          {carp && (
            <div className={`rounded-lg border p-3 text-xs ${carp.hasOpenParts ? 'border-amber-800 bg-amber-950/30' : 'border-slate-800 bg-slate-950/50'}`}>
              <div className="mb-1 flex items-center gap-1.5 font-bold text-slate-200">
                <Hammer className="h-3.5 w-3.5 text-amber-400" /> Carpenter: {carp.cutParts}/{carp.totalParts} parts cut
              </div>
              {carp.openPartsList.map((p, i) => (
                <div key={i} className="text-slate-300">
                  • {p.text || p.mText || 'part'} ×{p.qty} {p.alertMessage && <span className="text-rose-300">— {p.alertMessage}</span>}
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      <h3 className="mb-1 mt-5 text-[11px] font-bold uppercase tracking-wider text-slate-400">
        Module {j.masterOrder} {sync && <span className={sync.synchronized ? 'text-emerald-400' : 'text-amber-400'}>· spread {sync.spread} min {sync.synchronized ? '(synchronized)' : ''}</span>}
      </h3>
      <div className="overflow-hidden rounded-lg border border-slate-800">
        <table className="w-full text-xs">
          <tbody>
            {siblings.map(s => (
              <tr key={s.job.id} className={`border-b border-slate-800/70 last:border-0 ${s.job.id === jobId ? 'bg-blue-950/40' : ''}`}>
                <td className="mono px-3 py-1.5 text-amber-300">{s.job.boxCode}</td>
                <td className="px-2"><MaterialBadge material={s.job.materialType} /></td>
                <td className="px-2 text-slate-300">{s.machineId}</td>
                <td className="mono px-2 text-slate-400">{formatClock(s.startTime)} → {formatClock(s.endTime)}</td>
                <td className="mono px-3 text-right text-slate-400">{formatDuration(s.durationMin)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Modal>
  );
}
