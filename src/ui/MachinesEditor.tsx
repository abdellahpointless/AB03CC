import { AlertTriangle, ChevronDown, Plus, Power, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { MATERIAL_TYPES } from '../core/defaults';
import { refusal } from '../core/scheduler/eligibility';
import { SimContext } from '../core/scheduler/simulate';
import type { Job, MachineConfig, MachineSizeLimit, PlannerSettings } from '../core/types';
import { useStore } from '../state/store';
import { Button, Field, NumberInput, Segmented, inputCls } from './kit';

type SetFn = (p: Partial<PlannerSettings> | ((s: PlannerSettings) => PlannerSettings)) => void;

/**
 * The machine editor. Every rule here is hard: a part a machine refuses never goes there, whether the planner, the
 * optimizer, the ERP or a drag on the Gantt puts it there. The counts are worked out with exactly the planner's rules.
 */
export function MachinesEditor({ s, set }: { s: PlannerSettings; set: SetFn }) {
  const { jobs, partTimes } = useStore();
  const patch = (id: string, p: Partial<MachineConfig>) => set({ machines: s.machines.map(m => (m.id === id ? { ...m, ...p } : m)) });
  const [open, setOpen] = useState<string | null>(null);

  // the workload as the planner sees it: blocked parts left out, material aliases applied
  const parts = useMemo(() => {
    const out = new Set(s.outOfScopeMachines);
    return jobs
      .filter(j => !j.blocked && !(j.erpMachine && out.has(j.erpMachine)))
      .map(j => (s.materialAliases[j.materialType] ? { ...j, materialType: s.materialAliases[j.materialType] } : j));
  }, [jobs, s.materialAliases, s.outOfScopeMachines]);
  const ctx = useMemo(() => new SimContext(s, s.machines, partTimes), [s, partTimes]);
  const check = useMemo(() => {
    const takes = new Map<string, number>();
    const nobody: Array<{ job: Job; why: string }> = [];
    for (const j of parts) {
      let any = false;
      let firstWhy = '';
      for (const m of s.machines) {
        const why = refusal(j, m, s, ctx);
        if (!why) {
          any = true;
          takes.set(m.id, (takes.get(m.id) ?? 0) + 1);
        } else if (!firstWhy && !m.isDown) firstWhy = why;
      }
      if (!any) nobody.push({ job: j, why: firstWhy || 'every machine is down' });
    }
    return { takes, nobody };
  }, [parts, s, ctx]);

  const materials = useMemo(
    () => [...new Set([...MATERIAL_TYPES, ...parts.map(j => j.materialType).filter(Boolean), ...s.machines.flatMap(m => [...m.allowedMaterials, ...(m.backupMaterials ?? [])])])],
    [parts, s.machines],
  );
  const perMaterial = useMemo(() => {
    const c = new Map<string, number>();
    for (const j of parts) c.set(j.materialType, (c.get(j.materialType) ?? 0) + 1);
    return c;
  }, [parts]);

  const [newName, setNewName] = useState('');
  const [copyFrom, setCopyFrom] = useState('');
  const add = () => {
    const name = newName.trim();
    if (!name || s.machines.some(m => m.id === name)) return;
    const base = s.machines.find(m => m.id === copyFrom);
    const fresh: MachineConfig = base
      ? { ...structuredClone(base), id: name, name, isDown: false }
      : { id: name, name, allowedMaterials: [], speedPercentage: 100 };
    set({ machines: [...s.machines, fresh] });
    setNewName('');
    setOpen(name);
  };

  return (
    <div className="space-y-5">
      <section>
        <h3 className="text-xs font-bold uppercase tracking-wider text-white">Who makes what</h3>
        <p className="mb-3 mt-0.5 text-[11px] text-slate-400">
          Every rule is hard: a part goes only to a machine that takes its material, its size and its part type. The ERP machine is kept only when that machine takes the part; drag and drop on the Gantt follows the same rules. The machine name must match the ERP machine name.
        </p>
        <div className="overflow-x-auto rounded-lg border border-slate-800">
          <table className="w-full min-w-[640px] text-xs">
            <thead className="bg-slate-900 text-left text-[10px] uppercase tracking-wide text-slate-400">
              <tr>
                <th className="px-3 py-2">Machine</th>
                <th className="px-3 py-2">Materials</th>
                <th className="px-3 py-2">Part size</th>
                <th className="px-3 py-2">Part types</th>
                <th className="px-3 py-2 text-right">Workload parts it may take</th>
              </tr>
            </thead>
            <tbody>
              {s.machines.map(m => (
                <tr key={m.id} className={`cursor-pointer border-t border-slate-800 hover:bg-slate-900/70 ${m.isDown ? 'opacity-50' : ''}`} onClick={() => setOpen(m.id)}>
                  <td className="mono px-3 py-2 font-bold text-white">
                    {m.name}
                    {m.isDown && <span className="ml-2 rounded bg-rose-900/60 px-1.5 text-[10px] font-semibold text-rose-200">down</span>}
                  </td>
                  <td className="px-3 py-2 text-slate-200">
                    {m.allowedMaterials.join(', ') || <span className="text-rose-300">none</span>}
                    {m.backupMaterials?.length ? <span className={m.useBackupMaterials ? 'text-amber-300' : 'text-slate-500'}> + {m.backupMaterials.join(', ')} {m.useBackupMaterials ? '(backup, on)' : '(backup, off)'}</span> : null}
                  </td>
                  <td className="px-3 py-2 text-slate-300">{sizeText(m.size)}</td>
                  <td className="px-3 py-2 text-slate-300">{m.partTypes?.restricted ? `${Object.values(m.partTypes.allowed).filter(a => a.small || a.big).length} chosen` : 'all'}</td>
                  <td className="mono px-3 py-2 text-right text-slate-200">{m.isDown ? '—' : `${check.takes.get(m.id) ?? 0} / ${parts.length}`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {check.nobody.length > 0 && <NobodyTakes list={check.nobody} />}
      </section>

      <section className="space-y-2">
        {s.machines.map(m => (
          <MachineCard
            key={m.id}
            m={m}
            open={open === m.id}
            onToggle={() => setOpen(o => (o === m.id ? null : m.id))}
            patch={p => patch(m.id, p)}
            remove={() => confirm(`Remove ${m.name}? Its parts are planned on the other machines.`) && set({ machines: s.machines.filter(x => x.id !== m.id) })}
            materials={materials}
            perMaterial={perMaterial}
            takes={check.takes.get(m.id) ?? 0}
            total={parts.length}
            parts={parts}
            ctx={ctx}
            s={s}
          />
        ))}
      </section>

      <section className="rounded-lg border border-dashed border-slate-700 p-3">
        <div className="mb-2 text-[11px] font-semibold text-slate-300">Add a machine</div>
        <div className="flex flex-wrap gap-2">
          <input className={`${inputCls} min-w-[200px] flex-1`} placeholder="Name as in the ERP, e.g. HAAS - 6" value={newName} onChange={e => setNewName(e.target.value)} onKeyDown={e => e.key === 'Enter' && add()} />
          <select className={`${inputCls} w-48`} value={copyFrom} onChange={e => setCopyFrom(e.target.value)}>
            <option value="">Start empty</option>
            {s.machines.map(m => (
              <option key={m.id} value={m.id}>Copy rules of {m.name}</option>
            ))}
          </select>
          <Button variant="primary" onClick={add} disabled={!newName.trim() || s.machines.some(m => m.id === newName.trim())}>
            <Plus className="h-3.5 w-3.5" /> Add
          </Button>
        </div>
      </section>
    </div>
  );
}

function sizeText(lim?: MachineSizeLimit): string {
  if (!lim || (!lim.min && !lim.max)) return 'any';
  const unit = lim.basis === 'planned' ? 'planned min' : 'NC min';
  if (lim.min && lim.max) return `${lim.min} – under ${lim.max} ${unit}`;
  if (lim.max) return `under ${lim.max} ${unit}`;
  return `from ${lim.min} ${unit}`;
}

function NobodyTakes({ list }: { list: Array<{ job: Job; why: string }> }) {
  const [show, setShow] = useState(false);
  const byWhy = new Map<string, number>();
  for (const x of list) {
    const key = x.why.replace(/^[\d.]+ /, '… ');
    byWhy.set(key, (byWhy.get(key) ?? 0) + 1);
  }
  return (
    <div className="mt-2 rounded-lg border border-amber-700/60 bg-amber-950/30 p-3 text-xs text-amber-100">
      <button className="flex w-full items-center gap-2 text-left font-semibold" onClick={() => setShow(v => !v)}>
        <AlertTriangle className="h-3.5 w-3.5 text-amber-400" />
        {list.length} part{list.length === 1 ? '' : 's'} of the workload no machine may take. They wait under Exceptions → No eligible machine.
        <ChevronDown className={`ml-auto h-3.5 w-3.5 transition-transform ${show ? 'rotate-180' : ''}`} />
      </button>
      {show && (
        <ul className="mt-2 space-y-0.5 text-[11px] text-amber-200/90">
          {[...byWhy].sort((a, b) => b[1] - a[1]).map(([why, n]) => (
            <li key={why}>
              <span className="mono">{n}×</span> {why}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function MachineCard({
  m,
  open,
  onToggle,
  patch,
  remove,
  materials,
  perMaterial,
  takes,
  total,
  parts,
  ctx,
  s,
}: {
  m: MachineConfig;
  open: boolean;
  onToggle: () => void;
  patch: (p: Partial<MachineConfig>) => void;
  remove: () => void;
  materials: string[];
  perMaterial: Map<string, number>;
  takes: number;
  total: number;
  parts: Job[];
  ctx: SimContext;
  s: PlannerSettings;
}) {
  const lim: MachineSizeLimit = m.size ?? { basis: 'nc', min: null, max: null };
  const setLim = (p: Partial<MachineSizeLimit>) => patch({ size: { ...lim, ...p } });
  // three states per material: not taken, always taken, backup only
  const stateOf = (mat: string): 'off' | 'on' | 'backup' => (m.allowedMaterials.includes(mat) ? 'on' : m.backupMaterials?.includes(mat) ? 'backup' : 'off');
  const cycle = (mat: string) => {
    const st = stateOf(mat);
    const allowed = m.allowedMaterials.filter(x => x !== mat);
    const backup = (m.backupMaterials ?? []).filter(x => x !== mat);
    if (st === 'off') patch({ allowedMaterials: [...allowed, mat], backupMaterials: backup });
    else if (st === 'on') patch({ allowedMaterials: allowed, backupMaterials: [...backup, mat] });
    else patch({ allowedMaterials: allowed, backupMaterials: backup });
  };
  // what the size limit leaves out, among the parts whose material this machine takes
  const sizeEffect = useMemo(() => {
    const withMat = parts.filter(j => m.allowedMaterials.includes(j.materialType) || (m.useBackupMaterials && m.backupMaterials?.includes(j.materialType)));
    const free = { ...m, size: undefined, partTypes: undefined, isDown: false };
    const inSize = withMat.filter(j => !refusal(j, { ...free, size: m.size }, s, ctx)).length;
    return { withMat: withMat.length, inSize };
  }, [parts, m, s, ctx]);

  return (
    <div className={`rounded-lg border ${m.isDown ? 'border-rose-900/70 bg-rose-950/10' : open ? 'border-blue-700/70 bg-slate-950/60' : 'border-slate-800 bg-slate-950/40'}`}>
      <button className="flex w-full items-center gap-3 px-3 py-2.5 text-left" onClick={onToggle} aria-expanded={open}>
        <span className={`h-2 w-2 shrink-0 rounded-full ${m.isDown ? 'bg-rose-500' : 'bg-emerald-400'}`} />
        <span className="mono text-sm font-bold text-white">{m.name}</span>
        <span className="truncate text-[11px] text-slate-400">{m.description}</span>
        <span className="mono ml-auto shrink-0 text-[11px] text-slate-400">{m.isDown ? 'down' : `${takes}/${total} parts`}</span>
        <ChevronDown className={`h-4 w-4 shrink-0 text-slate-500 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="space-y-4 border-t border-slate-800 px-3 pb-3 pt-3">
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={() => patch({ isDown: !m.isDown })}>
              <Power className={`h-3 w-3 ${m.isDown ? 'text-emerald-400' : 'text-rose-400'}`} /> {m.isDown ? 'Machine is down · switch on' : 'Machine is running · set down'}
            </Button>
            <input className={`${inputCls} min-w-[220px] flex-1`} value={m.description ?? ''} placeholder="Description" onChange={e => patch({ description: e.target.value })} />
            <button onClick={remove} className="rounded p-1.5 text-slate-500 hover:bg-rose-950 hover:text-rose-400" aria-label={`Remove ${m.name}`} title="Remove machine">
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>

          <div>
            <div className="mb-1 text-[11px] font-semibold text-slate-300">Materials</div>
            <p className="mb-2 text-[11px] text-slate-500">Click to switch: blue = always, amber = backup only (used while the switch below is on), grey = never. The number is how many workload parts have that material.</p>
            <div className="flex flex-wrap gap-1.5">
              {materials.map(mat => {
                const st = stateOf(mat);
                return (
                  <button
                    key={mat}
                    onClick={() => cycle(mat)}
                    title={st === 'on' ? 'Always taken · click for backup only' : st === 'backup' ? 'Backup only · click for never' : 'Never · click for always'}
                    className={`rounded border px-2 py-0.5 text-[11px] font-bold ${
                      st === 'on' ? 'border-blue-500 bg-blue-600 text-white' : st === 'backup' ? 'border-amber-500 bg-amber-500/20 text-amber-200' : 'border-slate-700 text-slate-500 hover:bg-slate-800'
                    }`}
                  >
                    {mat}
                    <span className="mono ml-1 text-[10px] font-normal opacity-70">{perMaterial.get(mat) ?? 0}</span>
                  </button>
                );
              })}
            </div>
            {(m.backupMaterials?.length ?? 0) > 0 && (
              <label className="mt-2 flex items-center gap-2 text-[11px] text-slate-300">
                <input type="checkbox" className="accent-amber-500" checked={Boolean(m.useBackupMaterials)} onChange={e => patch({ useBackupMaterials: e.target.checked })} />
                Use the backup materials now ({m.backupMaterials!.join(', ')})
              </label>
            )}
          </div>

          <div>
            <div className="mb-1 text-[11px] font-semibold text-slate-300">Part size per piece</div>
            <div className="flex flex-wrap items-end gap-3">
              <Field label="Measured by">
                <Segmented
                  value={lim.basis}
                  options={[
                    { value: 'nc', label: 'NC file minutes' },
                    { value: 'planned', label: 'Planned minutes' },
                  ]}
                  onChange={basis => setLim({ basis })}
                />
              </Field>
              <div className="w-32">
                <Field label="Only from (min)">
                  <NumberInput value={lim.min ?? undefined} min={0} placeholder="no limit" onChange={v => setLim({ min: v && v > 0 ? v : null })} />
                </Field>
              </div>
              <div className="w-32">
                <Field label="Only under (min)">
                  <NumberInput value={lim.max ?? undefined} min={0} placeholder="no limit" onChange={v => setLim({ max: v && v > 0 ? v : null })} />
                </Field>
              </div>
            </div>
            <p className="mt-1.5 text-[11px] text-slate-500">
              {lim.basis === 'planned' ? 'Planned minutes = the real time from the parts list (or the estimate) for one piece on this machine.' : 'NC file minutes per piece, as in the workload.'}{' '}
              {sizeEffect.withMat > 0 && (lim.min || lim.max) ? `${sizeEffect.inSize} of the ${sizeEffect.withMat} parts in its materials fit.` : ''}
            </p>
          </div>

          <PartTypesEditor machine={m} patch={patch} />

          <div className="w-48">
            <Field label="Speed (% of ideal)" hint="Only for estimated times: 50 = twice as long.">
              <NumberInput value={m.speedPercentage} min={10} max={300} onChange={v => v && patch({ speedPercentage: v })} />
            </Field>
          </div>
        </div>
      )}
    </div>
  );
}

function PartTypesEditor({ machine, patch }: { machine: MachineConfig; patch: (p: Partial<MachineConfig>) => void }) {
  const { partTypes } = useStore();
  const [showAll, setShowAll] = useState(false);
  const [q, setQ] = useState('');
  const cfg = machine.partTypes ?? { restricted: false, allowed: {} };
  const save = (next: typeof cfg) => patch({ partTypes: next });
  const inWorkload = partTypes.filter(t => t.small + t.big > 0).length;
  const rows = partTypes.filter(t => (showAll || t.small + t.big > 0) && (!q || t.label.toLowerCase().includes(q.trim().toLowerCase())));
  const ticked = Object.values(cfg.allowed).filter(a => a.small || a.big).length;
  const setAll = (small: boolean, big: boolean) => save({ ...cfg, allowed: Object.fromEntries(partTypes.map(t => [t.key, { small, big }])) });
  const toggle = (key: string, size: 'small' | 'big', on: boolean) => {
    const cur = cfg.allowed[key] ?? { small: false, big: false };
    save({ ...cfg, allowed: { ...cfg.allowed, [key]: { ...cur, [size]: on } } });
  };
  return (
    <div>
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <span className="text-[11px] font-semibold text-slate-300">Part types</span>
        <Segmented
          value={cfg.restricted ? 'chosen' : 'all'}
          options={[
            { value: 'all', label: 'All part types' },
            { value: 'chosen', label: 'Only chosen types' },
          ]}
          onChange={v => {
            const restricted = v === 'chosen';
            // switching on starts from "everything allowed", so nothing changes until a type is unticked
            save({ restricted, allowed: restricted && ticked === 0 ? Object.fromEntries(partTypes.map(t => [t.key, { small: true, big: true }])) : cfg.allowed });
          }}
        />
      </div>
      {partTypes.length === 0 ? (
        <p className="text-[11px] text-slate-500">Import the parts time list to choose part types (seal cage, pin plate …).</p>
      ) : (
        cfg.restricted && (
          <div className="mt-2">
            <p className="mb-2 text-[11px] text-slate-500">
              Names from the parts time list without numbers ("Contact pin plate 001" is a Contact pin plate). Small = real time under 15 min per part, Big = 15 min or more. A part that is not in the list is only checked against materials and size. Untick what this machine must not make.
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
                  <tr>
                    <th className="px-2 py-1 text-left">Part type</th>
                    <th className="px-2 py-1 text-right">In workload</th>
                    <th className="px-2 py-1">Small</th>
                    <th className="px-2 py-1">Big</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(t => {
                    const a = cfg.allowed[t.key] ?? { small: false, big: false };
                    return (
                      <tr key={t.key} className="border-t border-slate-800/80">
                        <td className="px-2 py-1 text-slate-200">{t.label}</td>
                        <td className="mono px-2 py-1 text-right text-[10px] text-slate-500">{t.small + t.big ? `${t.small} small · ${t.big} big` : '–'}</td>
                        <td className="px-2 py-1 text-center">
                          <input type="checkbox" className="accent-blue-500" aria-label={`${t.label} small`} checked={a.small} onChange={e => toggle(t.key, 'small', e.target.checked)} />
                        </td>
                        <td className="px-2 py-1 text-center">
                          <input type="checkbox" className="accent-blue-500" aria-label={`${t.label} big`} checked={a.big} onChange={e => toggle(t.key, 'big', e.target.checked)} />
                        </td>
                      </tr>
                    );
                  })}
                  {rows.length === 0 && (
                    <tr>
                      <td colSpan={4} className="px-2 py-3 text-center text-slate-500">No part type matches.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )
      )}
    </div>
  );
}
