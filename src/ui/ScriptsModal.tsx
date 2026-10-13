import { SquareTerminal } from 'lucide-react';
import helperSource from '../../tools/shop-helper/helper.js?raw';
import { CopyBox, Modal } from './kit';

export const HELPER_CODE: string = helperSource;

/** The short form for a bookmark: comments and indentation dropped, wrapped as a javascript: address. */
export const liteOf = (c: string) =>
  c
    .replace(/^\s*\/\*[\s\S]*?\*\/\s*/, '')
    .split('\n')
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('//') && !l.startsWith('/*') && !l.startsWith('*'))
    .join('\n');
export const bookmarkletOf = (c: string) => 'javascript:' + encodeURIComponent('(function(){' + liteOf(c) + '})();');

/** The shop-site helper, ready to copy: as a console snippet and as a bookmark. */
export function ScriptsModal({ onClose }: { onClose: () => void }) {
  return (
    <Modal
      width="max-w-3xl"
      onClose={onClose}
      title={
        <span className="flex items-center gap-2">
          <SquareTerminal className="h-4 w-4 text-sky-400" /> Shop website scripts
        </span>
      }
      subtitle="One script for the company website: on CNC Workload it ticks, sends and orders every machine's boxes; on the carpenter list it refreshes every row."
    >
      <div className="space-y-4 text-xs text-slate-300">
        <ol className="list-decimal space-y-1 pl-5 text-slate-400">
          <li>
            On CNC Workload: export the plan from this app (Excel), open sheet <b className="text-slate-200">Plan_All</b>, copy columns A to D.
          </li>
          <li>Open the website page, press F12, open Console, paste the script and press Enter (or click the bookmark below).</li>
          <li>
            Paste the plan into the panel and press <b className="text-slate-200">Do everything</b> twice: it sends each machine its parts and puts every machine's list in plan order.
          </li>
          <li>
            On the carpenter list the same script shows <b className="text-slate-200">Refresh them all</b>: rows that already have a PDF or NC file are left alone.
          </li>
        </ol>
        <CopyBox label="Full script (console)" text={HELPER_CODE} rows={6} />
        <div>
          <CopyBox label="Bookmark address (make a bookmark, paste this as its URL)" text={bookmarkletOf(HELPER_CODE)} rows={2} />
          <p className="mt-1 text-[11px] text-slate-500">After the page reloads, click the bookmark again: the panel remembers the plan and carries on.</p>
        </div>
      </div>
    </Modal>
  );
}
