#!/usr/bin/env python3
"""
Independent check of the search with an exact solver (OR-Tools CP-SAT).

  cpsat.py instance.json [--time 600] [--workers 4] [--hint best|app|none] [--horizon-slack 600]

Model: every part is assigned to one machine that can run it and sequenced on it (AddCircuit per machine,
changeover as an enforced precedence on the used arc); tied (ERP assigned) parts stay at the head of their machine.
Objective: minimise the sum of module completion minutes. The best known schedule is given as a hint, so a result
below it proves the heuristic search was not perfect, and the reported bound shows how much room is left.
"""
import json
import sys
import time

from ortools.sat.python import cp_model


def main():
    path = sys.argv[1]
    opts = {a: sys.argv[i + 1] for i, a in enumerate(sys.argv) if a.startswith('--') and i + 1 < len(sys.argv)}
    time_limit = float(opts.get('--time', 600))
    workers = int(opts.get('--workers', 4))
    hint_kind = opts.get('--hint', 'best')
    slack = int(opts.get('--horizon-slack', 600))

    inst = json.load(open(path))
    if any(len(w) for w in inst.get('downtime', [])):
        sys.exit('this instance has disruptions on the timeline, which the exact model does not cover; skipping the polish')
    n, K, M = inst['n'], inst['K'], inst['M']
    dur, setup, mod, fixed = inst['dur'], inst['setup'], inst['mod'], inst['fixed']
    elig = [[k for k in range(K) if dur[j * K + k] > 0] for j in range(n)]
    # durations are machine independent in this model (true for the planner's defaults)
    d = []
    for j in range(n):
        vals = {dur[j * K + k] for k in elig[j]}
        if len(vals) != 1:
            sys.exit(f'job {j} has machine dependent durations; extend the model')
        d.append(vals.pop())

    hint = inst.get('bestQueues') if hint_kind == 'best' else inst.get('appQueues') if hint_kind == 'app' else None

    def simulate(queues):
        start = [0] * n
        for k, q in enumerate(queues):
            t, prev = 0, -1
            for j in q:
                s = 0 if prev < 0 else setup[prev * n + j]
                t += s
                start[j] = t
                t += d[j]
                prev = j
        return start

    hint_start = simulate(hint) if hint else None
    if hint:
        mod_end = [0] * M
        for j in range(n):
            mod_end[mod[j]] = max(mod_end[mod[j]], hint_start[j] + d[j])
        hint_obj = sum(mod_end)
        horizon = max(hint_start[j] + d[j] for j in range(n)) + slack
        print(f'hint objective {hint_obj}, horizon {horizon}', flush=True)
    else:
        horizon = sum(d) + sum(max(setup[i * n:(i + 1) * n]) for i in range(n))

    model = cp_model.CpModel()
    S = [model.NewIntVar(0, horizon, f's{j}') for j in range(n)]
    present = {}
    arc_lits = {}
    t0 = time.time()
    for k in range(K):
        jobs_k = [j for j in range(n) if k in elig[j]]
        idx = {j: i + 1 for i, j in enumerate(jobs_k)}
        arcs = []
        empty = model.NewBoolVar(f'empty{k}')
        arcs.append((0, 0, empty))
        arc_lits[(k, 'empty')] = empty
        for j in jobs_k:
            if len(elig[j]) > 1:
                p = model.NewBoolVar(f'x{j}_{k}')
                present[(j, k)] = p
                arcs.append((idx[j], idx[j], p.Not()))
            else:
                present[(j, k)] = None  # must be on this machine
            first = model.NewBoolVar(f'f{j}_{k}')
            last = model.NewBoolVar(f'l{j}_{k}')
            arcs.append((0, idx[j], first))
            arcs.append((idx[j], 0, last))
            arc_lits[(k, 'first', j)] = first
            arc_lits[(k, 'last', j)] = last
        for i in jobs_k:
            for j in jobs_k:
                if i == j:
                    continue
                lit = model.NewBoolVar(f'a{i}_{j}_{k}')
                arcs.append((idx[i], idx[j], lit))
                arc_lits[(k, i, j)] = lit
                model.Add(S[j] >= S[i] + d[i] + setup[i * n + j]).OnlyEnforceIf(lit)
        model.AddCircuit(arcs)
        # tied parts come first on their machine
        tied = [j for j in jobs_k if fixed[j] == k]
        free = [j for j in jobs_k if fixed[j] < 0]
        for t in tied:
            for f in free:
                c = model.Add(S[f] >= S[t] + d[t])
                p = present[(f, k)]
                if p is not None:
                    c.OnlyEnforceIf(p)
    # a part with several eligible machines is on exactly one of them
    for j in range(n):
        if len(elig[j]) > 1:
            model.AddExactlyOne([present[(j, k)] for k in elig[j]])
    C = [model.NewIntVar(0, horizon, f'c{m}') for m in range(M)]
    for j in range(n):
        model.Add(C[mod[j]] >= S[j] + d[j])
    model.Minimize(sum(C))
    print(f'model built in {time.time() - t0:.1f}s: {len(arc_lits)} arc literals', flush=True)

    if hint:
        on = {}
        for k, q in enumerate(hint):
            for j in q:
                on[j] = k
        for j in range(n):
            model.AddHint(S[j], hint_start[j])
            for k in elig[j]:
                if present[(j, k)] is not None:
                    model.AddHint(present[(j, k)], 1 if on[j] == k else 0)
        for k, q in enumerate(hint):
            model.AddHint(arc_lits[(k, 'empty')], 0 if q else 1)
            for pos, j in enumerate(q):
                if pos == 0:
                    model.AddHint(arc_lits[(k, 'first', j)], 1)
                if pos == len(q) - 1:
                    model.AddHint(arc_lits[(k, 'last', j)], 1)
            qs = set(q)
            for key, lit in arc_lits.items():
                pass
        # all remaining arc literals default to 0 through the hint below
        used = set()
        for k, q in enumerate(hint):
            for a, b in zip(q, q[1:]):
                used.add((k, a, b))
        for key, lit in arc_lits.items():
            if len(key) == 3 and isinstance(key[1], int):
                model.AddHint(lit, 1 if key in used else 0)
            elif len(key) == 3 and key[1] == 'first':
                k, _, j = key
                if not (hint[k] and hint[k][0] == j):
                    model.AddHint(lit, 0)
            elif len(key) == 3 and key[1] == 'last':
                k, _, j = key
                if not (hint[k] and hint[k][-1] == j):
                    model.AddHint(lit, 0)

    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = time_limit
    solver.parameters.num_search_workers = workers
    solver.parameters.log_search_progress = True
    status = solver.Solve(model)
    print('status', solver.StatusName(status))
    if status in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        print('objective', solver.ObjectiveValue(), 'best bound', solver.BestObjectiveBound())
        if hint:
            print('hint objective', hint_obj, 'improvement', hint_obj - solver.ObjectiveValue())
        # extract queues
        starts = [solver.Value(S[j]) for j in range(n)]
        queues = []
        for k in range(K):
            q = [j for j in range(n) if k in elig[j] and (present.get((j, k)) is None or solver.Value(present[(j, k)]))]
            q.sort(key=lambda j: starts[j])
            queues.append(q)
        out = opts.get('--out')
        if out:
            json.dump({'objective': solver.ObjectiveValue(), 'bound': solver.BestObjectiveBound(), 'queues': queues}, open(out, 'w'))


main()
