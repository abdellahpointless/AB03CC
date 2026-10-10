import { Hammer, Plus, RotateCcw, Timer, Trash2, Upload, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { minutesPerDay } from '../core/calendar';
import { EFFICIENCY_PRESETS, MATERIAL_TYPES } from '../core/defaults';
import { calibrationSuggestions, parseCalibration } from '../core/efficiency';
import type { CarpenterCutColumn, CarpenterDelayMode, MachineConfig, PlannerSettings, PlanningEffort, PlanningMode } from '../core/types';
import { useStore } from '../state/store';
import { Badge, Button, Field, NumberInput, Segmented, Toggle, inputCls } from './kit';
import { useImport } from './useImport';

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
          {tab === 'machines' && <MachinesTab s={settings} set={updateSettings} />}
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

/* ----------------------------- machines ----------------------------- */

function MachinesTab({ s, set }: TabProps) {
  const patch = (id: string, p: Partial<MachineConfig>) => set({ machines: s.machines.map(m => (m.id === id ? { ...m, ...p } : m)) });
  const allMaterials = useMemo(() => [...new Set([...MATERIAL_TYPES, ...s.machines.flatMap(m => m.allowedMaterials)])], [s.machines]);
  const [newName, setNewName] = useState('');
  const add = () => {
    const name = newName.trim();
    if (!name || s.machines.some(m => m.id === name)) return;
    set({ machines: [...s.machines, { id: name, name, allowedMaterials: ['ALU'], speedPercentage: 100 }] });
    setNewName('');
  };
  return (
    <>
      <Section title="CNC machine centers" hint="The machine name must equal the ERP machine name so existing assignments are recognised.">
        <div className="space-y-3">
          {s.machines.map(m => (
            <div key={m.id} className={`rounded-lg border p-3 ${m.isDown ? 'border-rose-800 bg-rose-950/20' : 'border-slate-800 bg-slate-950/50'}`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="mono text-sm font-bold text-white">{m.id}</div>
                <div className="flex items-center gap-3">
                  <label className="flex items-center gap-1.5 text-xs text-slate-300">
                    <input type="checkbox" checked={Boolean(m.isDown)} onChange={e => patch(m.id, { isDown: e.target.checked })} className="accent-rose-500" /> Machine down
                  </label>
                  <button
                    onClick={() => confirm(`Remove ${m.id}?`) && set({ machines: s.machines.filter(x => x.id !== m.id) })}
                    className="rounded p-1 text-slate-500 hover:bg-rose-950 hover:text-rose-400"
                    aria-label={`Remove ${m.id}`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
              <input className={`${inputCls} mt-2`} value={m.description ?? ''} placeholder="Description" onChange={e => patch(m.id, { description: e.target.value })} />
              <div className="mt-3">
                <div className="mb-1 text-[11px] font-semibold text-slate-300">Allowed materials</div>
                <div className="flex flex-wrap gap-1.5">
                  {allMaterials.map(mat => {
                    const on = m.allowedMaterials.includes(mat);
                    return (
                      <button
                        key={mat}
                        onClick={() => patch(m.id, { allowedMaterials: on ? m.allowedMaterials.filter(x => x !== mat) : [...m.allowedMaterials, mat] })}
                        className={`rounded border px-2 py-0.5 text-[11px] font-bold ${on ? 'border-blue-500 bg-blue-600 text-white' : 'border-slate-700 text-slate-400 hover:bg-slate-800'}`}
                      >
                        {mat}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="mt-3 grid gap-3 sm:grid-cols-3">
                <Field label="Speed (% of ideal)" hint="50 = twice as long">
                  <NumberInput value={m.speedPercentage} min={10} max={300} onChange={v => v && patch(m.id, { speedPercentage: v })} />
                </Field>
                <Field label="Only parts under (NC min)" hint="blank = no limit">
                  <NumberInput value={m.maxNcMinutes ?? undefined} min={1} onChange={v => patch(m.id, { maxNcMinutes: v ?? null })} />
                </Field>
                <Field label="Prefers parts from (NC min)" hint="soft preference">
                  <NumberInput value={m.minNcMinutesPref ?? undefined} min={1} onChange={v => patch(m.id, { minNcMinutesPref: v ?? null })} />
                </Field>
              </div>
              <PartTypesEditor machine={m} patch={patch} />
              <div className="mt-3">
                <Field label="Overflow materials" hint="Also accepted when 'Allow overflow' is enabled in Planning rules (comma separated).">
                  <input
                    className={inputCls}
                    defaultValue={(m.overflowMaterials ?? []).join(', ')}
                    key={m.id + (m.overflowMaterials ?? []).join()}
                    onBlur={e => patch(m.id, { overflowMaterials: e.target.value.split(/[,;\s]+/).map(x => x.trim().toUpperCase()).filter(Boolean) })}
                  />
                </Field>
              </div>
            </div>
          ))}
        </div>
        <div className="mt-3 flex gap-2">
          <input className={inputCls} placeholder="New machine name, e.g. HAAS - 6" value={newName} onChange={e => setNewName(e.target.value)} onKeyDown={e => e.key === 'Enter' && add()} />
          <Button variant="primary" onClick={add}>
            <Plus className="h-3.5 w-3.5" /> Add machine
          </Button>
        </div>
      </Section>
    </>
  );
}

function PartTypesEditor({ machine, patch }: { machine: MachineConfig; patch: (id: string, p: Partial<MachineConfig>) => void }) {
  const { partTypes } = useStore();
  const [open, setOpen] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [q, setQ] = useState('');
  const cfg = machine.partTypes ?? { restricted: false, allowed: {} };
  const save = (next: typeof cfg) => patch(machine.id, { partTypes: next });
  const inWorkload = partTypes.filter(t => t.small + t.big > 0).length;
  const rows = partTypes.filter(t => (showAll || t.small + t.big > 0) && (!q || t.label.toLowerCase().includes(q.trim().toLowerCase())));
  const ticked = Object.values(cfg.allowed).filter(a => a.small || a.big).length;
  const setAll = (small: boolean, big: boolean) => save({ ...cfg, allowed: Object.fromEntries(partTypes.map(t => [t.key, { small, big }])) });
  const toggle = (key: string, size: 'small' | 'big', on: boolean) => {
    const cur = cfg.allowed[key] ?? { small: false, big: false };
    save({ ...cfg, allowed: { ...cfg.allowed, [key]: { ...cur, [size]: on } } });
  };
  return (
    <div className="mt-3 rounded-md border border-slate-800 bg-slate-950/40 p-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="flex items-center gap-2 text-[11px] font-semibold text-slate-300">
          <input
            type="checkbox"
            className="accent-blue-500"
            checked={cfg.restricted}
            disabled={partTypes.length === 0}
            onChange={e => {
              const restricted = e.target.checked;
              // switching on starts from "everything allowed", so nothing changes until a type is unticked
              save({ restricted, allowed: restricted && ticked === 0 ? Object.fromEntries(partTypes.map(t => [t.key, { small: true, big: true }])) : cfg.allowed });
              if (restricted) setOpen(true);
            }}
          />
          Limit to chosen part types
        </label>
        <button className="text-[11px] text-blue-300 hover:text-blue-200" onClick={() => setOpen(o => !o)} disabled={partTypes.length === 0}>
          {partTypes.length === 0 ? 'Import the parts time list to get part names' : open ? 'Hide' : cfg.restricted ? `${ticked} of ${partTypes.length} types ticked · edit` : 'Choose'}
        </button>
      </div>
      {open && partTypes.length > 0 && (
        <div className="mt-2">
          <p className="mb-2 text-[11px] text-slate-500">
            Part names come from the parts time list, without numbers ("Contact pin plate 001" is a Contact pin plate). Small = real time under 15 min per part, Big = 15 min or more. A part that is not in the list is only checked against the materials.
          </p>
          <div className="mb-2 flex flex-wrap items-center gap-1.5">
            <input className={`${inputCls} w-44`} placeholder="Find a part type" value={q} onChange={e => setQ(e.target.value)} />
            <Button size="sm" onClick={() => setAll(true, true)}>All</Button>
            <Button size="sm" onClick={() => setAll(true, false)}>All small</Button>
            <Button size="sm" onClick={() => setAll(false, true)}>All big</Button>
            <Button size="sm" onClick={() => setAll(false, false)}>None</Button>
            <label className="ml-auto flex items-center gap-1.5 text-[11px] text-slate-400">
              <input type="checkbox" className="accent-blue-500" checked={showAll} onChange={e => setShowAll(e.target.checked)} /> Also types only in the list ({partTypes.length - inWorkload})
            </label>
          </div>
          <div className="max-h-64 overflow-auto rounded border border-slate-800">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-slate-900 text-[10px] uppercase tracking-wide text-slate-400">
                <tr><th className="px-2 py-1 text-left">Part type</th><th className="px-2 py-1 text-right">In workload</th><th className="px-2 py-1">Small</th><th className="px-2 py-1">Big</th></tr>
              </thead>
              <tbody>
                {rows.map(t => {
                  const a = cfg.allowed[t.key] ?? { small: false, big: false };
                  return (
                    <tr key={t.key} className="border-t border-slate-800/80">
                      <td className="px-2 py-1 text-slate-200">{t.label}</td>
                      <td className="mono px-2 py-1 text-right text-[10px] text-slate-500">{t.small + t.big ? `${t.small} small · ${t.big} big` : '–'}</td>
                      <td className="px-2 py-1 text-center"><input type="checkbox" className="accent-blue-500" checked={a.small} onChange={e => toggle(t.key, 'small', e.target.checked)} /></td>
                      <td className="px-2 py-1 text-center"><input type="checkbox" className="accent-blue-500" checked={a.big} onChange={e => toggle(t.key, 'big', e.target.checked)} /></td>
                    </tr>
                  );
                })}
                {rows.length === 0 && <tr><td colSpan={4} className="px-2 py-3 text-center text-slate-500">No part type matches.</td></tr>}
              </tbody>
            </table>
          </div>
          {!cfg.restricted && <p className="mt-1.5 text-[11px] text-amber-300/80">Switch on "Limit to chosen part types" for these choices to apply.</p>}
        </div>
      )}
    </div>
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
            <NumberInput value={c.startHour} min={0} max={23} onChange={v => v !== undefined && setC({ startHour: Math.min(23, Math.max(0, Math.round(v))) })} />
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
    </>
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
          <Toggle checked={s.keepErpAssignments} onChange={v => set({ keepErpAssignments: v })} label="Keep ERP machine assignments" hint="Jobs already assigned to one of your machines in the ERP stay there, at the head of its queue." />
          <Toggle checked={s.allowHaas5Overflow} onChange={v => set({ allowHaas5Overflow: v })} label="Allow overflow materials on machines that define them" hint="By default HAAS - 5 may then also take ALU and PCGF." />
          <Toggle checked={s.fanuc2UsesIdealMinutes} onChange={v => set({ fanuc2UsesIdealMinutes: v })} label="Small-part limit uses ideal NC minutes" hint="Off: the limit is checked against efficiency-adjusted planned minutes instead." />
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
      <Section title="What counts as cut?">
        <select className={inputCls} value={s.carpenterCutColumn} onChange={e => set({ carpenterCutColumn: e.target.value as CarpenterCutColumn })}>
          <option value="cutted_status">Cutted Status column</option>
          <option value="carpenter_status">Carpenter Status column</option>
          <option value="either">Either column</option>
        </select>
      </Section>
      <Section title="Delay mode" hint="How master orders with uncut carpenter parts are treated.">
        <Segmented
          value={s.carpenterDelayMode}
          onChange={(v: CarpenterDelayMode) => set({ carpenterDelayMode: v })}
          options={[
            { value: 'off', label: 'Off: ignore for ordering' },
            { value: 'soft', label: 'Soft: prefer ready modules' },
            { value: 'hard', label: 'Hard: ready modules first' },
          ]}
        />
        {s.carpenterDelayMode === 'hard' && (
          <div className="mt-3 w-64">
            <Field label="Maximum delay (hours)" hint="The classic planner releases a waiting module after being held back this long. The optimizer keeps waiting modules from finishing later than that plan does.">
              <NumberInput value={s.carpenterMaxDelayHours} min={0} onChange={v => v !== undefined && set({ carpenterMaxDelayHours: v })} />
            </Field>
          </div>
        )}
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
