import { FileSpreadsheet, Hammer, Sparkles, Upload } from 'lucide-react';
import { useRef, useState, type DragEvent } from 'react';
import { useStore } from '../state/store';
import { Button } from './kit';
import { useImport } from './useImport';

function Drop({
  icon,
  title,
  optional,
  text,
  status,
  tone,
  onFiles,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  optional?: boolean;
  text: string;
  status?: string | null;
  tone: 'blue' | 'amber';
  onFiles: (f: FileList) => void;
  children: React.ReactNode;
}) {
  const [over, setOver] = useState(false);
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    if (e.dataTransfer.files.length) onFiles(e.dataTransfer.files);
  };
  const ring = tone === 'blue' ? 'border-blue-500 bg-blue-950/20' : 'border-amber-500 bg-amber-950/20';
  return (
    <div
      onDragOver={e => (e.preventDefault(), setOver(true))}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
      className={`flex flex-col items-center gap-3 rounded-xl border-2 border-dashed p-8 text-center transition-colors ${
        over ? ring : 'border-slate-800 bg-slate-900/50 hover:border-slate-700'
      }`}
    >
      <div className={`flex h-12 w-12 items-center justify-center rounded-full border ${tone === 'blue' ? 'border-blue-500/30 bg-blue-600/10 text-blue-400' : 'border-amber-500/30 bg-amber-600/10 text-amber-400'}`}>
        {icon}
      </div>
      <h3 className="text-sm font-bold text-white">
        {title} {optional && <span className="ml-1 rounded bg-slate-800 px-1.5 py-0.5 text-[10px] font-normal text-slate-400">Optional</span>}
      </h3>
      <p className="max-w-xs text-xs leading-relaxed text-slate-400">{text}</p>
      {status && <p className="rounded-md border border-emerald-800 bg-emerald-950/50 px-3 py-1.5 text-xs text-emerald-300">{status}</p>}
      <div className="flex flex-wrap justify-center gap-2">{children}</div>
    </div>
  );
}

export function Landing() {
  const { loadDemo, carpenterParts, carpenterFile } = useStore();
  const { handleFiles } = useImport();
  const prodInput = useRef<HTMLInputElement>(null);
  const carpInput = useRef<HTMLInputElement>(null);

  return (
    <div className="mx-auto max-w-4xl space-y-6 py-10">
      <div className="text-center">
        <h2 className="text-xl font-bold text-white">Plan your CNC workload</h2>
        <p className="mt-1 text-sm text-slate-400">
          Import the production export first. The carpenter list is optional and can be added any time. Files are recognised by their columns, so you can drop both at once.
        </p>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <Drop
          tone="blue"
          icon={<FileSpreadsheet className="h-6 w-6" />}
          title="1. Production Workload"
          text="BoxShelf export from TPS-MA (.xlsx / .csv). Box codes and order numbers keep their leading zeros."
          onFiles={handleFiles}
        >
          <input ref={prodInput} type="file" accept=".xlsx,.xls,.csv" multiple hidden onChange={e => (handleFiles(e.target.files), (e.target.value = ''))} />
          <Button variant="primary" onClick={() => prodInput.current?.click()}>
            <Upload className="h-3.5 w-3.5" /> Select production file
          </Button>
          <Button onClick={loadDemo}>
            <Sparkles className="h-3.5 w-3.5 text-amber-400" /> Load demo data
          </Button>
        </Drop>
        <Drop
          tone="amber"
          icon={<Hammer className="h-6 w-6" />}
          title="2. Carpenter List"
          optional
          text="Uncut carpenter parts hold back master order completion and are flagged on the plan."
          status={carpenterParts.length ? `${carpenterFile ?? 'Carpenter list'} · ${carpenterParts.length} parts` : null}
          onFiles={handleFiles}
        >
          <input ref={carpInput} type="file" accept=".xlsx,.xls,.csv" multiple hidden onChange={e => (handleFiles(e.target.files), (e.target.value = ''))} />
          <Button variant="amber" onClick={() => carpInput.current?.click()}>
            <Upload className="h-3.5 w-3.5" /> Select carpenter file
          </Button>
        </Drop>
      </div>
    </div>
  );
}
