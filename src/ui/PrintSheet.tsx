import { Printer } from 'lucide-react';
import { formatClock, formatDayMonth, formatDuration } from '../core/calendar';
import { useStore } from '../state/store';
import { Button, Modal } from './kit';

/** A4 run sheets, one page per machine. The overlay is the print area (see print rules in index.css). */
export function PrintSheet({ onClose }: { onClose: () => void }) {
  const { plan, settings } = useStore();
  if (!plan) return null;
  const printed = new Date().toLocaleString();
  return (
    <>
      <Modal
        width="max-w-5xl"
        title="Print run sheets"
        subtitle="One A4 page per machine. Use landscape orientation for the widest layout."
        onClose={onClose}
        footer={
          <>
            <Button onClick={onClose}>Close</Button>
            <Button variant="primary" onClick={() => window.print()}>
              <Printer className="h-3.5 w-3.5" /> Print
            </Button>
          </>
        }
      >
        <p className="text-xs text-slate-400">{settings.machines.length} sheets will be printed. Preview below.</p>
      </Modal>
      <div className="print-area hidden bg-white p-6 text-black">
        {settings.machines.map(m => {
          const items = plan.queues[m.id] ?? [];
          return (
            <section key={m.id} className="print-page mb-10">
              <header className="mb-3 flex items-end justify-between border-b-2 border-black pb-2">
                <div>
                  <h1 className="text-2xl font-extrabold">{m.name}</h1>
                  <p className="text-xs">Run sheet · {items.length} parts · queue finish {plan.kpis.finishPerMachine[m.id] ?? 0} min</p>
                </div>
                <p className="text-right text-[10px]">Printed {printed}<br />CNC Smart Planner</p>
              </header>
              <table className="w-full border-collapse text-[11px]">
                <thead>
                  <tr className="bg-gray-200 text-left">
                    {['#', 'Box', 'Master order', 'Matnr', 'Mat.', 'Qty', 'Setup', 'Duration', 'Start', 'End', 'Done'].map(h => (
                      <th key={h} className="border border-gray-400 px-1.5 py-1">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {items.map(it => (
                    <tr key={it.job.id}>
                      <td className="border border-gray-400 px-1.5 py-1">{it.sequence}</td>
                      <td className="border border-gray-400 px-1.5 py-1 font-bold">{it.job.boxCode}</td>
                      <td className="border border-gray-400 px-1.5 py-1">{it.job.masterOrder}</td>
                      <td className="border border-gray-400 px-1.5 py-1">{it.job.matnr}</td>
                      <td className="border border-gray-400 px-1.5 py-1">{it.job.materialType}</td>
                      <td className="border border-gray-400 px-1.5 py-1">{it.job.qty}</td>
                      <td className="border border-gray-400 px-1.5 py-1">{it.setupBefore ? `+${it.setupBefore}m` : '–'}</td>
                      <td className="border border-gray-400 px-1.5 py-1">{formatDuration(it.durationMin)}</td>
                      <td className="border border-gray-400 px-1.5 py-1">{formatDayMonth(it.startTime)} {formatClock(it.startTime)}</td>
                      <td className="border border-gray-400 px-1.5 py-1">{formatClock(it.endTime)}</td>
                      <td className="border border-gray-400 px-1.5 py-1 text-center">☐</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          );
        })}
      </div>
    </>
  );
}
