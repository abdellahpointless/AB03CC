import { useMemo, useState } from 'react';
import { downloadPlan } from './core/export';
import type { TimelineEvent } from './core/types';
import { useStore } from './state/store';
import { CarpenterPanel } from './ui/CarpenterPanel';
import { EventModal } from './ui/EventModal';
import { ExceptionsView } from './ui/ExceptionsView';
import { GanttView } from './ui/GanttView';
import { Header, type View } from './ui/Header';
import { HelpModal } from './ui/HelpModal';
import { ImportReportModal } from './ui/ImportReportModal';
import { JobDetailModal } from './ui/JobDetailModal';
import { Landing } from './ui/Landing';
import { OrdersView } from './ui/OrdersView';
import { PrintSheet } from './ui/PrintSheet';
import { PriorityView } from './ui/PriorityView';
import { RunSheetView } from './ui/RunSheetView';
import { SettingsDrawer } from './ui/SettingsDrawer';
import { Toasts } from './ui/Toasts';

type Dialog = 'settings' | 'print' | 'help' | 'report' | 'carpenter' | null;

export default function App() {
  const { jobs, plan, planning, planError, settings } = useStore();
  const [view, setView] = useState<View>('gantt');
  const [dialog, setDialog] = useState<Dialog>(null);
  const [selectedJob, setSelectedJob] = useState<string | null>(null);
  const [event, setEvent] = useState<Partial<TimelineEvent> | null>(null);

  const exceptionCount = useMemo(() => {
    if (!plan) return 0;
    const e = plan.exceptions;
    return e.blocked.length + e.noEligibleMachine.length + e.outOfScope.length + e.manual30000.length;
  }, [plan]);

  const hasData = jobs.length > 0;

  return (
    <div className="flex min-h-full flex-col">
      <Header
        view={view}
        setView={setView}
        exceptionCount={exceptionCount}
        onSettings={() => setDialog('settings')}
        onPrint={() => setDialog('print')}
        onExport={() => plan && downloadPlan(plan, settings)}
        onHelp={() => setDialog('help')}
        onReport={() => setDialog('report')}
      />

      <main className="flex-1 px-3 py-4 sm:px-6">
        {!hasData ? (
          <Landing />
        ) : !plan ? (
          <div className="py-24 text-center text-sm text-slate-400">{planError ? `Planning failed: ${planError}` : 'Planning…'}</div>
        ) : (
          <>
            {planError && <div className="mb-3 rounded-lg border border-rose-800 bg-rose-950/50 px-4 py-2 text-xs text-rose-200">Planning failed: {planError}. Showing the last good plan.</div>}
            <div className={planning ? 'opacity-70 transition-opacity' : 'transition-opacity'}>
              {view === 'gantt' && <GanttView onSelect={it => setSelectedJob(it.job.id)} onEditEvent={setEvent} onCarpenter={() => setDialog('carpenter')} />}
              {view === 'priority' && <PriorityView />}
              {view === 'orders' && <OrdersView onSelect={it => setSelectedJob(it.job.id)} />}
              {view === 'runsheet' && <RunSheetView onPrint={() => setDialog('print')} />}
              {view === 'exceptions' && <ExceptionsView />}
            </div>
          </>
        )}
      </main>

      <footer className="no-print border-t border-slate-900 py-4 text-center text-xs text-slate-500">
        CNC Smart Planner · everything is processed locally in your browser; nothing is uploaded.
      </footer>

      {dialog === 'settings' && <SettingsDrawer onClose={() => setDialog(null)} />}
      {dialog === 'print' && <PrintSheet onClose={() => setDialog(null)} />}
      {dialog === 'help' && <HelpModal onClose={() => setDialog(null)} />}
      {dialog === 'report' && <ImportReportModal onClose={() => setDialog(null)} />}
      {dialog === 'carpenter' && <CarpenterPanel onClose={() => setDialog(null)} />}
      {selectedJob && <JobDetailModal jobId={selectedJob} onClose={() => setSelectedJob(null)} />}
      {event && <EventModal initial={event} onClose={() => setEvent(null)} />}
      <Toasts />
    </div>
  );
}
