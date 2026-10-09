# CNC Smart Planner

Production scheduling for a CNC machining workshop. Import the **BoxShelf production export** (and optionally the **carpenter list**), and the planner assigns every box to a machine, sequences each queue to minimise changeovers and finish whole master orders together, and shows the result as a Gantt chart, run sheets and Excel export. Everything runs in the browser; no data leaves the computer.

## Run it

```bash
npm install
npm run dev        # http://localhost:3000
npm test           # unit tests for parsers, efficiency, calendar, scheduler
npm run build      # type-check + production build into dist/
npm run check:data -- BoxShelf.xlsx [CarpenterList.xlsx]   # plan real exports and verify invariants
```

## Using it

1. **Import** – drop one or both spreadsheets on the start page, or use *Import* in the top bar at any time. Files are recognised by their columns, so it does not matter which button you use.
2. **Gantt** – boxes per machine on a working-time axis. Click a box for details and overrides, drag it onto another machine to pin it there, colour by material / master order / sales order, search, zoom, overlay the previous plan, add breakdowns / maintenance / absences / rework.
3. **Priority Rules** – levels evaluated top-down (sales order, schedule number/range, customer, material, finish full module, waiting, production date). Presets included.
4. **Orders & Bulk Efficiency** – every planned operation; select rows and set "runs at %" in bulk.
5. **Run Sheets** – per-machine sequence; print one A4 page per machine.
6. **Exceptions** – blocked, no eligible machine, out-of-scope ERP machines, master orders 30000* (assign manually), missing warehouse pick.
7. **Variable Editor** – machines and allowed materials, material offsets and aliases, changeover times, calendar, planning rules, carpenter handling, efficiency matrix and calibration.

Settings, overrides and the imported data are kept in the browser's local storage.

## How the plan is built

1. Classify jobs: blocked, out-of-scope, ERP-locked, user-pinned, master order 30000*, free.
2. Rank by the priority levels; rank master orders by their best part (carpenter delay applied on ties).
3. Assign master orders one at a time: small modules try every machine combination, large ones place part by part, minimising the busiest machine (including unavoidable future work), the module's finish time, changeovers and load imbalance.
4. Re-sequence each queue so modules finish as early as possible and identical drawings / stock run back to back.
5. Seeded local search (moves and swaps) polishes makespan, module completion and changeovers. The result is deterministic.
6. Planned minutes = (NC minutes ÷ efficiency + material offset) × quantity, placed on a shift calendar around downtime.

## Layout

```
src/core/            pure logic (no React): types, defaults, parsers, efficiency, priority, scheduler, calendar, export
src/core/scheduler/  simulate.ts (timing, changeovers, downtime) and plan.ts (assignment, sequencing, KPIs)
src/state/store.tsx  app state, persistence, background planning (web worker)
src/ui/              views and dialogs
scripts/             data check script
```
