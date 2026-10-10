# Benchmark: how close is the planner to the best possible timeline?

The planner is judged against a much heavier search that works on exactly the same problem (same parts, machine rules,
durations, changeovers, disruptions), so any difference is a difference in plan quality, not in assumptions.

* **Goal:** finish as many master orders as early as possible = minimise the sum of master-order completion times.
* `src/core/optimizer/` holds the compact problem model, the exact timing replay (including disruptions), a module-order
  search with a greedy decoder, an incremental queue-level simulated annealing (millions of moves), and a lower bound.
  The app's own optimizer is the same code with a small, fixed budget (`budget.ts`).
* `cpsat.py` is an independent exact check with OR-Tools CP-SAT. It can polish the best schedule and proves optimality
  on small cut-outs (`subtest.ts` makes them). It does not model disruptions.
* `report.ts` builds a self-contained HTML page: key numbers, master orders finished over time, the Gantt charts of the
  perfect timeline, the upgraded app and an app export on one scale, and a table per master order.

| script | what it does |
|---|---|
| `check-export.ts` | does the timing model reproduce an app export under the given settings? (finds the rules / disruptions it was made with) |
| `solve.ts`, `run.sh` | heavy search (parallel seeds) and the report in one go |
| `report.ts` | the HTML comparison; `--export` the app's file, `--upgraded standard` adds the current optimizer |
| `engine.ts` | runs the app's planner in each mode and effort: result and time |
| `tune.ts`, `profile.ts` | compare optimizer settings over several seeds; where the seconds go |
| `fuzz.ts` | plans random cut-outs under random settings, pins and disruptions and checks the invariants |

```bash
# does the model reproduce your export?
npx tsx scripts/benchmark/check-export.ts --export app-plan.xlsx --settings run.json -- workload.xlsx
# search + report (4 seeds in parallel), with the current optimizer as a third plan
scripts/benchmark/run.sh --out-dir out --export app-plan.xlsx --settings run.json --upgraded standard --iters 40000000 -- workload.xlsx
```

`run.json` holds what was changed in the app, for example:

```json
{ "priorityRules": [{ "id": "f", "type": "finish_master_order", "level": 1, "enabled": true, "name": "Finish Full Module First", "direction": "lowest_first" }],
  "timelineEvents": [{ "id": "e1", "machineId": "HAAS - 1", "type": "breakdown", "title": "x", "startMinute": 600, "durationMinutes": 50 }] }
```

Workload files stay local: nothing here writes company data into the repository.
