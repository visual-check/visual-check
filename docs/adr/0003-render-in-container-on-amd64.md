# The browser renders in a container on linux/amd64 by default

Baselines are written only locally and checked in CI, so both must render on the same platform. A macOS host differs from a Linux container by 1.66–3.11% even on text with identical fonts ([Render determinism and Docker](https://github.com/visual-check/visual-check/issues/7)), which no threshold absorbs. So by default the browser runs in visual-check's own image (ADR 0008), locally and in CI, forced to `linux/amd64`. [Render parity on real stories](https://github.com/visual-check/visual-check/issues/23) found that Rosetta then matches a real amd64 runner, as [GitHub Action design](https://github.com/visual-check/visual-check/issues/40) found again with visual-check's image, and a tolerance can stay tight. `linux/arm64` with a threshold of 0.01 and a 20 px budget avoids emulation but catches fewer small changes. Running on the host gives no parity across machines.

## Consequences

- The platform is one committed setting shared by local runs and CI, with no CLI flag, because a mismatch makes every story a visual diff. `host` is an opt-in for the whole project, never a fallback: with a container platform and no working Docker, a run exits 2.
- On Apple Silicon, amd64 runs under emulation. It needs Rosetta in the Docker VM, and Apple hasn't said whether Linux VMs keep Rosetta after macOS 27. arm64 CI runners emulate too.
- Chromium always launches with `--disable-skia-runtime-opts`, with no option. Without it, Rosetta differs from runners on gradients, and it must be on for baselines and snapshots alike.
- Changing the default later changes every user's baselines.
