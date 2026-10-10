import { Hammer } from 'lucide-react';
import { WorkCalendar, formatDuration } from '../core/calendar';
import { useStore } from '../state/store';
import { CountUp } from './CountUp';
import type { PlanResult } from '../core/types';

function Kpi({ label, value, sub, tone = 'text-white', wide }: { label: string; value: React.ReactNode; sub?: React.ReactNode; tone?: string; wide?: boolean }) {
  // fixed width and one line: the bar must not change size while the optimizer swaps plans
  return (
    <div className={wide ? 'min-w-[270px]' : 'min-w-[130px]'}>
      <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`mono h-6 whitespace-nowrap text-base font-bold leading-6 ${tone}`}>
        {value}
        {sub && <span className="ml-1.5 text-[10px] font-normal text-slate-500">{sub}</span>}
      </div>
    </div>
  );
}

export function KpiBar({ plan, onCarpenter }: { plan: PlanResult; onCarpenter: () => void }) {
  const { settings } = useStore();
  const k = plan.kpis;
  const busiest = Object.entries(k.finishPerMachine).sort((a, b) => b[1] - a[1])[0];
  const dayLen = new WorkCalendar(settings.calendar).dayLen;
  const mos = Object.values(plan.moSync).filter(m => !m.carpenterBlocked);
  const doneBy = (day: number) => mos.filter(m => m.lastFinish <= day * dayLen).length;
  const opt = plan.optimization;
  const gain = opt && opt.classicSumMo > 0 ? ((opt.classicSumMo - k.sumMoCompletion) / opt.classicSumMo) * 100 : 0;
  const day2Gain = opt ? opt.doneByDay[1][1] - opt.doneByDay[1][0] : 0;
  return (
    <div className="flex flex-wrap items-center gap-x-8 gap-y-3 glass rounded-xl border border-slate-800 px-5 py-3">
      <Kpi label="Busiest machine" value={<CountUp value={k.makespanMinutes} suffix="m" />} sub={busiest ? `${busiest[0]} · ${(k.makespanMinutes / 60).toFixed(1)}h` : undefined} tone="text-rose-400" />
      <Kpi label="Jobs planned" value={<CountUp value={k.plannedJobs} />} sub={`${k.plannedHours}h · ${k.measuredJobs} real / ${k.estimatedJobs} est.`} />
      <Kpi
        label="Sum MO completion"
        value={<CountUp value={k.sumMoCompletion} suffix="m" />}
        sub={
          <>
            avg {k.avgMoCompletion}m
            {opt && gain >= 0.05 && <span className="ml-1.5 font-semibold text-emerald-400">{gain.toFixed(1)}% sooner than the basic plan</span>}
          </>
        }
        tone="text-sky-300"
        wide
      />
      <Kpi
        label="Orders done by day 1 / 2"
        value={<><CountUp value={doneBy(1)} /> / <CountUp value={doneBy(2)} /></>}
        sub={<>of {mos.length}{day2Gain > 0 && <span className="ml-1.5 font-semibold text-emerald-400">+{day2Gain} by day 2 vs the basic plan</span>}</>}
        tone="text-emerald-300"
        wide
      />
      <Kpi label="Total changeover" value={<CountUp value={k.changeoverMinutes} suffix="m" />} tone="text-amber-300" />
      <Kpi label="Setup saved" value={<CountUp value={k.setupSavedMinutes} prefix="+" suffix="m" />} tone="text-emerald-400" />
      <Kpi label="Synchronized MOs" value={<><CountUp value={k.synchronizedMos} />/{k.totalMos}</>} tone="text-emerald-300" />
      <Kpi label="Past due" value={<CountUp value={k.overdueJobs} />} tone={k.overdueJobs ? 'text-rose-300' : 'text-slate-300'} sub="finish after production date" />
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
