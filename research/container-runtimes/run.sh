#!/bin/sh
# Usage: DOCKER="docker --context x" IMAGE=<ref> run.sh <outDir> <workers> <cpus|none> <firstRun> <lastRun> [passes]
# One fresh container per run, no network, Storybook on the container's loopback, external responses from the HAR.
# Expects data/sb/storybook-static, data/sb/storybook.tar.sha256 and data/har/{chromium,webkit}.har.zip next to this script.
# Optional: VC_LIMIT (stories), VC_READY_TIMEOUT (ms), VC_EXTRA_ARGS (JSON array for the flagged Chromium pass).
set -u
out=$1; workers=$2; cpus=$3; first=$4; last=$5; passes=${6:-chromium,noskia,webkit}
here=$(cd "$(dirname "$0")" && pwd)
sb="$here/data/sb/storybook-static"; har="$here/data/har"
mkdir -p "$out"; out=$(cd "$out" && pwd)
sb_sha=$(cut -c1-64 "$here/data/sb/storybook.tar.sha256")
har_sha=$(cat "$har/chromium.har.zip" "$har/webkit.har.zip" | shasum -a 256 | cut -c1-64)
limit=""
[ "$cpus" != none ] && limit="--cpus=$cpus --memory=7g"
i=$first
while [ "$i" -le "$last" ]; do
  t0=$(date +%s)
  # shellcheck disable=SC2086
  $DOCKER run --rm --init --ipc=host --network=none --pull=never --platform linux/amd64 $limit \
    -e SB_SHA="$sb_sha" -e HAR_SHA="$har_sha" -e VC_WORKERS="$workers" -e VC_LIMIT="${VC_LIMIT:-100000}" -e VC_READY_TIMEOUT="${VC_READY_TIMEOUT:-10000}" -e VC_EXTRA_ARGS="${VC_EXTRA_ARGS:-}" -e VC_PASSES="$passes" \
    -v "$here/harness:/harness:ro" -v "$sb:/sb:ro" -v "$har:/har:ro" -v "$out:/out" \
    "$IMAGE" node /harness/capture.mjs /sb /har "/out/run-$i" "$i" /out/run-1 > "$out/run-$i.log" 2>&1
  code=$?
  echo "{\"run\":$i,\"exit\":$code,\"wallS\":$(( $(date +%s) - t0 )),\"workers\":$workers,\"cpus\":\"$cpus\"}" > "$out/run-$i.exit.json"
  echo "run $i exit $code in $(( $(date +%s) - t0 )) s"
  i=$((i + 1))
done
