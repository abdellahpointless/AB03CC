import { FileSpreadsheet, Hammer, Sparkles, Timer, Upload } from 'lucide-react';
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
  delay = 0,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  optional?: boolean;
  text: string;
  status?: string | null;
  tone: 'blue' | 'amber' | 'sky';
  onFiles: (f: FileList) => void;
  delay?: number;
  children: React.ReactNode;
}) {
  const [over, setOver] = useState(false);
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    if (e.dataTransfer.files.length) onFiles(e.dataTransfer.files);
  };
  const ring = tone === 'blue' ? 'border-blue-500 bg-blue-950/20' : tone === 'amber' ? 'border-amber-500 bg-amber-950/20' : 'border-sky-500 bg-sky-950/20';
  const iconCls =
    tone === 'blue'
      ? 'border-blue-500/30 bg-blue-600/10 text-blue-400'
      : tone === 'amber'
        ? 'border-amber-500/30 bg-amber-600/10 text-amber-400'
        : 'border-sky-500/30 bg-sky-600/10 text-sky-400';
  return (
    <div
      onDragOver={e => (e.preventDefault(), setOver(true))}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
      style={{ animationDelay: `${delay}ms` }}
      className={`anim-fade-up lift flex flex-col items-center gap-3 rounded-xl border-2 border-dashed p-8 text-center backdrop-blur-sm transition-colors ${
        over ? `${ring} scale-[1.01]` : 'border-slate-800 bg-slate-900/50 hover:border-slate-600'
      }`}
    >
      <div className={`float-slow flex h-12 w-12 items-center justify-center rounded-full border ${iconCls}`}>
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
  const { loadDemo, carpenterParts, carpenterFile, partList, settings } = useStore();
  const { handleFiles } = useImport();
  const prodInput = useRef<HTMLInputElement>(null);
  const carpInput = useRef<HTMLInputElement>(null);
  const timesInput = useRef<HTMLInputElement>(null);

  return (
    <div className="relative mx-auto max-w-6xl space-y-6 py-10">
      <div aria-hidden className="pointer-events-none absolute -left-24 -top-10 -z-10 h-72 w-72 rounded-full bg-blue-600/20 blur-3xl" style={{ animation: 'orb-drift 14s ease-in-out infinite' }} />
      <div aria-hidden className="pointer-events-none absolute -right-20 top-24 -z-10 h-64 w-64 rounded-full bg-violet-600/15 blur-3xl" style={{ animation: 'orb-drift 18s ease-in-out infinite reverse' }} />
      <div className="anim-fade-up text-center">
        <h2 className="text-xl font-bold text-white">Plan your CNC workload</h2>
        <p className="mt-1 text-sm text-slate-400">
          Import the production export first. The carpenter list is optional and can be added any time. Files are recognised by their columns, so you can drop both at once.
        </p>
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <Drop
          tone="blue"
          icon={<FileSpreadsheet className="h-6 w-6" />}
          title="1. Production Workload"
          text="BoxShelf export from TPS-MA (.xlsx / .csv). Box codes and order numbers keep their leading zeros."
          onFiles={handleFiles}
          delay={80}
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
          delay={160}
        >
          <input ref={carpInput} type="file" accept=".xlsx,.xls,.csv" multiple hidden onChange={e => (handleFiles(e.target.files), (e.target.value = ''))} />
          <Button variant="amber" onClick={() => carpInput.current?.click()}>
            <Upload className="h-3.5 w-3.5" /> Select carpenter file
          </Button>
        </Drop>
        <Drop
          tone="sky"
          icon={<Timer className="h-6 w-6" />}
          title="3. Parts Time List"
          optional
          text={`Average real minutes per part, matched on the material number. Parts not in the list are estimated at NC × ${settings.estimateMultiplier}.`}
          status={partList.source === 'none' ? null : `${partList.source === 'builtin' ? 'Built-in list' : partList.file} · ${partList.count.toLocaleString()} parts`}
          onFiles={handleFiles}
          delay={240}
        >
          <input ref={timesInput} type="file" accept=".xlsx,.xls,.csv" multiple hidden onChange={e => (handleFiles(e.target.files), (e.target.value = ''))} />
          <Button onClick={() => timesInput.current?.click()}>
            <Upload className="h-3.5 w-3.5" /> {partList.source === 'imported' ? 'Replace time list' : 'Select time list'}
          </Button>
        </Drop>
      </div>
    </div>
  );
}
