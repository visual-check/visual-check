#!/usr/bin/env bash
# Usage: run.sh <outDir> [baseUrl]
# Captures a public Storybook once over the network, serves that recording from a local server for every later pass,
# then times visual diffs on the snapshots.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
out=$1; origin=${2:-https://react.carbondesignsystem.com}
mkdir -p "$out"
out=$(cd "$out" && pwd)
snaps=$out/snaps
curl -fsSL "$origin/index.json" -o "$out/index.json"
node "$here/capture.mjs" --base "$origin" --index "$out/index.json" --stories 150 --cache "$out/cache" --record --workers 2 --out "$snaps/warm" | tee -a "$out/capture.jsonl"
node "$here/serve-cache.mjs" "$out/cache" "$origin" 6402 > "$out/serve.log" 2>&1 &
server=$!; trap 'kill $server' EXIT
sleep 2
cap() { node "$here/capture.mjs" --base http://127.0.0.1:6402 --index "$out/index.json" --stories 150 "$@" | tee -a "$out/capture.jsonl"; }
cap --workers 2 --out "$snaps/a" --again "$snaps/a-again"
cap --workers 2 --out "$snaps/b"
cap --workers 1 --out "$snaps/c"
for m in text shift hue; do cap --workers 2 --mutate "$m" --out "$snaps/m-$m"; done

node "$here/bench.mjs" --out "$out/bench.json" --reps 5 \
  replay="$snaps/warm:$snaps/a" repeat="$snaps/a:$snaps/b" workers="$snaps/a:$snaps/c" again="$snaps/a:$snaps/a-again" \
  text="$snaps/a:$snaps/m-text" shift="$snaps/a:$snaps/m-shift" hue="$snaps/a:$snaps/m-hue"

for rep in 1 2 3; do
  for set in repeat shift; do
    b=$snaps/b; [ "$set" = shift ] && b=$snaps/m-shift
    for decoder in pngjs sharp; do for diff in pm bd; do for skip in 1 0; do for workers in 1 2; do
      node "$here/pool.mjs" --a "$snaps/a" --b "$b" --decoder $decoder --diff $diff --skip $skip --workers $workers --label $set --out "$out/pool.jsonl" > /dev/null
    done; done; done; done
  done
done

node "$here/summarize.mjs" "$out/bench.json" "$out/pool.jsonl" > "$out/summary.md"
{
  echo; echo '### Install size (KB on disk)'; echo
  for d in pixelmatch @blazediff/core pngjs sharp @img; do echo "- $d: $(du -sk "$here/node_modules/$d" | cut -f1)"; done
  echo "- nproc: $(nproc 2>/dev/null || sysctl -n hw.ncpu); cpu: $(grep -m1 'model name' /proc/cpuinfo 2>/dev/null | cut -d: -f2 || sysctl -n machdep.cpu.brand_string)"
  echo "- requests missing from the recording: $(grep -c '^404' "$out/serve.log" || true)"
} >> "$out/summary.md"
cat "$out/summary.md"
