import { Hammer } from 'lucide-react';
import { formatDuration } from '../core/calendar';
import type { PlanResult } from '../core/types';

function Kpi({ label, value, sub, tone = 'text-white' }: { label: string; value: React.ReactNode; sub?: React.ReactNode; tone?: string }) {
  return (
    <div className="min-w-[110px]">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`mono text-base font-bold leading-tight ${tone}`}>
        {value}
        {sub && <span className="ml-1.5 text-[10px] font-normal text-slate-500">{sub}</span>}
      </div>
    </div>
  );
}

export function KpiBar({ plan, onCarpenter }: { plan: PlanResult; onCarpenter: () => void }) {
  const k = plan.kpis;
  const busiest = Object.entries(k.finishPerMachine).sort((a, b) => b[1] - a[1])[0];
  return (
    <div className="flex flex-wrap items-center gap-x-8 gap-y-3 rounded-xl border border-slate-800 bg-slate-900/70 px-5 py-3">
      <Kpi label="Busiest machine" value={`${k.makespanMinutes}m`} sub={busiest ? `${busiest[0]} · ${(k.makespanMinutes / 60).toFixed(1)}h` : undefined} tone="text-rose-400" />
      <Kpi label="Jobs planned" value={k.plannedJobs} sub={`${k.plannedHours}h machining`} />
      <Kpi label="Sum MO completion" value={`${k.sumMoCompletion}m`} sub={`avg ${k.avgMoCompletion}m`} tone="text-sky-300" />
      <Kpi label="Total changeover" value={`${k.changeoverMinutes}m`} tone="text-amber-300" />
      <Kpi label="Setup saved" value={`+${k.setupSavedMinutes}m`} tone="text-emerald-400" />
      <Kpi label="Synchronized MOs" value={`${k.synchronizedMos}/${k.totalMos}`} tone="text-emerald-300" />
      <Kpi label="Past due" value={k.overdueJobs} tone={k.overdueJobs ? 'text-rose-300' : 'text-slate-300'} sub="finish after production date" />
      {k.cautiousMakespanMinutes > k.makespanMinutes && <Kpi label="Cautious finish" value={formatDuration(k.cautiousMakespanMinutes)} tone="text-slate-300" />}
      <button
        onClick={onCarpenter}
        className={`ml-auto flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-semibold ${
          k.waitingOnCarpenter ? 'border-amber-700 bg-amber-950/50 text-amber-300 hover:bg-amber-950' : 'border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700'
        }`}
      >
        <Hammer className="h-3.5 w-3.5" /> Waiting on carpenter: <span className="mono">{k.waitingOnCarpenter} MOs</span>
      </button>
    </div>
  );
}
