#!/bin/bash
# RESEARCH, throwaway: N passes over the arms, in an order rotated each pass, each a capture run of the userflow stories.
#   arms.sh <base> <out root> <passes> <rotation offset> [arms...]
set -uo pipefail
H=$(cd "$(dirname "$0")" && pwd); BASE=$1; OUT=$(mkdir -p "$2" && cd "$2" && pwd); PASSES=$3; OFF=$4; shift 4
declare -A FLAGS=(
  [raw]="--driver raw"
  [pw]="--driver pw"
  [raw-net]="--driver raw --net"
  [raw-setup]="--driver raw --pw-setup all"
  [raw-all]="--driver raw --net --pw-setup all"
  [raw-s-runtime]="--driver raw --pw-setup runtime"
  [raw-s-utility]="--driver raw --pw-setup utility"
  [raw-s-attach]="--driver raw --pw-setup attach"
  [raw-s-lifecycle]="--driver raw --pw-setup lifecycle"
  [raw-pace]="--driver raw --pace 0.15"
  [raw-1w]="--driver raw --workers 1"
  [pw-1w]="--driver pw --workers 1"
  [raw-retrywait]="--driver raw --retry-wait 500"
  [raw-noprobe]="--driver raw --no-probe"
  [pw-noprobe]="--driver pw --no-probe"
  [pw-dns]="--driver pw --offline dns"
  [raw-live]="--driver raw --offline none"
  [pw-live]="--driver pw --offline none"
)
ARMS=("$@"); [ ${#ARMS[@]} -eq 0 ] && ARMS=(raw pw raw-net raw-setup raw-all raw-pace raw-1w pw-1w raw-retrywait raw-noprobe pw-noprobe pw-dns raw-live pw-live)
N=${#ARMS[@]}
for i in $(seq 1 "$PASSES"); do
  for k in $(seq 0 $((N - 1))); do
    a=${ARMS[$(((k + i + OFF) % N))]}
    mkdir -p "$OUT/$a"
    echo "### pass $i $a $(date +%T)"
    # shellcheck disable=SC2086
    timeout 600 node "$H/capture.ts" ${FLAGS[$a]} --base "$BASE" --out "$OUT/$a/run-$i" --label "$a-$i" 2>"$OUT/$a/run-$i.err" | cut -c1-400
    ids=$(docker ps -aq --filter name=vc-nav-); [ -n "$ids" ] && docker rm -f $ids >/dev/null 2>&1
  done
done
