import { Table2, Wrench } from 'lucide-react';
import { useMemo, useState } from 'react';
import { formatDuration } from '../core/calendar';
import { partKey } from '../core/parse/partTimes';
import { buildGroups, classifyKinds, type PartGroup } from '../core/partKinds';
import { useStore } from '../state/store';
import { Badge, Button, Empty, Segmented, inputCls } from './kit';

type Filter = 'all' | 'table' | 'spare';

/** Tables and spares: grouped by sales order, planned inside the start and finish the user chooses. */
export function TablesView() {
  const { jobs, plan, settings, partTimes, updateSettings } = useStore();
  const [filter, setFilter] = useState<Filter>('all');
  const groups = useMemo(() => buildGroups(jobs, classifyKinds(jobs)), [jobs]);
  const byId = useMemo(() => new Map(jobs.map(j => [j.id, j])), [jobs]);

  const minutesOf = (g: PartGroup) =>
    g.jobIds.reduce((sum, id) => {
      const j = byId.get(id)!;
      const per = partTimes[partKey(j.matnr)]?.minutes ?? j.ncMinutes * (settings.estimateMultiplier || 1);
      return sum + per * j.qty;
    }, 0);

  const setWindow = (key: string, patch: Partial<{ start: string; finish: string }>) =>
    updateSettings(s => ({ ...s, partWindows: { ...s.partWindows, [key]: { ...{ start: '', finish: '' }, ...s.partWindows[key], ...patch } } }));
  const clearWindow = (key: string) =>
    updateSettings(s => {
      const { [key]: _gone, ...rest } = s.partWindows;
      return { ...s, partWindows: rest };
    });

  const shown = groups.filter(g => filter === 'all' || g.kind === filter);
  const counts = { table: groups.filter(g => g.kind === 'table').length, spare: groups.filter(g => g.kind === 'spare').length };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-900/70 px-5 py-4">
        <div>
          <h2 className="text-lg font-extrabold uppercase tracking-wide text-white">Tables &amp; spare parts</h2>
          <p className="mt-0.5 max-w-3xl text-xs text-slate-400">
            Tables (order and master order 60000*, or 30000* with the sales order of a table) and spare parts (30000*) are kept together per sales order and are not planned automatically.
            Choose when a group should start and when it must be finished. The planner then places its parts so that the module parts are delayed as little as possible.
          </p>
        </div>
        <Segmented
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: `All ${groups.length}` },
            { value: 'table', label: `Tables ${counts.table}` },
            { value: 'spare', label: `Spares ${counts.spare}` },
          ]}
        />
      </div>

      {shown.length === 0 ? (
        <Empty>No table or spare parts in this workload.</Empty>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {shown.map(g => {
            const w = settings.partWindows[g.key];
            const report = plan?.windowReport[g.key];
            const invalid = Boolean(w?.start && w?.finish && w.finish <= w.start);
            const planned = plan ? g.jobIds.filter(id => Object.values(plan.queues).some(q => q.some(i => i.job.id === id))).length : 0;
            return (
              <div key={g.key} className="glass rounded-xl border border-slate-800 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      {g.kind === 'table' ? <Table2 className="h-4 w-4 text-sky-300" /> : <Wrench className="h-4 w-4 text-amber-300" />}
                      <Badge className={g.kind === 'table' ? 'border-sky-700 text-sky-200' : 'border-amber-700 text-amber-200'}>{g.kind === 'table' ? 'Table' : 'Spare parts'}</Badge>
                      <span className="mono truncate text-sm font-bold text-white">SO {g.salesOrder}</span>
                    </div>
                    <div className="mt-1 truncate text-xs text-slate-300">{g.customer}</div>
                    <div className="mono mt-0.5 truncate text-[11px] text-slate-500" title={g.masterOrders.join(', ')}>
                      Master order {g.masterOrders.slice(0, 3).join(', ')}
                      {g.masterOrders.length > 3 ? ` +${g.masterOrders.length - 3}` : ''}
                    </div>
                  </div>
                  <div className="text-right text-xs">
                    <div className="mono font-bold text-white">{g.jobIds.length} parts</div>
                    <div className="mono text-slate-400">≈ {formatDuration(minutesOf(g))} machining</div>
                  </div>
                </div>

                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  <label className="text-[11px] font-semibold text-slate-300">
                    Start
                    <input type="datetime-local" className={`${inputCls} mt-1`} value={w?.start ?? ''} onChange={e => setWindow(g.key, { start: e.target.value })} />
                  </label>
                  <label className="text-[11px] font-semibold text-slate-300">
                    Must be finished by
                    <input type="datetime-local" className={`${inputCls} mt-1`} value={w?.finish ?? ''} min={w?.start || undefined} onChange={e => setWindow(g.key, { finish: e.target.value })} />
                  </label>
                </div>

                <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs">
                  {invalid ? (
                    <span className="text-rose-300">The finish must be after the start.</span>
                  ) : report ? (
                    <span className={report.lateBy > 0 ? 'text-rose-300' : 'text-emerald-300'}>
                      Planned {report.startTime.replace('T', ' ')} → {report.finishTime.replace('T', ' ')}
                      {report.lateBy > 0 ? ` · ${formatDuration(report.lateBy)} too late: widen the window or start earlier` : ' · in time'}
                      {planned < g.jobIds.length ? ` · ${planned} of ${g.jobIds.length} parts planned` : ''}
                    </span>
                  ) : w?.start && w?.finish ? (
                    <span className="text-amber-300">No part of this group could be planned (check blocked parts and the machine rules).</span>
                  ) : (
                    <span className="text-slate-400">Not planned yet: choose a start and a finish.</span>
                  )}
                  {w && (
                    <Button size="sm" variant="ghost" onClick={() => clearWindow(g.key)}>
                      Clear
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
