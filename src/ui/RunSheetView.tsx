import { Printer } from 'lucide-react';
import { useState } from 'react';
import { formatClock, formatDayMonth, formatDuration } from '../core/calendar';
import type { MachineConfig, PlanResult } from '../core/types';
import { useStore } from '../state/store';
import { Button, MaterialBadge, inputCls } from './kit';

export function RunSheetView({ onPrint }: { onPrint: () => void }) {
  const { plan, settings } = useStore();
  const [filter, setFilter] = useState('all');
  if (!plan) return null;
  const machines = settings.machines.filter(m => filter === 'all' || m.id === filter);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-900/70 px-5 py-4">
        <div>
          <h2 className="text-sm font-bold text-white">Machine dispatch results (final sequence)</h2>
          <p className="text-xs text-slate-400">Loading sequences and setup information for the shop floor operators.</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-400">Filter machine</span>
          <select className={`${inputCls} w-52`} value={filter} onChange={e => setFilter(e.target.value)}>
            <option value="all">All machines ({settings.machines.length})</option>
            {settings.machines.map(m => (
              <option key={m.id} value={m.id}>{m.name}</option>
            ))}
          </select>
          <Button variant="primary" onClick={onPrint}>
            <Printer className="h-3.5 w-3.5" /> Print run sheets
          </Button>
        </div>
      </div>
      {machines.map(m => (
        <MachineTable key={m.id} machine={m} plan={plan} />
      ))}
    </div>
  );
}

function MachineTable({ machine, plan }: { machine: MachineConfig; plan: PlanResult }) {
  const items = plan.queues[machine.id] ?? [];
  const load = plan.kpis.loadPerMachine[machine.id];
  return (
    <section className="overflow-hidden rounded-xl border border-slate-800 bg-slate-950">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 bg-slate-900/70 px-5 py-3">
        <div>
          <h3 className="text-sm font-bold text-white">
            {machine.name} <span className="mono ml-2 rounded bg-slate-800 px-1.5 py-0.5 text-[10px] font-normal text-slate-300">{items.length} parts</span>
          </h3>
          <p className="text-[11px] text-slate-400">
            Allowed materials: {machine.allowedMaterials.join(', ')} · Speed {machine.speedPercentage}%
            {machine.maxNcMinutes ? ` · NC < ${machine.maxNcMinutes} min` : ''}
          </p>
        </div>
        <div className="mono text-right text-[11px] text-slate-400">
          Machining / setup: <span className="text-white">{load?.machineMinutes ?? 0}m</span> / <span className="text-amber-300">{load?.setupMinutes ?? 0}m</span>
          <div>Queue finish: <span className="text-emerald-400">{plan.kpis.finishPerMachine[machine.id] ?? 0} min</span></div>
        </div>
      </div>
      {items.length === 0 ? (
        <p className="px-5 py-6 text-center text-xs text-slate-500">Nothing planned on this machine.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-xs">
            <thead className="text-left text-[11px] uppercase tracking-wide text-slate-400">
              <tr className="border-b border-slate-800">
                {['#', 'Box', 'Master order', 'Matnr (drawing)', 'Material', 'Qty', 'NC min', 'Setup', 'Duration', 'Start → End', 'Customer'].map(h => (
                  <th key={h} className="px-3 py-2">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {items.map(it => (
                <tr key={it.job.id} className="border-b border-slate-900 hover:bg-slate-900/60">
                  <td className="mono px-3 py-1.5 text-slate-500">{it.sequence}</td>
                  <td className="mono px-3 font-bold text-amber-300">{it.job.boxCode}</td>
                  <td className="mono px-3 text-sky-300">{it.job.masterOrder}</td>
                  <td className="mono px-3 text-slate-300">{it.job.matnr}</td>
                  <td className="px-3"><MaterialBadge material={it.job.materialType} /></td>
                  <td className="mono px-3 text-slate-300">{it.job.qty}</td>
                  <td className="mono px-3 text-slate-400">{formatDuration(it.idealMinutes)}</td>
                  <td className={`mono px-3 ${it.setupBefore ? 'text-amber-300' : 'text-emerald-400'}`}>{it.setupBefore ? `+${it.setupBefore}m` : '0m'}</td>
                  <td className="mono px-3 font-bold text-white">{formatDuration(it.durationMin)}</td>
                  <td className="mono px-3 text-slate-400">{formatDayMonth(it.startTime)} {formatClock(it.startTime)} → {formatClock(it.endTime)}</td>
                  <td className="max-w-[240px] truncate px-3 text-slate-400">{it.job.customer}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
