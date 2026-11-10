#!/bin/bash
# PROTOTYPE, throwaway: N passes, round robin over drivers and animation arms, each a full capture run of the Storybook.
#   run-anim.sh <base> <out root> <passes>   env DRIVERS (default "raw pw-webkit"), ARMS (default all nine), EXTRA
set -uo pipefail
H=$(cd "$(dirname "$0")" && pwd); BASE=$1; OUT=$(mkdir -p "$2" && cd "$2" && pwd); PASSES=$3
DRIVERS=(${DRIVERS:-raw pw-webkit}); ARMS=(${ARMS:-none sb zero-noguard zero zero-tiny finish zero-finish zero-finish-media settle})
for i in $(seq 1 "$PASSES"); do
  for d in "${DRIVERS[@]}"; do
    for a in "${ARMS[@]}"; do
      mkdir -p "$OUT/$d-$a"
      echo "### pass $i $d $a $(date +%T)"
      node "$H/capture.ts" --driver "$d" --anim "$a" --base "$BASE" --out "$OUT/$d-$a/run-$i" --label "$d-$a-$i" ${EXTRA:-} 2>"$OUT/$d-$a/run-$i.err" | cut -c1-600
      grep -E '^broken|killing|launched' "$OUT/$d-$a/run-$i.err" | cut -c1-200
    done
  done
done
