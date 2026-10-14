import { useMemo, useState } from 'react';
import type { CutItem } from '../core/types';
import { useStore } from '../state/store';
import { Button, CopyBox, Empty, inputCls } from './kit';

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

/** Material words the app could not place: one row per word with examples, the admin types the material once. */
export const unknownCount = (items: CutItem[]) => new Set(items.filter(i => i.status !== 'cut' && i.status !== 'elsewhere' && i.unknownToken).map(i => i.unknownToken)).size;

export function CarpenterQuestions({ items }: { items: CutItem[] }) {
  const { settings, updateSettings } = useStore();
  const tokens = useMemo(() => {
    const map = new Map<string, { token: string; count: number; examples: CutItem[] }>();
    for (const it of items) {
      if (it.status === 'cut' || it.status === 'elsewhere' || !it.unknownToken) continue;
      let e = map.get(it.unknownToken);
      if (!e) map.set(it.unknownToken, (e = { token: it.unknownToken, count: 0, examples: [] }));
      e.count++;
      if (e.examples.length < 3) e.examples.push(it);
    }
    return [...map.values()].sort((a, b) => b.count - a.count);
  }, [items]);
  if (!tokens.length) return <Empty>Every material was understood.</Empty>;
  return (
    <div className="space-y-2">
      <p className="text-xs text-slate-400">These texts did not tell the material for sure. Type the material it means (ALU, FH, POM, PCGF, MS, INOX …) and press Save: every part with that word follows it.</p>
      {tokens.map(u => (
        <TokenRow
          key={u.token}
          token={u.token}
          count={u.count}
          examples={u.examples}
          current={settings.carpenter.materialTokens[u.token]}
          onSave={code => updateSettings(s => ({ ...s, carpenter: { ...s.carpenter, materialTokens: { ...s.carpenter.materialTokens, [u.token]: code } } }))}
        />
      ))}
    </div>
  );
}

function TokenRow({ token, count, examples, current, onSave }: { token: string; count: number; examples: CutItem[]; current?: string; onSave: (code: string) => void }) {
  const [v, setV] = useState(current ?? '');
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-2 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <span className="mono font-semibold text-white">“{token}”</span>
        <span className="text-slate-500">{count} rows</span>
        <input className={`${inputCls} w-28!`} placeholder="material" value={v} onChange={e => setV(e.target.value.toUpperCase())} />
        <Button size="sm" variant="secondary" disabled={!v.trim()} onClick={() => onSave(v.trim())}>
          Save
        </Button>
        {current && <span className="text-emerald-400">now: {current}</span>}
      </div>
      {examples.map(e => (
        <div key={e.id} className="mono mt-0.5 text-slate-400">
          {e.part.workOrder} · {e.part.measure || '(no measure)'} · {e.part.descriptionDe || '(no stock)'} · {e.part.partName ?? e.part.text}
        </div>
      ))}
    </div>
  );
}
