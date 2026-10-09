import {
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
import { useStore } from '../state/store';
import { Button } from './kit';
import { useImport } from './useImport';

export type View = 'gantt' | 'priority' | 'orders' | 'runsheet' | 'exceptions';

const TABS: Array<{ id: View; label: string; icon: React.ReactNode }> = [
  { id: 'gantt', label: 'Gantt Diagram', icon: <BarChart3 className="h-3.5 w-3.5" /> },
  { id: 'priority', label: 'Priority Rules', icon: <SlidersHorizontal className="h-3.5 w-3.5" /> },
  { id: 'orders', label: 'Orders & Bulk Efficiency', icon: <Package className="h-3.5 w-3.5" /> },
  { id: 'runsheet', label: 'Machine Output (Run Sheets)', icon: <FileText className="h-3.5 w-3.5" /> },
  { id: 'exceptions', label: 'Exceptions', icon: <AlertTriangle className="h-3.5 w-3.5" /> },
];

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
  const { jobs, planning, replanNow, clearData, report } = useStore();
  const { handleFiles, inputRef, openPicker } = useImport();
  const hasData = jobs.length > 0;

  return (
    <header className="no-print sticky top-0 z-30 border-b border-slate-800 bg-slate-900/95 backdrop-blur-md">
      <div className="flex min-h-16 flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-2 lg:px-6">
        <div className="flex shrink-0 items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-600 text-[11px] font-bold text-white">CNC</div>
          <div>
            <h1 className="text-base font-bold leading-tight tracking-tight text-white">CNC Smart Planner</h1>
            <p className="text-xs text-slate-400">TPS-MA Workshop Sequence</p>
          </div>
        </div>

        {hasData && (
          <nav className="flex flex-wrap items-center gap-1 rounded-lg border border-slate-800 bg-slate-950/80 p-1">
            {TABS.map(t => (
              <button
                key={t.id}
                onClick={() => setView(t.id)}
                className={`flex items-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-bold transition-colors ${
                  view === t.id ? 'bg-blue-600 text-white' : 'text-slate-300 hover:bg-slate-800 hover:text-white'
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
          <Button onClick={onSettings} title="Machines, materials, calendar, efficiency, carpenter">
            <SettingsIcon className="h-3.5 w-3.5 text-blue-400" /> <span className="hidden xl:inline">Variable Editor</span><span className="xl:hidden">Settings</span>
          </Button>
          {hasData && (
            <>
              <Button onClick={onPrint} title="Print run sheets">
                <Printer className="h-3.5 w-3.5 text-emerald-400" /> <span className="hidden 2xl:inline">Print</span>
              </Button>
              <Button onClick={onExport} title="Export the plan to Excel">
                <Download className="h-3.5 w-3.5 text-sky-400" /> <span className="hidden 2xl:inline">Export</span>
              </Button>
            </>
          )}
          <Button onClick={openPicker} title="Import a production workload or carpenter list">
            <Upload className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Import</span>
          </Button>
          {hasData && (
            <>
              <Button onClick={onReport} title={report?.fileName ?? 'Import report'}>
                Report
              </Button>
              <Button variant="primary" onClick={replanNow} disabled={planning} title="Re-run the scheduler">
                <RotateCcw className={`h-3.5 w-3.5 ${planning ? 'animate-spin' : ''}`} />
                {planning ? 'Planning…' : 'Re-optimize'}
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
    </header>
  );
}
