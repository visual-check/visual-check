# Capture engine

Part of the [v1 PRD](README.md). Terms come from the [glossary](../../GLOSSARY.md).

v1 captures in Chromium only, through visual-check's own raw CDP driver. Nothing in visual-check uses Playwright or Puppeteer. Where the browser runs and how it reaches a Storybook is in [Browser and platform](05-browser-and-platform.md). What a capture waits for is in [Readiness and stability](06-readiness-and-stability.md).

## The browser

- Always Chrome for Testing's headless shell, never new headless, with no option.
- The build comes from the browser package ([Packages](01-packages.md)).
- visual-check only ever uses the browser in its own image, in its container or directly when the CLI runs inside that image, or the build it downloaded for `host`. It never uses another Chromium found on the machine.
- On connect, the driver reads the browser's exact version over CDP. If it isn't the browser package's build, the run exits 2 and names both versions. This holds in the container, inside visual-check's image and on `host`.

## Driver interface

- The engine talks to the browser through an internal driver interface, shaped by what visual-check needs and not by Playwright's API.
- v1 has one implementation: raw CDP for Chromium. There's no driver switch and no fallback driver.
- It's designed for several browsers, so a later one goes behind it without changing the config, baseline names or the report. It starts from the prototype's interface and is fixed in the first implementation ticket. It covers launch, page setup, the per-capture steps, hazard handling, and crash and exit events.
- Real Safari is out for good.
- One in-page script, shared by every driver, does everything that happens in the page:
  - the readiness wait and the `wait` hook;
  - bringing the page to its end state;
  - painting masks and hiding the caret;
  - reading per-story options through `loadStory`;
  - collecting console messages and errors;
  - finding remote content.
- Page hazards (below) are handled the same way in every driver.
- From Playwright, visual-check copies data only: the launch arguments, with a link to the Playwright file and version. They're reviewed on every Chromium bump.

## Transport and launch

- CDP runs over a pipe (`--remote-debugging-pipe`). There's no WebSocket and no published port.
- Launch arguments: Playwright's Chromium arguments, plus `--disable-skia-runtime-opts`, always and with no option ([ADR 0003](../adr/0003-render-in-container-on-amd64.md)).
- The sandbox flag depends on where the browser runs ([Browser and platform](05-browser-and-platform.md)).
- In the container, the browser starts through the image's shell with redirections, so CDP uses the container's stdin and stdout and the browser's own output goes to stderr. The image needs no extra program.
- Chromium's stderr is always drained, because a full stderr pipe freezes the browser. Its last 50 lines are kept, and so is its last fatal log line, first among them, when a stack trace pushes it out. They're printed only with a failed launch or a browser exit.
- The browser's profile folder is removed on exit.

## Workers, contexts and pages

- One browser per run. Each worker has one browser context and one page.
- A run has one pool of workers across all its Storybooks. More workers than CPUs is slower.
- Cookies, `localStorage`, `sessionStorage` and IndexedDB are cleared between captures. Cache Storage and service workers are kept, so MSW's worker isn't installed again for every story.
- Every capture starts with a fresh `goto`. Stories are never switched in place.

## Page setup

Once per page:

- **No font table.** A capture that reaches past the viewport, such as a full page with `growViewport: false`, resets the page's web preferences and drops a table set through `Page.setFontFamilies`, and Chromium takes the table once per page. A page would be measured with the table's fonts and painted with the system's, so the generic families keep the system's fonts.
- **User agent** ends in `StorybookTestRunner`, which puts Storybook on its test path.
- **Emulation:** `timezone`, `locale` and `colorScheme` from the config, focus emulation, and `prefers-reduced-motion: no-preference`.
- **A script at document start** that does these things:
  - hooks Storybook's channel and preview to note when the story finished, and to collect its error events and render steps (the Storybook adapter's part);
  - empties the pause stylesheets Storybook 9.1 and 10 add on the test path;
  - wraps `attachShadow` to record every shadow root;
  - collects console messages, uncaught errors and unhandled rejections;
  - provides the waits a capture calls: the story wait, and the wait for images and fonts.

  It changes no other styles.
- Evaluations run with a user gesture, so `beforeunload` fires and can be handled.

## Each capture

1. Set the viewport, the device scale factor and touch on the page.
2. `goto` `iframe.html?id=<story-id>&viewMode=story`, with the mode's globals in the URL.
3. Wait until the story is ready, grow the viewport to the page for a full-page capture, run the `wait` hook, and bring the page to its end state ([Readiness and stability](06-readiness-and-stability.md)).
4. Paint the masks and hide the caret.
5. Capture the full page or the `element` box, as a standard PNG.

Rules:

- `touch: true` turns on touch and mobile emulation together. A capture that reaches past the viewport resets hover and pointer media as it starts and again as it ends, so the driver turns touch emulation back on right behind the capture command, before Chromium paints the capture, and again after it. That order is observed Chromium 157 behaviour the protocol doesn't promise; the hover box in the e2e Modes stories guards it. The snapshot has no hover and a coarse pointer, and so does the page afterwards.
- Before a full-page capture, the viewport's height grows to the content's, rounded up, once, keeping the screen's size, the width, the scale and touch ([ADR 0012](../adr/0012-full-page-capture-grows-the-viewport.md)). A page that fits the viewport, a page over 32,767 device pixels tall, an `element` capture and a story with `growViewport: false` keep the viewport. The next story's viewport is set as usual.
- A capture that fits the viewport, as a grown full page and most `element` boxes do, is taken from what the viewport shows, so the page doesn't notice it. Only a capture that reaches past the viewport is taken beyond it, and Chromium then resizes the page to 1 × 1 and back while it captures, so the page gets `resize` events and one that reacts to them can change afterwards ([#165](https://github.com/visual-check/visual-check/issues/165)).
- The PNG is stored exactly as the browser returned it. The byte comparison in [Visual diff](09-visual-diff.md) depends on that.
- The full page is the viewport's width and the content's height. Content wider than the viewport is cut at the viewport's width.
- An element capture is the element's border box, rounded out to whole CSS pixels.
- A capture over 32,767 device pixels on either side makes a broken story. The size is checked before the browser is asked, so nothing is captured. With `element` set, the message says to capture a smaller element instead.

## Page hazards

None of these fails a story:

- `alert()` is accepted. `confirm()` and `prompt()` are dismissed.
- `beforeunload` is accepted, so the next `goto` never blocks.
- Popups are ignored, and each is closed as soon as it opens.
- Downloads and permission requests are denied.
- Iframes, `srcdoc` ones included, are captured as part of the page.

## When a capture goes wrong

| Event                                               | What happens                                                                                                                                                                                                                                                                                   |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The story navigates its document away               | Retried 2 times, each on a fresh page in a new context, with no wait. Then a broken story, "navigated away". Its message names the URL it went to and says to await the new page before clicking                                                                                               |
| A page-started navigation overtakes `goto`          | The `goto` fails at once and doesn't hang                                                                                                                                                                                                                                                      |
| The page crashes                                    | A broken story, "crashed", never retried. The worker opens a new context for its next story                                                                                                                                                                                                    |
| The browser exits                                   | Every story in flight becomes a broken story, "browser exited". The browser relaunches once. A second exit, or a failed relaunch, exits 2. An exit before the first capture that says this machine can't run the platform exits 2 at once ([Browser and platform](05-browser-and-platform.md)) |
| An error or a timeout                               | A broken story. Never retried                                                                                                                                                                                                                                                                  |
| A snapshot beyond tolerance, or of a different size | Captured again with a fresh `goto`, up to `retries` more times ([Readiness and stability](06-readiness-and-stability.md))                                                                                                                                                                      |

- Only new documents count as navigating away. Storybook's own `history.replaceState` doesn't.
- Broken stories count toward exit 1, and the run goes on.

## What the driver never does

- Turn on the Network domain in `test`. Only `update` does, for its two warnings ([Baselines and update](10-baselines-and-update.md)).
- Turn on Runtime, Log or lifecycle events, or attach to service workers, in `test`.
- Intercept requests: no record, replay, stub or block.
- Scope the proxy to some hosts, or publish a CDP port.
- Use a new context per story, which measured 43% slower.

## Speed

These numbers come from the research and are here for reference. Captures per second, the launch time and the message count were measured with 2 workers on 2-vCPU runners over 300 real stories. The fresh-runner time was measured on 4-vCPU runners, and memory per worker in local Docker VMs.

| Measure                                       | Value                                            |
| --------------------------------------------- | ------------------------------------------------ |
| Captures per second                           | 3.30, against 2.71 for Playwright's `run-server` |
| Browser launched, `docker run` included       | 0.39 s                                           |
| Fresh runner: pull, start and first CDP reply | About 8 s                                        |
| CDP messages per capture                      | 14 to 16                                         |
| Memory per worker                             | About 1 GiB                                      |

The migration target's CI capture takes 4:45 today on 2 vCPUs. v1 has to beat that from capture speed alone, because CI runs all stories.

## Kept addable

- Capture outside Storybook comes after v1 ([Capture outside Storybook][22]). The driver interface, the shared in-page script and the report's `kind` field leave room for it.
- A user-supplied Playwright function would need a Playwright driver behind the interface. That's decided with that ticket, not here.

## Sources

- [Capture engine and host Playwright reuse][11], [Raw CDP on the test path][24], [Raw CDP for Chromium][28], [Driver interface prototype][29], [Self-navigating stories under raw CDP][31], [Story readiness and page reuse][21], [Per-story options][37], [Playwright peer dependency and Chromium version][45], [Capture benchmark][10], [Migration target audit][2], [Visual diff benchmark][19], [Late network requests after storyFinished][25], [Remote content that differs between machines][35], [Config file shape and init wizard][38], [Failure report format][39], [GitHub Action design][40], [Reading per-story options][46].
- [ADR 0002](../adr/0002-capture-on-storybook-test-path.md), [ADR 0003](../adr/0003-render-in-container-on-amd64.md), [ADR 0007](../adr/0007-browser-build-comes-from-a-peer-package.md).
- Decided while writing this PRD: clearing IndexedDB, closing popups at once, an interface designed for several browsers, how the pipe is wired, each OS's own font list on `host`, and the emulated timezone, locale and colour scheme.

[2]: https://github.com/visual-check/visual-check/issues/2
[10]: https://github.com/visual-check/visual-check/issues/10
[11]: https://github.com/visual-check/visual-check/issues/11
[19]: https://github.com/visual-check/visual-check/issues/19
[21]: https://github.com/visual-check/visual-check/issues/21
[22]: https://github.com/visual-check/visual-check/issues/22
[24]: https://github.com/visual-check/visual-check/issues/24
[25]: https://github.com/visual-check/visual-check/issues/25
[28]: https://github.com/visual-check/visual-check/issues/28
[29]: https://github.com/visual-check/visual-check/issues/29
[31]: https://github.com/visual-check/visual-check/issues/31
[35]: https://github.com/visual-check/visual-check/issues/35
[37]: https://github.com/visual-check/visual-check/issues/37
[38]: https://github.com/visual-check/visual-check/issues/38
[39]: https://github.com/visual-check/visual-check/issues/39
[40]: https://github.com/visual-check/visual-check/issues/40
[45]: https://github.com/visual-check/visual-check/issues/45
[46]: https://github.com/visual-check/visual-check/issues/46
