import { Modal } from './kit';

const SECTIONS: Array<[string, string]> = [
  ['1. Hard constraints first', 'Each job is checked against what every machine can physically run: allowed materials, the small-part limit on FANUC - 2 (ideal NC time under 8 min by default) and machines marked down. Blocked jobs, jobs already assigned in the ERP to machines outside this planner, master orders starting with 30000 and jobs nobody can run appear under Exceptions.'],
  ['2. Priority levels decide the order', 'The Priority Rules tab defines levels. A job matching a level-1 rule always beats one that does not; ties fall to level 2 and so on. Ranking rules such as "finish full module first" prefer master orders with the fewest parts left, and "production date" prefers the earliest due date.'],
  ['3. Modules finish together', 'All parts of a master order are assigned jointly: for small modules every machine combination is tried, for larger ones parts are placed one by one. The goal is to keep the busiest machine short, finish whole modules early and avoid changeovers, then a seeded local search polishes the result. The same input always produces the same plan.'],
  ['4. Changeovers', 'Same drawing (Matnr) = 0 min, same stock blank = 8 min, same material family = 12 min, different material = 20 min. Parts of one master order in the same material share a fixture (0 min). All values are editable.'],
  ['5. Real-world time', 'Planned minutes = (NC minutes ÷ efficiency + material offset) × quantity. Efficiency comes from, in order: a per-part override, the machine × material matrix, the material default, the machine speed, then the global value. "Cautious" mode uses the lower bound of each cell.'],
  ['6. Calendar and disruptions', 'Time runs on working minutes: shifts per day, hours per shift, weekends off. Breakdowns, maintenance, absences or shortages block a machine; running jobs pause and resume (or restart). Rework events add minutes to one box.'],
  ['7. Carpenter list', 'A master order with uncut carpenter parts cannot be completed. It is flagged, excluded from the synchronized count and listed under "Waiting on carpenter". Soft mode only uses it as a tie-break, hard mode moves such modules behind ready ones for up to the configured number of hours.'],
  ['8. Your overrides', 'Pin a box to a machine (click it, or drag it onto another lane), set a fixed run time or earliest start, or override efficiency for a part or a whole selection in Orders & Bulk Efficiency. Everything stays on this computer.'],
];

export function HelpModal({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="How the plan is built" subtitle="Assumptions and rules behind the schedule" onClose={onClose} width="max-w-3xl">
      <div className="space-y-4 text-xs leading-relaxed text-slate-300">
        {SECTIONS.map(([h, t]) => (
          <div key={h}>
            <h3 className="mb-1 text-sm font-bold text-white">{h}</h3>
            <p>{t}</p>
          </div>
        ))}
      </div>
    </Modal>
  );
}
