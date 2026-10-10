# CNC Smart Planner

Production scheduling for a CNC machining workshop. Import the **BoxShelf production export** (and optionally the **carpenter list**), and the planner assigns every box to a machine, sequences each queue to finish as many master orders as early as possible with few changeovers, and shows the result as a Gantt chart, run sheets and Excel export. Everything runs in the browser; no data leaves the computer.

## Run it

```bash
npm install
npm run dev        # http://localhost:3000
npm test           # unit tests for parsers, efficiency, calendar, scheduler
npm run build      # type-check + production build into dist/
npm run check:data -- BoxShelf.xlsx [CarpenterList.xlsx] [PartsTimeList.xlsx]   # plan real exports and verify invariants
```

## Using it

1. **Import** – drop the spreadsheets on the start page, or use *Import* in the top bar at any time. The production export, the carpenter list and the parts time list are recognised by their columns, so it does not matter which button you use.
2. **Gantt** – boxes per machine on a working-time axis. Click a box for details and overrides, drag it onto another machine to pin it there, colour by material / master order / sales order, search, zoom, overlay the previous plan, add breakdowns / maintenance / absences / rework.
3. **Priority Rules** – levels like digits (sales order, schedule number/range, customer, material, finish full module, waiting, production date): level 1 beats level 2. Presets included.
4. **Orders & Bulk Efficiency** – every planned operation; select rows and set "runs at %" in bulk.
5. **Run Sheets** – per-machine sequence; print one A4 page per machine.
   **Hourly Output** – how many master orders and parts finish in each hour, shift or day of the plan.
6. **Exceptions** – blocked, no eligible machine, out-of-scope ERP machines, master orders 30000* (assign manually), missing warehouse pick.
7. **Variable Editor** – machines and allowed materials, material offsets and aliases, changeover times, calendar, planning rules, carpenter handling, efficiency matrix and calibration.

Settings, overrides and the imported data are kept in the browser's local storage.

## How the plan is built

1. Classify jobs: blocked, out-of-scope, ERP-locked, user-pinned, master order 30000*, free.
2. Rank by the priority levels; rank master orders by their best part.
3. **Fast plan** (about half a second, shown immediately): master orders are assigned one at a time, small modules by trying every machine combination, larger ones part by part; queues are re-sequenced so modules finish early and identical drawings run back to back; a short seeded local search polishes the result.
4. **Optimizer** (a few seconds, runs in the web worker, progress in the top bar): searches for the plan that finishes master orders as early as possible, measured as the weighted sum of master-order completion times, with the busiest machine and changeover time as small secondary terms. It anneals the order of the master orders (each order decoded into a full schedule by a greedy machine choice), then anneals the machine queues directly (relocate, swap, block and reorder moves, each re-timed incrementally). It uses exactly the planner's timing: changeovers, disruptions (pause or restart), measured and estimated times. ERP-assigned and pinned parts stay on their machine at the head of its queue. It starts from the fast plan, so it can never return something worse, and the iteration counts are fixed, so the same input always gives the same plan.
5. Priority rules become weights: an order matching a rule of a more important level counts 25 times more than one that does not (levels act like digits), production date gives closer dates a slight edge, carpenter-blocked orders count less (a lot less in *hard* mode, where they also may not finish later than in the fast plan).
6. Rework parts, pinned start times and the exact timing of the result are applied last.
7. Planned minutes: a part found in the parts time list runs for its average real time × quantity and ignores every efficiency rule; any other part is estimated at NC minutes × 2.8 (editable), then efficiency and offsets apply. A subtle dot on each box shows which one it is (filled = measured, ring = estimated). Times are placed on a shift calendar around downtime.

*Variable Editor > Planning rules > Planning engine* switches between the optimizer and the classic heuristic and sets the search effort (quick, standard, thorough).

### Measuring the planner against the best possible plan

`scripts/benchmark/` holds a much heavier search that works on exactly the same problem (same parts, machine rules, durations, changeovers, disruptions). It finds the best plan it can, compares it with the plan in an app export and writes a self-contained HTML report (curve of master orders finished over time, Gantt charts on one scale, a table per master order).

```bash
# 1. does the model reproduce your export? (tells you which settings, rules or disruptions the export was made with)
npx tsx scripts/benchmark/check-export.ts --export plan.xlsx --settings run.json -- workload.xlsx
# 2. search + report, 4 parallel seeds; add --upgraded standard to include the current optimizer as a third plan
scripts/benchmark/run.sh --out-dir out --export plan.xlsx --settings run.json --upgraded standard --iters 40000000 -- workload.xlsx
```

`run.json` holds what was changed in the app (`priorityRules`, `timelineEvents`, `calendar` ...). Workload files stay on your computer; nothing here writes company data into the repository.

### Parts time list

The list (Material Number, Time per Part avg) is matched on the part's `Matnr`. Import it once through *Import*; it is remembered in the browser. A private build can ship it built in: `npx tsx scripts/make-part-times.ts list.xlsx` writes `src/data/builtin-part-times.json`, which is gitignored because it is company data.

## Layout

```
src/core/            pure logic (no React): types, defaults, parsers, efficiency, priority, scheduler, calendar, export
src/core/scheduler/  simulate.ts (timing, changeovers, downtime), plan.ts (fast plan, KPIs), improve.ts + weights.ts (optimizer entry, priority weights)
src/core/optimizer/  search model, exact re-timing, annealing, lower bound (also used by the benchmark)
src/state/store.tsx  app state, persistence, background planning (web worker)
src/ui/              views and dialogs
scripts/             data check script, benchmark against the best possible plan
```
