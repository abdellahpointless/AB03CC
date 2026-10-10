#!/usr/bin/env bash
# One command from a workload to a report: parallel searches, optional exact-solver polish, HTML report.
#
#   scripts/benchmark/run.sh --out-dir DIR [--export app-plan.xlsx] [--settings run.json] [--iters 40000000]
#                            [--seeds "1 2 3 4"] [--polish-seconds 600] [--start-date 2026-10-09]
#                            -- workload.xlsx [carpenter.xlsx] [parts-time-list.xlsx]
#
# --settings: what was changed in the app for the run being judged (priority rules, disruptions on the timeline ...).
# The exact-solver polish does not model disruptions, so it stops by itself when the settings contain any.
#
# The polish step needs OR-Tools:  python3 -m venv VENV && VENV/bin/pip install ortools   (set VENV=path)
set -euo pipefail
OUT=""; EXPORT=""; SETTINGS=""; ITERS=40000000; SEEDS="1 2 3 4"; POLISH=0; START="2026-10-09"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --out-dir) OUT="$2"; shift 2;;
    --export) EXPORT="$2"; shift 2;;
    --settings) SETTINGS="$2"; shift 2;;
    --iters) ITERS="$2"; shift 2;;
    --seeds) SEEDS="$2"; shift 2;;
    --polish-seconds) POLISH="$2"; shift 2;;
    --start-date) START="$2"; shift 2;;
    --) shift; break;;
    *) echo "unknown option $1"; exit 1;;
  esac
done
FILES=("$@")
[[ -n "$OUT" && ${#FILES[@]} -gt 0 ]] || { echo "usage: run.sh --out-dir DIR -- workload.xlsx ..."; exit 1; }
mkdir -p "$OUT"
cd "$(dirname "$0")/../.."
SET=()
[[ -n "$SETTINGS" ]] && SET=(--settings "$SETTINGS")

echo "== searching ($SEEDS) =="
pids=()
for s in $SEEDS; do
  npx tsx scripts/benchmark/solve.ts --seed "$s" --iters "$ITERS" --restarts 1 --start-date "$START" "${SET[@]}" --out "$OUT/best-$s.json" -- "${FILES[@]}" > "$OUT/log-$s.txt" 2>&1 &
  pids+=($!)
done
for p in "${pids[@]}"; do wait "$p"; done
cat "$OUT"/log-*.txt

BESTARGS=()
for f in "$OUT"/best-*.json; do BESTARGS+=(--best "$f"); done
BEST=$(python3 -I -c 'import json,sys; print(min(sys.argv[1:], key=lambda f: json.load(open(f))["sumC"]))' "$OUT"/best-*.json)
echo "best search run: $BEST"

if [[ "$POLISH" -gt 0 && -n "${VENV:-}" ]]; then
  echo "== exact-solver polish ($POLISH s) =="
  npx tsx scripts/benchmark/dump-instance.ts --best "$BEST" --start-date "$START" "${SET[@]}" --out "$OUT/instance.json" -- "${FILES[@]}"
  "$VENV/bin/python" scripts/benchmark/cpsat.py "$OUT/instance.json" --time "$POLISH" --workers 4 --out "$OUT/cpsat.json" > "$OUT/cpsat.log" 2>&1 || true
  if [[ -f "$OUT/cpsat.json" ]]; then
    npx tsx scripts/benchmark/adopt.ts --queues "$OUT/cpsat.json" --start-date "$START" "${SET[@]}" --out "$OUT/best-cpsat.json" -- "${FILES[@]}"
    BESTARGS+=(--best "$OUT/best-cpsat.json")
  fi
fi

echo "== report =="
EXTRA=()
[[ -n "$EXPORT" ]] && EXTRA+=(--export "$EXPORT")
npx tsx scripts/benchmark/report.ts "${BESTARGS[@]}" "${EXTRA[@]}" --start-date "$START" "${SET[@]}" --out "$OUT/report.html" -- "${FILES[@]}"
