import { Activity, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { downloadPlan } from './core/export';
import { DEMO, DEMO_BLOCKED } from './lib/demoMode';
import { useStore } from './state/store';
import { CarpenterView } from './ui/CarpenterView';
import { EmergencyModal } from './ui/EmergencyModal';
import { ExceptionsView } from './ui/ExceptionsView';
import { GanttView } from './ui/GanttView';
import { Header, type View } from './ui/Header';
import { HelpModal } from './ui/HelpModal';
import { HourlyView } from './ui/HourlyView';
import { ImportReportModal } from './ui/ImportReportModal';
import { JobDetailModal } from './ui/JobDetailModal';
import { Landing } from './ui/Landing';
import { DUR, EASE_OUT, animate } from './ui/motion';
import { OrdersView } from './ui/OrdersView';
import { PrintSheet } from './ui/PrintSheet';
import { PriorityView } from './ui/PriorityView';
import { RunSheetView } from './ui/RunSheetView';
import { ScriptsModal } from './ui/ScriptsModal';
import { SettingsDrawer } from './ui/SettingsDrawer';
import { TablesView } from './ui/TablesView';
import { Toasts } from './ui/Toasts';

type Dialog = 'settings' | 'print' | 'help' | 'report' | 'scripts' | 'emergency' | null;

const VIEW_ORDER: View[] = ['gantt', 'priority', 'orders', 'runsheet', 'hourly', 'carpenter', 'tables', 'exceptions'];

export default function App() {
  const { jobs, plan, planError, settings, notify } = useStore();
  const [view, setView] = useState<View>('gantt');
  const [dialog, setDialog] = useState<Dialog>(null);
  const [selectedJob, setSelectedJob] = useState<string | null>(null);

  const exceptionCount = useMemo(() => {
    if (!plan) return 0;
    const e = plan.exceptions;
    return e.blocked.length + e.noEligibleMachine.length + e.outOfScope.length + e.manual30000.length + (e.erpRefused?.length ?? 0);
  }, [plan]);

  const hasData = jobs.length > 0;
  const hasPlan = Boolean(plan);

  // Views stay mounted once visited (hidden with <Activity>), so zoom, scroll, filters and count-ups survive a tab
  // round trip and coming back costs nothing.
  const [visited, setVisited] = useState<ReadonlySet<View>>(() => new Set([view]));
  if (!visited.has(view)) setVisited(new Set([...visited, view]));
  useEffect(() => {
    if (!hasPlan) setVisited(v => (v.size === 1 && v.has(view) ? v : new Set([view])));
  }, [hasPlan, view]);

  // entering a view: start at the top, fade/slide in (no fill, so no transform is left on the wrapper)
  const viewWrap = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!hasPlan) return;
    window.scrollTo({ top: 0 });
    animate(viewWrap.current, [{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }], { duration: DUR[3], easing: EASE_OUT });
  }, [view, hasPlan]);

  const render = (v: View): ReactNode => {
    switch (v) {
      case 'gantt':
        return <GanttView onSelect={it => setSelectedJob(it.job.id)} onCarpenter={() => setView('carpenter')} />;
      case 'priority':
        return <PriorityView />;
      case 'orders':
        return <OrdersView onSelect={it => setSelectedJob(it.job.id)} />;
      case 'runsheet':
        return <RunSheetView onPrint={() => setDialog('print')} />;
      case 'hourly':
        return <HourlyView />;
      case 'carpenter':
        return <CarpenterView />;
      case 'tables':
        return <TablesView />;
      case 'exceptions':
        return <ExceptionsView />;
    }
  };

  return (
    <div className="flex min-h-full flex-col">
      <Header
        view={view}
        setView={setView}
        exceptionCount={exceptionCount}
        onSettings={() => setDialog('settings')}
        onPrint={() => setDialog('print')}
        onExport={async () => {
          if (!plan) return;
          if (DEMO) return notify(DEMO_BLOCKED, 'warn');
          if ((await downloadPlan(plan, settings)) === 'failed') notify('The plan could not be saved as an Excel file here.', 'error');
        }}
        onHelp={() => setDialog('help')}
        onScripts={() => setDialog('scripts')}
        onReport={() => setDialog('report')}
        onEmergency={() => setDialog('emergency')}
      />

      {DEMO && (
        <div className="no-print border-b border-blue-900/60 bg-blue-950/40 px-4 py-1.5 text-center text-[11px] text-blue-200">
          Demo · a preview with sample data and premade settings. Look around and press any button; importing, exporting and clearing are turned off and nothing is saved.
        </div>
      )}
      <main className="flex-1 px-3 py-4 sm:px-6">
        {!hasData ? (
          <Landing />
        ) : !plan ? (
          <div className="py-24 text-center text-sm text-slate-400">{planError ? `Planning failed: ${planError}` : 'Planning…'}</div>
        ) : (
          <>
            {planError && <div className="mb-3 rounded-lg border border-rose-800 bg-rose-950/50 px-4 py-2 text-xs text-rose-200">Planning failed: {planError}. Showing the last good plan.</div>}
            <div ref={viewWrap}>
              {VIEW_ORDER.filter(v => visited.has(v)).map(v => (
                <Activity key={v} mode={v === view ? 'visible' : 'hidden'}>
                  {render(v)}
                </Activity>
              ))}
            </div>
          </>
        )}
      </main>

      <footer className="no-print border-t border-slate-900 py-4 text-center text-xs text-slate-500">
        CNC Smart Planner · everything is processed locally in your browser; nothing is uploaded.
      </footer>

      {dialog === 'settings' && <SettingsDrawer onClose={() => setDialog(null)} />}
      {dialog === 'emergency' && <EmergencyModal onClose={() => setDialog(null)} />}
      {dialog === 'print' && <PrintSheet onClose={() => setDialog(null)} />}
      {dialog === 'help' && <HelpModal onClose={() => setDialog(null)} />}
      {dialog === 'report' && <ImportReportModal onClose={() => setDialog(null)} />}
      {dialog === 'scripts' && <ScriptsModal onClose={() => setDialog(null)} />}
      {selectedJob && <JobDetailModal jobId={selectedJob} onClose={() => setSelectedJob(null)} />}
      <Toasts />
    </div>
  );
}
