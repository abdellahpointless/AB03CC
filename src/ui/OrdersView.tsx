import { Check, ChevronDown, ChevronRight, Hammer, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { formatClock, formatDayMonth, formatDuration } from '../core/calendar';
import type { ScheduledJob } from '../core/types';
import { useStore } from '../state/store';
import { timeBasisNote } from '../lib/timeBasis';
import { Badge, Button, Empty, MaterialBadge, NumberInput, Segmented, TimeMark } from './kit';

type Group = 'masterOrder' | 'salesOrder';

export function OrdersView({ onSelect }: { onSelect: (it: ScheduledJob) => void }) {
  const { plan, settings, setPartEfficiency, notify } = useStore();
  const [mode, setMode] = useState<'table' | 'cards'>('table');
  const [group, setGroup] = useState<Group>('masterOrder');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulk, setBulk] = useState<number | undefined>(80);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const items = useMemo(() => {
    if (!plan) return [];
    const q = query.trim().toLowerCase();
    return Object.values(plan.queues)
      .flat()
      .filter(
        it =>
          !q ||
          [it.job.boxCode, it.job.masterOrder, it.job.orderNumber, it.job.salesOrder, it.job.customer, it.job.matnr, it.machineId]
            .join(' ')
            .toLowerCase()
            .includes(q),
      );
  }, [plan, query]);

  const groups = useMemo(() => {
    const map = new Map<string, ScheduledJob[]>();
    for (const it of items) {
      const key = group === 'masterOrder' ? it.job.masterOrder : it.job.salesOrder || '(no sales order)';
      (map.get(key) ?? map.set(key, []).get(key)!).push(it);
    }
    return [...map.entries()].map(([key, list]) => ({
      key,
      list: list.sort((a, b) => a.endMinute - b.endMinute),
      finish: Math.max(...list.map(i => i.endMinute)),
      minutes: list.reduce((a, i) => a + i.durationMin, 0),
    })).sort((a, b) => a.finish - b.finish);
  }, [items, group]);

  if (!plan) return null;
  if (items.length === 0 && !query) return <Empty>No planned jobs yet.</Empty>;

  const toggle = (id: string) =>
    setSelected(s => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  const allSelected = items.length > 0 && items.every(i => selected.has(i.job.id));
  const overrides = settings.partEfficiencyOverrides;

  // Parts with a measured time ignore efficiency entirely, so bulk edits skip them.
  const measuredIds = new Set(items.filter(i => i.timeBasis === 'measured').map(i => i.job.id));
  const editable = () => [...selected].filter(id => !measuredIds.has(id));
  const skippedNote = () => {
    const skipped = selected.size - editable().length;
    return skipped ? ` ${skipped} part${skipped === 1 ? ' has' : 's have'} a measured time and ${skipped === 1 ? 'was' : 'were'} skipped.` : '';
  };
  const applyBulk = () => {
    if (!bulk || bulk <= 0) return;
    const ids = editable();
    setPartEfficiency(ids, bulk);
    notify(`Efficiency ${bulk}% applied to ${ids.length} operations.${skippedNote()}`);
    setSelected(new Set());
  };
  const clearBulk = () => {
    const ids = editable();
    setPartEfficiency(ids, undefined);
    notify(`Efficiency overrides removed from ${ids.length} operations.${skippedNote()}`);
    setSelected(new Set());
  };

  const row = (it: ScheduledJob) => (
    <tr key={it.job.id} className="border-b border-slate-800/70 hover:bg-slate-900/70">
      <td className="px-3 py-2">
        <input type="checkbox" checked={selected.has(it.job.id)} onChange={() => toggle(it.job.id)} className="accent-blue-500" />
      </td>
      <td className="mono cursor-pointer px-2 font-bold text-amber-300" onClick={() => onSelect(it)}>{it.job.boxCode}</td>
      <td className="mono px-2 text-slate-200">{it.job.masterOrder}</td>
      <td className="mono px-2 text-slate-400">{it.job.orderNumber}</td>
      <td className="mono px-2 text-sky-300">{it.job.matnr}</td>
      <td className="px-2"><MaterialBadge material={it.job.materialType} /></td>
      <td className="px-2">
        {it.carpenterOpen ? (
          <Badge className="border-amber-700 text-amber-300"><Hammer className="mr-1 h-2.5 w-2.5" />open parts</Badge>
        ) : plan.carpenter[it.job.masterOrder] ? (
          <Badge className="border-emerald-800 text-emerald-300"><Check className="mr-1 h-2.5 w-2.5" />all cut</Badge>
        ) : (
          <span className="text-[10px] text-slate-600">no carp. data</span>
        )}
      </td>
      <td className="mono px-2 text-right text-slate-400">{formatDuration(it.idealMinutes)}</td>
      <td className="mono px-2 text-right font-bold text-white">
        <span className="inline-flex items-center justify-end gap-1">
          <TimeMark basis={it.timeBasis} title={timeBasisNote(it, settings.estimateMultiplier)} className="text-slate-400" />
          {formatDuration(it.durationMin)}
        </span>
      </td>
      <td className="px-2 text-center">
        {it.timeBasis === 'measured' ? (
          <span className="text-[11px] text-slate-600" title="Measured time: efficiency rules do not apply">—</span>
        ) : (
          <span className={`mono rounded px-1.5 py-0.5 text-[11px] ${overrides[it.job.id] ? 'bg-blue-900 text-blue-200' : 'bg-slate-800 text-slate-300'}`}>{it.efficiencyPercent}%</span>
        )}
      </td>
      <td className="px-2 text-slate-300">{it.machineId}</td>
      <td className="mono px-2 text-slate-400">{formatDayMonth(it.endTime)} {formatClock(it.endTime)}</td>
      <td className="max-w-[220px] truncate px-2 text-slate-400">{it.job.customer}</td>
    </tr>
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-800 bg-slate-900/70 px-4 py-3">
        <span className="text-xs text-slate-400">View</span>
        <Segmented value={mode} onChange={setMode} options={[{ value: 'table', label: 'Table (bulk override)' }, { value: 'cards', label: 'Order cards' }]} />
        <span className="ml-2 text-xs text-slate-400">Group</span>
        <Segmented value={group} onChange={setGroup} options={[{ value: 'masterOrder', label: 'Master orders' }, { value: 'salesOrder', label: 'Sales orders' }]} />
        <div className="relative ml-auto">
          <Search className="pointer-events-none absolute left-2 top-1.5 h-3.5 w-3.5 text-slate-500" />
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search order number, customer…" className="w-64 rounded-md border border-slate-700 bg-slate-950 py-1.5 pl-7 pr-2 text-xs outline-none focus:border-blue-500" />
        </div>
      </div>

      {mode === 'table' && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-800 bg-slate-900/70 px-4 py-2.5 text-xs">
          <span className="mono text-slate-400">Selected {selected.size} of {items.length} operations</span>
          <Button size="sm" onClick={() => setSelected(allSelected ? new Set() : new Set(items.map(i => i.job.id)))}>{allSelected ? 'Clear selection' : 'Select all'}</Button>
          <span className="ml-auto text-[11px] text-slate-500">Parts with a measured time (●) keep it and ignore efficiency.</span>
          <span className="text-slate-400">Bulk set “Runs at”:</span>
          <div className="w-20"><NumberInput value={bulk} min={10} max={200} onChange={setBulk} /></div>
          <span className="text-slate-400">%</span>
          <Button variant="primary" disabled={selected.size === 0 || !bulk} onClick={applyBulk}><Check className="h-3.5 w-3.5" /> Apply override</Button>
          <Button disabled={selected.size === 0} onClick={clearBulk}>Remove override</Button>
        </div>
      )}

      {mode === 'table' ? (
        <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-950">
          <table className="w-full min-w-[1100px] text-xs">
            <thead className="sticky top-0 bg-slate-900 text-left text-[11px] uppercase tracking-wide text-slate-400">
              <tr>
                <th className="w-8 px-3 py-2.5" />
                {['Box', 'Master order', 'Order #', 'Matnr (drawing)', 'Material', 'Carpenter', 'Ideal NC', 'Planned', 'Runs at', 'Machine', 'Finish', 'Customer'].map((h, i) => (
                  <th key={h} className={`px-2 py-2.5 ${i >= 6 && i <= 8 ? 'text-right' : ''}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {groups.map(g => (
                <GroupRows key={g.key} label={g.key} count={g.list.length} minutes={g.minutes} collapsed={collapsed.has(g.key)} onToggle={() => setCollapsed(s => { const n = new Set(s); n.has(g.key) ? n.delete(g.key) : n.add(g.key); return n; })}>
                  {g.list.map(row)}
                </GroupRows>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {groups.map(g => {
            const sync = plan.moSync[g.key];
            return (
              <div key={g.key} className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="mono text-sm font-bold text-white">{g.key}</div>
                    <div className="text-[11px] text-slate-400">{g.list[0].job.customer}</div>
                  </div>
                  <div className="text-right text-[11px]">
                    <div className="mono text-slate-300">{g.list.length} {g.list.length === 1 ? 'part' : 'parts'} · {formatDuration(g.minutes)}</div>
                    {group === 'masterOrder' && sync && <div className={sync.synchronized ? 'text-emerald-400' : 'text-amber-400'}>{sync.synchronized ? 'synchronized' : `spread ${sync.spread}m`} · done {sync.finishTime}</div>}
                  </div>
                </div>
                <ul className="mt-3 space-y-1">
                  {g.list.map(it => (
                    <li key={it.job.id} onClick={() => onSelect(it)} className="flex cursor-pointer items-center gap-2 rounded-md bg-slate-950/60 px-2 py-1.5 text-xs hover:bg-slate-800">
                      <span className="mono w-10 font-bold text-amber-300">{it.job.boxCode}</span>
                      <MaterialBadge material={it.job.materialType} />
                      <span className="text-slate-300">{it.machineId}</span>
                      <span className="mono ml-auto text-slate-400">{formatClock(it.startTime)}→{formatClock(it.endTime)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function GroupRows({ label, count, minutes, collapsed, onToggle, children }: { label: string; count: number; minutes: number; collapsed: boolean; onToggle: () => void; children: React.ReactNode }) {
  return (
    <>
      <tr className="cursor-pointer bg-slate-900/80" onClick={onToggle}>
        <td colSpan={13} className="px-3 py-1.5 text-[11px] font-bold text-slate-300">
          <span className="inline-flex items-center gap-1">
            {collapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            <span className="mono">{label}</span>
            <span className="ml-2 font-normal text-slate-500">{count} {count === 1 ? 'part' : 'parts'} · {formatDuration(minutes)}</span>
          </span>
        </td>
      </tr>
      {!collapsed && children}
    </>
  );
}
