#!/bin/sh
# Usage: run.sh <platform> <image@digest> <runs> <outDir>
# Each run is a fresh container with no network; fixtures are served on its loopback.
set -eu
platform=$1; image=$2; runs=$3; out=$4
here=$(cd "$(dirname "$0")" && pwd)
mkdir -p "$out"
out=$(cd "$out" && pwd)
i=1
while [ "$i" -le "$runs" ]; do
  docker run --rm --init --ipc=host --network=none --pull=never --platform "$platform" \
    -v "$here:/harness:ro" -v "$out:/out" "$image" node /harness/capture.mjs "/out/run-$i"
  i=$((i + 1))
done
