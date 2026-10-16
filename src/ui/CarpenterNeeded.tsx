import { Hammer, Upload } from 'lucide-react';
import { useRef } from 'react';
import { useStore } from '../state/store';
import { Button } from './kit';
import { Drop } from './Landing';
import { useImport } from './useImport';

function ago(iso: string | null): string {
  if (!iso) return '';
  const min = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (!Number.isFinite(min) || min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  return h < 24 ? `${h} h ago` : `${Math.round(h / 24)} days ago`;
}

/**
 * The carpenter list is required: a workload alone is not planned. The planner needs to know which modules still have
 * uncut parts at the carpenter, or it would rush modules that cannot be finished.
 */
export function CarpenterNeeded() {
  const { jobs, report, carpenterParts, carpenterFile, carpenterAt, keepCarpenter } = useStore();
  const { handleFiles } = useImport();
  const input = useRef<HTMLInputElement>(null);
  const old = carpenterParts.length > 0;
  return (
    <div className="mx-auto max-w-xl space-y-4 py-14">
      <div className="anim-fade-up text-center">
        <h2 className="text-xl font-bold text-white">One more file: the carpenter list</h2>
        <p className="mt-1 text-sm text-slate-400">
          The workload is in ({report?.fileName ?? 'workload'} · {jobs.length} parts). To plan it, the app needs today's carpenter list: a module that still has uncut parts at the carpenter cannot be finished, so the
          modules that can are planned first.
        </p>
      </div>
      <Drop
        tone="amber"
        icon={<Hammer className="h-6 w-6" />}
        title="Carpenter list (required)"
        text="Export it from the carpenter page of the website (Excel button) and drop it here, or select it."
        onFiles={handleFiles}
        delay={80}
      >
        <input ref={input} type="file" accept=".xlsx,.xls,.csv" multiple hidden onChange={e => (handleFiles(e.target.files), (e.target.value = ''))} />
        <Button variant="amber" onClick={() => input.current?.click()}>
          <Upload className="h-3.5 w-3.5" /> Select the carpenter list
        </Button>
      </Drop>
      {old && (
        <div className="anim-fade-up flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-900/50 px-4 py-3 text-xs text-slate-400" style={{ animationDelay: '160ms' }}>
          <span>
            Still loaded: <b className="text-slate-200">{carpenterFile ?? 'carpenter list'}</b> · {carpenterParts.length} parts{carpenterAt ? ` · imported ${ago(carpenterAt)}` : ''}
          </span>
          <Button size="sm" onClick={keepCarpenter} title="Plan with the carpenter list that is already loaded">
            Keep using it
          </Button>
        </div>
      )}
    </div>
  );
}
