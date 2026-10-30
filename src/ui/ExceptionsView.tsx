import { useState } from 'react';
import { formatDuration } from '../core/calendar';
import type { Job } from '../core/types';
import { useStore } from '../state/store';
import { useMachineRules } from './useMachineRules';
import { Badge, Empty, MaterialBadge, inputCls } from './kit';

type Tab = 'manual30000' | 'blocked' | 'leftOut';

const TABS: Array<{ id: Tab; label: string; tone: string; help: string; assign: boolean }> = [
  { id: 'manual30000', label: 'Tables & spares waiting', tone: 'text-blue-300', assign: true, help: 'Table and spare parts are planned from a start and a finish you choose: open the Tables & Spares tab. Until then they are listed here. You can also pick a machine for one part: it is then planned and pinned there.' },
  { id: 'blocked', label: 'Blocked jobs', tone: 'text-rose-300', assign: false, help: 'On hold in the ERP (production status 11) or flagged as discontinued. They are not planned. Parts that no machine takes are not here: they are in the red box next to the Gantt.' },
  { id: 'leftOut', label: 'Left out by End', tone: 'text-rose-300', assign: true, help: 'An End rule in the Priority Rules plans only the parts the rules above it pick. These are the rest of the workload: they are not planned. Remove the End to plan them again, or pick a machine for one part here: it is then planned and pinned there.' },
];

function reasonFor(tab: Tab, j: Job): string {
  switch (tab) {
    case 'blocked': return j.blockedReason || 'On hold';
    case 'leftOut': return 'Not picked by the rules above End';
    default: return 'Waiting for a start and a finish';
  }
}

export function ExceptionsView() {
  const { plan, settings, locks, setLock, clearLock } = useStore();
  const whyNot = useMachineRules();
  const [tab, setTab] = useState<Tab>('manual30000');
  if (!plan) return null;
  const list = plan.exceptions[tab] ?? [];
  const def = TABS.find(t => t.id === tab)!;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs font-semibold ${tab === t.id ? 'border-blue-500 bg-blue-600 text-white' : 'border-slate-700 bg-slate-900 text-slate-300 hover:bg-slate-800'}`}
          >
            {t.label}
            <span className={`mono rounded bg-black/30 px-1.5 text-[10px] ${tab === t.id ? 'text-white' : t.tone}`}>{(plan.exceptions[t.id] ?? []).length}</span>
          </button>
        ))}
      </div>
      <p className="rounded-lg border border-slate-800 bg-slate-900/60 px-4 py-2.5 text-xs text-slate-400">{def.help}</p>

      {list.length === 0 ? (
        <Empty>Nothing in this category.</Empty>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-950">
          <table className="w-full min-w-[900px] text-xs">
            <thead className="bg-slate-900 text-left text-[11px] uppercase tracking-wide text-slate-400">
              <tr>
                {['Master order', 'Order number', 'Box', 'Material', 'Matnr', 'NC time', 'Customer', 'Reason', ...(def.assign ? ['Assign to machine'] : [])].map(h => (
                  <th key={h} className="px-3 py-2.5">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {list.map(j => (
                <tr key={j.id} className="border-b border-slate-900 hover:bg-slate-900/60">
                  <td className="mono px-3 py-2 font-bold text-amber-300">{j.masterOrder}</td>
                  <td className="mono px-3 text-slate-400">{j.orderNumber}</td>
                  <td className="mono px-3 font-bold text-white">{j.boxCode}</td>
                  <td className="px-3"><MaterialBadge material={j.materialType} /></td>
                  <td className="mono px-3 text-sky-300">{j.matnr}</td>
                  <td className="mono px-3 text-slate-300">{formatDuration(j.ncMinutes * j.qty)}</td>
                  <td className="max-w-[220px] truncate px-3 text-slate-400">{j.customer}</td>
                  <td className="px-3"><Badge className="border-slate-700 text-slate-300">{reasonFor(tab, j)}</Badge></td>
                  {def.assign && (
                    <td className="px-3 py-1.5">
                      <select
                        className={`${inputCls} w-44`}
                        value={locks[j.id]?.machine ?? ''}
                        onChange={e => (e.target.value ? setLock(j.id, { machine: e.target.value }) : clearLock(j.id))}
                      >
                        <option value="">Choose CNC machine…</option>
                        {settings.machines.map(m => {
                          const why = whyNot(j, m.id);
                          return (
                            <option key={m.id} value={m.id} title={why ?? undefined}>
                              {m.name}{why ? ' (override)' : ''}
                            </option>
                          );
                        })}
                      </select>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
