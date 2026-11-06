#!/bin/bash
# Proxy scope research: N passes, round robin over network arms, each a full capture run of the Storybook at <base>.
#   arms.sh <base> <out root> <passes> <arm>...
#   arms: proxy (all traffic through the SOCKS proxy), scoped (only loopback through it, the rest direct),
#         hostnet (--network host), pw (Playwright Chromium, exposeNetwork)
set -uf -o pipefail
H=$(cd "$(dirname "$0")" && pwd); BASE=$1; OUT=$(mkdir -p "$2" && cd "$2" && pwd); PASSES=$3; shift 3
args() {
  case $1 in
    proxy) echo "--driver raw --network proxy --proxy-host ${PROXY_HOST:-127.0.0.1}" ;;
    scoped) echo "--driver raw --network bypass --bypass * --proxy-host ${PROXY_HOST:-127.0.0.1}" ;;
    hostnet) echo "--driver raw --network host" ;;
    pw) echo "--driver pw-chromium" ;;
    settle) echo "--driver raw --network proxy --settle 100 --proxy-host ${PROXY_HOST:-127.0.0.1}" ;;
    *) echo "unknown arm $1" >&2; exit 2 ;;
  esac
}
for i in $(seq 1 "$PASSES"); do
  for a in "$@"; do
    mkdir -p "$OUT/$a"
    [ -f "$OUT/$a/run-$i/run.json" ] && continue
    echo "### pass $i $a $(date +%T)"
    # shellcheck disable=SC2046,SC2086
    node "$H/capture.ts" $(args "$a") --base "$BASE" --out "$OUT/$a/run-$i" --label "$a-$i" ${EXTRA:-} 2>"$OUT/$a/run-$i.err" | cut -c1-300
  done
done
