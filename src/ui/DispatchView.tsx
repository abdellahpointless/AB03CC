import { CheckCheck, ClipboardCopy, Download, FileDown, Send } from 'lucide-react';
import { useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import { buildDispatch, snapshotOf, type ChangeKind, type DispatchChange, type SentSnapshot } from '../core/dispatch';
import { saveWorkbook } from '../core/export';
import { useStore } from '../state/store';
import { Badge, Button, Empty, MaterialBadge, Segmented, inputCls } from './kit';

const KEY = 'cnc-planner.v2.sent';
interface Sent {
  at: string;
  step: number;
  parts: SentSnapshot;
}

function loadSent(): Sent | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Sent) : null;
  } catch {
    return null;
  }
}
function saveSent(s: Sent | null) {
  try {
    if (s) localStorage.setItem(KEY, JSON.stringify(s));
    else localStorage.removeItem(KEY);
  } catch {
    /* storage can be blocked: the page still works, it just forgets */
  }
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }
}

const KIND_LABEL: Record<ChangeKind, string> = { new: 'new', machine: 'moved', status: 'status', same: '' };
const KIND_TONE: Record<ChangeKind, string> = {
  new: 'border-emerald-700 text-emerald-300',
  machine: 'border-amber-700 text-amber-300',
  status: 'border-sky-700 text-sky-300',
  same: '',
};

export function DispatchView() {
  const { plan, notify, improving } = useStore();
  const [sent, setSent] = useState<Sent | null>(loadSent);
  const [step, setStep] = useState<1 | 10>((sent?.step as 1 | 10) ?? 10);
  const [only, setOnly] = useState<'all' | 'changes'>('all');
  const [batch, setBatch] = useState(25);

  const result = useMemo(() => (plan ? buildDispatch(plan, sent?.parts ?? null, step) : null), [plan, sent, step]);
  if (!plan || !result) return null;

  const changed = result.changes.filter(c => c.kind !== 'same');
  const byMachine = Object.keys(plan.queues).map(m => ({
    machine: m,
    all: result.changes.filter(c => c.row.machine === m),
  }));
  const copy = async (text: string, what: string) => notify((await copyText(text)) ? `Copied ${what}.` : 'The browser did not allow copying here: select the text in the table instead.', 'ok');
  const markSent = () => {
    const next: Sent = { at: new Date().toISOString(), step, parts: snapshotOf(result.rows) };
    saveSent(next);
    setSent(next);
    setOnly('all');
    notify(`Marked ${result.rows.length} parts as sent. From now on only what changes is highlighted.`, 'ok');
  };
  const forget = () => {
    saveSent(null);
    setSent(null);
  };

  const download = async (which: 'all' | 'changes') => {
    const wb = XLSX.utils.book_new();
    const list = which === 'changes' ? changed : result.changes;
    const sheetRows = (l: DispatchChange[]) =>
      l.map(c => ({
        Machine: c.row.machine,
        'Production Status': c.row.status,
        'Box Code': c.row.boxCode,
        'Order Number': c.row.orderNumber,
        'Master Order': c.row.masterOrder,
        Material: c.row.materialType,
        'Planned Minutes': c.row.minutes,
        'Planned Start': c.row.start.replace('T', ' '),
        Change: c.kind === 'same' ? '' : c.kind === 'new' ? 'new' : c.kind === 'machine' ? `moved from ${c.from?.machine}` : `status was ${c.from?.status}`,
      }));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sheetRows(list).length ? sheetRows(list) : [{ Info: 'Nothing to send' }]), which === 'changes' ? 'Changes' : 'Everything');
    for (const m of byMachine) {
      const l = (which === 'changes' ? m.all.filter(c => c.kind !== 'same') : m.all).map(c => c);
      if (l.length) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sheetRows(l)), m.machine.replace(/[^A-Za-z0-9]+/g, '_').slice(0, 31));
    }
    if (result.removed.length)
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(result.removed.map(r => ({ 'Take off': r.machine, 'Box Code': r.box, 'Order Number': r.orderNumber, 'Was status': r.status }))), 'Take off');
    const out = await saveWorkbook(wb, `send-to-machines-${which}-${new Date().toISOString().slice(0, 10)}.xlsx`);
    if (out === 'failed') notify('The file could not be saved here.', 'error');
  };

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-slate-800 bg-slate-900/70 px-5 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="max-w-3xl">
            <h2 className="flex items-center gap-2 text-sm font-bold text-white">
              <Send className="h-4 w-4 text-blue-400" /> Send to machines
            </h2>
            <p className="mt-1 text-xs text-slate-400">
              Everything you need to enter the plan in the shop system, machine by machine: the box codes in running order, ready to copy, and the Production Status number for each. After you have entered a plan, press <b className="text-slate-200">Mark as sent</b>. When the plan changes later, only the parts that moved or got a new number are highlighted, so you do not start over.
            </p>
            <ol className="mt-2 list-decimal space-y-0.5 pl-5 text-[11px] text-slate-400">
              <li>Pick a machine below and copy its box codes (the whole list, or a batch of the size you like).</li>
              <li>In the CNC Workload page, filter <i>Box Code</i> with them, tick all rows, <i>Send to machine</i>, choose the machine, OK.</li>
              <li>Enter the Production Status numbers as listed (or paste the "box code + status" copy into your sheet).</li>
              <li>Press <b className="text-slate-300">Mark as sent</b>.</li>
            </ol>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="primary" onClick={markSent} disabled={improving} title={improving ? 'Wait for the optimizer to finish' : 'Remember this plan as entered'}>
              <CheckCheck className="h-3.5 w-3.5" /> Mark as sent
            </Button>
            {sent && (
              <Button variant="ghost" onClick={() => confirm('Forget what was sent? Every part will count as new again.') && forget()}>
                Forget
              </Button>
            )}
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs">
          <span className="text-slate-300">
            {sent ? (
              <>
                Last marked as sent <b className="text-white">{new Date(sent.at).toLocaleString()}</b> ·{' '}
                <b className={changed.length || result.removed.length ? 'text-amber-300' : 'text-emerald-300'}>
                  {changed.length || result.removed.length ? `${changed.length} to enter, ${result.removed.length} to take off` : 'nothing changed since'}
                </b>
              </>
            ) : (
              <>Nothing marked as sent yet: all <b className="text-white">{result.rows.length}</b> parts count as new.</>
            )}
          </span>
          <Segmented
            value={only}
            options={[
              { value: 'all', label: 'Everything' },
              { value: 'changes', label: `Only what changed (${changed.length})` },
            ]}
            onChange={setOnly}
          />
          <label className="flex items-center gap-2 whitespace-nowrap text-slate-400">
            Status numbers go up by
            <Segmented value={String(step) as '1' | '10'} options={[{ value: '10', label: '10' }, { value: '1', label: '1' }]} onChange={v => setStep(v === '1' ? 1 : 10)} />
          </label>
          <label className="flex items-center gap-2 whitespace-nowrap text-slate-400">
            Batch of
            <input type="number" min={1} max={200} className={`${inputCls} w-16`} value={batch} onChange={e => setBatch(Math.max(1, Math.min(200, Number(e.target.value) || 25)))} />
            boxes
          </label>
          <span className="ml-auto flex gap-2">
            <Button size="sm" onClick={() => download('all')}>
              <FileDown className="h-3 w-3" /> Excel: everything
            </Button>
            <Button size="sm" onClick={() => download('changes')} disabled={!sent || changed.length === 0}>
              <Download className="h-3 w-3" /> Excel: only changes
            </Button>
          </span>
        </div>
        <p className="mt-2 text-[11px] text-slate-500">
          Status numbers go up by {step}: later insertions fit into the gaps, so parts whose order did not change keep the number they already have in the shop system. {result.renumbered.length > 0 && <span className="text-amber-300">No gap was left on {result.renumbered.join(', ')}: its numbers start over, so all its parts are marked.</span>}
        </p>
      </div>

      {result.removed.length > 0 && (
        <div className="rounded-xl border border-rose-800/70 bg-rose-950/30 px-5 py-3 text-xs text-rose-100">
          <div className="font-bold">{result.removed.length} part{result.removed.length === 1 ? '' : 's'} sent before, no longer in the plan: take them off</div>
          <div className="mono mt-1 text-[11px] text-rose-200/90">{result.removed.map(r => `${r.box} (${r.machine}, ${r.status})`).join(' · ')}</div>
        </div>
      )}

      {byMachine.map(({ machine, all }) => {
        const shown = only === 'changes' ? all.filter(c => c.kind !== 'same') : all;
        const needSend = all.filter(c => c.kind === 'new' || c.kind === 'machine');
        const needStatus = all.filter(c => c.kind === 'status');
        const batches: DispatchChange[][] = [];
        const source = only === 'changes' ? shown : all;
        for (let i = 0; i < source.length; i += batch) batches.push(source.slice(i, i + batch));
        return (
          <section key={machine} className="glass overflow-hidden rounded-xl border border-slate-800">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 px-4 py-3">
              <div>
                <h3 className="mono text-sm font-bold text-white">{machine}</h3>
                <div className="text-[11px] text-slate-400">
                  {all.length} parts
                  {sent && (
                    <>
                      {' '}· <span className="text-emerald-300">{needSend.length} to send</span> · <span className="text-sky-300">{needStatus.length} status only</span>
                    </>
                  )}
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5">
                <Button size="sm" onClick={() => copy(source.map(c => c.row.boxCode).join('\n'), `${source.length} box codes of ${machine}`)} disabled={source.length === 0}>
                  <ClipboardCopy className="h-3 w-3" /> Box codes
                </Button>
                <Button size="sm" onClick={() => copy(source.map(c => `${c.row.boxCode}\t${c.row.status}`).join('\n'), `box codes and status of ${machine}`)} disabled={source.length === 0}>
                  <ClipboardCopy className="h-3 w-3" /> Box code + status
                </Button>
                {sent && (
                  <Button size="sm" variant="primary" onClick={() => copy(needSend.map(c => c.row.boxCode).join('\n'), `${needSend.length} box codes to send to ${machine}`)} disabled={needSend.length === 0}>
                    <Send className="h-3 w-3" /> Only the ones to send ({needSend.length})
                  </Button>
                )}
              </div>
            </div>
            {batches.length > 1 && (
              <div className="flex flex-wrap items-center gap-1.5 border-b border-slate-800 bg-slate-950/40 px-4 py-2 text-[11px] text-slate-400">
                Batches:
                {batches.map((b, i) => (
                  <Button key={i} size="sm" variant="ghost" onClick={() => copy(b.map(c => c.row.boxCode).join('\n'), `batch ${i + 1} of ${machine} (${b.length} boxes)`)}>
                    {i + 1} · {b[0].row.status}–{b[b.length - 1].row.status}
                  </Button>
                ))}
              </div>
            )}
            {shown.length === 0 ? (
              <div className="px-4 py-5">
                <Empty>{all.length === 0 ? 'No parts on this machine.' : 'Nothing changed on this machine.'}</Empty>
              </div>
            ) : (
              <div className="max-h-[420px] overflow-auto">
                <table className="w-full min-w-[720px] text-xs">
                  <thead className="sticky top-0 bg-slate-900 text-left text-[10px] uppercase tracking-wide text-slate-400">
                    <tr>
                      <th className="px-3 py-2">Status</th>
                      <th className="px-3 py-2">Box</th>
                      <th className="px-3 py-2">Order number</th>
                      <th className="px-3 py-2">Master order</th>
                      <th className="px-3 py-2">Material</th>
                      <th className="px-3 py-2 text-right">Min</th>
                      <th className="px-3 py-2">Planned start</th>
                      <th className="px-3 py-2">Change</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map(c => (
                      <tr key={c.row.orderNumber} className={`border-t border-slate-800/80 ${c.kind === 'same' ? '' : 'bg-slate-800/30'}`}>
                        <td className="mono px-3 py-1.5 font-bold text-white">{c.row.status}</td>
                        <td className="mono px-3 font-bold text-amber-300">{c.row.boxCode}</td>
                        <td className="mono px-3 text-slate-400">{c.row.orderNumber}</td>
                        <td className="mono px-3 text-slate-400">{c.row.masterOrder}</td>
                        <td className="px-3"><MaterialBadge material={c.row.materialType} /></td>
                        <td className="mono px-3 text-right text-slate-300">{Math.round(c.row.minutes)}</td>
                        <td className="mono px-3 text-slate-400">{c.row.start.slice(5, 16).replace('T', ' ')}</td>
                        <td className="px-3">
                          {c.kind !== 'same' && (
                            <Badge className={KIND_TONE[c.kind]}>
                              {c.kind === 'new' ? KIND_LABEL.new : c.kind === 'machine' ? `moved from ${c.from?.machine}` : `was ${c.from?.status}`}
                            </Badge>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
