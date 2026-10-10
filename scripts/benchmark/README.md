# Benchmark: how close is the planner to the best possible timeline?

The planner is judged against a much heavier search that works on exactly the same problem (same parts, machine rules,
durations, changeovers), so any difference is a difference in plan quality, not in assumptions.

* **Goal:** finish as many master orders as early as possible = minimise the sum of master-order completion times.
* `src/core/optimizer/` holds the compact problem model, the exact timing replay, a module-order search with a greedy
  decoder, an incremental queue-level simulated annealing (millions of moves), and a lower bound.
* `scripts/benchmark/cpsat.py` is an independent exact check with OR-Tools CP-SAT. It can polish the best schedule and
  proves optimality on small cut-outs (`subtest.ts` makes them).
* `report.ts` builds a self-contained HTML page: key numbers, modules finished over time, the perfect Gantt and the app's
  Gantt on one scale, and a per-master-order table. `--export` takes the Excel export from the app's Export button.

```bash
scripts/benchmark/run.sh --out-dir out --export app-plan.xlsx --polish-seconds 600 -- workload.xlsx carpenter.xlsx parts-times.xlsx
```

Workload files stay local: nothing here writes company data into the repository.
