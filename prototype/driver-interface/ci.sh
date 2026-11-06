#!/bin/bash
# PROTOTYPE, throwaway: one runner job. Serves the Storybook build, runs every arm N times, then the checks.
#   ci.sh <storybook-static dir> <out dir> <passes>
set -uo pipefail
H=$(cd "$(dirname "$0")" && pwd); SB=$1; OUT=$(mkdir -p "$2" && cd "$2" && pwd); PASSES=$3
{ nproc; lscpu | grep -E 'Model name'; free -m | head -2; docker version --format '{{.Server.Version}}'; } > "$OUT/machine.txt"
node "$H/serve.mjs" "$SB" 6400 127.0.0.1 > "$OUT/serve.log" 2>&1 &
until grep -q serving "$OUT/serve.log" 2>/dev/null; do sleep 0.1; done
# Live network as a project has it, then offline (external requests fail fast) to tell driver noise from late content
"$H/run-arms.sh" http://127.0.0.1:6400 "$OUT/runs" "$PASSES" 2>&1 | tee "$OUT/runs.log" | grep -E '^###|^\{' | cut -c1-300
EXTRA=--offline "$H/run-arms.sh" http://127.0.0.1:6400 "$OUT/offline" "$PASSES" 2>&1 | tee "$OUT/offline.log" | grep -E '^###|^\{' | cut -c1-300
"$H/checks.sh" http://127.0.0.1:6400 "$OUT/checks" 2>&1 | tee "$OUT/checks.log"
