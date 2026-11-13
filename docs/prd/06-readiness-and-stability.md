# Readiness and stability

Part of the [v1 PRD](README.md). Terms come from the [glossary](../../GLOSSARY.md).

A story runs under visual-check as it does in plain Storybook. visual-check waits until the story has finished, brings the page to its end state only at capture, and treats a story that can't be captured as a broken story. Where stability and speed conflict, stability wins.

## Supported Storybooks

- v1 supports Storybook 9.1, 10 and 11.
- 9.1 is the floor for good. 7, 8 and 9.0 are never supported, not even behind an adapter.
- A major stays supported while Storybook still ships fixes for it. It's dropped only in a visual-check major after that, so 9 stays until Storybook 12 is stable.
- The addon supports 10 only in v1 ([Storybook addon](15-storybook-addon.md)).
- Every run checks the version of the `storybook` package installed in each Storybook's folder:
  - below 9.1, it exits 2 and names the version and the minimum;
  - above 11, it warns once and carries on;
  - with no install to read, it skips the check.

## The Storybook adapter

- One internal adapter holds every Storybook internal the engine touches. The addon doesn't use it.
- It wraps:
  - `index.json`;
  - `iframe.html?id=<id>&viewMode=story`, with a mode's globals in the URL;
  - the preview's `ready()`, `loadStory()` and preview store;
  - the channel events `storyFinished`, `playFunctionThrewException`, `storyThrewException`, `storyErrored` and `unhandledErrorsWhilePlaying`, and the render steps.
- It checks for behaviour, not only for major numbers, because patch releases have changed behaviour.
- `index.json` entries with `subtype: 'test'` (CSF Next's `.test()`) aren't stories. They're never captured, selected or counted.
- What it absorbs per version:
  - **9.1 and 10:** it empties the pause stylesheets that Storybook's test path adds after `play`, as they're added.
  - **11:** Storybook parks infinite animations on their first frame itself. visual-check pins those as it pins its own.
  - **11:** globals are seeded from `initialGlobals` only. A mode's global counts as declared exactly when that Storybook would accept it from the URL.
  - **11:** the `wait` hook's context loses `argTypes`, `kind` and `story`, as `play`'s does.

## Storybook's test path

- Every page's user agent ends in `StorybookTestRunner`, always. Storybook 9.1 and later then skip a fixed 100 ms wait per story: a story is ready in about 80 ms instead of 170 ms.
- If a Storybook ignores it, snapshots stay correct and each capture is about 100 ms slower.
- visual-check sees this from the gap between Storybook's "completing" and "completed" render steps. At the end of a run, it warns once for each Storybook whose median gap is 50 ms or more, naming the Storybook and its version. It never fails for it.

## Each capture, in order

1. Set the viewport, scale and touch, then `goto` the story.
2. Wait for `storyFinished`, which comes after `play` and `afterEach`. The four error events are watched too, because `storyFinished` can report success when `play` threw.
3. In the page: make lazy images eager, decode every image, and wait for `document.fonts.ready`.
4. Run the `wait` hook, if the story has one. Then check images and fonts again.
5. Bring the page to its end state.
6. Paint the masks and hide the caret.
7. Capture once.

Rules:

- Readiness never waits for the network. Late content is the `wait` hook's job.
- `test` has no loop that captures until two images match. What noise is left is tolerance's job.
- `readyTimeout` (10 s by default) is one limit for everything up to the capture, the end-state step included. Running out makes a broken story, and the message says which step it was in.

## The `wait` hook

- `parameters.visualCheck.wait` is a function, set in `preview`, in a stories file's meta or on a story. The most specific one wins, and `wait: null` turns an inherited hook off.
- It runs in the browser, only under visual-check, after images and fonts and before the end state.
- It gets the story's context and `canvasElement`, like `play`. Its type is `(context: StoryContext) => void | Promise<void>`, with the project's own Storybook `StoryContext`.
- It counts toward `readyTimeout`. A throw makes a broken story.
- v1 ships no ready-made wait helpers, and visual-check never detects particular libraries.

## End state

A snapshot shows finite animations and transitions as finished, and infinite animations and media on their first frame. It's always on, with no option ([ADR 0002](../adr/0002-capture-on-storybook-test-path.md)).

At capture, after the `wait` hook:

1. Call `finish()` on every running finite animation, CSS or script, in the document and in every shadow root. Animations the page paused itself and scroll-driven ones are left alone.
2. Let a frame pass, so end events run page logic.
3. Repeat until two checks a frame apart find nothing finite running, for at most 20 rounds.
4. Put infinite animations, and any still starting after 20 rounds, on their first keyframe.
5. Pin what Chromium might paint stale. Every animation now on its first keyframe, and every finished animation whose fill mode still holds its end, is written into the element's inline style and then cancelled. A pseudo-element can't take an inline style, so its animation stays paused at 0.
6. Freeze media: videos paused on frame 0, inline SVG animation paused at 0, and GIFs in `<img>` replaced by their first frame.
7. Check images and fonts again, making newly revealed lazy images eager first.

Notes:

- `play` sees real durations and every end event. A story with nothing running pays nothing.
- Closed shadow roots are reached because `attachShadow` is wrapped at document start. Declarative shadow roots are reached only when open.
- Left to the project, through a mask or a `wait` hook: SVG in `<img>`, GIFs as CSS backgrounds or cross-origin without CORS, APNG, animated WebP, canvas, Lottie and other script-driven motion.

## Retries and flaky snapshots

- A snapshot beyond tolerance, or of a different size, is captured again with a fresh `goto`, up to `retries` more times.
- `retries` is one config key for the whole project, `1` by default. It's the same number for every story, and `0` turns retries off.
- As soon as one capture passes, the story passes and the snapshot is flaky. The report keeps the first attempt's images.
- If every capture fails, the story fails.
- A flaky snapshot never fails a run. Every `test` and `update` lists its flaky snapshots by name at the end: in the terminal, in the GitHub step summary and in the JSON ([Report and output](13-report-and-output.md)).
- Retries are for visual diffs only. Errors and timeouts aren't retried, and a story that navigates away has its own two retries.
- `update` doesn't use `retries`. It has its own stability checks, and a snapshot there is flaky when its two loads disagreed and a third decided ([Baselines and update](10-baselines-and-update.md)).

## Broken stories

A broken story counts toward exit 1, and the run goes on. Errors and timeouts aren't retried.

| Reason code | When |
|---|---|
| `load-failed` | Its stories file failed to load, or didn't load within `readyTimeout`. Every story of that file is broken |
| `error` | Storybook shows its error display, or `storyFinished` reports an error |
| `play-threw` | `play` threw or left unhandled errors |
| `timeout` | Not ready within `readyTimeout` |
| `fonts-not-loaded` | `document.fonts.ready` hadn't resolved by the timeout. The details name the faces still pending |
| `wait-threw` | The `wait` hook threw |
| `navigated-away` | The story left its document, after 2 retries. The details carry the URL, and the message says to await the new page before clicking |
| `element-missing` | The `element` selector matched nothing, or a box of zero size |
| `too-tall` | The capture is over 32,767 device pixels on a side |
| `grid-too-wide` | A grid is wider than the viewport ([Grid stories](08-grid-stories.md)) |
| `crashed` | The page crashed. The message points to memory and the worker count |
| `browser-exited` | The browser exited while the story was in flight |
| `changed-after-capture` | `update` only: the page changed in the second after capture |
| `unstable` | `update` only: no two loads agreed |

- A stories file that fails to load also fails the consistency check. Its baselines are never orphans, and `update` never deletes them.
- These aren't broken stories but exit 2: a preview that fails to load, an `index.json` that fails, and invalid options.

## Remote content

- visual-check leaves the network alone: no record and replay, no stubs, no blocking.
- Remote content is what a story shows from another origin:
  - images: `<img>`, `<picture>` and `srcset`, SVG `<image>`, video posters, and CSS images (`background-image`, `mask-image`, `border-image`, `content: url()`), pseudo-elements included;
  - cross-origin iframes, as their whole rectangle.
- Same-origin iframes are searched too. `data:` and `blob:` URLs, responses a service worker mocked, and fonts don't count.
- One in-page search finds it. Host masks and the hint below share it, and it costs nothing unless one of them needs it.
- **The hint:** when every differing pixel of a failing snapshot lies inside remote content, give or take 1 px for anti-aliased edges, the failure carries a hint. It names the hosts, shows the mask line and links the docs page.
  - Example: "Differs only inside remote content from images.unsplash.com. A CDN can serve different bytes to different machines.", then the mask line `{ host: 'images.unsplash.com' }`.
  - It's a hint and never a pass. Exit codes don't change.
  - It never appears on a size difference.
  - The rectangles are collected on a retry, so passing captures pay nothing.
- `update` warns about remote content and about real network requests ([Baselines and update](10-baselines-and-update.md)).
- Fonts are neither remote content nor real requests. A face that never loads makes a broken story, and a `wait` hook can't work around it, because it runs after fonts.

## Sources

- [Story readiness and page reuse][21], [Late network requests after storyFinished][25], [WebKit web fonts that never load][32], [Remote content that differs between machines][35], [Animations frozen at their end state][44], [Reading per-story options][46], [Storybook 9 floor and Storybook 11][48], [Storybook integration surface][5], [Self-navigating stories under raw CDP][31], [Failure report format][39].
- [ADR 0002](../adr/0002-capture-on-storybook-test-path.md), [ADR 0004](../adr/0004-per-story-options-in-storybook-parameters.md).
- Decided while writing this PRD: the run-time version check, the test-path warning's cutoff, the timeout covering the end state, the reason codes for the newer causes, what counts as a declared global, and flaky snapshots.

[5]: https://github.com/visual-check/visual-check/issues/5
[21]: https://github.com/visual-check/visual-check/issues/21
[25]: https://github.com/visual-check/visual-check/issues/25
[31]: https://github.com/visual-check/visual-check/issues/31
[32]: https://github.com/visual-check/visual-check/issues/32
[35]: https://github.com/visual-check/visual-check/issues/35
[39]: https://github.com/visual-check/visual-check/issues/39
[44]: https://github.com/visual-check/visual-check/issues/44
[46]: https://github.com/visual-check/visual-check/issues/46
[48]: https://github.com/visual-check/visual-check/issues/48
