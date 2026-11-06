#!/bin/bash
# PROTOTYPE, throwaway: (1) does the browser container go when visual-check is killed, (2) browser process exit
# handling: in-flight stories broken, one relaunch, a second exit exits 2.
#   checks.sh <base> <out dir>
set -uo pipefail
H=$(cd "$(dirname "$0")" && pwd); BASE=$1; OUT=$(mkdir -p "$2" && cd "$2" && pwd)
set -m  # background jobs get their own process group, so a group signal reaches docker run too, as Ctrl-C would
gone() { local n=$1 k=0; while [ -n "$(docker ps -aq -f name="^$n\$")" ]; do [ $k -ge 150 ] && return 1; sleep 0.2; k=$((k + 1)); done; echo $((k * 200)); }
kill_check() {
  local label=$1 sig=$2 target=$3; shift 3
  local name="vc-kill-$label" log="$OUT/kill-$label.log"
  node "$H/capture.ts" --base "$BASE" --out "$OUT/kill-$label" --name "$name" "$@" > "$log" 2>&1 &
  local pid=$!
  local k=0; until grep -q launched "$log" 2>/dev/null || [ $k -ge 300 ]; do sleep 0.2; k=$((k + 1)); done
  sleep 3
  local before; before=$(docker ps -q -f name="^$name-1\$" | wc -l | tr -d ' ')
  if [ "$target" = group ]; then kill -"$sig" -- -"$pid"; else kill -"$sig" "$pid"; fi
  local ms; if ms=$(gone "$name-1"); then echo "kill $label: SIG$sig to the $target, container running before: $before, gone after ${ms} ms"
  else echo "kill $label: SIG$sig to the $target, container running before: $before, STILL RUNNING after 30 s ($(docker ps --format '{{.Names}} {{.Status}}' -f name="^$name-1\$"))"; docker rm -f "$name-1" > /dev/null; fi
  wait "$pid" 2>/dev/null
  pkill -f "name $name" 2>/dev/null; true
}
echo "### container cleanup when visual-check is killed $(date +%T)"
kill_check raw-kill KILL process --driver raw
kill_check raw-term TERM process --driver raw
kill_check raw-int INT group --driver raw
kill_check wk-detached-kill KILL process --driver pw-webkit --pw-mode detached --port 3341
kill_check wk-detached-int INT group --driver pw-webkit --pw-mode detached --port 3342
kill_check wk-attached-kill KILL process --driver pw-webkit --pw-mode attached --port 3343
kill_check wk-attached-int INT group --driver pw-webkit --pw-mode attached --port 3344
echo "### browser exit $(date +%T)"
for a in raw pw-chromium pw-webkit; do
  node "$H/capture.ts" --driver "$a" --base "$BASE" --out "$OUT/exit-once-$a" --kill-browser-after 20 --skip vc-hazards--renderer-crash 2> "$OUT/exit-once-$a.err"; echo "exit once $a: exit code $?"
  grep -E 'killing|broken' "$OUT/exit-once-$a.err" | cut -c1-200
  node "$H/capture.ts" --driver "$a" --base "$BASE" --out "$OUT/exit-twice-$a" --kill-browser-after 20,50 --skip vc-hazards--renderer-crash 2> "$OUT/exit-twice-$a.err"; echo "exit twice $a: exit code $?"
  grep -E 'killing|broken' "$OUT/exit-twice-$a.err" | cut -c1-200
done
docker ps -a -f name=vc- --format 'left over: {{.Names}} {{.Status}}'
