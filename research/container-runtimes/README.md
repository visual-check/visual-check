# Container runtimes and cost

Harness for https://github.com/visual-check/visual-check/issues/26. It reuses the Render parity on real stories harness
(HeroUI build `cc5fb67a`, HAR replay, no network) with workers, passes, story count, readiness timeout and extra
Chromium args from the environment, crash recovery and anonymous memory sampling.

- `run.sh`: one fresh `linux/amd64` container per run. `DOCKER` picks the daemon (for example `docker --context desktop-linux`).
- `cold.mjs`: cold start from the host: image inspect, pull of the local tag, `run-server`, connect, first screenshot.
- `stoptest.mjs`: `docker stop` after a client session.
- `harness/probe.mjs`: which Chromium args start under QEMU.
- `compare/rt.mjs`, `compare/flake.py`: parity against the runner snapshots, raster against late content.
- `findings.md`: each runtime's documented emulation, Rosetta default, VM resources and file sharing.

The scratch copy was lost to a temp-directory wipe before pushing. These files were rebuilt from the same edits and
syntax-checked, but not rerun after the rebuild. The local snapshots weren't kept.
