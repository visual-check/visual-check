#!/bin/sh
# Usage: run.sh <platform> <image@digest> <runs> <storybookDir> <harDir> <outDir> [--mutate]
# Each run is a fresh container with no network; Storybook is served on its loopback, external responses come from the HAR.
set -eu
platform=$1; image=$2; runs=$3; sb=$(cd "$4" && pwd); har=$(cd "$5" && pwd); out=$6; mutate=${7:-}
here=$(cd "$(dirname "$0")" && pwd)
mkdir -p "$out"
out=$(cd "$out" && pwd)
hash() { if command -v sha256sum >/dev/null; then sha256sum "$@"; else shasum -a 256 "$@"; fi | cut -c1-64; }
sb_sha=$(cat "$sb/../storybook.tar.sha256" | cut -c1-64)
har_sha=$(cat "$har/chromium.har.zip" "$har/webkit.har.zip" | hash)
i=1
while [ "$i" -le "$runs" ]; do
  extra=""
  [ "$i" -eq 1 ] && [ "$mutate" = "--mutate" ] && extra="--mutate"
  docker run --rm --init --ipc=host --network=none --pull=never --platform "$platform" \
    -e SCALE="${SCALE:-1}" -e SB_SHA="$sb_sha" -e HAR_SHA="$har_sha" \
    -v "$here:/harness:ro" -v "$sb:/sb:ro" -v "$har:/har:ro" -v "$out:/out" \
    "$image" node /harness/capture.mjs /sb /har "/out/run-$i" "$i" /out/run-1 $extra
  i=$((i + 1))
done
