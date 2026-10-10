import { Modal } from './kit';

const SECTIONS: Array<[string, string]> = [
  ['1. Hard constraints first', 'Each job is checked against what every machine can physically run: allowed materials, the small-part limit on FANUC - 2 (ideal NC time under 8 min by default) and machines marked down. Blocked jobs, jobs already assigned in the ERP to machines outside this planner, master orders starting with 30000 and jobs nobody can run appear under Exceptions.'],
  ['2. Priority rules are respected first', 'The Priority Rules tab defines levels. Rules that pick specific orders (sales order, schedule, customer, material) make priority classes: a machine runs all parts of level 1 before any part of level 2, then the rest, like digits in a number. The optimizer plans class by class: level 1 first, finishing its master orders as early as possible, then level 2 after it, and so on. Production date and "fewest parts left" only fine-tune the order inside a class.'],
  ['3. The plan that finishes the most orders soonest', 'Inside each class the optimizer looks for the schedule in which master orders (modules) are completed as early as possible, measured as the sum of all completion times, with the busiest machine and the changeover time as secondary goals. A fast heuristic plan appears at once; the optimizer then improves it for a few seconds by trying millions of re-orderings and machine swaps, always under the same rules: parts only on machines that can run them (materials, size limits, part types), ERP-assigned parts on their machine, changeovers, disruptions and pinned times. The same input always produces the same plan. In Variable Editor > Planning rules you can switch to the Classic heuristic or change how long the optimizer searches.'],
  ['4. Changeovers', 'A changeover is added only when the next part is of a different material family (20 min by default) or is much bigger than the part before it (at least 3 times as long, 12 min by default). The same drawing, and anything else of the same family that is not much bigger, runs straight on. All values are editable.'],
  ['5. Real-world time', 'Parts found in your parts time list (matched on the material number) run for exactly their average real time × quantity, marked with a filled dot. Nothing else changes that time: no efficiency %, machine speed, material offset % or cautious mode. Parts not in the list are estimated at NC minutes × 2.8 (editable) and marked with a hollow ring; for those, the efficiency rules still apply, in this order: per-part override, machine × material matrix, material default, machine speed, global value. A run time you type on a job always wins.'],
  ['6. Calendar and disruptions', 'Time runs on working minutes: shifts per day, hours per shift, Monday to Saturday (Saturday and Sunday can be switched), and the hour of the first day at which the plan starts. Add a disruption by dragging along the bottom strip of a machine on the Gantt. Breakdowns, maintenance, absences or shortages block a machine; running jobs pause and resume (or restart). A rework event adds a new part, placed before or after the part it was dropped on; nothing is split.'],
  ['7. Carpenter list', 'A master order with uncut carpenter parts cannot be completed. It is flagged, excluded from the synchronized count and listed under "Waiting on carpenter". Soft mode counts such an order slightly less, so ready orders go first when that costs little. Hard mode strongly prefers ready orders but never lets a waiting order finish later than the basic plan has it, which keeps the maximum delay in check.'],
  ['8. Hourly output', 'The Hourly Output tab counts the master orders and parts that finish in each hour (or shift, or day) of the plan. A part counts in the hour it ends in; a module counts when its last part ends. Modules held back by the carpenter list or by parts that cannot be planned are shown separately.'],
  ['9. Kinds of parts', 'The order numbers tell what a part is. Module parts: order and master order start with 10000. Rework: order starts with 80000 (master order 10000): top priority, ahead of every rule. Tables: order and master order start with 60000, or 30000 with the sales order of a table. Spare parts: order starts with 30000. Tables and spare parts are kept together per sales order on the Tables & Spares tab; you choose when a group starts and when it must be finished, and the planner puts its parts where the module parts are delayed least.'],
  ['10. Emergency', 'The red Emergency button takes a sales order (and optionally a schedule) and shows how long its parts would need even with the best possible planning, and what that does to everything else. If you apply it, those parts are planned before anything else on every machine, marked URGENT on the Gantt, and everything else waits for them.'],
  ['11. Part types per machine', 'Part names from the parts time list are made standard by dropping numbering: "Contact pin plate 001" and "Contact pin plate 2" are both a Contact pin plate. In Variable Editor > Machines you can limit a machine to chosen part types, separately for small parts (real time under 15 minutes per part) and big parts (15 minutes or more). Parts that are not in the list are only checked against the materials.'],
  ['12. Your overrides', 'Pin a box to a machine (click it, or drag it onto another lane), set a fixed run time or earliest start, or override efficiency for a part or a whole selection in Orders & Bulk Efficiency. Everything stays on this computer.'],
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
