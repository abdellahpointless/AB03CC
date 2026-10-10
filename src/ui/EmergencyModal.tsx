import { Siren, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { formatDuration } from '../core/calendar';
import { analyzeEmergency, type EmergencyAnalysis } from '../core/emergency';
import { emergencyJobIds } from '../core/partKinds';
import { useStore } from '../state/store';
import { Button, Modal, inputCls } from './kit';

const noZeros = (s: string) => s.trim().replace(/^0+/, '');

/** The red button: name an order, see how fast it could possibly be done, and decide whether to put it first. */
export function EmergencyModal({ onClose }: { onClose: () => void }) {
  const { jobs, settings, locks, carpenterParts, partTimes, updateSettings } = useStore();
  const [salesOrder, setSalesOrder] = useState('');
  const [schedule, setSchedule] = useState<string>('all');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<EmergencyAnalysis | null>(null);

  const orders = useMemo(() => {
    const m = new Map<string, { so: string; customer: string; parts: number; schedules: Set<number> }>();
    for (const j of jobs) {
      const k = noZeros(j.salesOrder);
      if (!k) continue;
      const e = m.get(k) ?? { so: j.salesOrder, customer: j.customer, parts: 0, schedules: new Set<number>() };
      e.parts++;
      if (j.scheduleNo !== null) e.schedules.add(j.scheduleNo);
      m.set(k, e);
    }
    return m;
  }, [jobs]);
  const known = orders.get(noZeros(salesOrder));
  const schedules = known ? [...known.schedules].sort((a, b) => a - b) : [];
  const scheduleValue = schedule === 'all' ? null : Number(schedule);
  const matching = salesOrder ? emergencyJobIds(jobs, [{ salesOrder, schedule: scheduleValue }]).size : 0;
  const applied = settings.emergencies.filter(e => e.applied);

  const analyze = () => {
    setBusy(true);
    setResult(null);
    // let the screen show "Analyzing…" before the (short) calculation blocks it
    setTimeout(() => {
      try {
        setResult(analyzeEmergency({ jobs, settings, locks, carpenterParts, partTimes, salesOrder: salesOrder.trim(), schedule: scheduleValue }));
      } finally {
        setBusy(false);
      }
    }, 30);
  };
  const apply = () => {
    if (!result) return;
    updateSettings(s => ({ ...s, emergencies: [...s.emergencies, { id: `em-${Date.now().toString(36)}`, salesOrder: result.salesOrder, schedule: result.schedule, applied: true }] }));
    onClose();
  };
  const remove = (id: string) => updateSettings(s => ({ ...s, emergencies: s.emergencies.filter(e => e.id !== id) }));

  return (
    <Modal
      title={
        <span className="flex items-center gap-2 text-rose-300">
          <Siren className="h-4 w-4" /> Emergency order
        </span>
      }
      subtitle="Put one sales order ahead of everything else, rules included."
      onClose={onClose}
      width="max-w-2xl"
    >
      <div className="space-y-5 text-xs text-slate-300">
        {applied.length > 0 && (
          <section>
            <h3 className="mb-2 text-[11px] font-bold uppercase tracking-wider text-white">In the plan now</h3>
            <div className="space-y-1.5">
              {applied.map(e => (
                <div key={e.id} className="flex items-center justify-between rounded-lg border border-rose-800 bg-rose-950/40 px-3 py-2">
                  <span className="mono font-bold text-rose-200">
                    SO {e.salesOrder}
                    {e.schedule !== null ? ` · schedule ${e.schedule}` : ' · all schedules'}
                  </span>
                  <Button size="sm" variant="danger" onClick={() => remove(e.id)}>
                    <Trash2 className="h-3 w-3" /> Remove from plan
                  </Button>
                </div>
              ))}
            </div>
          </section>
        )}

        <section>
          <h3 className="mb-2 text-[11px] font-bold uppercase tracking-wider text-white">Which parts?</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="font-semibold">
              Sales order
              <input
                list="emergency-orders"
                className={`${inputCls} mt-1`}
                value={salesOrder}
                placeholder="e.g. 0014102730"
                onChange={e => (setSalesOrder(e.target.value), setSchedule('all'), setResult(null))}
              />
              <datalist id="emergency-orders">
                {[...orders.values()].map(o => (
                  <option key={o.so} value={o.so}>
                    {o.customer} · {o.parts} parts
                  </option>
                ))}
              </datalist>
            </label>
            <label className="font-semibold">
              Schedule
              <select className={`${inputCls} mt-1`} value={schedule} onChange={e => (setSchedule(e.target.value), setResult(null))} disabled={schedules.length === 0}>
                <option value="all">All schedules</option>
                {schedules.map(sc => (
                  <option key={sc} value={sc}>
                    Schedule {sc}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <p className="mt-2 text-[11px] text-slate-500">
            {!salesOrder ? 'Type or pick a sales order from the workload.' : matching ? `${matching} parts match${known ? ` (${known.customer})` : ''}.` : 'No part of the workload has this sales order and schedule.'}
          </p>
          <div className="mt-3">
            <Button variant="danger" onClick={analyze} disabled={!matching || busy}>
              {busy ? 'Analyzing…' : 'How long would it take?'}
            </Button>
          </div>
        </section>

        {result && (
          <section className="rounded-xl border border-rose-800/70 bg-rose-950/20 p-4">
            {result.planned === 0 ? (
              <p className="text-amber-300">None of these {matching} parts can be planned (on hold, out of scope or no machine can take them).</p>
            ) : (
              <>
                <div className="text-[11px] font-bold uppercase tracking-wider text-rose-300">Even with the best possible planning</div>
                <div className="mono mt-1 text-2xl font-extrabold text-white">{formatDuration(result.durationMinutes)} of working time</div>
                <div className="mt-0.5 text-slate-300">
                  {result.planned} parts finish {result.finishTime.slice(8, 10)}/{result.finishTime.slice(5, 7)} at {result.finishTime.slice(11, 16)}
                  {result.unplannable ? ` · ${result.unplannable} cannot be planned` : ''}
                </div>
                <div className="mt-3 grid gap-1.5 sm:grid-cols-2">
                  {result.machines.map(m => (
                    <div key={m.machineId} className="mono flex justify-between rounded border border-slate-800 bg-slate-950/60 px-2 py-1 text-[11px]">
                      <span className="text-slate-200">{m.machineId}</span>
                      <span className="text-slate-400">
                        {m.boxes} boxes · {formatDuration(m.busyMinutes)}
                      </span>
                    </div>
                  ))}
                </div>
                {result.effect && (
                  <p className="mt-3 text-slate-300">
                    Effect on the rest (quick estimate): {result.effect.ordersDelayed} other orders finish later, on average {formatDuration(Math.max(0, result.effect.averageDelayMinutes))} later; the last machine ends{' '}
                    {formatDuration(Math.max(0, result.effect.lastFinishDelayMinutes))} later.
                  </p>
                )}
                <div className="mt-4 flex flex-wrap gap-2">
                  <Button variant="danger" onClick={apply}>
                    <Siren className="h-3.5 w-3.5" /> Apply to the Gantt plan
                  </Button>
                  <Button onClick={() => setResult(null)}>Don't apply</Button>
                </div>
                <p className="mt-2 text-[11px] text-slate-500">Applied, these parts are shown as URGENT and everything else on their machines waits until they are done.</p>
              </>
            )}
          </section>
        )}
      </div>
    </Modal>
  );
}
