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
  exit 0
fi
args=("$@")
if [[ " $* " == *" --engine pw-connect "* ]]; then
  node /h/node_modules/playwright-core/cli.js run-server --port 3333 --host 127.0.0.1 --unsafe > /tmp/rs.log 2>&1 &
  until grep -q Listening /tmp/rs.log 2>/dev/null; do sleep 0.1; done
  args+=(--endpoint ws://127.0.0.1:3333/)
fi
node /h/bench.mjs "${common[@]}" "${args[@]}"
