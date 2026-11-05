#!/bin/bash
# Runs inside the Playwright image. Harness at /h (read-only), Storybook build at /sb (read-only), results in /out.
#   inner.sh setup <bench args>   Playwright's Chromium arguments and font table, and CDP message counts per capture
#   inner.sh bench <bench args>   one timed run; '--engine pw-connect' also starts run-server in this container
set -euo pipefail
mode="$1"; shift
node /h/serve.mjs /sb 6400 > /tmp/serve.log 2>&1 &
until grep -q serving /tmp/serve.log 2>/dev/null; do sleep 0.1; done
EXE=$(ls -d /ms-playwright/chromium_headless_shell-*/chrome-headless-shell-*/chrome-headless-shell | head -1)
ARCH=$(uname -m)
common=(--exe "$EXE" --storybook /sb --flags "/out/flags-$ARCH.json" --fonts "/out/fonts-$ARCH.json")
if [ "$mode" = setup ]; then
  node /h/flags.mjs "/out/flags-$ARCH.json"
  DEBUG=pw:protocol node /h/bench.mjs "${common[@]}" "$@" --engine pw --workers 1 --marks --label setup-pw 2> /tmp/proto.log | cut -c1-300
  node /h/protocol.mjs /tmp/proto.log "/out/fonts-$ARCH.json" "/out/audit-pw-$ARCH.json"
  node /h/bench.mjs "${common[@]}" "$@" --engine raw --workers 1 --marks --label setup-raw --out "/out/audit-raw-$ARCH.jsonl" 2>/dev/null | cut -c1-300
  node /h/bench.mjs "${common[@]}" "$@" --engine raw --network --workers 1 --marks --label setup-raw-net --out "/out/audit-raw-net-$ARCH.jsonl" 2>/dev/null | cut -c1-300
  DEBUG=pw:protocol node /h/bench.mjs "${common[@]}" "$@" --stories 60 --engine pw --browser webkit --workers 1 --marks --label setup-webkit 2> /tmp/proto-wk.log | cut -c1-300
  node /h/protocol.mjs /tmp/proto-wk.log /tmp/fonts-wk.json "/out/audit-webkit-$ARCH.json"
  exit 0
fi
args=("$@")
RS=
if [[ " $* " == *" --engine pw-connect "* ]]; then
  node /h/node_modules/playwright-core/cli.js run-server --port 3333 --host 127.0.0.1 --unsafe > /tmp/rs.log 2>&1 &
  RS=$!
  until grep -q Listening /tmp/rs.log 2>/dev/null; do sleep 0.1; done
  args+=(--endpoint ws://127.0.0.1:3333/)
fi
# CPU of the whole container and of run-server, to tell the browser's share from Playwright's
usage() { awk '/^usage_usec/ {print $2}' /sys/fs/cgroup/cpu.stat; }
pcpu() { [ -n "$1" ] && awk '{print $14 + $15}' "/proc/$1/stat" || echo 0; }
SP=$(pgrep -f serve.mjs | head -1)
C0=$(usage); S0=$(pcpu "$SP")
node /h/bench.mjs "${common[@]}" "${args[@]}"
C1=$(usage); S1=$(pcpu "$SP"); R1=$(pcpu "$RS")
label=$(printf '%s\n' "${args[@]}" | awk 'p {print; exit} $0 == "--label" {p = 1}')
TCK=$(getconf CLK_TCK)
echo "{\"label\":\"$label\",\"containerCpuS\":$(( (C1 - C0) / 1000 ))e-3,\"serveCpuS\":$(( (S1 - S0) * 1000 / TCK ))e-3,\"runServerCpuS\":$(( R1 * 1000 / TCK ))e-3,\"at\":\"$(date -u +%FT%TZ)\"}" >> /out/cpu.jsonl
