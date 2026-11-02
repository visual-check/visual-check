# Render determinism and Docker

Research for [#7](https://github.com/visual-check/visual-check/issues/7), part of map [#1](https://github.com/visual-check/visual-check/issues/1). Read 2026-11-02.

Evidence tags:

- **[D]** documented: official docs or source code
- **[M]** measured here, on this run's machine
- **[A]** anecdotal: issue threads and PRs, unreproduced
- **[I]** my inference

## Answer

Docker fixes OS, fonts and library drift, but only if every machine uses the same image **and the same CPU architecture**.

Treat a Linux arm64 container on Apple Silicon and an amd64 container in CI as **not pixel-matching**. A Playwright maintainer calls differences expected because the images hold different binaries (an issue comment, not docs). Larger suites report failures at zero tolerance, while small pages sometimes match [A]. This run could not measure arm64, because the arm64 image isn't local and pulling it wasn't approved.

Recommended direction, for the tickets this blocks to decide:

- Key every **baseline** to an image digest and an explicit `--platform`, and always pass that platform rather than taking the host default.
- Default to `linux/amd64`, with `linux/arm64` as a config option.
- Run only the browser in the container and drive it from the host with Playwright's `run-server`, `connect` and `exposeNetwork: '<loopback>'`.

Cost measured on one simple page, with amd64 under Rosetta: about 1.7 s extra once per run and about 15% per capture [M].

## What makes renders differ

| Factor | Finding | Evidence |
|---|---|---|
| General | Rendering varies with "host OS, version, settings, hardware, power source", headless mode and more. Advice: use the environment that generated the baselines. | [D] [Playwright snapshots](https://playwright.dev/docs/test-snapshots) |
| OS | Playwright's default snapshot names include browser and platform because rendering and fonts differ. Pixel output depends on the graphics stack, the text renderer and OS settings. | [D] [Playwright source doc](https://github.com/microsoft/playwright/blob/main/docs/src/test-snapshots-js.md), [Chromium's writing_web_tests.md](https://github.com/chromium/chromium/blob/main/docs/testing/writing_web_tests.md) |
| macOS vs Linux | Same Chromium build: 3.11% of pixels differ on a mixed page, 1.66% on text with **identical font bytes**. Channel deltas reach 238 of 255. Font flags don't close the gap (1.14% at best on text). | [M] |
| Anti-aliasing | On a web-font page, Linux text has LCD colour fringes (9,543 coloured pixels) and macOS is greyscale (0). `--disable-lcd-text` removes the fringes on Linux. On macOS, the flags changed nothing on the mixed page. | [M] |
| Hinting | `--font-render-hinting` is a headless switch with default `full`, and it also controls glyph subpixel positioning. Setting `none` changed 1.63% of pixels on the web-font page and 0 on the mixed page. I did not establish why. | [D] [switches.h](https://github.com/chromium/chromium/blob/main/headless/public/switches.h), [M] |
| Fonts | The image's fontconfig resolves `sans-serif`, `system-ui` and unknown families such as `Inter` to **WenQuanYi Zen Hei**, and `Arial` to Liberation Sans (`fc-match`). A story without bundled fonts will look different in the container, though consistently so. | [M] |
| GPU | Not a factor in headless shell here: macOS and the container both report `rasterization: disabled_software` and a SwiftShader device. Backends differ (LLVM on macOS, Subzero on amd64), so WebGL may not match. WebGL pixels and headed or new-headless modes weren't tested. | [M] |
| Colour | Playwright already passes `--force-color-profile=srgb` and `--enable-unsafe-swiftshader`. It passes no LCD or hinting flags. | [D] [chromiumSwitches.ts](https://github.com/microsoft/playwright/blob/main/packages/playwright-core/src/server/chromium/chromiumSwitches.ts) |
| CPU architecture | See the next section. | |
| Same-platform noise | A maintainer cites crbug 919955 for non-determinism within one platform, in anti-aliasing. I could not read that bug. My fixture showed none: 3 of 3 fresh containers and over 160 session captures were identical. It has no animation, canvas or hover. | [A], [M] |

Page state also matters: animations and the caret. `animations: 'disabled'` fast-forwards finite animations and cancels infinite ones, and `caret` defaults to `hide` [D] ([params.md](https://github.com/microsoft/playwright/blob/main/docs/src/api/params.md)).

## arm64 vs amd64 pixel parity

### Documented

- The image is multi-arch: `v1.64.1-noble` has `linux/amd64` (990 MB compressed) and `linux/arm64` (964 MB) manifests. [Playwright's Docker page](https://playwright.dev/docs/docker) doesn't state the architectures or promise parity; I read this from the registry manifest.
- Both architectures now use Chrome for Testing builds. At [v1.51.1](https://github.com/microsoft/playwright/blob/v1.51.1/packages/playwright-core/src/server/registry/index.ts) they were Playwright's own builds. At [v1.64.1](https://github.com/microsoft/playwright/blob/v1.64.1/packages/playwright-core/src/server/registry/index.ts) both use `cftUrl(...)`. **Most of the reports below predate this**, so they may not predict current behaviour [I].
- Both architectures get the same font packages: `ubuntu24.04-arm64` copies the x64 dependency lists in [nativeDeps.ts](https://github.com/microsoft/playwright/blob/main/packages/playwright-core/src/server/registry/nativeDeps.ts).
- Skia's float pipeline differs by CPU. In [SkRasterPipeline_opts.h](https://github.com/google/skia/blob/main/src/opts/SkRasterPipeline_opts.h), `mad` is fused on arm64 (`vfmaq_f32`) and on AVX2 (`_mm256_fmadd_ps`), but plain `a+f*m` in the SSE baseline. x86 picks its path at runtime ([SkOpts.cpp](https://github.com/google/skia/blob/main/src/core/SkOpts.cpp), [SkCpu.h](https://github.com/google/skia/blob/main/src/core/SkCpu.h)). This is a plausible cause of the shadow and backdrop reports below, but I didn't trace it to pixels [I].
- Chromium doesn't assume parity on Mac: its web test harness has separate `mac-*-arm64` baseline paths ([mac.py](https://github.com/chromium/chromium/blob/main/third_party/blink/tools/blinkpy/web_tests/port/mac.py)). Its [Linux port](https://github.com/chromium/chromium/blob/main/third_party/blink/tools/blinkpy/web_tests/port/linux.py) only sets `x86_64`.
- `--disable-skia-runtime-opts` exists for "forcing a baseline code path for e.g. web tests" ([content_switches.cc](https://github.com/chromium/chromium/blob/main/content/public/common/content_switches.cc)).
- Playwright's default snapshot name carries browser and platform (`chromium-darwin`) but no architecture ([test-snapshots-js.md](https://github.com/microsoft/playwright/blob/main/docs/src/test-snapshots-js.md)), so arm64 and amd64 Linux baselines would share a name [I].

### Maintainers (authoritative, but comments rather than docs)

From [playwright#13873](https://github.com/microsoft/playwright/issues/13873), closed `not_planned` on 2026-05-12:

- [dgozman, 2022](https://github.com/microsoft/playwright/issues/13873#issuecomment-1116126196) says arm and intel images producing different output is expected, because "they have different libraries/executables inside".
- [aslushnikov, 2022](https://github.com/microsoft/playwright/issues/13873#issuecomment-1264037198) concludes Docker guarantees structural identity (layout and fonts) but not pixel-perfect output, and that anti-aliasing differences are worse across architectures.

### Anecdotal

| Source | Setup | Result |
|---|---|---|
| [elastic-charts, 2022](https://github.com/microsoft/playwright/issues/13873#issuecomment-1252640479) | ~1,100 snapshots, arm64 vs amd64, zero threshold | About 10% failed, diffs 0.01% to over 5%. Team moved baseline updates to CI. |
| [markov00, 2025](https://github.com/microsoft/playwright/issues/13873#issuecomment-2805017176) | Same repo, v1.51.1, ~1,500 tests, zero threshold, experimental comparator | About 50% passed. Reliable failures: canvas text, HTML text, CSS shadows. |
| [dtokarczyk, 2025](https://github.com/microsoft/playwright/issues/13873#issuecomment-2796020342) | Mixed Mac and Linux team in Docker | Diffs persisted; moved to CI update mode. |
| [design-system-starter #40](https://github.com/scookeco/design-system-starter/pull/40) | v1.63, stories | 43 of 127 sampled differ on arm64, on backdrops and shadows. Rosetta amd64 reported byte-identical to CI. |
| gselsidi, 2025 ([setup](https://github.com/microsoft/playwright/issues/13873#issuecomment-2796121483), [detail](https://github.com/microsoft/playwright/issues/13873#issuecomment-2797687119)) | v1.49.1, M1 baselines, Jenkins Linux (CI architecture not stated) | **Passes at zero threshold** with text and images. |
| [house-template-nextjs #5](https://github.com/olaheavy-dev/house-template-nextjs/pull/5) | Starter template, arm64 vs emulated amd64 | **Pixel-identical.** |
| [pragmatic-papers #980](https://github.com/digitalgroundgame/pragmatic-papers/issues/980) | x86 WSL2 vs x86 CI, same image, zero tolerance | 13 of 13 identical. Supports same-architecture parity only. |

The pattern is that small or simple pages can match, while shadows, backdrops, canvas and dense text often don't [I].

**Do not cite the [playwright-docker-arch-matrix](https://github.com/nickofthyme/playwright-docker-arch-matrix) results as parity evidence.** The [summary comment](https://github.com/microsoft/playwright/issues/13873#issuecomment-2816905158) reports 72 of 72 passing across x64 and arm64 runners, but that run didn't compare across architectures:

- Its CI jobs set `RUNNER`, which [switches the path template](https://github.com/nickofthyme/playwright-docker-arch-matrix/blob/main/e2e/constants.ts) to `e2e/runner-screenshots/docker/<runner>/`, and that tree holds 36 images per runner.
- The PR baselines live in `e2e/screenshots/`, so each runner compared against its own stored images. Failure messages in the decoded reports for PRs 4 and 6 show those paths.
- The Mac rows have the same flaw: native and Docker reports fail the same tests with the same counts.

The author's conclusion (same OS and same architecture) may still be right, but this table doesn't show it.

### Measured here

Nothing on arm64 Linux. Under OrbStack with Rosetta, `/proc/cpuinfo` lists `fma` and SSE up to 4.2 but **no `avx2`**. Skia's `ML3` level requires AVX2, so emulated amd64 can't take the AVX2 path that AVX2-capable CI hardware would [D + M + I]. That is a possible gap between emulated amd64 and real amd64, despite the byte-identical reports above. `--disable-skia-runtime-opts` changed 0 pixels under Rosetta, which fits; it could force real amd64 onto the same path, but that is untested.

## Which architecture to pin

| Option | For | Against |
|---|---|---|
| **`linux/amd64` everywhere** | Default GitHub runners and x86 developers run it natively. The reports of byte-identical results across machines mostly use it [A]. Warm capture cost under Rosetta is low [M]. | Depends on Rosetta on Macs. Apple says [macOS 27 is the final release to support Rosetta](https://developer.apple.com/news/?id=w5ngl9k2) for Intel apps; the page doesn't mention Linux VMs, so this is an open risk. [Docker VMM has no Rosetta](https://docs.docker.com/desktop/features/vmm/). Docker's 2022 docs called emulation "best effort" ([quoted here](https://github.com/microsoft/playwright/issues/13873#issuecomment-1252640479)). |
| `linux/arm64` everywhere | Native on Macs and on [`ubuntu-24.04-arm`](https://github.blog/changelog/2026-01-29-arm64-standard-runners-are-now-available-in-private-repositories/), with no Rosetta dependency. | Users must change CI. Private repo arm64 runners have 2 vCPUs (public: 4). x86 developers emulate. |
| Baselines per architecture | No emulation. Chromium does this on Mac. | Every approved change needs two sets of baselines. Poor fit for "extremely easy". |
| Baselines written only in CI | Used by elastic-charts at 0 px. | Slow update loop, and no local check against committed baselines. |
| Tolerance across architectures | Simple. | Maintainer says values large enough would make tests less useful. See [#8](https://github.com/visual-check/visual-check/issues/8). |

## Driving a containerised browser from the host

| Approach | Notes |
|---|---|
| **`run-server` + `browserType.connect`** | [D] Documented for this exact case. Major and minor versions must match. The Playwright package isn't in the image, so the documented `npx -y playwright@x run-server` fetches it at start; a derived image avoids that [I]. |
| CDP via `connectOverCDP` | [D] "Significantly lower fidelity". [M] `--remote-debugging-address=0.0.0.0` did not expose the port in this headless shell (empty reply), so I needed a forwarder inside the container. |
| Whole CLI inside the container | [I] A bind-mounted `node_modules` holds host-native binaries, so this needs a separate install. Not attractive for setup. |

Capture engine choice belongs to [#4](https://github.com/visual-check/visual-check/issues/4).

Container flags, from [Playwright's Docker docs](https://playwright.dev/docs/docker) [D]:

- `--ipc=host` for Chromium, to avoid memory crashes.
- `--init`, to avoid zombie processes.
- The default root user disables the Chromium sandbox. That is acceptable for trusted local code, and the image isn't recommended for untrusted sites.

## Reaching a local Storybook from a container

Constraints [D]:

- Storybook binds `127.0.0.1` by default, and [calls `0.0.0.0` insecure](https://storybook.js.org/docs/api/cli-options).
- [Vite](https://vite.dev/config/server-options) allows only `localhost`, `.localhost` and IP addresses by default, so `host.docker.internal` is blocked unless allowlisted. Vite warns against `allowedHosts: true`.
- With `--host 0.0.0.0` and no allowlist, [Storybook's Vite builder sets `allowedHosts = true` itself](https://github.com/storybookjs/storybook/blob/next/code/builders/builder-vite/src/vite-server.ts).

| Route | Works how | Caveat |
|---|---|---|
| **`exposeNetwork: '<loopback>'`** | [D] [Exposes the client's network](https://playwright.dev/docs/api/class-browsertype) to the browser, so the page can use `localhost:6006`. Needs no Storybook or Vite config change [I]. | Not tested here. Tunnelling cost per asset is unmeasured. |
| `host.docker.internal` | [D] [Docker Desktop](https://docs.docker.com/desktop/features/networking/networking-how-tos/). [M] On OrbStack it reached a `127.0.0.1`-bound server. | Hits Vite's host check. |
| `--add-host=hostmachine:host-gateway` | [D] Playwright's documented route. [M] Same result on OrbStack. | Same host check. On native Linux, a loopback-bound server probably isn't reachable [I]. |
| `--network host` | [D] Linux native. [Docker Desktop needs 4.34+, sign-in and a manual toggle](https://docs.docker.com/engine/network/drivers/host/). [M] The flag ran on OrbStack; I didn't test reaching a server this way. | Not a zero-config default on Docker Desktop. |
| Mount `storybook-static`, serve inside | No host networking [I]. | No live dev server. Good CI fit. Not tested. |

## Image choice

- **Use `mcr.microsoft.com/playwright:vX.Y.Z-noble`, pinned by digest** [D for version pinning; digest is my addition]. The docs warn that a version mismatch means browsers aren't found. Tags without an OS suffix currently mean noble.
- **Avoid Alpine and other musl distros**: unsupported [D].
- **Size** [M]: 3.59 GB on disk, about 1 GB to pull. `docker history` shows Chromium 713 MB, Firefox 325 MB, WebKit 307 MB, and an 821 MB layer I read as system dependencies. A Chromium-only derived image could save about 630 MB, before dependency savings, and could bake in the Playwright package [I].
- **Headless shell vs new headless**: [Chrome's docs](https://developer.chrome.com/blog/chrome-headless-shell) suit the shell to screenshots and lightweight use, and call new headless more authentic. [Playwright](https://playwright.dev/docs/browsers) says they differ, so mode must be part of the render environment [I].
- **Safari**: the image's WebKit is `minibrowser-gtk` and `minibrowser-wpe` [M], so Linux container output isn't Safari on macOS [I]. This is relevant to the browser goal in [#1](https://github.com/visual-check/visual-check/issues/1).

## Startup and capture speed

Measured on 12-core Apple Silicon, OrbStack 2.2.4, amd64 under Rosetta. Chromium headless shell 1248, one small fixture, serial captures of 40 per run. These are floors: a real story loads much more.

| Scenario | Result |
|---|---|
| `docker run --rm image true` | 165 ms median |
| One-shot capture, native macOS | 342 ms median |
| One-shot capture, fresh container | 2,033 ms median |
| Session, native macOS | 58.5 ms per capture (3.5 ms navigate, 55 ms capture) |
| Session, driver inside container | 67 ms per capture (9 ms, 58 ms) |
| Session, driver on host via published port | 100 ms per capture (44 ms, 56 ms) |

Reading these:

- Cold start is about 1.7 s per run, not per story, if the browser stays up.
- Warm capture is about 15% slower than native. Rosetta is in that number, so native arm64 may differ.
- The host-driven row has an extra Node forwarder in the path and isn't Playwright's `run-server`. A constant ~35 ms on navigation but none on the larger capture looks like a TCP delay in this rig, not throughput [I]. Don't treat it as the real cost.
- All Linux session captures produced one hash whichever side drove them, so the control path doesn't change pixels [M].

Not measured: image pull time in CI, concurrency (the map's 10 local and 5 CI), Docker Desktop, real Storybook pages. One third-party action [claims 2 to 3 times faster than `playwright install --with-deps`](https://github.com/dtinth/setup-playwright-test-docker) using the pre-built image [A].

## What remains unproven

1. **Native arm64 vs real amd64 on current Playwright (Chrome for Testing builds).** The arm64 image was not pulled (964 MB compressed) because no one approved that download.
2. **Rosetta amd64 vs real amd64 CI**, given the missing AVX2. Only anecdotes say it matches. This decides whether the recommended default holds, so it should be tested before the default is locked.
3. Whether `--disable-skia-runtime-opts` on real amd64 helps or matters.
4. Whether Rosetta for Linux VMs outlasts macOS 27.
5. `exposeNetwork` against a real Storybook, including its origin checks and HMR, plus its speed.
6. Firefox and WebKit parity. The only multi-browser data is the invalid matrix.
7. Docker Desktop behaviour. One [report](https://github.com/microsoft/playwright/issues/13873#issuecomment-4353246704) says a recent update changed in-container font rendering [A].

Experiment to settle 1 to 3: run the fixtures described under Method in the arm64 image on a Mac, the amd64 image under Rosetta, and the amd64 image on `ubuntu-24.04`, then compare exact pixels. Repeat with real shadow-heavy stories. Pull the arm64 image by digest so the local tag isn't retagged:

```sh
docker pull mcr.microsoft.com/playwright:v1.64.1-noble@sha256:f609973e8fd93f38a5ddfd706a65805294247dae8d81b2541c0afe2787746197
```

## Method

Tools: Chromium headless shell 1248 (Chrome for Testing 156.0.8078.4) from `v1.64.1-noble` under `--platform linux/amd64`, and Playwright's macOS arm64 build of the same revision. Flags: `--hide-scrollbars --window-size=1000,760 --force-color-profile=srgb --enable-unsafe-swiftshader`, plus `--no-sandbox` in the container. Comparison: exact per-channel difference on decoded PNGs, with no tolerance.

Fixtures:

- **Mixed page**: system-font text in four families, box shadows, linear, radial and conic gradients, `backdrop-filter`, a rotated element, `filter: blur` with `drop-shadow`, and SVG strokes and text.
- **Web-font page**: Liberation Sans from the image loaded via `@font-face`, at three sizes plus rotated text.

| Comparison | Differing pixels | % |
|---|---|---|
| Fresh Linux containers, 3 runs | 0 | 0 |
| macOS, 3 runs | 0 | 0 |
| Linux, `--disable-skia-runtime-opts` | 0 | 0 |
| Linux mixed, `--disable-lcd-text` | 0 | 0 |
| Linux mixed, `--font-render-hinting=none` | 0 | 0 |
| Linux mixed, those plus `--disable-font-subpixel-positioning` | 5,401 | 0.71 |
| Linux web-font, `--disable-lcd-text` | 9,628 | 1.27 |
| Linux web-font, `--font-render-hinting=none` | 12,409 | 1.63 |
| macOS mixed, `--disable-lcd-text` | 0 | 0 |
| macOS mixed, hinting, LCD and subpixel flags together | 0 | 0 |
| macOS vs Linux, mixed | 23,663 | 3.11 |
| macOS vs Linux, mixed, all flags | 24,769 | 3.26 |
| macOS vs Linux, web-font | 12,613 | 1.66 |
| macOS vs Linux, web-font, all flags | 8,678 | 1.14 |
