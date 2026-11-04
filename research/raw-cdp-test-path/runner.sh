#!/bin/bash
# On a GitHub runner: the same container runs as locally, plus the host layout, where Node and the server run on the
# runner and only the browser runs in the container, on the host network.
#   runner.sh <image> <storybook-static dir> <out dir> <passes>
set -uo pipefail
H=$(cd "$(dirname "$0")" && pwd); IMG=$1; SB=$2; OUT=$3; PASSES=${4:-3}
# Containers write as root, so the host side gets its own folder
mkdir -p "$OUT" "$OUT/host"
ONLY=${ONLY:-all}
{ nproc; lscpu | grep -E 'Model name|^CPU\(s\)'; free -m | head -2; } > "$OUT/machine.txt"
U=(--stories 300 --area viewport --viewport 1280x720 --css 'html>:not(head):not(body){display:none!important}')
dock() { docker run --rm --init --ipc=host --network none --cpus=2 -e CPUS=2 -v "$H":/h:ro -v "$SB":/sb:ro -v "$OUT":/out "$IMG" bash /h/inner.sh "$@"; }
run() { local l=$1; shift; dock bench "${U[@]}" --label "gha-$l" --out /out/timed.jsonl "$@" 2>&1 | cut -c1-330 | tail -1; }
host() { # host <label> connect|raw <bench args...>
  local l=$1 mode=$2; shift 2
  node "$H/serve.mjs" "$SB" 6400 > /tmp/serve.log 2>&1 &
  local sp=$!
  until grep -q serving /tmp/serve.log 2>/dev/null; do sleep 0.1; done
  local cid end
  if [ "$mode" = connect ]; then
    cid=$(docker run -d --rm --init --ipc=host --network host -v "$H":/h:ro "$IMG" node /h/node_modules/playwright-core/cli.js run-server --port 3333 --host 127.0.0.1 --unsafe)
    until docker logs "$cid" 2>&1 | grep -q Listening; do sleep 0.1; done
    end=(--engine pw-connect --endpoint ws://127.0.0.1:3333/)
  else
    cid=$(docker run -d --rm --init --ipc=host --network host -v "$OUT":/out:ro "$IMG" bash -c 'mapfile -t A < <(node -e "for (const a of JSON.parse(require(\"fs\").readFileSync(\"/out/flags-x86_64.json\", \"utf8\"))) console.log(a)"); exec /ms-playwright/chromium_headless_shell-*/chrome-headless-shell-linux64/chrome-headless-shell "${A[@]}" --disable-skia-runtime-opts --user-data-dir=/tmp/u --remote-debugging-address=127.0.0.1 --remote-debugging-port=9222 about:blank')
    until curl -sf http://127.0.0.1:9222/json/version > /dev/null; do sleep 0.1; done
    end=(--engine raw --endpoint http://127.0.0.1:9222 --fonts "$OUT/fonts-x86_64.json")
  fi
  CPUS=2 node "$H/bench.mjs" --storybook "$SB" "${U[@]}" "${end[@]}" --label "gha-$l" "$@" 2>&1 | cut -c1-330 | tail -4
  docker stop -t 2 "$cid" > /dev/null
  kill $sp
}
echo "### setup $(date +%T)"
dock setup "${U[@]}" --label setup 2>&1 | tail -5
for i in $(seq 1 "$PASSES"); do
  echo "### pass $i $(date +%T)"
  run pw-w2 --engine pw --workers 2
  run raw-w2 --engine raw --workers 2
  run connect-w2 --engine pw-connect --workers 2
  run rawfast-w2 --engine raw --encoder png-fast --workers 2
  run rawws-w2 --engine raw --transport ws --workers 2
  host hostconnect-w2 connect --workers 2 --out "$OUT/host/timed.jsonl"
  host hostraw-w2 raw --workers 2 --out "$OUT/host/timed.jsonl"
  [ "$ONLY" = host ] && continue
  for w in 6 12; do
    run pw-w$w --engine pw --workers $w
    run raw-w$w --engine raw --workers $w
    run connect-w$w --engine pw-connect --workers $w
  done
done
echo "### parity $(date +%T)"
for r in pw-1 pw-2; do run save-$r --engine pw --workers 2 --save /out/parity/$r; done
if [ "$ONLY" != host ]; then
run save-connect --engine pw-connect --workers 2 --save /out/parity/connect
run save-raw --engine raw --workers 2 --save /out/parity/raw
run save-rawfast --engine raw --encoder png-fast --workers 2 --save /out/parity/rawfast
run save-rawws --engine raw --transport ws --workers 2 --save /out/parity/rawws
run save-nofonts --engine raw --fonts none --workers 2 --save /out/parity/nofonts
fi
host save-hostconnect connect --workers 2 --save "$OUT/host/parity/hostconnect"
host save-hostraw raw --workers 2 --save "$OUT/host/parity/hostraw"
for r in parity/pw-2 parity/connect parity/raw parity/rawfast parity/rawws parity/nofonts host/parity/hostconnect host/parity/hostraw; do
  [ -d "$OUT/$r" ] && node "$H/compare.mjs" "$OUT/parity/pw-1" "$OUT/$r" | tee -a "$OUT/host/parity.jsonl" | cut -c1-300
done
echo "### done $(date +%T)"
