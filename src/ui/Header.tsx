import {
  Activity,
  AlertTriangle,
  BarChart3,
  Download,
  FileText,
  HelpCircle,
  Package,
  Printer,
  RotateCcw,
  Settings as SettingsIcon,
  SlidersHorizontal,
  Trash2,
  Upload,
} from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useProgress, useStore } from '../state/store';
import { Button } from './kit';
import { useImport } from './useImport';

export type View = 'gantt' | 'priority' | 'orders' | 'runsheet' | 'hourly' | 'exceptions';

const TABS: Array<{ id: View; label: string; icon: React.ReactNode }> = [
  { id: 'gantt', label: 'Gantt Diagram', icon: <BarChart3 className="h-3.5 w-3.5" /> },
  { id: 'priority', label: 'Priority Rules', icon: <SlidersHorizontal className="h-3.5 w-3.5" /> },
  { id: 'orders', label: 'Orders & Bulk Efficiency', icon: <Package className="h-3.5 w-3.5" /> },
  { id: 'runsheet', label: 'Machine Output (Run Sheets)', icon: <FileText className="h-3.5 w-3.5" /> },
  { id: 'hourly', label: 'Hourly Output', icon: <Activity className="h-3.5 w-3.5" /> },
  { id: 'exceptions', label: 'Exceptions', icon: <AlertTriangle className="h-3.5 w-3.5" /> },
];

interface Pill {
  left: number;
  top: number;
  width: number;
  height: number;
}

export function Header({
  view,
  setView,
  exceptionCount,
  onSettings,
  onPrint,
  onExport,
  onHelp,
  onReport,
}: {
  view: View;
  setView: (v: View) => void;
  exceptionCount: number;
  onSettings: () => void;
  onPrint: () => void;
  onExport: () => void;
  onHelp: () => void;
  onReport: () => void;
}) {
  const { jobs, planning, improving, replanNow, clearData, report } = useStore();
  const progress = useProgress();
  const busy = planning || improving;
  const { handleFiles, inputRef, openPicker } = useImport();
  const hasData = jobs.length > 0;

  // sliding highlight behind the active tab
  const nav = useRef<HTMLElement>(null);
  const tabs = useRef<Partial<Record<View, HTMLButtonElement | null>>>({});
  const [pill, setPill] = useState<Pill | null>(null);
  const measure = useCallback(() => {
    const b = tabs.current[view];
    if (b) setPill({ left: b.offsetLeft, top: b.offsetTop, width: b.offsetWidth, height: b.offsetHeight });
  }, [view]);
  useLayoutEffect(measure, [measure, hasData, exceptionCount]);
  useEffect(() => {
    const ro = new ResizeObserver(measure);
    if (nav.current) ro.observe(nav.current);
    window.addEventListener('resize', measure);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [measure, hasData]);

  return (
    <header className="no-print sticky top-0 z-30 border-b border-slate-800/80 bg-slate-900/80 backdrop-blur-xl">
      <div className="flex min-h-16 flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-2 lg:px-6">
        <div className="flex shrink-0 items-center gap-3">
          <div className="relative">
            {busy && <span className="absolute inset-0 rounded-lg bg-blue-500" style={{ animation: 'ping-soft 1.4s ease-out infinite' }} />}
            <div className="shine relative flex h-9 w-9 items-center justify-center overflow-hidden rounded-lg bg-gradient-to-br from-blue-500 to-indigo-600 text-[11px] font-bold text-white shadow-[0_0_24px_-4px_rgba(59,130,246,0.85)]">
              CNC
            </div>
          </div>
          <div>
            <h1 className="text-base font-bold leading-tight tracking-tight text-white">CNC Smart Planner</h1>
            <p className="text-xs text-slate-400">TPS-MA Workshop Sequence</p>
          </div>
        </div>

        {hasData && (
          <nav ref={nav} className="relative flex flex-wrap items-center gap-1 rounded-lg border border-slate-800 bg-slate-950/70 p-1">
            {pill && (
              <span
                aria-hidden
                className="absolute rounded-md bg-blue-600 shadow-[0_6px_20px_-8px_rgba(37,99,235,0.95)]"
                style={{ ...pill, transition: 'left .38s var(--ease-out), top .38s var(--ease-out), width .38s var(--ease-out), height .38s var(--ease-out)' }}
              />
            )}
            {TABS.map(t => (
              <button
                key={t.id}
                ref={el => {
                  tabs.current[t.id] = el;
                }}
                onClick={() => setView(t.id)}
                className={`relative z-10 flex items-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-bold transition-colors duration-200 ${
                  view === t.id ? 'text-white' : 'text-slate-300 hover:text-white'
                }`}
              >
                {t.icon}
                {t.label}
                {t.id === 'exceptions' && exceptionCount > 0 && (
                  <span className="mono ml-1 rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] text-amber-300">{exceptionCount}</span>
                )}
              </button>
            ))}
          </nav>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <input ref={inputRef} type="file" accept=".xlsx,.xls,.csv" multiple hidden onChange={e => (handleFiles(e.target.files), (e.target.value = ''))} />
          <Button onClick={onSettings} title="Machines, materials, calendar, part times, efficiency, carpenter">
            <SettingsIcon className="h-3.5 w-3.5 text-blue-400" /> <span className="hidden xl:inline">Variable Editor</span>
            <span className="xl:hidden">Settings</span>
          </Button>
          {hasData && (
            <>
              <Button onClick={onPrint} disabled={improving} title={improving ? 'Available when the optimizer has finished' : 'Print run sheets'}>
                <Printer className="h-3.5 w-3.5 text-emerald-400" /> <span className="hidden 2xl:inline">Print</span>
              </Button>
              <Button onClick={onExport} disabled={improving} title={improving ? 'Available when the optimizer has finished' : 'Export the plan to Excel'}>
                <Download className="h-3.5 w-3.5 text-sky-400" /> <span className="hidden 2xl:inline">Export</span>
              </Button>
            </>
          )}
          <Button onClick={openPicker} title="Import a production workload, carpenter list or parts time list">
            <Upload className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Import</span>
          </Button>
          {hasData && (
            <>
              <Button onClick={onReport} title={report?.fileName ?? 'Import report'}>
                Report
              </Button>
              <Button variant="primary" onClick={replanNow} disabled={busy} title="Re-run the scheduler">
                <RotateCcw className={`h-3.5 w-3.5 ${busy ? 'animate-spin' : ''}`} />
                {improving ? `Optimizing ${Math.round(progress * 100)}%` : planning ? 'Planning…' : 'Re-optimize'}
              </Button>
              <Button
                variant="ghost"
                onClick={() => confirm('Remove the imported data and all manual overrides?') && clearData()}
                title="Clear imported data"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </>
          )}
          <Button variant="ghost" onClick={onHelp} title="How the plan is built">
            <HelpCircle className="h-4 w-4" />
          </Button>
        </div>
      </div>
      {planning && (
        <div className="absolute inset-x-0 bottom-0 h-[2px] overflow-hidden">
          <div className="h-full w-1/4 bg-gradient-to-r from-transparent via-blue-400 to-transparent" style={{ animation: 'progress-slide 1.1s linear infinite' }} />
        </div>
      )}
      {improving && (
        <div className="absolute inset-x-0 bottom-0 h-[2px] overflow-hidden" role="progressbar" aria-label="Optimizing the plan" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}>
          <div className="h-full bg-gradient-to-r from-blue-500 to-emerald-400" style={{ width: `${Math.max(2, progress * 100)}%`, transition: 'width .25s linear' }} />
        </div>
      )}
    </header>
  );
}
