import { Hammer } from 'lucide-react';
import { useStore } from '../state/store';
import { Badge, Modal } from './kit';

export function CarpenterPanel({ onClose }: { onClose: () => void }) {
  const { plan, carpenterParts, settings } = useStore();
  const waiting = plan?.waitingOnCarpenter ?? [];
  const rep = plan?.carpenterReport;
  return (
    <Modal
      width="max-w-4xl"
      title={
        <span className="flex items-center gap-2">
          <Hammer className="h-4 w-4 text-amber-400" /> Waiting on carpenter
        </span>
      }
      subtitle={
        rep
          ? `${rep.totalParts} carpenter parts · ${rep.uniqueMasterOrders} master orders · ${rep.matchedMasterOrders} matched to production · ${rep.openMasterOrders} with open parts`
          : 'No carpenter list loaded. Import one (it is recognised automatically) or simulate an uncut module in the Variable Editor.'
      }
      onClose={onClose}
    >
      {waiting.length === 0 ? (
        <p className="py-8 text-center text-sm text-slate-400">
          {carpenterParts.length || settings.simulatedUncutMasterOrders.length
            ? 'Every planned module has all its carpenter parts cut.'
            : 'Nothing to show.'}
        </p>
      ) : (
        <div className="space-y-3">
          {waiting.map(w => (
            <div key={w.masterOrder} className="rounded-lg border border-amber-900/60 bg-amber-950/20 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <span className="mono font-bold text-amber-300">{w.masterOrder}</span>
                  <span className="ml-2 text-xs text-slate-400">{w.customer}</span>
                </div>
                <div className="flex items-center gap-2 text-[11px]">
                  <Badge className="border-amber-700 text-amber-300">
                    {w.openParts.length}/{w.totalParts} parts open
                  </Badge>
                  <span className="mono text-slate-400">CNC finishes {w.lastFinishTime.slice(5, 16).replace('T', ' ')}</span>
                </div>
              </div>
              <ul className="mt-2 space-y-1 text-xs">
                {w.openParts.map((p, i) => (
                  <li key={i} className="flex flex-wrap items-baseline gap-x-2 text-slate-300">
                    <span className="font-semibold">{p.text || p.mText || 'Part'}</span>
                    {p.materialType && <span className="text-slate-500">{p.materialType}</span>}
                    <span className="mono text-slate-500">×{p.qty}</span>
                    {p.alertMessage && <span className="text-rose-300">⚠ {p.alertMessage}</span>}
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-[11px] text-slate-500">Boxes in plan: {w.boxCodes.join(', ')}</p>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}
