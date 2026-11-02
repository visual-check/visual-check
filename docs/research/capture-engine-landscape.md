# Capture engine landscape

Research for [#4](https://github.com/visual-check/visual-check/issues/4), feeding [#10 Capture benchmark](https://github.com/visual-check/visual-check/issues/10) and [#11 Capture engine and host Playwright reuse](https://github.com/visual-check/visual-check/issues/11). Checked 2026-11-02. Nothing here was measured: speed statements come from reading source and docs, and are hypotheses for #10.

## Answer

- **Lead candidate: Playwright.** It is the only engine that covers Chromium, Firefox and WebKit, has a multi-arch Docker image with all three, and is likely already installed in host projects.
- **Fastest path to test: raw CDP on `chrome-headless-shell`.** Playwright's Chromium is an unmodified Chrome for Testing download, so a thin CDP hot path can run on the same binary.
- **Why Puppeteer is slow is visible in its source.** `page.screenshot()` holds a browser-wide mutex, so one browser takes one snapshot at a time however many pages are open.
- **Technique probably matters more than driver.** All the Chromium drivers end in the same `Page.captureScreenshot` call, so the differences are in what surrounds it: navigating vs switching stories, isolation scope, PNG encoder, per-capture overhead and concurrency model.
- **Playwright WebKit is not Safari.** It is a patched upstream WebKit, and on Linux it is a different port with a different graphics stack. Real Safari means `safaridriver`: macOS only, one session at a time, no documented headless mode.

## Current versions

| Thing | Version | Source |
|---|---|---|
| Playwright | 1.64.1 (Chromium 156.0.8078.4, Firefox 157.0, WebKit 27.2) | [`browsers.json`](https://github.com/microsoft/playwright/blob/v1.64.1/packages/playwright-core/browsers.json) |
| Puppeteer | 25.16.0 (Chrome for Testing 156.0.8078.47, Firefox 158.0.1) | [supported browsers](https://pptr.dev/supported-browsers) |
| Selenium / WebdriverIO | `selenium-webdriver` 4.52.0, `webdriverio` 10.1.0 | npm registry |
| Safari on GitHub macOS runners | Safari and SafariDriver 27.2 | [runner image](https://github.com/actions/runner-images/blob/main/images/macos/macos-15-arm64-Readme.md) |
| Storybook | 10.6.5 | [releases](https://github.com/storybookjs/storybook/releases) |

## Engine comparison

| | Playwright | Puppeteer | Raw CDP client | `safaridriver` (WebDriver) |
|---|---|---|---|---|
| **Chromium** | Yes, headless shell by default | Yes, new headless by default | Yes, Chromium only | No |
| **Firefox** | Patched build (Juggler), or stock via `moz-*` channels (BiDi) | Stock, BiDi by default | No | No |
| **WebKit / Safari** | Patched WebKit, never Safari | No | No | Real Safari |
| **Capture concurrency** | Queue per page | Mutex per browser | Whatever we build | One session per machine |
| **PNG fast encoder** | Not exposed by `page.screenshot` | `optimizeForSpeed` option, off by default | Yes | No |
| **Transport default** | Pipe (Chromium, WebKit) | WebSocket, `pipe: true` opt-in | Pipe possible | HTTP per command |
| **Official Docker image** | amd64 and arm64, all three engines | amd64 only, Chrome for Testing | None needed: reuse a browser image | Impossible: macOS only |
| **Reuse from host project** | Yes, with caveats below | Rarely installed | Can launch a host-installed binary | Ships with macOS |

### Playwright

- Three engines through [one API](https://github.com/microsoft/playwright/blob/v1.64.1/README.md).
- [Each version needs specific browser binaries](https://playwright.dev/docs/browsers), so the browser revision moves with the npm version.
- Headless Chromium [defaults to the separate headless shell](https://playwright.dev/docs/browsers); `channel: 'chromium'` selects new headless, and `--only-shell` skips the full download.
- Chromium and headless shell are [downloaded from Chrome for Testing URLs](https://github.com/microsoft/playwright/blob/v1.64.1/packages/playwright-core/src/server/registry/index.ts), not a Playwright-patched build. The [`browser_patches`](https://github.com/microsoft/playwright/tree/v1.64.1/browser_patches) directory only holds Firefox and WebKit patches.
- Screenshots are [queued per page](https://github.com/microsoft/playwright/blob/v1.64.1/packages/playwright-core/src/server/screenshotter.ts) with [one `Screenshotter` per `Page`](https://github.com/microsoft/playwright/blob/v1.64.1/packages/playwright-core/src/server/page.ts#L215), so pages capture in parallel at the driver level.

**Per-capture overhead on the Chromium path**, all in [`screenshotter.ts`](https://github.com/microsoft/playwright/blob/v1.64.1/packages/playwright-core/src/server/screenshotter.ts) and [`crPage.ts`](https://github.com/microsoft/playwright/blob/v1.64.1/packages/playwright-core/src/server/chromium/crPage.ts#L296):

- An in-page script runs in all frames, walking the DOM for shadow roots. It returns early only if there is no `style`, the caret is not hidden and animations are allowed. [`caret` defaults to `hide`](https://github.com/microsoft/playwright/blob/v1.64.1/docs/src/api/params.md), so the walk happens by default.
- It awaits `document.fonts.ready`, unless the `PW_TEST_SCREENSHOT_NO_FONTS_READY` env var is set.
- `Page.getLayoutMetrics` is an extra round trip.
- The final `Page.captureScreenshot` sends `format`, `quality`, `clip` and `captureBeyondViewport: !fitsViewport`. **It never sends `optimizeForSpeed`,** so it always gets Chromium's slower PNG encoder.

**Bypass:** [`browserContext.newCDPSession(page)`](https://github.com/microsoft/playwright/blob/v1.64.1/docs/src/api/class-browsercontext.md) (Chromium only) can call `Page.captureScreenshot` directly, keeping Playwright's lifecycle while skipping the overhead. The skipped steps then become ours to do: animations, caret and font waits matter for determinism, see [#7](https://github.com/visual-check/visual-check/issues/7).

Playwright also launches Chromium with [`--enable-features=CDPScreenshotNewSurface`](https://github.com/microsoft/playwright/blob/v1.64.1/packages/playwright-core/src/server/chromium/chromiumSwitches.ts), which is [off by default in Chromium](https://github.com/chromium/chromium/blob/main/content/common/features.cc) and described there as avoiding a possible stall from frames not being presented. A raw CDP client should copy it, along with `--force-color-profile=srgb`, `--disable-renderer-backgrounding` and the [other switches](https://github.com/microsoft/playwright/blob/v1.64.1/packages/playwright-core/src/server/chromium/chromiumSwitches.ts).

### Puppeteer

- **The slowness has a visible cause.** [`Page.screenshot` is `@guarded` on `this.browser()`](https://github.com/puppeteer/puppeteer/blob/puppeteer-v25.16.0/packages/puppeteer-core/src/api/Page.ts#L2914-L2920), and [`guarded`](https://github.com/puppeteer/puppeteer/blob/puppeteer-v25.16.0/packages/puppeteer-core/src/util/decorators.ts#L121-L142) takes a mutex keyed on that object. All captures in one browser are therefore serial, across pages and contexts.
- The usual workaround is one browser per worker. [Storycap](https://github.com/reg-viz/storycap), which is built on Puppeteer, has `--parallel` defined as "Number of browsers to screenshot", default 4. More browsers should mean more memory and cold start; #10 should measure this.
- The mutex is client-side, so [`page.createCDPSession()`](https://github.com/puppeteer/puppeteer/blob/puppeteer-v25.16.0/packages/puppeteer-core/src/api/Page.ts#L1052) should bypass it on Chromium. Untested.
- [`optimizeForSpeed` is exposed but off by default](https://github.com/puppeteer/puppeteer/blob/puppeteer-v25.16.0/packages/puppeteer-core/src/api/Page.ts#L721-L727). `captureBeyondViewport` defaults to `true`, but is [forced to `false` for plain viewport shots](https://github.com/puppeteer/puppeteer/blob/puppeteer-v25.16.0/packages/puppeteer-core/src/api/Page.ts#L3009).
- [New headless is the default](https://pptr.dev/guides/headless-modes); `headless: 'shell'` selects the headless shell.
- [WebSocket is the default transport](https://github.com/puppeteer/puppeteer/blob/puppeteer-v25.16.0/packages/puppeteer-core/src/node/LaunchOptions.ts), `pipe: true` opts in, Chrome only.
- [Firefox uses BiDi by default](https://pptr.dev/webdriver-bidi), which has only partial screenshot parameters and no screencast. It targets [stock Firefox stable](https://pptr.dev/supported-browsers). No WebKit.
- [`setViewport` can require a reload](https://github.com/puppeteer/puppeteer/blob/puppeteer-v25.16.0/packages/puppeteer-core/src/cdp/EmulationManager.ts#L282-L283) when `isMobile` or `hasTouch` changes, which matters for viewport matrices.

### Raw CDP on `chrome-headless-shell`

The upper bound for Chromium. No third-party driver, and every parameter is reachable.

- **Binary:** `chrome-headless-shell` is [published for every Chrome release](https://developer.chrome.com/blog/chrome-headless-shell) through Chrome for Testing, [including `linux-arm64`](https://googlechromelabs.github.io/chrome-for-testing/last-known-good-versions-with-downloads.json) as of 156.
- **Transport:** `--remote-debugging-pipe` is what [Playwright](https://github.com/microsoft/playwright/blob/v1.64.1/packages/playwright-core/src/server/pipeTransport.ts) and Puppeteer use for pipes. [`chrome-remote-interface`](https://github.com/cyrus-and/chrome-remote-interface) documents WebSocket connections only, so a pipe needs a small custom client.
- **Cost:** we own launch, flags, readiness, emulation, crash handling and protocol drift, and it does nothing for Firefox or WebKit. It only makes sense as the Chromium hot path behind an engine seam.
- **Native clients** (`chromiumoxide`, `chromedp`, Rod) were not reviewed. They would speak the same protocol to the same browser, so they only matter if #10 shows the Node side is the bottleneck.

### WebDriver and others

- **Selenium / WebdriverIO:** classic WebDriver is [a REST API with an HTTP request per command](https://developer.apple.com/documentation/webkit/about-webdriver-for-safari). For Chromium and Firefox it adds a driver hop with no capability we need. Its one unique value is reaching real Safari, and `safaridriver` can be spoken to directly over HTTP without a client library.
- **Lightpanda 1.0.2:** not viable. Its [README](https://github.com/lightpanda-io/browser) calls `--dump png` "a text-only rendering", so it offers no faithful pixels to compare.
- **Storybook test-runner and Vitest browser mode:** test runners, not engines. [Test-runner uses Playwright](https://github.com/storybookjs/test-runner) underneath, so it was only read for its story-switching technique, below.

## What drives capture speed

Ranked by expected impact. This ranking is inference for #10 to confirm or overturn.

### 1. Page reuse vs navigation

A `page.goto('iframe.html?id=...')` per story reloads the Storybook bundle, re-evaluates modules and re-runs preview setup. The alternative switches story on a live page:

- [Test-runner emits `setCurrentStory`](https://github.com/storybookjs/test-runner/blob/next/src/setup-page-script.ts) on `__STORYBOOK_ADDONS_CHANNEL__` and listens for `storyRendered`, `storyErrored`, `storyThrewException`, `playFunctionThrewException`, `storyMissing` and `storyUnchanged`.
- Storybook [tears down the last render and renders the new one](https://github.com/storybookjs/storybook/blob/next/code/core/src/preview-api/modules/preview-web/PreviewWithSelection.tsx), then [emits `storyRendered` and `storyFinished`](https://github.com/storybookjs/storybook/blob/next/code/core/src/preview-api/modules/preview-web/render/StoryRender.ts) after the play function.
- Reselecting the same story emits `storyUnchanged` without re-rendering, so per-story viewport or theme variants need another trigger such as the [`forceRemount` event](https://github.com/storybookjs/storybook/blob/next/code/core/src/core-events/index.ts).

**Risk:** teardown cleans up the render, not the page. Module state, leaked `<head>` styles, portals and timers can bleed between stories and make a snapshot depend on story order. Worth measuring both speed and flake, perhaps with periodic page recycling. Exact events belong to [#5](https://github.com/visual-check/visual-check/issues/5).

For contrast, [lost-pixel](https://github.com/lost-pixel/lost-pixel/blob/main/src/shots/shots.ts) creates a new context and page and navigates for every shot. This is the most isolated and probably the slowest shape, and a useful control.

### 2. Isolation scope: contexts vs browsers

- Playwright calls contexts [fast and cheap, and isolated within a single browser](https://playwright.dev/docs/browser-contexts), without giving figures. A CDP browser context is [similar to an incognito profile](https://github.com/ChromeDevTools/devtools-protocol/blob/master/json/browser_protocol.json).
- **A new context per story is a cold cache per story** (inference: isolated storage should mean Storybook's chunks are refetched), so it may cost most of what navigation costs.
- **Renderer sharing:** Chromium [never shares a renderer process across profiles or StoragePartitions](https://github.com/chromium/chromium/blob/main/docs/process_model_and_site_isolation.md), but above a memory-based soft process limit it reuses same-site processes. N same-origin pages in one context could then contend on one renderer main thread; N contexts cannot.

Topologies to compare: N pages in 1 context, N contexts in 1 browser, N browsers.

### 3. PNG encoder

[Chromium's encoder selection](https://github.com/chromium/chromium/blob/main/content/browser/devtools/protocol/page_handler.cc):

| Request | Encoder |
|---|---|
| PNG (default) | `EncodeBGRASkBitmap` (`EncodeBitmapAsPngSlow`) |
| PNG, `optimizeForSpeed` | `FastEncodeBGRASkBitmap` |
| WebP quality 100 | Lossless, method 1, or method 0 with `optimizeForSpeed` |
| WebP lossy | Method 3, or method 2 with `optimizeForSpeed` |
| JPEG | Lossy, default quality 80 |

- Baselines need lossless output (lossy artefacts would register in a visual diff), so the real candidates are fast PNG, default PNG and lossless WebP.
- `optimizeForSpeed` is [marked experimental](https://github.com/ChromeDevTools/devtools-protocol/blob/master/json/browser_protocol.json). The protocol's `quality` text still says "jpeg only" although the code uses it for WebP.
- Fast PNG produces bigger files, which trades capture time against repo or artifact size and decode time. Measure capture through visual diff end to end, not capture alone, and feed results to [#8](https://github.com/visual-check/visual-check/issues/8).
- CDP returns [base64 inside a JSON message](https://github.com/ChromeDevTools/devtools-protocol/blob/master/json/browser_protocol.json), so raw pixels are not available. Encoding, base64 and JSON parsing look unavoidable, and with many workers the Node main thread may be the bottleneck.
- Firefox and WebKit have no speed switch: [Juggler `Page.screenshot`](https://github.com/microsoft/playwright/blob/v1.64.1/packages/playwright-core/src/server/firefox/ffPage.ts#L479), [WebKit `Page.snapshotRect`](https://github.com/microsoft/playwright/blob/v1.64.1/packages/playwright-core/src/server/webkit/wkPage.ts#L883) and [BiDi `browsingContext.captureScreenshot`](https://github.com/microsoft/playwright/blob/v1.64.1/packages/playwright-core/src/server/bidi/bidiPage.ts#L513) all take only format and quality.

### 4. Capture area

Fewer pixels means less to encode and compare. Compare viewport, element clip on the story root, and full page. `captureBeyondViewport` is [experimental](https://github.com/ChromeDevTools/devtools-protocol/blob/master/json/browser_protocol.json), and Playwright [needs a workaround after using it with touch emulation](https://github.com/microsoft/playwright/blob/v1.64.1/packages/playwright-core/src/server/chromium/crPage.ts#L297-L300).

### 5. Headless shell vs new headless

Chrome's docs frame this as [performance vs authenticity](https://developer.chrome.com/blog/chrome-headless-shell): the shell is a lightweight wrapper around `//content` that can be faster, while new headless is the real browser. Puppeteer agrees the shell is [more performant but does not fully match Chrome](https://pptr.dev/guides/headless-modes). Chrome marks old headless as deprecated, so check its future before depending on it. Both modes should be measured for speed, and for rendering differences under #7.

### 6. HTTP cache and request interception

[Enabling `page.route` disables the HTTP cache](https://github.com/microsoft/playwright/blob/v1.64.1/docs/src/api/class-page.md?plain=1#L3891), and [the source confirms it](https://github.com/microsoft/playwright/blob/v1.64.1/packages/playwright-core/src/server/chromium/crNetworkManager.ts#L169). Avoid routing in the hot path, and serve the Storybook build with long cache headers. Which Storybook is served belongs to [#15](https://github.com/visual-check/visual-check/issues/15).

### 7. Lower-value techniques

- **Pipe vs WebSocket:** likely small next to encoding and rendering, but cheap to test.
- **`Page.startScreencast`:** [JPEG and PNG only, experimental](https://github.com/ChromeDevTools/devtools-protocol/blob/master/json/browser_protocol.json), frame-driven rather than on demand. Not a fit.
- **`HeadlessExperimental.beginFrame`:** [experimental, requires BeginFrameControl](https://github.com/chromium/chromium/blob/main/headless/lib/browser/protocol/headless_handler.cc). A determinism tool for #7, not a speed tool.

The render wait itself is probably large too, but it is a determinism question for #7. #10 should break time down by phase so it is visible.

## Host project reuse

**Playwright, feasible with caveats:**

- Resolve `playwright-core` from the host and launch what it installed. Client and browser revision then match by construction, with no download.
- **Host upgrades move baselines.** A host Playwright bump changes the browser revision, so rendering can change and invalidate baselines with no visual-check change. This is inference from the [version pairing](https://playwright.dev/docs/browsers), and the main thing #11 has to decide.
- **We must support a version range.** The host's Playwright may be older or newer than what we test against.
- Host Playwright may have browsers missing. Hosts on CI often install only one, and `--only-shell` removes full Chromium.
- **`executablePath` is not an escape hatch** for pairing a client with a different browser: the docs say Playwright [only works with the bundled browsers, "use at your own risk"](https://playwright.dev/docs/api/class-browsertype).
- **Fallback that still saves download:** pin our own `playwright-core`. Browsers go in a [shared location](https://playwright.dev/docs/browsers) (`PLAYWRIGHT_BROWSERS_PATH`) by revision, so a matching host revision is reused automatically.
- **Raw CDP mix:** host `chromium.executablePath()` gives an unpatched Chrome for Testing binary that a raw CDP client can launch. This does not extend to Firefox and WebKit, since [Playwright's patched builds are bound to Playwright](https://playwright.dev/docs/browsers).

**Puppeteer:** `puppeteer-core` can launch a given executable, but offers little reuse, since hosts doing visual or end-to-end testing are more likely to have Playwright.

## Docker

| | Playwright | Puppeteer |
|---|---|---|
| Image | [`mcr.microsoft.com/playwright:v1.64.1`](https://playwright.dev/docs/docker) | [`ghcr.io/puppeteer/puppeteer:25.16.0`](https://pptr.dev/guides/docker) |
| Architectures (read from registry manifest) | amd64, arm64 | amd64 only |
| Browsers | All three engines and system dependencies | Chrome for Testing |
| Base | Ubuntu 24.04, also 22.04 and 26.04. [Alpine unsupported](https://playwright.dev/docs/docker) | [`node:24-bookworm`](https://github.com/puppeteer/puppeteer/blob/main/docker/Dockerfile) |
| npm package included | No, install separately | Yes |
| Flags | `--init`, `--ipc=host` recommended for Chromium | `--init`, `--cap-add=SYS_ADMIN` for the sandbox |

- **Version lock:** the [Playwright image must match the project's version](https://playwright.dev/docs/docker) or browsers aren't found. A host-reuse design therefore has to select the image tag from the host version.
- **Remote mode:** [`playwright run-server`](https://playwright.dev/docs/docker) lets Node on the host drive browsers in a container, reaching the host's Storybook through `--add-host=hostmachine:host-gateway`. [Client and server must match major and minor](https://playwright.dev/docs/api/class-browsertype). Relevant to [#13](https://github.com/visual-check/visual-check/issues/13), which could use it to keep host-side setup minimal.
- **Puppeteer's arm64 gap** would affect Docker on Apple Silicon. Anything reading "amd64 only" should re-check per tag: this was one tag on one day.
- **Safari can't run in Docker**, since [`safaridriver` lives in macOS](https://developer.apple.com/documentation/webkit/testing-with-webdriver-in-safari). WebKit in Docker is the Linux port described below.

## Playwright WebKit vs real Safari

| | Playwright WebKit | Real Safari |
|---|---|---|
| Source | [Patched upstream WebKit `main`](https://playwright.dev/docs/browsers), [pinned commit](https://github.com/microsoft/playwright/blob/v1.64.1/browser_patches/webkit/UPSTREAM_CONFIG.sh), [~950 KB patch](https://github.com/microsoft/playwright/tree/v1.64.1/browser_patches/webkit/patches) | Apple's build, including private parts |
| App | [`Playwright.app` on macOS, `MiniBrowser` on Linux](https://github.com/microsoft/playwright/blob/v1.64.1/browser_patches/webkit/pw_run.sh) | Safari.app |
| Timing | [Ahead of Safari](https://playwright.dev/docs/browsers) | Ships later, tied to OS releases |
| Headless | Yes | None documented |
| Parallelism | Normal contexts and pages | [One browser instance, one session](https://developer.apple.com/documentation/webkit/about-webdriver-for-safari) |
| Linux / Docker | Yes | No |

Differences that matter for a visual diff:

- **Playwright can't drive Safari.** The docs say it [doesn't work with branded Safari because it relies on patches](https://playwright.dev/docs/browsers).
- **On Linux it isn't Apple's port.** [Headless uses WPE, headed uses GTK](https://github.com/microsoft/playwright/blob/v1.64.1/browser_patches/webkit/pw_run.sh), so even headed and headless on Linux are different builds. [Igalia maintains those ports and each port's platform code is separate](https://docs.webkit.org/Ports/Introduction.html).
- **Graphics stacks differ.** WebKit has [separate `cg`/`coretext` and `skia`/`freetype`/`harfbuzz` backends](https://github.com/WebKit/WebKit/tree/main/Source/WebCore/platform/graphics). WPE and GTK [moved to Skia in 2.46, with GPU rendering by default and changed font rendering](https://blogs.igalia.com/carlosgc/2024/09/27/graphics-improvements-in-webkitgtk-and-wpewebkit-2-46/). Expect text in Linux WebKit snapshots to differ from Safari (inference, not measured). Linux WebKit catches regressions relative to itself; it says little about how Safari draws the page.
- **macOS is closer, but tied to the OS.** Playwright [recommends a Mac for the closest experience](https://playwright.dev/docs/browsers). Builds are per OS: [macOS 14 is frozen at revision 2251 against 2370 elsewhere](https://github.com/microsoft/playwright/blob/v1.64.1/packages/playwright-core/browsers.json) and [macOS 13 has no build](https://github.com/microsoft/playwright/blob/v1.64.1/packages/playwright-core/src/server/registry/index.ts).
- **Open-source parts only.** A maintainer described [slight differences because Playwright's build includes only the open-source part](https://github.com/microsoft/playwright/issues/5795), and the same thread has a user seeing bugs in Safari that didn't reproduce in Playwright WebKit. The thread dates from 2021.
- **The version label is approximate.** "27.2" names the Safari version it resembles, not a Safari build.
- **Media codecs and platform features** [vary by OS](https://playwright.dev/docs/browsers).
- **No iOS.** The [browser registry](https://github.com/microsoft/playwright/blob/v1.64.1/packages/playwright-core/src/server/registry/index.ts) has no iOS build, so "Mobile Safari" device presets are desktop WebKit with emulation.

**Real Safari constraints:**

- [Only one Safari instance and one WebDriver session at a time](https://developer.apple.com/documentation/webkit/about-webdriver-for-safari), so snapshots are serial per machine. Parallelism means more Macs.
- Runs in [automation windows with a glass pane](https://developer.apple.com/documentation/webkit/about-webdriver-for-safari); Apple's docs describe no headless mode.
- [`safaridriver --enable` must run once](https://developer.apple.com/documentation/webkit/testing-with-webdriver-in-safari). GitHub's macOS runners [include both](https://github.com/actions/runner-images/blob/main/images/macos/macos-15-arm64-Readme.md).
- Full-page capture was [clipped to the viewport until a fix in STP 247](https://webkit.org/blog/18133/release-notes-for-safari-technology-preview-247/), so older Safari versions may need care.
- **BiDi isn't there yet.** At the 2025 contributors meeting it [worked for WebKitGTK but not SafariDriver, with no Mac timeline](https://docs.webkit.org/Other/Contributor%20Meetings/ContributorMeeting2025.html). [STP 254 (2026-10-08) added initial `browsingContext.captureScreenshot`](https://webkit.org/blog/18420/release-notes-for-safari-technology-preview-254/), viewport PNG only. Keep watching: it could eventually allow a single protocol across Firefox and Safari.

**Suggested framing for #11:** call the v1 browser "WebKit", not "Safari", in config and docs, so nobody reads a pass as Safari verified. Treat real Safari as an optional serial macOS backend behind the engine seam. It cannot meet the "hyper fast" goal.

## Benchmark candidates for #10

**Chromium (full matrix):**

| # | Candidate | Why |
|---|---|---|
| C1 | Playwright `page.screenshot`, headless shell | Baseline, most likely default |
| C2 | Playwright with `newCDPSession` + `optimizeForSpeed` | Keeps Playwright's lifecycle, bypasses overhead |
| C3 | Raw CDP over pipe, headless shell | Upper bound |
| C4 | Puppeteer `page.screenshot`, N pages in one browser | Tests the mutex claim |
| C5 | Puppeteer, N browsers (Storycap's shape) | Puppeteer's usual workaround |
| C6 | C1 with `channel: 'chromium'` (new headless) | Cost of fidelity |

**Firefox:**

| # | Candidate | Why |
|---|---|---|
| F1 | Playwright, bundled Firefox (Juggler) | Default |
| F2 | Playwright, `channel: 'moz-firefox'` (BiDi, stock) | [In the source](https://github.com/microsoft/playwright/blob/v1.64.1/packages/playwright-core/src/server/firefox/firefox.ts#L45-L46) but not in `docs/src/browsers.md`, so treat as unstable |
| F3 | Puppeteer, stock Firefox (BiDi) | Comparison, mutex applies |

**WebKit / Safari:**

| # | Candidate | Why |
|---|---|---|
| W1 | Playwright WebKit on Linux (WPE) | Cheap CI path |
| W2 | Playwright WebKit on macOS | Closest Playwright gets |
| S1 | `safaridriver` over plain HTTP, serial | Real Safari floor; reference point only |

**Techniques**, varied on C1, C2 and C3, with W1 and F1 where they apply:

1. **Story switch:** `goto` per story; `setCurrentStory` on a live page; `setCurrentStory` with recycling every N stories.
2. **Topology at N = 1, 5, 10** (the map's current CI and local defaults): pages in one context; contexts in one browser; browsers.
3. **Isolation:** new context per story vs per worker.
4. **Encoding:** default PNG; fast PNG; lossless WebP. Record file size and decode time.
5. **Area:** viewport; element clip; full page.
6. **Playwright options:** `caret: 'initial'` and `animations: 'allow'` vs defaults.
7. **Transport:** pipe vs WebSocket.

**Report:** stories per second, cold start, peak memory, and a per-phase breakdown (switch, render wait, capture, encode, transfer). Also count **flakes**: run twice and report snapshots differing between runs, since the fastest setup is worthless if it isn't stable. Use a static Storybook build so server time doesn't pollute results.

Doing the full cross-product isn't necessary. A sensible order is C1 with each technique on its own, then the winners on the other candidates.

## Unresolved

- **No trustworthy public benchmark exists.** Searches found only [vendor and blog comparisons](https://betterstack.com/community/comparisons/playwright-vs-puppeteer/) with thin or absent methodology, none on Storybook capture. They are deliberately not used as evidence here.
- **Cost of `FastEncodeBGRASkBitmap` in size and speed** on real story images is unmeasured.
- **Whether Playwright's bundled Firefox can be driven by Puppeteer's BiDi** wasn't tested. Assume not.
- **Apple's docs don't state "no headless"** outright; the claim is based on nothing being documented.
- **Chromium sources were read at `main`** on 2026-11-02, while the browsers under test are 156.
