#!/bin/bash
# PROTOTYPE, throwaway: N passes, round robin over the arms, each a full capture run of the Storybook at <base>.
#   run-arms.sh <base> <out root> <passes> [arms...]   arms: raw pw-chromium pw-webkit
set -uo pipefail
H=$(cd "$(dirname "$0")" && pwd); BASE=$1; OUT=$(mkdir -p "$2" && cd "$2" && pwd); PASSES=$3; shift 3
ARMS=("$@"); [ ${#ARMS[@]} -eq 0 ] && ARMS=(raw pw-chromium pw-webkit)
mkdir -p "$OUT"
for i in $(seq 1 "$PASSES"); do
  for a in "${ARMS[@]}"; do
    mkdir -p "$OUT/$a"
    echo "### pass $i $a $(date +%T)"
    node "$H/capture.ts" --driver "$a" --base "$BASE" --out "$OUT/$a/run-$i" --label "$a-$i" ${EXTRA:-} 2>"$OUT/$a/run-$i.err" | cut -c1-600
    grep -E '^broken|killing|launched' "$OUT/$a/run-$i.err" | cut -c1-200
  done
done
node "$H/compare.ts" "$OUT"
