import { SquareTerminal } from 'lucide-react';
import helperSource from '../../tools/shop-helper/helper.js?raw';
import changerSource from '../../tools/shop-helper/material-changer.js?raw';
import { CopyBox, Modal } from './kit';

/** One script for the website: the shop helper, with the material changer behind its "Change materials" button. */
export const HELPER_CODE: string = 'window.__cncBundle = true;\n' + changerSource + '\n' + helperSource;

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
      subtitle="One script for the company website: on CNC Workload it ticks, sends and orders every machine's boxes; on the carpenter list it refreshes rows, guides the scan and changes materials."
    >
      <div className="space-y-4 text-xs text-slate-300">
        <ol className="list-decimal space-y-1 pl-5 text-slate-400">
          <li>
            On CNC Workload: press <b className="text-slate-200">Copy</b> at the top of this app (next to Export): the plan is on the clipboard, no Excel needed.
          </li>
          <li>Open the website page, press F12, open Console, paste the script and press Enter (or click the bookmark below).</li>
          <li>
            Paste the plan into the panel and press <b className="text-slate-200">Do everything</b> twice: it sends each machine its parts and puts every machine's list in plan order.
          </li>
          <li>
            On the carpenter list the same script shows <b className="text-slate-200">Refresh them all</b>: rows that already have a PDF or NC file are left alone.
          </li>
          <li>
            Scanning the cut parts: in this app open Carpenter → "Scan the cut parts", copy the scan order, paste it into the script's <b className="text-slate-200">Scan</b> box on the carpenter list and press{' '}
            <b className="text-slate-200">Start scanning</b>. It goes material by material, the size with most pieces first. For each part it shows the size, the line of the printed sheet and how many pieces go in the box, presses Finish on the right work order, picks the material and waits: type the box code and press OK.
          </li>
          <li>
            Changing materials: on the carpenter list press <b className="text-slate-200">Change materials…</b> in the script's panel, then <b className="text-slate-200">Check</b> (changes nothing) and{' '}
            <b className="text-slate-200">Start</b>. It takes the size each part needs from the Nc Description and the material type from Description De, picks the right board or bar, applies the replacement table, and where that differs from Description De it opens Change Material, sets ChangeType Temporary, the Type and the Size, checks the material the window fills in, and saves. Check lists every change first (Download the list); rows already right are skipped.
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
