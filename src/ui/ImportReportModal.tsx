import { AlertTriangle } from 'lucide-react';
import { useStore } from '../state/store';
import { Modal } from './kit';

export function ImportReportModal({ onClose }: { onClose: () => void }) {
  const { report, carpenterFile, carpenterParts, plan } = useStore();
  if (!report) return null;
  const stat = (k: string, v: React.ReactNode) => (
    <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-3">
      <div className="text-[10px] uppercase tracking-wide text-slate-500">{k}</div>
      <div className="mono text-lg font-bold text-white">{v}</div>
    </div>
  );
  return (
    <Modal title="Import report" subtitle={report.fileName} onClose={onClose} width="max-w-3xl">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {stat('Rows', report.totalRows)}
        {stat('Master orders', report.uniqueMasterOrders)}
        {stat('Drawings (Matnr)', report.uniqueMatnr)}
        {stat('Order numbers', report.uniqueOrders)}
        {stat('Assigned in ERP', report.assignedInErp)}
        {stat('Unassigned', report.unassigned)}
        {stat('Unassigned NC time', `${report.unassignedMinutes}m`)}
        {stat('Carpenter parts', carpenterParts.length)}
      </div>
      {report.warnings.map(w => (
        <p key={w} className="mt-3 flex items-center gap-2 rounded-lg border border-amber-800 bg-amber-950/40 px-3 py-2 text-xs text-amber-200">
          <AlertTriangle className="h-3.5 w-3.5" /> {w}
        </p>
      ))}
      <div className="mt-5 grid gap-5 md:grid-cols-2">
        <div>
          <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-400">ERP machine assignments</h3>
          <table className="w-full text-xs">
            <tbody>
              {Object.entries(report.erpLoads).sort().map(([m, v]) => (
                <tr key={m} className="border-b border-slate-800">
                  <td className="py-1 text-slate-300">{m}</td>
                  <td className="mono text-right text-slate-400">{v.count} jobs</td>
                  <td className="mono w-20 text-right text-slate-400">{v.minutes}m</td>
                </tr>
              ))}
              {Object.keys(report.erpLoads).length === 0 && <tr><td className="py-2 text-slate-500">None</td></tr>}
            </tbody>
          </table>
        </div>
        <div>
          <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-400">Material mix</h3>
          <table className="w-full text-xs">
            <tbody>
              {Object.entries(report.materialCounts).sort((a, b) => b[1] - a[1]).map(([m, n]) => (
                <tr key={m} className="border-b border-slate-800">
                  <td className="py-1 text-slate-300">{m}</td>
                  <td className="mono text-right text-slate-400">{n}</td>
                </tr>
              ))}
              {Object.keys(report.materialCounts).length === 0 && <tr><td className="py-2 text-slate-500">—</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
      {plan?.carpenterReport && (
        <p className="mt-5 rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2 text-xs text-slate-300">
          Carpenter list{carpenterFile ? ` (${carpenterFile})` : ''}: {plan.carpenterReport.totalParts} parts, {plan.carpenterReport.uniqueMasterOrders} master orders, {plan.carpenterReport.matchedMasterOrders} matched to production, {plan.carpenterReport.openMasterOrders} with open parts.
        </p>
      )}
    </Modal>
  );
}
