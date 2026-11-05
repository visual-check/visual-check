#!/bin/bash
# Runs headless shell alone in the Playwright image, with Playwright's arguments, for a driver on the host.
#   chrome.sh <flags.json> pipe-stdio|ws [extra Chromium args...]
# pipe-stdio: the CDP pipe is the container's stdin (fd 3) and stdout (fd 4), for docker run -i.
set -euo pipefail
F=$1; M=$2; shift 2
mapfile -t A < <(node -e 'for (const a of JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))) console.log(a)' "$F")
EXE=$(ls -d /ms-playwright/chromium_headless_shell-*/chrome-headless-shell-*/chrome-headless-shell | head -1)
if [ "$M" = pipe-stdio ]; then
  exec "$EXE" "${A[@]}" --disable-skia-runtime-opts --user-data-dir=/tmp/u --remote-debugging-pipe "$@" about:blank 3<&0 4>&1 1>&2
fi
# FWD=1: forward 0.0.0.0:9223 to Chromium's 127.0.0.1:9222, for a published port on a bridge network
[ -n "${FWD:-}" ] && node /h/fwd.mjs 9223 9222 &
exec "$EXE" "${A[@]}" --disable-skia-runtime-opts --user-data-dir=/tmp/u --remote-debugging-port=9222 "$@" about:blank
