import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { useMemo } from 'react';
import { RULE_LABELS, boxLevel, type BoxFacts } from '../core/carpenter/priority';
import type { CarpenterRule, CarpenterRuleType, CutItem } from '../core/types';
import { useStore } from '../state/store';
import { Button, CopyBox, Empty, Toggle, inputCls } from './kit';

const HINT: Record<CarpenterRuleType, string> = {
  sales_order: 'e.g. 0014102903, 0014102956',
  schedule: 'e.g. 75, 85',
  customer: 'part of the name, e.g. Leoni',
  master_order: 'e.g. 100003480464',
  material: 'e.g. FH, ALU',
  production_before: 'YYYY-MM-DD',
};

/** The admin decides what the carpenter cuts first, after the boxes already in production. */
export function CarpenterPriority({ facts }: { facts: Map<string, BoxFacts> }) {
  const { settings, updateSettings } = useStore();
  const cs = settings.carpenter;
  const rules = cs.priorityRules;
  const set = (patch: Partial<typeof cs>) => updateSettings(s => ({ ...s, carpenter: { ...s.carpenter, ...patch } }));
  const setRules = (next: CarpenterRule[]) => set({ priorityRules: next });
  const edit = (id: string, patch: Partial<CarpenterRule>) => setRules(rules.map(r => (r.id === id ? { ...r, ...patch } : r)));
  const move = (i: number, d: number) => {
    const next = rules.slice();
    const [r] = next.splice(i, 1);
    next.splice(i + d, 0, r);
    setRules(next);
  };

  // how many boxes land on each level (to see a rule working)
  const counts = useMemo(() => {
    const c = new Map<number, number>();
    for (const f of facts.values()) {
      const l = boxLevel(f, cs).level;
      c.set(l, (c.get(l) ?? 0) + 1);
    }
    return c;
  }, [facts, cs]);
  const active = rules.filter(r => r.enabled && r.value.trim());
  const levelOf = (r: CarpenterRule) => active.indexOf(r) + 1;

  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-400">
        The carpenter only follows the cut list. Here you decide what comes first. Boxes higher in this list are cut before the ones below; inside a level the app still finishes boxes quickly
        and cuts parts of the same bar together.
      </p>
      <div className="rounded-xl border border-emerald-800/60 bg-emerald-950/20 px-4 py-3 text-xs">
        <Toggle
          checked={cs.productionFirst}
          onChange={v => set({ productionFirst: v })}
          label={<span className="font-semibold text-emerald-300">Top priority: boxes we are producing</span>}
          hint="Their sales order is already in the CNC plan, but these parts are not cut yet. Urgent orders (the red button) are always first."
        />
        <div className="mt-1 text-slate-400">{counts.get(0) ?? 0} boxes</div>
      </div>

      <div className="space-y-2">
        {rules.map((r, i) => (
          <div key={r.id} className={`flex flex-wrap items-center gap-2 rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-2 text-xs ${r.enabled ? '' : 'opacity-50'}`}>
            <span className="mono w-16 text-slate-400">{levelOf(r) > 0 ? `Level ${levelOf(r)}` : '—'}</span>
            <select className={`${inputCls} w-52!`} value={r.type} onChange={e => edit(r.id, { type: e.target.value as CarpenterRuleType })}>
              {(Object.keys(RULE_LABELS) as CarpenterRuleType[]).map(t => (
                <option key={t} value={t}>
                  {RULE_LABELS[t]}
                </option>
              ))}
            </select>
            <input
              className={`${inputCls} w-72!`}
              type={r.type === 'production_before' ? 'date' : 'text'}
              placeholder={HINT[r.type]}
              value={r.value}
              onChange={e => edit(r.id, { value: e.target.value })}
            />
            <span className="w-20 text-slate-500">{levelOf(r) > 0 ? `${counts.get(levelOf(r)) ?? 0} boxes` : ''}</span>
            <label className="flex items-center gap-1 text-slate-400">
              <input type="checkbox" checked={r.enabled} onChange={e => edit(r.id, { enabled: e.target.checked })} /> on
            </label>
            <span className="ml-auto flex gap-1">
              <Button size="sm" variant="ghost" disabled={i === 0} onClick={() => move(i, -1)} title="Higher">
                <ArrowUp className="h-3.5 w-3.5" />
              </Button>
              <Button size="sm" variant="ghost" disabled={i === rules.length - 1} onClick={() => move(i, 1)} title="Lower">
                <ArrowDown className="h-3.5 w-3.5" />
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setRules(rules.filter(x => x.id !== r.id))} title="Remove">
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </span>
          </div>
        ))}
        <Button
          size="sm"
          variant="secondary"
          onClick={() => setRules([...rules, { id: `r${Date.now().toString(36)}`, type: 'sales_order', value: '', enabled: true }])}
        >
          <Plus className="h-3.5 w-3.5" /> Add a priority
        </Button>
      </div>

      <div className="rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2 text-xs text-slate-400">
        <div>Everything else: {counts.get(active.length + 1) ?? 0} boxes</div>
        <div className="mt-2">
          <Toggle checked={cs.earliestDateFirst} onChange={v => set({ earliestDateFirst: v })} label="Inside each level, earlier production dates first" />
        </div>
      </div>
    </div>
  );
}

type MissingKind = 'pdf_no_nc' | 'nothing' | 'nc_no_pdf' | 'no_size';
const MISSING: Array<{ kind: MissingKind; title: string; hint: string }> = [
  { kind: 'pdf_no_nc', title: 'PDF but no NC file', hint: 'the drawing is there, the NC program is missing' },
  { kind: 'nothing', title: 'No PDF and no NC file', hint: 'nothing released yet' },
  { kind: 'nc_no_pdf', title: 'NC file but no PDF', hint: 'the drawing is missing' },
  { kind: 'no_size', title: 'No measurements', hint: 'no cut size in Measure or in the NC file header' },
];

function missingKinds(it: CutItem): MissingKind[] {
  if (it.status === 'cut' || it.status === 'elsewhere') return [];
  const p = it.part;
  const out: MissingKind[] = [];
  if (p.hasPdf === true && p.hasNc === false) out.push('pdf_no_nc');
  if (p.hasPdf === false && p.hasNc === false) out.push('nothing');
  if (p.hasNc === true && p.hasPdf === false) out.push('nc_no_pdf');
  if (!it.cut && it.status !== 'premade') out.push('no_size');
  return out;
}

export const missingCount = (items: CutItem[]) => items.filter(i => missingKinds(i).length > 0).length;

const byNumber = (a: string, b: string) => (a.length !== b.length && /^\d+$/.test(a) && /^\d+$/.test(b) ? a.length - b.length : a < b ? -1 : a > b ? 1 : 0);

/** Parts whose files or sizes are missing, by material number, ready to copy and send to whoever makes them. */
export function MissingFiles({ items }: { items: CutItem[] }) {
  const groups = useMemo(() => {
    const out = new Map<MissingKind, Map<string, { matnr: string; name: string; rows: number; qty: number; workOrders: string[] }>>();
    for (const it of items)
      for (const k of missingKinds(it)) {
        let g = out.get(k);
        if (!g) out.set(k, (g = new Map()));
        const matnr = it.part.materialNr || '(no material number)';
        let e = g.get(matnr);
        if (!e) g.set(matnr, (e = { matnr, name: it.part.partName ?? it.part.text ?? '', rows: 0, qty: 0, workOrders: [] }));
        e.rows++;
        e.qty += it.qty;
        if (it.part.workOrder) e.workOrders.push(it.part.workOrder);
      }
    return out;
  }, [items]);

  if (!groups.size) return <Empty>Every part to cut has its PDF, its NC file and a cut size.</Empty>;
  return (
    <div className="space-y-4">
      {MISSING.filter(m => groups.has(m.kind)).map(m => {
        const rows = [...groups.get(m.kind)!.values()].sort((a, b) => byNumber(a.matnr, b.matnr));
        const numbers = rows.map(r => r.matnr).filter(n => !n.startsWith('('));
        return (
          <section key={m.kind} className="rounded-xl border border-slate-800 bg-slate-900/50 px-4 py-3">
            <h3 className="text-sm font-semibold text-white">
              {m.title} <span className="text-xs font-normal text-slate-400">· {numbers.length} material numbers · {rows.reduce((a, r) => a + r.rows, 0)} parts · {m.hint}</span>
            </h3>
            <CopyBox label="Material numbers (one per line)" text={numbers.join('\n')} rows={4} />
            <div className="mt-2 max-h-72 overflow-auto rounded-lg border border-slate-800">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-slate-900 text-[11px] uppercase tracking-wide text-slate-400">
                  <tr>
                    <th className="px-2 py-1.5 text-left">Material number</th>
                    <th className="px-2 py-1.5 text-left">Part</th>
                    <th className="px-2 py-1.5 text-right">Rows</th>
                    <th className="px-2 py-1.5 text-right">Qty</th>
                    <th className="px-2 py-1.5 text-left">Work orders</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(r => (
                    <tr key={r.matnr} className="border-t border-slate-900">
                      <td className="mono px-2 py-1 font-semibold text-white">{r.matnr}</td>
                      <td className="px-2 py-1 text-slate-300">{r.name}</td>
                      <td className="mono px-2 py-1 text-right">{r.rows}</td>
                      <td className="mono px-2 py-1 text-right">{r.qty}</td>
                      <td className="mono px-2 py-1 text-slate-500">
                        {r.workOrders.slice(0, 4).join(', ')}
                        {r.workOrders.length > 4 ? ` +${r.workOrders.length - 4}` : ''}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}
    </div>
  );
}
