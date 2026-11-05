#!/bin/bash
# Raw CDP for Chromium: how a driver on the host reaches headless shell in the container, and how that browser reaches
# a Storybook on the host. Runs on a GitHub runner (Linux) and on macOS with OrbStack.
#   runner2.sh <image> <storybook-static dir> <out dir> <passes>
set -uo pipefail
H=$(cd "$(dirname "$0")" && pwd); IMG=$1; SB=$2; OUT=$3; PASSES=${4:-3}
mkdir -p "$OUT" "$OUT/host"
PLAT=$(uname)
if [ "$PLAT" = Linux ]; then
  { nproc; lscpu | grep -E 'Model name|^CPU\(s\)'; free -m | head -2; docker version --format '{{.Server.Version}}'; } > "$OUT/machine.txt"
  GW=$(ip -4 -o addr show docker0 | awk '{print $4}' | cut -d/ -f1)
  ADDHOST=(--add-host=host.docker.internal:host-gateway)
else
  { sysctl -n machdep.cpu.brand_string; docker version --format '{{.Server.Version}}'; docker info --format '{{.OperatingSystem}} {{.NCPU}} {{.MemTotal}}'; } > "$OUT/machine.txt"
  GW=127.0.0.1
  ADDHOST=()
fi
SOCKS="$GW:1080"
ALLOW=127.0.0.1:6400,localhost:6400,sb.vc.test:6400
PROXY=(--proxy-server=socks5://host.docker.internal:1080 '--proxy-bypass-list=<-loopback>')
OFFLINE=('--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1, EXCLUDE sb.vc.test')
FLAGS=/out/flags-x86_64.json
U=(--stories ${STORIES:-300} --area viewport --viewport 1280x720 --css 'html>:not(head):not(body){display:none!important}')
BASE=(docker run --rm --init --ipc=host --platform linux/amd64 --cpus=2 --memory=7g -v "$H":/h:ro -v "$OUT":/out:ro)
json() { node -e 'console.log(JSON.stringify(process.argv.slice(1)))' -- "$@"; }

# In-container arms: Node, server and browser in one container with no network, as in Raw CDP on the test path
dock() { docker run --rm --init --ipc=host --platform linux/amd64 --network none --cpus=2 --memory=7g -e CPUS=2 -v "$H":/h:ro -v "$SB":/sb:ro -v "$OUT":/out "$IMG" bash /h/inner.sh "$@"; }
ic() { local l=$1; shift; dock bench "${U[@]}" --label "$l" --out /out/timed.jsonl "$@" 2>&1 | cut -c1-400 | tail -1; }

serve() { node "$H/serve.mjs" "$SB" 6400 127.0.0.1 > "$OUT/host/serve.log" 2>&1 & SP=$!; until grep -q serving "$OUT/host/serve.log" 2>/dev/null; do sleep 0.1; done; }
bench() { CPUS=2 node "$H/bench.mjs" --storybook "$SB" "${U[@]}" --fonts "$OUT/fonts-x86_64.json" --out "$OUT/host/timed.jsonl" "$@" 2>&1 | cut -c1-400 | tail -${TAIL:-2}; }

# Host arms: Node and the server on the host, only the browser in the container, limited to 2 CPUs
#   h <label> ws|stdio proxy|hostnet [bench args...]
h() {
  local l=$1 t=$2 n=$3; shift 3
  local net=() extra=()
  if [ "$n" = proxy ]; then net=(${ADDHOST[@]+"${ADDHOST[@]}"}); extra=("${PROXY[@]}"); else net=(--network host); extra=("${OFFLINE[@]}"); fi
  serve
  if [ "$t" = stdio ]; then
    bench --label "$l" --engine raw --socks "$SOCKS" --socks-allow "$ALLOW" --spawn "$(json "${BASE[@]}" -i ${net[@]+"${net[@]}"} "$IMG" bash /h/chrome.sh "$FLAGS" pipe-stdio ${extra[@]+"${extra[@]}"})" "$@"
  else
    local pub=()
    [ "$n" = proxy ] && pub=(-e FWD=1 -p 127.0.0.1:9222:9223)
    local cid; cid=$("${BASE[@]}" -d ${net[@]+"${net[@]}"} ${pub[@]+"${pub[@]}"} "$IMG" bash /h/chrome.sh "$FLAGS" ws ${extra[@]+"${extra[@]}"})
    local k=0; until curl -sf http://127.0.0.1:9222/json/version > /dev/null || [ $k -gt 300 ]; do sleep 0.1; k=$((k+1)); done
    bench --label "$l" --engine raw --socks "$SOCKS" --socks-allow "$ALLOW" --endpoint http://127.0.0.1:9222 "$@"
    docker rm -f "$cid" > /dev/null
  fi
  kill $SP; wait $SP 2>/dev/null
}
# v1's path: run-server in the container on the default network, the Storybook through exposeNetwork. --dns keeps it offline.
hrs() {
  local l=$1; shift
  serve
  local cid; cid=$("${BASE[@]}" -d --dns 127.0.0.1 -p 127.0.0.1:3333:3333 "$IMG" node /h/node_modules/playwright-core/cli.js run-server --port 3333 --host 0.0.0.0 --unsafe)
  local k=0; until docker logs "$cid" 2>&1 | grep -q Listening || [ $k -gt 300 ]; do sleep 0.1; k=$((k+1)); done
  bench --label "$l" --engine pw-connect --endpoint ws://127.0.0.1:3333/ "$@"
  docker rm -f "$cid" > /dev/null
  kill $SP; wait $SP 2>/dev/null
}

echo "### setup $(date +%T)"
[ -z "${SKIP_SETUP:-}" ] && dock setup "${U[@]}" --label setup 2>&1 | tail -8
if [ "$PLAT" = Linux ] && [ -n "${CHECK_HOSTS:-}" ]; then
  echo "### URL as written: a hosts-file name $(date +%T)"
  echo '127.0.0.1 sb.vc.test' | sudo tee -a /etc/hosts > /dev/null
  S20=(--stories 20 --base http://sb.vc.test:6400 --workers 2)
  h names-stdio-hostnet stdio hostnet "${S20[@]}"
  h names-stdio-proxy stdio proxy "${S20[@]}"
  h names-ws-proxy ws proxy "${S20[@]}"
  hrs names-runserver "${S20[@]}" --expose 'sb.vc.test,<loopback>'
fi
arm() { [ -z "${ARMS:-}" ] || [[ " $ARMS " == *" $1 "* ]]; }
for i in $(seq 1 "$PASSES"); do
  echo "### pass $i $(date +%T)"
  arm ic-raw && ic ic-raw --engine raw --workers 2
  arm ic-raw-net && ic ic-raw-net --engine raw --network --workers 2
  arm ic-pw && ic ic-pw --engine pw --workers 2
  arm h-ws-proxy && h h-ws-proxy ws proxy --workers 2
  arm h-stdio-proxy && h h-stdio-proxy stdio proxy --workers 2
  arm h-ws-hostnet && h h-ws-hostnet ws hostnet --workers 2
  arm h-stdio-hostnet && h h-stdio-hostnet stdio hostnet --workers 2
  arm h-runserver && hrs h-runserver --workers 2
  arm ic-wk-pw && ic ic-wk-pw --engine pw --browser webkit --workers 2
  arm ic-wk-connect && ic ic-wk-connect --engine pw-connect --browser webkit --workers 2
done
echo "### done $(date +%T)"
