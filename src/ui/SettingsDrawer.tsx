import { Hammer, Plus, RotateCcw, Timer, Trash2, Upload, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { clockMinutes, minutesPerDay } from '../core/calendar';
import { EFFICIENCY_PRESETS, MATERIAL_TYPES } from '../core/defaults';
import { calibrationSuggestions, parseCalibration } from '../core/efficiency';
import type { CarpenterCutColumn, CarpenterDelayMode, PlannerSettings, PlanningEffort, PlanningMode } from '../core/types';
import { useStore } from '../state/store';
import { Badge, Button, Field, NumberInput, Segmented, Toggle, inputCls } from './kit';
import { MachinesEditor } from './MachinesEditor';
import { useImport } from './useImport';
import { DEFAULT_PART_KIND_CODES, parsePrefixes, prefixText, type PartKindCodes } from '../core/partKinds';
import { DEFAULT_CUT_ALLOWANCES } from '../core/carpenter/dims';

type Tab = 'machines' | 'materials' | 'time' | 'rules' | 'parttimes' | 'carpenter' | 'efficiency';
const TABS: Array<[Tab, string]> = [
  ['machines', 'Machines'],
  ['materials', 'Materials'],
  ['time', 'Changeover & calendar'],
  ['rules', 'Planning rules'],
  ['parttimes', 'Part times'],
  ['carpenter', 'Carpenter'],
  ['efficiency', 'Efficiency'],
];

export function SettingsDrawer({ onClose }: { onClose: () => void }) {
  const { settings, updateSettings, resetSettings } = useStore();
  const [tab, setTab] = useState<Tab>('machines');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="no-print anim-fade-in fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-sm" onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <aside className="anim-drawer flex h-full w-full max-w-3xl flex-col border-l border-slate-700 bg-slate-900 shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-800 px-5 py-3">
          <div>
            <h2 className="text-sm font-bold text-white">Variable Editor</h2>
            <p className="text-xs text-slate-400">Changes apply immediately and re-plan in the background.</p>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={() => confirm('Reset every setting to its default?') && resetSettings()}>
              <RotateCcw className="h-3 w-3" /> Reset
            </Button>
            <Button size="sm" variant="primary" onClick={onClose}>
              Done
            </Button>
            <button onClick={onClose} className="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-white" aria-label="Close">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
        <nav className="flex gap-1 overflow-x-auto border-b border-slate-800 px-3 py-2">
          {TABS.map(([id, label]) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-bold ${tab === id ? 'bg-blue-600 text-white' : 'text-slate-300 hover:bg-slate-800'}`}
            >
              {label}
            </button>
          ))}
        </nav>
        <div className="flex-1 overflow-y-auto p-5">
          {tab === 'machines' && <MachinesEditor s={settings} set={updateSettings} />}
          {tab === 'materials' && <MaterialsTab s={settings} set={updateSettings} />}
          {tab === 'time' && <TimeTab s={settings} set={updateSettings} />}
          {tab === 'rules' && <RulesTab s={settings} set={updateSettings} />}
          {tab === 'parttimes' && <PartTimesTab s={settings} set={updateSettings} />}
          {tab === 'carpenter' && <CarpenterTab s={settings} set={updateSettings} />}
          {tab === 'efficiency' && <EfficiencyTab s={settings} set={updateSettings} />}
        </div>
      </aside>
    </div>
  );
}

type SetFn = (p: Partial<PlannerSettings> | ((s: PlannerSettings) => PlannerSettings)) => void;
interface TabProps {
  s: PlannerSettings;
  set: SetFn;
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="mb-6">
      <h3 className="text-xs font-bold uppercase tracking-wider text-white">{title}</h3>
      {hint && <p className="mb-3 mt-0.5 text-[11px] text-slate-400">{hint}</p>}
      <div className={hint ? '' : 'mt-3'}>{children}</div>
    </section>
  );
}

/* ----------------------------- materials ----------------------------- */

function MaterialsTab({ s, set }: TabProps) {
  const [newMat, setNewMat] = useState('');
  const [aliasFrom, setAliasFrom] = useState('');
  const [aliasTo, setAliasTo] = useState('');
  const mats = [...new Set([...MATERIAL_TYPES, ...Object.keys(s.materialOffsets)])];
  return (
    <>
      <Section title="Material time offsets" hint="Extra time in percent added to the planned time of an estimated part (probing, deburring, tool wear…). Parts with a measured time ignore it. Estimated = NC × factor ÷ efficiency × (1 + offset %) × qty.">
        <div className="grid gap-2 sm:grid-cols-2">
          {mats.map(m => (
            <div key={m} className="flex items-center justify-between gap-3 rounded-lg border border-slate-800 bg-slate-950/50 px-3 py-2">
              <span className="text-xs font-bold text-slate-200">{m}</span>
              <div className="flex items-center gap-2">
                <div className="w-20">
                  <NumberInput value={s.materialOffsets[m] ?? 0} min={0} onChange={v => v !== undefined && set({ materialOffsets: { ...s.materialOffsets, [m]: v } })} />
                </div>
                <span className="text-[11px] text-slate-500">%</span>
              </div>
            </div>
          ))}
        </div>
        <div className="mt-3 flex gap-2">
          <input className={inputCls} placeholder="Add material type, e.g. PE" value={newMat} onChange={e => setNewMat(e.target.value)} />
          <Button
            onClick={() => {
              const m = newMat.trim().toUpperCase();
              if (m) set({ materialOffsets: { ...s.materialOffsets, [m]: 0 } });
              setNewMat('');
            }}
          >
            Add
          </Button>
        </div>
      </Section>

      <Section title="Material aliases" hint='Treat one material label as another during planning, e.g. "ALU B" → "ALU" so it can run on aluminium machines. Without an alias such parts land in "No eligible machine".'>
        <div className="space-y-1.5">
          {Object.entries(s.materialAliases).map(([from, to]) => (
            <div key={from} className="flex items-center gap-2 text-xs">
              <Badge className="border-slate-600 text-slate-200">{from}</Badge> → <Badge className="border-blue-600 text-blue-200">{to}</Badge>
              <button
                className="ml-auto text-slate-500 hover:text-rose-400"
                onClick={() => {
                  const { [from]: _x, ...rest } = s.materialAliases;
                  set({ materialAliases: rest });
                }}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
        <div className="mt-2 flex gap-2">
          <input className={inputCls} placeholder="From (e.g. ALU B)" value={aliasFrom} onChange={e => setAliasFrom(e.target.value)} />
          <input className={inputCls} placeholder="To (e.g. ALU)" value={aliasTo} onChange={e => setAliasTo(e.target.value)} />
          <Button
            onClick={() => {
              const f = aliasFrom.trim().toUpperCase();
              const t = aliasTo.trim().toUpperCase();
              if (f && t && f !== t) set({ materialAliases: { ...s.materialAliases, [f]: t } });
              setAliasFrom('');
              setAliasTo('');
            }}
          >
            Add
          </Button>
        </div>
      </Section>
    </>
  );
}

/* ----------------------------- time ----------------------------- */

function TimeTab({ s, set }: TabProps) {
  const c = s.calendar;
  const setC = (p: Partial<typeof c>) => set({ calendar: { ...c, ...p } });
  const setCo = (k: keyof typeof s.changeover, v: number | undefined) => v !== undefined && set({ changeover: { ...s.changeover, [k]: Math.max(0, v) } });
  return (
    <>
      <Section title="Changeover times" hint="Setup minutes inserted between two consecutive parts on a machine. A changeover happens only when the next part is of a different material family, or is much bigger than the part before it. Anything else runs straight on.">
        <div className="grid gap-2 sm:grid-cols-2">
          <div className="flex items-center justify-between gap-3 rounded-lg border border-slate-800 bg-slate-950/50 px-3 py-2">
            <div>
              <div className="text-xs font-bold text-slate-200">Different material family</div>
              <div className="text-[11px] text-slate-500">Clean-out and tooling swap</div>
            </div>
            <div className="flex w-24 items-center gap-1">
              <NumberInput value={s.changeover.differentMaterialTypeMin} min={0} onChange={v => setCo('differentMaterialTypeMin', v)} />
              <span className="text-[11px] text-slate-500">min</span>
            </div>
          </div>
          <div className="flex items-center justify-between gap-3 rounded-lg border border-slate-800 bg-slate-950/50 px-3 py-2">
            <div>
              <div className="text-xs font-bold text-slate-200">Much bigger part</div>
              <div className="text-[11px] text-slate-500">Setup for a longer part after a short one</div>
            </div>
            <div className="flex w-24 items-center gap-1">
              <NumberInput value={s.changeover.biggerPartMin} min={0} onChange={v => setCo('biggerPartMin', v)} />
              <span className="text-[11px] text-slate-500">min</span>
            </div>
          </div>
          <div className="flex items-center justify-between gap-3 rounded-lg border border-slate-800 bg-slate-950/50 px-3 py-2 sm:col-span-2">
            <div>
              <div className="text-xs font-bold text-slate-200">"Much bigger" means at least</div>
              <div className="text-[11px] text-slate-500">times as long as the part before (its listed or estimated time × quantity)</div>
            </div>
            <div className="flex w-24 items-center gap-1">
              <NumberInput value={s.changeover.biggerPartRatio} min={1} step={0.5} onChange={v => setCo('biggerPartRatio', v)} />
              <span className="text-[11px] text-slate-500">×</span>
            </div>
          </div>
        </div>
      </Section>
      <Section title="Calendar" hint={`Working time per day: ${(minutesPerDay(c) / 60).toFixed(1)} h`}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Plan start date">
            <input type="date" className={inputCls} value={c.startDate} onChange={e => e.target.value && setC({ startDate: e.target.value })} />
          </Field>
          <Field label="Shift start hour (0–23)">
            <NumberInput value={c.shiftStartHour} min={0} max={23} onChange={v => v !== undefined && setC({ shiftStartHour: Math.min(23, Math.max(0, Math.round(v))) })} />
          </Field>
          <Field label="Plan starts at hour (0–23)" hint="The hour of the start date at which the machines begin. Earlier hours of that day are left empty.">
            <NumberInput value={c.startHour} min={0} max={23} onChange={v => v !== undefined && setC({ startHour: Math.min(23.99, Math.max(0, v)) })} />
          </Field>
          <Field label="Shifts per day">
            <NumberInput value={c.shiftsPerDay} min={1} max={3} onChange={v => v && setC({ shiftsPerDay: Math.round(v) })} />
          </Field>
          <Field label="Hours per shift">
            <NumberInput value={c.hoursPerShift} min={1} max={12} onChange={v => v && setC({ hoursPerShift: v })} />
          </Field>
        </div>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <Toggle checked={c.workSaturday} onChange={v => setC({ workSaturday: v })} label="Work on Saturday" hint="Operators normally work Monday to Saturday." />
          <Toggle checked={c.workSunday} onChange={v => setC({ workSunday: v })} label="Work on Sunday" hint="Off by default: Sunday is skipped." />
          <Toggle checked={c.continuous247} onChange={v => setC({ continuous247: v })} label="Continuous 24/7" hint="Ignore shifts and weekends; machines run around the clock." />
        </div>
      </Section>
      <BreaksSection c={c} setC={setC} />
    </>
  );
}

const BREAK_PRESETS: Array<{ label: string; start: string; minutes: number }> = [
  { label: 'Coffee break', start: '10:00', minutes: 15 },
  { label: 'Lunch', start: '12:30', minutes: 30 },
  { label: 'Afternoon break', start: '16:00', minutes: 15 },
];

function BreaksSection({ c, setC }: { c: PlannerSettings['calendar']; setC: (p: Partial<PlannerSettings['calendar']>) => void }) {
  const list = c.breaks ?? [];
  const setList = (breaks: PlannerSettings['calendar']['breaks']) => setC({ breaks });
  const edit = (id: string, p: Partial<(typeof list)[number]>) => setList(list.map(b => (b.id === id ? { ...b, ...p } : b)));
  const add = (preset: { label: string; start: string; minutes: number }) => setList([...list, { id: `brk-${Date.now().toString(36)}-${list.length}`, ...preset }]);
  const total = list.reduce((a, b) => a + (clockMinutes(b.start) !== null ? b.minutes : 0), 0);
  return (
    <Section title="Operator breaks" hint={`Breaks the operators take every working day, at the same clock time. ${total ? `${total} min a day in total.` : ''}`}>
      <div className="mb-3">
        <Segmented
          value={c.breakMode}
          options={[
            { value: 'stop', label: 'Machines stop during a break' },
            { value: 'run', label: 'Running parts carry on' },
          ]}
          onChange={breakMode => setC({ breakMode })}
        />
        <p className="mt-1.5 text-[11px] text-slate-500">
          {c.breakMode === 'run'
            ? 'A part that is already running finishes during the break; no part is started and no changeover is done until the break is over.'
            : 'The machines stand still: a running part pauses and carries on after the break; nothing starts and no changeover is done during it.'}
        </p>
      </div>
      <div className="space-y-2">
        {list.map(b => {
          const bad = clockMinutes(b.start) === null;
          return (
            <div key={b.id} className="grid grid-cols-[minmax(0,1fr)_8rem_6.5rem_auto] items-center gap-2 rounded-lg border border-slate-800 bg-slate-950/50 px-3 py-2">
              <input className={inputCls} value={b.label} placeholder="Name" aria-label="Break name" onChange={e => edit(b.id, { label: e.target.value })} />
              <input type="time" className={`${inputCls} ${bad ? 'border-rose-600' : ''}`} value={b.start} aria-label="Starts at" onChange={e => edit(b.id, { start: e.target.value })} />
              <div className="flex items-center gap-1">
                <NumberInput value={b.minutes} min={1} max={240} onChange={v => v && edit(b.id, { minutes: Math.round(v) })} />
                <span className="text-[11px] text-slate-500">min</span>
              </div>
              <button onClick={() => setList(list.filter(x => x.id !== b.id))} className="rounded p-1 text-slate-500 hover:bg-rose-950 hover:text-rose-400" aria-label={`Remove ${b.label || 'break'}`}>
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          );
        })}
        {list.length === 0 && <p className="text-[11px] text-slate-500">No breaks yet: the machines are planned without pauses.</p>}
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        <Button size="sm" onClick={() => add({ label: 'Break', start: '10:00', minutes: 15 })}>
          <Plus className="h-3 w-3" /> Add a break
        </Button>
        {BREAK_PRESETS.filter(p => !list.some(b => b.label === p.label)).map(p => (
          <Button key={p.label} size="sm" variant="ghost" onClick={() => add(p)}>
            + {p.label} {p.start} · {p.minutes} min
          </Button>
        ))}
      </div>
    </Section>
  );
}

/* ----------------------------- rules ----------------------------- */

function RulesTab({ s, set }: TabProps) {
  return (
    <>
      <Section
        title="Planning engine"
        hint="The optimizer searches for the plan that finishes the most master orders soonest. A basic plan appears at once and is replaced when the search is done. Classic is the earlier heuristic, which balances the machines first."
      >
        <Segmented
          value={s.planningMode}
          onChange={(v: PlanningMode) => set({ planningMode: v })}
          options={[
            { value: 'modules_first', label: 'Optimizer: finish orders first' },
            { value: 'classic', label: 'Classic' },
          ]}
        />
        {s.planningMode === 'modules_first' && (
          <div className="mt-3 text-xs">
            <span className="mb-1 block font-semibold text-slate-300">Search effort</span>
            <Segmented
              value={s.planningEffort}
              onChange={(v: PlanningEffort) => set({ planningEffort: v })}
              options={[
                { value: 'quick', label: 'Quick' },
                { value: 'standard', label: 'Standard' },
                { value: 'thorough', label: 'Thorough' },
              ]}
            />
            <span className="mt-1 block text-[11px] text-slate-500">More effort searches longer for a slightly better plan: roughly 2, 7 and 25 seconds for 500 parts.</span>
          </div>
        )}
      </Section>
      <Section title="Assignment rules">
        <div className="grid gap-2">
          <Toggle checked={s.keepErpAssignments} onChange={v => set({ keepErpAssignments: v })} label="Keep ERP machine assignments" hint="Jobs already assigned to one of your machines in the ERP stay on that machine; the optimizer chooses where in its queue they run." />
          <Toggle checked={s.restartJobOnEvent} onChange={v => set({ restartJobOnEvent: v })} label="Restart a job hit by a disruption" hint="Off: the job pauses and resumes after the disruption." />
        </div>
      </Section>
      <Section title="Synchronization">
        <Field label="Synchronization tolerance (minutes)" hint="A master order counts as synchronized when its first and last part finish within this spread.">
          <div className="w-32">
            <NumberInput value={s.syncToleranceMin} min={0} onChange={v => v !== undefined && set({ syncToleranceMin: v })} />
          </div>
        </Field>
      </Section>
      <PartKindsSection s={s} set={set} />
      <Section title="Out-of-scope ERP machines" hint="Jobs the ERP assigned to these machines are listed under Exceptions and not planned. Comma separated.">
        <input
          className={inputCls}
          key={s.outOfScopeMachines.join('|')}
          defaultValue={s.outOfScopeMachines.join(', ')}
          onBlur={e => set({ outOfScopeMachines: e.target.value.split(',').map(x => x.trim()).filter(Boolean) })}
        />
      </Section>
    </>
  );
}

function PartKindsSection({ s, set }: TabProps) {
  const codes = s.partKindCodes;
  const rows: Array<[keyof PartKindCodes, string, string]> = [
    ['rework', 'Rework', 'Top priority, ahead of every rule; not counted as a finished module.'],
    ['table', 'Tables', 'Order and master order start with one of these (or a spare prefix with the sales order of a table).'],
    ['spare', 'Spare parts', 'Order starts with one of these and is not a table.'],
  ];
  const changed = (Object.keys(DEFAULT_PART_KIND_CODES) as Array<keyof PartKindCodes>).some(k => codes[k].join(',') !== DEFAULT_PART_KIND_CODES[k].join(','));
  return (
    <Section
      title="Kinds of parts (order number prefixes)"
      hint="The start of the order number tells what a part is. Every other order is a module part. Several prefixes per kind: separate them with commas. An empty box goes back to the default."
    >
      <div className="grid gap-2">
        {rows.map(([k, label, hint]) => (
          <Field key={k} label={label} hint={`${hint} Default ${prefixText(DEFAULT_PART_KIND_CODES[k])}.`}>
            <input
              className={`${inputCls} mono`}
              key={codes[k].join('|')}
              defaultValue={codes[k].join(', ')}
              placeholder={DEFAULT_PART_KIND_CODES[k].join(', ')}
              onBlur={e => {
                const v = parsePrefixes(e.target.value);
                set({ partKindCodes: { ...codes, [k]: v.length ? v : DEFAULT_PART_KIND_CODES[k] } });
              }}
              onKeyDown={e => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
            />
          </Field>
        ))}
      </div>
      {changed && (
        <Button size="sm" className="mt-2" onClick={() => set({ partKindCodes: structuredClone(DEFAULT_PART_KIND_CODES) })}>
          <RotateCcw className="h-3.5 w-3.5" /> Defaults
        </Button>
      )}
    </Section>
  );
}

function AllowancesSection({ s, set }: TabProps) {
  const [mat, setMat] = useState('');
  const [mm, setMm] = useState<number | undefined>(3);
  const entries = Object.entries(s.cutAllowances).sort(([a], [b]) => a.localeCompare(b));
  const put = (next: Record<string, number>) => set({ cutAllowances: next });
  return (
    <Section
      title="Extra size to saw, per material"
      hint="The carpenter saws this many mm more on the two sizes that are not Z (the CNC squares the part before milling). It is added to the cut list, the printed sheets and the scan. Default: FH +3 mm."
    >
      <div className="grid gap-1.5">
        {entries.length === 0 && <p className="text-xs text-slate-500">No extra size: every part is sawn at its drawing size.</p>}
        {entries.map(([m, v]) => (
          <div key={m} className="flex items-center gap-2 text-xs">
            <span className="mono w-24 font-semibold text-white">{m}</span>
            <div className="w-24">
              <NumberInput value={v} min={0} step={0.5} onChange={n => n !== undefined && put({ ...s.cutAllowances, [m]: n })} />
            </div>
            <span className="text-slate-400">mm on X and Y</span>
            <button
              className="ml-auto rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-rose-300"
              title={`Remove ${m}`}
              onClick={() => {
                const next = { ...s.cutAllowances };
                delete next[m];
                put(next);
              }}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>
      <div className="mt-3 flex items-center gap-2">
        <div className="w-32">
          <input
            list="allowance-materials"
            className={`${inputCls} mono`}
            placeholder="Material"
            value={mat}
            onChange={e => setMat(e.target.value.toUpperCase())}
          />
        </div>
        <datalist id="allowance-materials">
          {MATERIAL_TYPES.map(m => (
            <option key={m} value={m} />
          ))}
        </datalist>
        <div className="w-24">
          <NumberInput value={mm} min={0} step={0.5} onChange={setMm} />
        </div>
        <Button
          size="sm"
          disabled={!mat.trim() || mm === undefined}
          onClick={() => {
            put({ ...s.cutAllowances, [mat.trim()]: mm ?? 0 });
            setMat('');
          }}
        >
          <Plus className="h-3.5 w-3.5" /> Add
        </Button>
        <Button size="sm" className="ml-auto" onClick={() => put({ ...DEFAULT_CUT_ALLOWANCES })}>
          <RotateCcw className="h-3.5 w-3.5" /> Defaults
        </Button>
      </div>
    </Section>
  );
}

/* ----------------------------- part times ----------------------------- */

function PartTimesTab({ s, set }: TabProps) {
  const { partList, partCoverage: cov, clearImportedPartList } = useStore();
  const { handleFiles, inputRef, openPicker } = useImport();
  const pct = cov.uniqueParts ? Math.round((cov.measuredParts / cov.uniqueParts) * 100) : 0;
  return (
    <>
      <Section
        title="Parts time list"
        hint="Average real minutes per part, matched on the material number (Matnr). A part found in the list is planned at exactly that time."
      >
        <div className="rounded-lg border border-slate-800 bg-slate-950/50 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs">
              <Timer className="h-4 w-4 text-sky-400" />
              {partList.source === 'none' ? (
                <span className="text-slate-300">No list loaded: every part is estimated.</span>
              ) : (
                <span className="text-slate-200">
                  <b>{partList.source === 'builtin' ? 'Built-in list' : partList.file}</b> · {partList.count.toLocaleString()} parts
                  {partList.source === 'imported' && <span className="text-slate-500"> (imported)</span>}
                </span>
              )}
            </div>
            <div className="flex gap-2">
              <input ref={inputRef} type="file" accept=".xlsx,.xls,.csv" hidden onChange={e => (handleFiles(e.target.files), (e.target.value = ''))} />
              <Button size="sm" variant="primary" onClick={openPicker}>
                <Upload className="h-3 w-3" /> {partList.source === 'imported' ? 'Replace list' : 'Import list'}
              </Button>
              {partList.source === 'imported' && (
                <Button size="sm" variant="danger" onClick={clearImportedPartList}>
                  {partList.hasBuiltin ? 'Use built-in list' : 'Remove list'}
                </Button>
              )}
            </div>
          </div>
          {cov.jobs > 0 && (
            <div className="mt-3">
              <div className="mb-1 flex justify-between text-[11px] text-slate-400">
                <span>
                  {cov.measuredParts} of {cov.uniqueParts} parts in this workload have a real time
                </span>
                <span className="mono">{pct}%</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-slate-800">
                <div className="h-full rounded-full bg-sky-500 transition-[width] duration-700 ease-out" style={{ width: `${pct}%` }} />
              </div>
              <p className="mt-1 text-[11px] text-slate-500">
                {cov.measuredJobs} of {cov.jobs} rows are measured; the rest use the estimate below.
              </p>
            </div>
          )}
        </div>
      </Section>

      <Section title="How times are decided">
        <div className="grid gap-2">
          <Toggle
            checked={s.useMeasuredTimes}
            onChange={v => set({ useMeasuredTimes: v })}
            label="Use real times from the list"
            hint="On: listed parts run for exactly their listed time × quantity. Efficiency %, machine speed, material defaults, cautious mode, material offsets and per-part overrides never touch them. Only a run time you type on a job beats it. Off: everything is estimated."
          />
        </div>
        <div className="mt-3 w-64">
          <Field label="Estimate for parts not in the list (× NC minutes)" hint="Planned = NC minutes × this factor × quantity. Your efficiency rules and material offsets still apply to estimated parts.">
            <NumberInput value={s.estimateMultiplier} min={0.1} step={0.1} onChange={v => v && v > 0 && set({ estimateMultiplier: v })} />
          </Field>
        </div>
      </Section>
    </>
  );
}

/* ----------------------------- carpenter ----------------------------- */

function CarpenterTab({ s, set }: TabProps) {
  const { carpenterParts, carpenterFile, clearCarpenter, plan, jobs } = useStore();
  const [mo, setMo] = useState('');
  const known = useMemo(() => [...new Set(jobs.map(j => j.masterOrder))], [jobs]);
  return (
    <>
      <Section title="Carpenter list">
        {carpenterParts.length ? (
          <div className="flex items-center justify-between rounded-lg border border-emerald-800 bg-emerald-950/30 px-3 py-2 text-xs text-emerald-200">
            <span>
              <Hammer className="mr-1.5 inline h-3.5 w-3.5" />
              {carpenterFile} · {carpenterParts.length} parts{plan?.carpenterReport ? ` · ${plan.carpenterReport.matchedMasterOrders} master orders matched` : ''}
            </span>
            <Button size="sm" variant="danger" onClick={clearCarpenter}>
              Remove list
            </Button>
          </div>
        ) : (
          <p className="text-xs text-slate-400">No list loaded. Use Import in the top bar: the file is recognised by its columns.</p>
        )}
      </Section>
      <AllowancesSection s={s} set={set} />
      <Section
        title="What counts as cut?"
        hint="A part leaves the carpenter list when it reaches the CNC workload, so every part still in the list is still at the carpenter. The website's Cutted Status is set for whole orders at once, not per part. The workload's own counters (Sub Order Count − Cutting Count) are checked too, for parts the list does not show."
      >
        <select className={inputCls} value={s.carpenterCutColumn} onChange={e => set({ carpenterCutColumn: e.target.value as CarpenterCutColumn })}>
          <option value="in_list">Every part in the carpenter list is still to cut (recommended)</option>
          <option value="cutted_status">Trust the Cutted Status column</option>
          <option value="carpenter_status">Trust the Carpenter Status column</option>
          <option value="either">Trust either column</option>
        </select>
      </Section>
      <Section
        title="Modules waiting for the carpenter"
        hint="A module's parts left are its parts in the workload plus its parts the carpenter has not cut yet. Inside each priority class, the modules the carpenter is done with are planned first; the ones still waiting for cut parts come after them, so the modules that can really be finished come first."
      >
        <Segmented
          value={s.carpenterDelayMode === 'off' ? 'off' : 'soft'}
          onChange={(v: CarpenterDelayMode) => set({ carpenterDelayMode: v })}
          options={[
            { value: 'soft', label: 'Ready modules first' },
            { value: 'off', label: 'Off: ignore the carpenter' },
          ]}
        />
      </Section>
      <Section title="Simulate an uncut module" hint="Pretend a master order still has uncut carpenter parts to see how the plan reacts.">
        <div className="mb-2 flex flex-wrap gap-1.5">
          {s.simulatedUncutMasterOrders.map(m => (
            <span key={m} className="mono flex items-center gap-1 rounded border border-amber-700 bg-amber-950/40 px-2 py-0.5 text-[11px] text-amber-200">
              {m}
              <button onClick={() => set({ simulatedUncutMasterOrders: s.simulatedUncutMasterOrders.filter(x => x !== m) })}>
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
        <div className="flex gap-2">
          <input list="mo-list" className={inputCls} placeholder="Master order number" value={mo} onChange={e => setMo(e.target.value)} />
          <datalist id="mo-list">
            {known.slice(0, 300).map(m => (
              <option key={m} value={m} />
            ))}
          </datalist>
          <Button
            onClick={() => {
              const v = mo.trim();
              if (v && !s.simulatedUncutMasterOrders.includes(v)) set({ simulatedUncutMasterOrders: [...s.simulatedUncutMasterOrders, v] });
              setMo('');
            }}
          >
            Add
          </Button>
        </div>
      </Section>
    </>
  );
}

/* ----------------------------- efficiency ----------------------------- */

function EfficiencyTab({ s, set }: TabProps) {
  const { jobs, notify } = useStore();
  const [calText, setCalText] = useState('');
  const [showVar, setShowVar] = useState(false);
  const mats = useMemo(() => [...new Set([...MATERIAL_TYPES, ...jobs.map(j => j.materialType)])], [jobs]);
  const suggestions = useMemo(() => calibrationSuggestions(s.calibrationHistory, s), [s]);
  const overrideCount = Object.keys(s.partEfficiencyOverrides).length;

  const setCell = (kind: 'efficiencyMatrix' | 'efficiencyVariability', machine: string, mat: string, v: number | undefined) => {
    set(prev => {
      const grid = { ...prev[kind] };
      const row = { ...(grid[machine] ?? {}) };
      if (v === undefined || (kind === 'efficiencyMatrix' && v <= 0)) delete row[mat];
      else row[mat] = v;
      grid[machine] = row;
      return { ...prev, [kind]: grid };
    });
  };

  return (
    <>
      <Section title="Planning mode" hint="Efficiency only applies to parts with an estimated time. Parts with a measured time from the list are never changed by it. Expected uses the efficiency as entered; Cautious subtracts each cell's variability.">
        <Segmented value={s.efficiencyMode} onChange={v => set({ efficiencyMode: v })} options={[{ value: 'expected', label: 'Expected' }, { value: 'cautious', label: 'Cautious' }]} />
      </Section>
      <Section title="Presets">
        <div className="grid gap-2 sm:grid-cols-3">
          {Object.entries(EFFICIENCY_PRESETS).map(([k, p]) => (
            <button
              key={k}
              onClick={() => set({ globalEfficiencyPercent: p.global, materialEfficiency: { ...p.materials } })}
              className="rounded-lg border border-slate-700 bg-slate-950/50 p-3 text-left hover:border-blue-500"
            >
              <div className="text-xs font-bold text-white">{p.label}</div>
              <div className="mt-0.5 text-[11px] leading-snug text-slate-400">{p.description}</div>
            </button>
          ))}
        </div>
      </Section>
      <Section title="Global & material defaults" hint="Lookup order: part override → machine × material → material default → machine speed (when not 100) → global.">
        <div className="mb-3 w-48">
          <Field label="Global efficiency (%)">
            <NumberInput value={s.globalEfficiencyPercent} min={10} max={200} onChange={v => v && set({ globalEfficiencyPercent: v })} />
          </Field>
        </div>
        <div className="grid gap-2 sm:grid-cols-3">
          {mats.map(m => (
            <div key={m} className="flex items-center justify-between gap-2 rounded-lg border border-slate-800 bg-slate-950/50 px-3 py-1.5">
              <span className="text-xs font-bold text-slate-200">{m}</span>
              <div className="w-20">
                <NumberInput
                  value={s.materialEfficiency[m]}
                  min={10}
                  max={200}
                  placeholder="—"
                  onChange={v => set(p => {
                    const next = { ...p.materialEfficiency };
                    if (v && v > 0) next[m] = v;
                    else delete next[m];
                    return { ...p, materialEfficiency: next };
                  })}
                />
              </div>
            </div>
          ))}
        </div>
      </Section>
      <Section title="Machine × material matrix" hint="Most specific setting. Leave a cell empty to fall back to the defaults above.">
        <div className="mb-2">
          <Toggle checked={showVar} onChange={setShowVar} label="Edit variability (± points)" hint="Used by Cautious mode: lower bound = efficiency − variability." />
        </div>
        <div className="overflow-x-auto rounded-lg border border-slate-800">
          <table className="w-full text-xs">
            <thead className="bg-slate-900 text-slate-400">
              <tr>
                <th className="px-3 py-2 text-left">Machine</th>
                {mats.map(m => (
                  <th key={m} className="px-1 py-2 text-center">{m}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {s.machines.map(mc => (
                <tr key={mc.id} className="border-t border-slate-800">
                  <td className="mono whitespace-nowrap px-3 py-1 text-slate-200">{mc.id}</td>
                  {mats.map(m => (
                    <td key={m} className="px-1 py-1">
                      <div className="w-16">
                        <NumberInput
                          value={showVar ? s.efficiencyVariability[mc.id]?.[m] : s.efficiencyMatrix[mc.id]?.[m]}
                          min={0}
                          max={200}
                          placeholder="—"
                          onChange={v => setCell(showVar ? 'efficiencyVariability' : 'efficiencyMatrix', mc.id, m, v)}
                        />
                      </div>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
      <Section title="Calibrate from actuals" hint="Paste one line per box: Box Code, Machine, Actual minutes. Suggested efficiency = Σ (NC × estimate factor) ÷ Σ actual minutes, so it corrects the estimate for parts that are not in the parts list.">
        <textarea className={`${inputCls} h-24 font-mono`} placeholder={'0217, HAAS - 1, 38\n6601, FANUC - 1, 52'} value={calText} onChange={e => setCalText(e.target.value)} />
        <div className="mt-2 flex gap-2">
          <Button
            onClick={() => {
              const { rows, error } = parseCalibration(calText, jobs);
              if (error) return notify(error, 'error');
              set({ calibrationHistory: [...s.calibrationHistory, ...rows] });
              setCalText('');
              notify(`${rows.length} actuals added.`);
            }}
          >
            Add actuals
          </Button>
          {s.calibrationHistory.length > 0 && (
            <Button variant="danger" onClick={() => set({ calibrationHistory: [] })}>
              Clear {s.calibrationHistory.length} saved
            </Button>
          )}
        </div>
        {suggestions.length > 0 && (
          <div className="mt-3 overflow-hidden rounded-lg border border-slate-800">
            <table className="w-full text-xs">
              <thead className="bg-slate-900 text-left text-slate-400">
                <tr>{['Machine', 'Material', 'Samples', 'Estimate / actual', 'Current', 'Suggested'].map(h => <th key={h} className="px-3 py-2">{h}</th>)}</tr>
              </thead>
              <tbody>
                {suggestions.map(g => (
                  <tr key={g.machineId + g.materialType} className="border-t border-slate-800">
                    <td className="px-3 py-1.5">{g.machineId}</td>
                    <td className="px-3">{g.materialType}</td>
                    <td className="mono px-3">{g.samples}</td>
                    <td className="mono px-3">{Math.round(g.ncMinutes * s.estimateMultiplier)}/{g.actualMinutes}</td>
                    <td className="mono px-3">{g.currentPercent}%</td>
                    <td className="mono px-3 font-bold text-emerald-300">{g.suggestedPercent}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="border-t border-slate-800 p-2 text-right">
              <Button
                variant="primary"
                onClick={() =>
                  set(p => {
                    const matrix = { ...p.efficiencyMatrix };
                    suggestions.forEach(g => (matrix[g.machineId] = { ...(matrix[g.machineId] ?? {}), [g.materialType]: g.suggestedPercent }));
                    return { ...p, efficiencyMatrix: matrix };
                  })
                }
              >
                Apply suggestions to matrix
              </Button>
            </div>
          </div>
        )}
      </Section>
      <Section title="Per-part overrides">
        <p className="text-xs text-slate-400">{overrideCount} part{overrideCount === 1 ? '' : 's'} currently overridden (set from a job's detail or in bulk on the Orders tab).</p>
        {overrideCount > 0 && (
          <Button className="mt-2" variant="danger" onClick={() => set({ partEfficiencyOverrides: {} })}>
            Clear all overrides
          </Button>
        )}
      </Section>
    </>
  );
}
