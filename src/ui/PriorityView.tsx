import { CalendarClock, Hourglass, Layers, Plus, Tag, Trash2, Users, Hash, Boxes, X } from 'lucide-react';
import { useMemo, useState, type DragEvent } from 'react';
import { RULE_PRESETS } from '../core/defaults';
import { FILTER_TYPES, jobMatchesRule, ruleTypeLabel } from '../core/priority';
import type { Job, PriorityRule, PriorityRuleType } from '../core/types';
import { useStore } from '../state/store';
import { Badge, Button, NumberInput, Segmented, inputCls } from './kit';

const TRAY: Array<{ type: PriorityRuleType; icon: React.ReactNode; desc: string; make: () => Partial<PriorityRule> }> = [
  { type: 'sales_order', icon: <Hash className="h-4 w-4" />, desc: 'Prioritize jobs matching specific sales order numbers', make: () => ({ name: 'Sales Order Priority', values: [] }) },
  { type: 'schedule', icon: <CalendarClock className="h-4 w-4" />, desc: 'Prioritize one schedule number or a range', make: () => ({ name: 'Schedule Priority', scheduleMode: 'range', scheduleMin: 1, scheduleMax: 50 }) },
  { type: 'customer', icon: <Users className="h-4 w-4" />, desc: 'Fast-track strategic customers', make: () => ({ name: 'Customer Priority', values: [] }) },
  { type: 'material_type', icon: <Layers className="h-4 w-4" />, desc: 'Prioritize material types to batch similar work', make: () => ({ name: 'Material Priority', values: [] }) },
  { type: 'finish_master_order', icon: <Boxes className="h-4 w-4" />, desc: 'Group and complete whole master orders first', make: () => ({ name: 'Finish Full Module First', direction: 'lowest_first' }) },
  { type: 'waiting', icon: <Hourglass className="h-4 w-4" />, desc: 'Modules with the fewest remaining parts first', make: () => ({ name: 'Waiting: Modules with Fewest Remaining Parts', direction: 'lowest_first' }) },
  { type: 'production_date', icon: <Tag className="h-4 w-4" />, desc: 'Order by planned production / due date', make: () => ({ name: 'Production Date: Closest First', dateDirection: 'closest_first' }) },
];

const LEVEL_TITLES = ['Highest dispatch tier', 'Secondary dispatch tier', 'Tertiary dispatch tier', 'Fourth dispatch tier'];

function impact(rule: PriorityRule, jobs: Job[]): string {
  if (FILTER_TYPES.includes(rule.type)) {
    const n = jobs.filter(j => jobMatchesRule(j, rule)).length;
    return `${n} job${n === 1 ? '' : 's'} match in loaded data`;
  }
  const mos = new Set(jobs.map(j => j.masterOrder)).size;
  return `ranks ${mos} master orders`;
}

function ValueEditor({ rule, suggestions, onChange }: { rule: PriorityRule; suggestions: string[]; onChange: (v: string[]) => void }) {
  const [text, setText] = useState('');
  const values = rule.values ?? [];
  const add = () => {
    const parts = text.split(/[,;\n]+/).map(s => s.trim()).filter(Boolean);
    if (parts.length) onChange([...new Set([...values, ...parts])]);
    setText('');
  };
  const listId = `sug-${rule.id}`;
  return (
    <div>
      <div className="mb-2 flex flex-wrap gap-1.5">
        {values.length === 0 && <span className="text-[11px] text-slate-500">No values yet: add some below.</span>}
        {values.map(v => (
          <span key={v} className="mono flex items-center gap-1 rounded border border-slate-600 bg-slate-800 px-2 py-0.5 text-[11px]">
            {v}
            <button onClick={() => onChange(values.filter(x => x !== v))} className="text-slate-400 hover:text-rose-400" aria-label={`Remove ${v}`}>
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
      </div>
      <div className="flex gap-2">
        <input
          list={listId}
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && add()}
          placeholder="Type or pick a value, press Enter (comma separates several)"
          className={inputCls}
        />
        <datalist id={listId}>
          {suggestions.slice(0, 200).map(s => (
            <option key={s} value={s} />
          ))}
        </datalist>
        <Button onClick={add}>
          <Plus className="h-3.5 w-3.5" /> Add
        </Button>
      </div>
    </div>
  );
}

function RuleCard({ rule, jobs, levelCount, onChange, onRemove }: { rule: PriorityRule; jobs: Job[]; levelCount: number; onChange: (p: Partial<PriorityRule>) => void; onRemove: () => void }) {
  const suggestions = useMemo(() => {
    const pick = (f: (j: Job) => string) => [...new Set(jobs.map(f).filter(Boolean))].sort();
    if (rule.type === 'sales_order') return pick(j => j.salesOrder);
    if (rule.type === 'customer') return pick(j => j.customer);
    if (rule.type === 'material_type') return pick(j => j.materialType);
    return [];
  }, [jobs, rule.type]);

  return (
    <div
      draggable
      onDragStart={(e: DragEvent) => e.dataTransfer.setData('application/x-rule-id', rule.id)}
      className={`rounded-lg border bg-slate-950/70 p-3 ${rule.enabled ? 'border-slate-700' : 'border-slate-800 opacity-60'}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={rule.name}
          onChange={e => onChange({ name: e.target.value })}
          className="mono min-w-[200px] flex-1 bg-transparent text-xs font-bold text-white outline-none"
          aria-label="Rule name"
        />
        <Badge className="border-slate-600 text-slate-300">{ruleTypeLabel(rule.type)}</Badge>
        <label className="flex items-center gap-1 text-[11px] text-slate-400">
          Level
          <select className="rounded border border-slate-700 bg-slate-900 px-1 py-0.5 text-[11px] text-white" value={rule.level} onChange={e => onChange({ level: Number(e.target.value) })}>
            {Array.from({ length: levelCount }, (_, i) => i + 1).map(l => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1 text-[11px] text-slate-400">
          <input type="checkbox" checked={rule.enabled} onChange={e => onChange({ enabled: e.target.checked })} className="accent-emerald-500" />
          Active
        </label>
        <button onClick={onRemove} className="rounded p-1 text-slate-500 hover:bg-rose-950 hover:text-rose-400" aria-label="Delete rule">
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="mt-3 rounded-md border border-slate-800 bg-slate-900/60 p-3">
        {(rule.type === 'sales_order' || rule.type === 'customer' || rule.type === 'material_type') && (
          <ValueEditor rule={rule} suggestions={suggestions} onChange={values => onChange({ values })} />
        )}
        {rule.type === 'schedule' && (
          <div className="flex flex-wrap items-center gap-3 text-xs">
            <Segmented
              value={rule.scheduleMode ?? 'range'}
              onChange={scheduleMode => onChange({ scheduleMode })}
              options={[
                { value: 'single', label: 'Single number' },
                { value: 'range', label: 'Range' },
              ]}
            />
            {rule.scheduleMode === 'single' ? (
              <NumberInput className="w-28" value={rule.scheduleSingle ?? undefined} onChange={v => onChange({ scheduleSingle: v ?? null })} placeholder="e.g. 75" />
            ) : (
              <>
                <NumberInput className="w-24" value={rule.scheduleMin ?? undefined} onChange={v => onChange({ scheduleMin: v ?? null })} placeholder="from" />
                <span className="text-slate-500">to</span>
                <NumberInput className="w-24" value={rule.scheduleMax ?? undefined} onChange={v => onChange({ scheduleMax: v ?? null })} placeholder="to" />
              </>
            )}
          </div>
        )}
        {(rule.type === 'waiting' || rule.type === 'finish_master_order') && (
          <div className="flex items-center justify-between gap-3 text-xs">
            <span className="text-slate-400">Sorting direction</span>
            <Segmented
              value={rule.direction ?? 'lowest_first'}
              onChange={direction => onChange({ direction })}
              options={[
                { value: 'lowest_first', label: 'Fewest parts first (fastest finish)' },
                { value: 'highest_first', label: 'Most parts first' },
              ]}
            />
          </div>
        )}
        {rule.type === 'production_date' && (
          <div className="flex items-center justify-between gap-3 text-xs">
            <span className="text-slate-400">Date direction</span>
            <Segmented
              value={rule.dateDirection ?? 'closest_first'}
              onChange={dateDirection => onChange({ dateDirection })}
              options={[
                { value: 'closest_first', label: 'Earliest first (oldest due date)' },
                { value: 'furthest_first', label: 'Latest first' },
              ]}
            />
          </div>
        )}
      </div>
      <p className="mono mt-2 text-[10px] text-slate-500">● {impact(rule, jobs)}</p>
    </div>
  );
}

export function PriorityView() {
  const { settings, updateSettings, jobs, plan } = useStore();
  const rules = settings.priorityRules;
  const levelCount = Math.max(4, ...rules.map(r => r.level));
  const [overLevel, setOverLevel] = useState<number | null>(null);

  const setRules = (next: PriorityRule[]) => updateSettings({ priorityRules: next });
  const patchRule = (id: string, p: Partial<PriorityRule>) => setRules(rules.map(r => (r.id === id ? { ...r, ...p } : r)));
  const addRule = (type: PriorityRuleType, level: number) => {
    const t = TRAY.find(x => x.type === type)!;
    setRules([...rules, { id: `${type}-${Date.now().toString(36)}`, type, level, enabled: true, name: ruleTypeLabel(type), ...t.make() } as PriorityRule]);
  };

  const onDrop = (level: number, e: DragEvent) => {
    e.preventDefault();
    setOverLevel(null);
    const existing = e.dataTransfer.getData('application/x-rule-id');
    const type = e.dataTransfer.getData('application/x-rule-type') as PriorityRuleType;
    if (existing) patchRule(existing, { level });
    else if (type) addRule(type, level);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-900/70 px-5 py-4">
        <div>
          <h2 className="text-lg font-extrabold uppercase tracking-wide text-white">Priority matrix</h2>
          <p className="mt-0.5 max-w-3xl text-xs text-slate-400">
            Levels are evaluated top-down: a job matching a level-1 rule always beats one that doesn't; only when jobs tie does level 2 decide, and so on. Several rules can share a level.
            Drag cards between levels or use the buttons. Changes re-plan automatically.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            className={`${inputCls} w-56`}
            value=""
            onChange={e => e.target.value && setRules(structuredClone(RULE_PRESETS[e.target.value].rules))}
            aria-label="Load preset"
          >
            <option value="">Load a preset…</option>
            {Object.entries(RULE_PRESETS).map(([k, p]) => (
              <option key={k} value={k}>
                {p.label}
              </option>
            ))}
          </select>
          <Button variant="danger" onClick={() => setRules([])}>
            <Trash2 className="h-3.5 w-3.5" /> Clear all levels
          </Button>
          <Button onClick={() => setRules(structuredClone(RULE_PRESETS.finishModule.rules))}>Reset to default</Button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[340px_1fr]">
        <aside className="h-fit space-y-2 rounded-xl border border-slate-800 bg-slate-900/60 p-4">
          <h3 className="text-xs font-bold uppercase tracking-wider text-white">Rule tray</h3>
          <p className="text-[11px] text-slate-400">Drag a card onto a level, or click L1–L4.</p>
          {TRAY.map(t => (
            <div
              key={t.type}
              draggable
              onDragStart={e => e.dataTransfer.setData('application/x-rule-type', t.type)}
              className="cursor-grab rounded-lg border border-slate-700 bg-slate-950/60 p-3 hover:border-slate-500"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2 text-xs font-bold text-white">
                  <span className="text-blue-400">{t.icon}</span>
                  {ruleTypeLabel(t.type)}
                </span>
                <span className="flex gap-1">
                  {[1, 2, 3, 4].map(l => (
                    <button key={l} onClick={() => addRule(t.type, l)} className="mono h-5 w-6 rounded border border-slate-600 text-[10px] text-slate-300 hover:bg-blue-600 hover:text-white">
                      L{l}
                    </button>
                  ))}
                </span>
              </div>
              <p className="mt-1 text-[11px] text-slate-400">{t.desc}</p>
            </div>
          ))}
        </aside>

        <div className="space-y-3">
          {Array.from({ length: levelCount }, (_, i) => i + 1).map(level => {
            const inLevel = rules.filter(r => r.level === level);
            return (
              <section
                key={level}
                onDragOver={e => (e.preventDefault(), setOverLevel(level))}
                onDragLeave={() => setOverLevel(null)}
                onDrop={e => onDrop(level, e)}
                className={`rounded-xl border-2 p-4 transition-colors ${overLevel === level ? 'border-blue-500 bg-blue-950/20' : 'border-slate-800 bg-slate-900/40'}`}
              >
                <div className="mb-3 flex items-center gap-3">
                  <span className="mono rounded border border-blue-700 bg-blue-950 px-2 py-0.5 text-xs font-bold text-blue-300">L-{String(level).padStart(2, '0')}</span>
                  <div>
                    <div className="text-xs font-bold uppercase tracking-wide text-white">
                      Level {String(level).padStart(2, '0')} · {LEVEL_TITLES[level - 1] ?? `Tier ${level}`}
                    </div>
                  </div>
                  <span className="ml-auto text-[11px] text-slate-500">
                    {inLevel.length} rule{inLevel.length === 1 ? '' : 's'}
                  </span>
                </div>
                {inLevel.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-slate-700 py-6 text-center text-xs text-slate-500">Drop a rule here</div>
                ) : (
                  <div className="space-y-2">
                    {inLevel.map(r => (
                      <RuleCard key={r.id} rule={r} jobs={jobs} levelCount={levelCount} onChange={p => patchRule(r.id, p)} onRemove={() => setRules(rules.filter(x => x.id !== r.id))} />
                    ))}
                  </div>
                )}
              </section>
            );
          })}
          {plan && (
            <p className="text-[11px] text-slate-500">
              Current plan: {plan.kpis.plannedJobs} jobs, {plan.kpis.synchronizedMos}/{plan.kpis.totalMos} modules finish together, {plan.kpis.makespanMinutes} min makespan.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
