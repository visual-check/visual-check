# @visual-check/test-storybook-10-react

One of this repo's own test Storybooks ([PRD 18](../../docs/prd/18-repo-ci.md#this-repos-own-test-storybooks)): a private React Storybook on Storybook 10 with a few plain stories, a set of [hazard stories](#the-hazard-stories), a set of [readiness stories](#the-readiness-stories) a set of [per-story options stories](#the-per-story-options-stories) and a set of [animation stories](#the-animation-stories), their committed baselines in `.visual-check/baselines/` and the expected outcome of every story in `expected-outcomes.json`.

The React test Storybooks on Storybook 9.1 ([`storybook-9-react`](../storybook-9-react/README.md)) and 11 ([`storybook-11-react`](../storybook-11-react/README.md)) read these stories, take their config from `.storybook/test-storybook-config.ts` as this one does, and run this `e2e.ts` from their own folders.

`e2e.ts` is its end-to-end check. It serves the static build on `127.0.0.1`, runs the built CLI against it and checks eleven cases. Inside visual-check's image the last three are replaced, and on the host other cases run; see below.

- `test` against the committed baselines, with 2 workers, gives exactly the expected outcomes. The line of each broken readiness story says why: what it threw, that Storybook never sent `storyFinished`, or the font face `Never Loads`. So does the line of each broken per-story options story: what its `wait` hook threw, or that its stories file failed to load and what the file threw. The two disabled stories have no line, though `index.json` lists them, and the header counts exactly the stories in `expected-outcomes.json`. Its stderr has no test-path warning. In the 9.1 and 11 test Storybooks, every committed `animations--*.png` is byte-identical to this Storybook's, and both folders hold the same ones, so on 11, Storybook's own pause of animations followed by visual-check's end state gives the same snapshots as on 10.
- `test` runs the animation stories against the committed baselines 10 times, one run after the other on one server, with a config that sets 2 workers and `retries: 0`, and every run passes them all. With no retries, and `test` comparing byte for byte, each snapshot is byte-identical to its baseline on every run. The case reports every run's problems, each led by its run's number, so a story whose snapshot changes shows how often it did. A run that times out or that a signal ends stops the case, since that's a broken setup rather than a snapshot that changed.
- `update` into an empty folder writes every story that isn't broken, `test` then passes them and finds the broken ones missing, apart from the two `load-fails` stories, which stay broken since they're broken before any baseline is read. The baselines of the stories expected to pass are byte-identical to the committed ones. When they aren't, the written baselines are copied to `e2e-output/`. Both commands take 2 workers from the config.
- With 1 worker, the two storage stories run one after the other on the same page and both pass. Each checks that visual-check's markers aren't in cookies, `localStorage`, `sessionStorage` or IndexedDB, then writes them and checks they stuck, so the second fails when storage isn't cleared between captures. A broken storage story's line gives only Storybook's generic status: the stores it found are named in the error it throws in its page, which the CLI doesn't print. Opening the story in an ordinary browser won't show them, because nothing clears storage there, so every store holds the marker from the second visit on.
- With 1 worker and a `readyTimeout` of 60 s, the hazard stories run one after the other, and `test` gives exactly their expected outcomes. The story that navigates away says it went to `/categories/burgers`, and the server is asked for its page 3 times: once, then on each of its 2 retries. The story that crashes says its page crashed. The stories after `BeforeUnload` and `Crashes` pass: the first loads once the `beforeunload` dialog is accepted, the second on a fresh page.
- A stylesheet that changes the card story makes `test` exit 1 with that story differing.
- A script that gives every `iframe.html` a plain browser's `navigator.userAgent`, without `StorybookTestRunner`, takes Storybook off its test path. `test` with 2 workers passes the button stories and exits 0, and its stderr warns exactly once that the Storybook seems to ignore the test path's user agent, naming `Storybook react` and the version of the `storybook` package installed in the folder. The case writes its own config naming the Storybook `react`, so the warning names `react` whichever folder the check runs from.
- With a script in every page that asks `InvalidWhenAsked` for invalid options, `test` exits 2 before any capture. Its stderr names the story, `options--invalid-when-asked`, and the key, `visualCheck.tolerance.pixels`, and its stdout is empty.
- Killing the CLI while it captures leaves none of its containers behind.
- With 2 workers, `docker kill` on the browser's container while both workers capture breaks those 2 stories, each line saying the browser exited. The browser relaunches for the stories left, which get their expected outcomes, `test` exits 1, its stderr says the browser exited and visual-check relaunches it once, and none of its containers is left.
- With 2 workers, `docker kill` on the browser's container while both workers capture, then on the relaunched browser's once it captures, stops `test` with exit 2. The first browser's 2 stories are broken, each line saying the browser exited, and no other story finished. Its stderr says the browser exited and visual-check relaunches it once, then that the browser exited again and "Run visual-check again.", and none of its containers is left.

The server never answers `/visual-check-e2e/never-loads.woff2`, the font file `FontNeverLoads` asks for, so that story is broken in every case; stopping the server drops the request. A story page is an `iframe.html` with an `id`. The page visual-check reads every story's options on, `iframe.html?viewMode=story`, has none: the server never holds it, and the kill cases don't count it. The markup a case adds goes into every `iframe.html`, that page included, at the end of its `<head>`. Storybook's own scripts there are modules, which run once the document is parsed, so a script the case adds runs before Storybook imports any stories file. The deliberate change and the CLI kill run with the default `workers`, `'auto'`. In the last three the server holds every story page, so the run is still capturing when the kill comes, and containers that were there before the run don't count. Where the browser exits once, the server answers the story pages right after the kill, so the stories left can pass; where it exits twice, it holds them throughout.

## The hazard stories

`stories/hazards.stories.tsx` has one story for each thing a page can do that visual-check deals with itself. They're in this order, so that with 1 worker `BeforeUnload` and `Crashes` are each followed by a story that passes:

- `Alert`, `Confirm` and `Prompt` open their dialog as they render. visual-check accepts the alert and dismisses the other two, so the snapshots show `alert() returned`, `confirm() returned false` and `prompt() returned null`.
- `BeforeUnload` leaves a `beforeunload` handler that asks to stay, so the next story's `goto` on the same page opens a dialog. visual-check accepts it, so that story loads; dismissing it would cancel the navigation and break that story.
- `Popup` opens a popup in a loader, which visual-check closes. The loader waits until it's closed, so a popup left open makes the loader throw, which breaks the story.
- `Crashes` allocates in `play` until its page reaches V8's heap limit, about 3.8 GB, and its renderer crashes: within a few seconds on a Mac, but 14 to 19 s on CI's runners, which is why the hazards case gives it 60 s. It's broken, `crashed`, and isn't retried; the next story gets a fresh page.
- `Download` clicks a download link, which visual-check denies. The page can't tell a denied download from an allowed one, so this only checks that a download doesn't hold up the capture.
- `Permissions` asks for the notification and geolocation permissions in a loader. visual-check denies both, so the snapshot shows `denied` and geolocation's `PERMISSION_DENIED` error.
- `SrcdocIframe` shows an iframe with a `srcdoc` document, which visual-check captures with the page. `play` waits for that document's own text, since the iframe's first, empty document is complete at once.
- `NavigatesAway` follows a link to `/categories/burgers` in `play`, then waits forever, so its page always leaves before Storybook reports it finished. It's broken, `navigated-away`, after 2 retries.

`test` captures only a story that has a baseline, so the two broken stories have one too, though `update` never writes a broken story's: each is the story as it renders without its `play`. `test` never gets as far as comparing it.

## The readiness stories

`stories/readiness.stories.tsx` has one story for each thing visual-check waits for, or gives up on, before it captures. Each shows its result in a note:

- `PlayAwaits` waits 500 ms in `play`, then clicks its button, so the snapshot shows `play finished`: visual-check captures once `play` has finished.
- `LazyImage` has a lazy image 5000 px down. Chromium loads lazy images early within 1250 to 4000 px of the viewport, depending on the connection type, so the image sits 5000 px down, where on its own the browser leaves it unloaded. visual-check makes lazy images eager, so the full-page snapshot shows the green square at the bottom.
- `AnimationKeepsRunning` has a hidden element with an infinite CSS animation, and `afterEach` writes the element's computed `animation-play-state` into the note. On the test path, Storybook 9.1 and 10 add a stylesheet that pauses every animation before `afterEach`. visual-check empties it, so the note says `running`, as in plain Storybook; without that it says `paused`. Storybook 11 pauses through the Web Animations API, which leaves the CSS value alone, so it says `running` there too.
- `RenderThrows` throws as it renders. It's broken, `error`.
- `PlayThrows` throws in `play`. Storybook still reports it finished, but sends `playFunctionThrewException` first, so it's broken, `play-threw`.
- `PlayLeavesUnhandledError` throws from a timer while `play` waits. Storybook sends `unhandledErrorsWhilePlaying`, so it's broken, `play-threw`.
- `NeverReady` waits forever in `play`, so Storybook never sends `storyFinished`. It's broken, `timeout`, once `readyTimeout` runs out.
- `FontNeverLoads` asks for a font face, `Never Loads`, whose file the end-to-end check's server never answers. It's broken, `fonts-not-loaded`, once `readyTimeout` runs out, naming the face. Its loader waits for the window's `load` event first, so the font's request can't hold up the `load` that visual-check's `goto` waits for. Under `storybook dev` the file 404s and the story passes.

The CLI's line for a broken story doesn't print its reason, so the committed-baselines case checks what each line says. The five broken stories have committed baselines too, each the story as it renders without its failure: `RenderThrows` without the throw, `PlayThrows`, `PlayLeavesUnhandledError` and `NeverReady` without their `play`, and `FontNeverLoads` with its font file 404ing, in the fallback font.

## The per-story options stories

Five stories files cover per-story options. Four of them set `parameters.visualCheck` through `visualCheck` from `.storybook/visual-check.ts`, which declares two modes that set only a viewport: `narrow`, 375 px wide, and `wide`, 1600 px wide. It imports `@visual-check/storybook`'s built `dist`. Turbo builds it before `build-storybook`, but `pnpm storybook` runs without Turbo, so on a fresh checkout build it first, from the repo root: `pnpm turbo run build --filter @visual-check/storybook`.

Every React test Storybook's preview also loads `.storybook/shared-preview.ts`, through `previewAnnotations` in `.storybook/test-storybook-config.ts`. It isn't named `preview.ts`, so Storybook doesn't load it on its own. It sets three options for every story, none of which changes a snapshot:

- `tolerance: { color: 0.01 }`, the default color tolerance.
- The mask `e2e-never`, for `[data-visual-check-e2e-never]`, which no story has.
- A `wait` hook that sets the text of the story's `[data-wait-target]` element to `preview wait ran`, when it has one. Only the wait stories do.

The stories files:

- `merged-options.stories.tsx` has one story, `Default`, which shows its merged `parameters.visualCheck` as JSON, with each function as `a function`. Its meta and the story each set every option but `wait` and `disable`, so the snapshot pins how Storybook merges them: `modes` is the story's empty list, so both modes are `null`; `viewport` is `{ width: 1280, height: 720 }` and `tolerance` is `{ color: 0, pixels: 0 }`, merged key by key; `masks` holds `e2e-never`, `never-a` and `never-c`, with `dropped` set to `null`; `element` is the story's `null`; `wait` is the preview's. None of it changes the capture: the viewport is the config's default, no mask matches anything, `element: null` is the full page, and no mode is listed.
- `wait.stories.tsx` has one story for each way a story gets its `wait` hook:
  - `InheritsPreviewWait` sets no `wait`, so the preview's writes `preview wait ran` into its note.
  - `OwnWait`'s own `wait` replaces the preview's and writes `story wait ran`.
  - `WaitTurnedOff` sets `wait: null`, so the note still says `wait didn't run`.
  - `AwaitsLateContent` shows `Late content` 1500 ms after it renders, long after Storybook reports it finished. Its `wait` finds that text through `canvas`, which visual-check builds from `storybook/test` as `play` gets it, so the snapshot shows `Late content`.
  - `Throws`'s `wait` throws. It's broken, `wait-threw`.
- `disabled.stories.tsx` sets `disable: true` on its meta. `Skipped` inherits it, so visual-check never captures it, prints a line for it or counts it. `BroughtBack` sets `disable: false` and passes.
- `options.stories.tsx` has `DisabledOnItsOwn`, which sets `disable: true` on the story alone and is left out the same way, and `InvalidWhenAsked`. That one passes, unless the page's `globalThis.__visualCheckE2eInvalidOptions` is `true` when its stories file is imported. Then its hand-written `parameters.visualCheck` sets `tolerance.pixels` to `'120%'`, which the invalid-options case checks.
- `load-fails.stories.tsx` throws as the browser imports it, so loading it fails, and both its stories, `First` and `Second`, are broken, `load-failed`. Storybook's indexer reads the exports without running the file, so the build succeeds and `index.json` still lists them. The throw sits behind a `window` check only because an unconditional top-level throw would make the rest of the file unreachable, which Biome's `noUnreachable` rejects. Every browser has a `window`, so the check changes nothing there.

`Throws` has a committed baseline, the story with a `wait` that does nothing. The two `load-fails` stories need none: visual-check breaks them before it reads a baseline.

## The animation stories

`stories/animations.stories.tsx` has one story for each kind of motion that visual-check brings to its end state at capture, and one for the motion it leaves alone. Each story runs as in plain Storybook: `play` sees animations and transitions run for their real durations, with every end event, and visual-check brings the page to its end state only once the story has finished. The stories are drawn in solid colours on a fixed-size stage, so the end state is plain in the snapshot. All of them pass:

- `TransitionsInPlay` clicks a button in `play` that opens a drawer and turns a box green through CSS transitions, the box's after a 400 ms delay. They're still running when `play` finishes, so the snapshot shows the drawer open over its half-dark overlay, and the box green, only because they're finished.
- `KeyframesInPlay` mounts a drawer in `play` whose keyframe animations have no fill, so the snapshot shows the drawer open at its own styles.
- `EntranceForwards` fades in two boxes whose own style is `opacity: 0`, one with `forwards` and one after a 600 ms delay with `both`. Only their fill mode keeps them visible, and the snapshot shows both.
- `ScriptAnimations` moves two boxes with `element.animate()`, one with `fill: 'forwards'` and one without, so the snapshot shows the first moved and the second back where it started.
- `ChainedAnimation` has three steps, each mounted by the last one's `animationend`. The middle one's animation has no fill, so once it's finished nothing is left of it but its pending `animationend`. visual-check lets the end events of every finished animation run page logic before it pins anything, Storybook 11's included, and finishes again until nothing finite is running, so the snapshot shows the last step: three boxes and `step 3 ended`.
- `ExitUnmounts` clicks Close in `play`, which starts the dialog's exit animation. The dialog unmounts on its `animationend`, as Radix's Presence does, so the snapshot shows `state: gone` and no dialog.
- `PlayAwaitsEndEvents` starts a 400 ms transition and a 400 ms animation in `play`, and waits for their `transitionend` and `animationend`. It throws when they come in under 390 ms or not within 5 s, so it passes only when `play` sees real durations and every end event. The snapshot shows `play saw transitionend and animationend`.
- `InfiniteAnimations` has a CSS spinner, a CSS pulse, an infinite animation on a `::after` pseudo-element and an infinite `element.animate()`. They never end, so the snapshot shows each on its first keyframe. A pseudo-element's animation can't be written into an inline style, so it stays paused at 0.
- `ShadowRoots` has a fade-in, a spinner and a transition `play` starts in an open shadow root and in a closed one, and the snapshot shows both as they'd be in the document. visual-check reaches the closed one through `attachShadow`, which its page script wraps.
- `LeftAlone` has an `element.animate()` with `fill: 'forwards'` that the page paused halfway itself, and a scroll-driven animation from red to green at scroll 0. visual-check leaves both alone, so the snapshot shows the box halfway, 150 px to the right, and the other one red. Finished, the box would be 300 px to the right, and put on its first keyframe, back on the left; finishing the scroll-driven one would turn it green.
- `Video` plays a muted clip in a loop, and `play` waits until it plays, so it's playing at capture on any machine. The snapshot shows its first frame. Vite inlines the small clip into the build as a `data:` URL, as it does any asset under 4 KiB.
- `VideoPlayerControls` plays the same clip in a small player whose React state follows the video's `play` and `pause` events. When the video pauses, the player's controls fade in and its bar turns blue, through 300 ms CSS transitions. visual-check pauses the video only once the animations are finished, so those transitions start then. It lets a frame pass after freezing media, then finishes the animations once more, so the snapshot shows the first frame under the controls fully faded in, with `paused`, and the bar blue. Without that, 9.1 and 10 would capture the controls mid-fade, and 11, whose own listener finishes every transition that starts, would capture them faded in.
- `InlineSvgAnimation` has an inline SVG with two SMIL animations, one infinite and one frozen at its end, and the snapshot shows it at time 0.
- `Gifs` shows a GIF from a file URL, whose path ends in `.gif`, and from a `data:image/gif` URL, imported with Vite's `?no-inline` and `?inline`. The snapshot shows both on their first frame.

On the test path, Storybook 9.1 and 10 add two stylesheets that pause every animation after `play`, which visual-check empties, so the stories keep running until visual-check finishes them. Storybook 11 itself finishes finite CSS animations and transitions after `play`, and parks infinite ones on their first frame, but leaves script animations alone. visual-check's end state then takes what's left. Each animation story's snapshot is byte-identical on 9.1, 10 and 11.

visual-check leaves some motion to the project, so no story has it: SVG in `<img>`, GIFs as CSS backgrounds or cross-origin without CORS, APNG, animated WebP, canvas, Lottie and other script-driven motion.

## Running the end-to-end check

`e2e.ts` works in the folder it starts in, so the 9.1 and 11 test Storybooks run the same file from their own folders.

Until the browser image is published, every run names a locally built image through `TEST_STORYBOOK_IMAGE`. From the repo root:

```sh
packages/chromium/image/build.sh amd64 --output type=docker,name=visual-check-chromium:amd64
TEST_STORYBOOK_IMAGE=visual-check-chromium:amd64 pnpm turbo run e2e --filter @visual-check/test-storybook-10-react
```

Turbo builds the CLI, `@visual-check/storybook` and the Storybook first. The check prints one line per case, then each of its problems, and exits 1 when any case fails.

## Running it inside visual-check's image

`--inside-image` runs the check the way a job container on visual-check's image would: the CLI starts the browser itself, with no Docker. It needs the image's marker (`/etc/visual-check/chromium.json`) and no `docker` on the `PATH`, and it doesn't need `TEST_STORYBOOK_IMAGE`. It runs the first eight cases above, then these two in place of the three that kill the CLI or the browser's container:

- With `platform: 'host'`, `test` uses the image's browser and gives exactly the expected outcomes.
- With `platform: 'linux/arm64'`, `test` exits 2 before any capture, and its message names the image's architecture and the configured platform.

The host case takes 2 workers from the config. The deliberate change runs with `'auto'`, which here reads the machine's own CPUs and memory, since no Docker is used.

Mount the repo and a Linux Node into the image, with no network so that nothing can be downloaded. Build the CLI and the Storybook first, as in the next section, and `$NODE_DIR` is a Linux amd64 Node installation (the committed baselines are linux/amd64, so only the amd64 image works):

```sh
docker run --rm --network none -e CI=true -v "$PWD:$PWD" -v "$NODE_DIR:/opt/node:ro" -w "$PWD/test-storybooks/storybook-10-react" \
  -e PATH=/opt/node/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
  visual-check-chromium:amd64 node e2e.ts --inside-image
```

CI's "Inside the image" job does this on every PR.

## Running it on the host

`--host` checks `platform: 'host'` on your machine, in place of all the cases above. It needs no `TEST_STORYBOOK_IMAGE` and no Docker. Two cases capture `card--default` against baselines the run writes, since the committed ones need the image's fonts:

- With an empty cache, `update` (with `CI` unset) downloads the headless shell, says so, writes the baseline, and leaves the cache's marker for this machine's build.
- `test` then downloads nothing and passes.

The cache is `VISUAL_CHECK_CACHE_DIR` when set, which must name an empty or missing folder, else a temporary folder removed at the end. `--no-docker` adds a case for a machine with no `docker` on the `PATH`: with the default platform, `test` exits 2 with the no-Docker error before any capture.

```sh
pnpm turbo run e2e --filter @visual-check/test-storybook-10-react -- --host --no-docker
```

CI's "Ubuntu host" job runs `--host` where Chromium's sandbox can't start, so the CLI relaunches without it. "macOS without Docker" runs `--host --no-docker`.

## Rewriting the baselines

Baselines must come from the default `linux/amd64` platform, the one CI renders on. Build the CLI, `@visual-check/storybook`, which the stories import, and the Storybook:

```sh
pnpm turbo run build build-storybook --filter @visual-check/test-storybook-10-react...
```

Serve `storybook-static/` on `127.0.0.1` with any static server, then from this folder, with `CI` unset:

```sh
TEST_STORYBOOK_IMAGE=visual-check-chromium:amd64 pnpm exec visual-check update --all --url http://127.0.0.1:<port>
```

Run `test` the same way to check them, update `expected-outcomes.json` when a story is added or its outcome changes, and commit both. The disabled stories are never captured, so they get no baseline and no entry there. With an ordinary static server `FontNeverLoads` passes, since its font file 404s, though `expected-outcomes.json` gives it as broken; the end-to-end check, whose server never answers that file, confirms its outcome.

`update` leaves the baselines of the broken stories as they are, apart from `FontNeverLoads`: an ordinary static server 404s its font file, so there the story passes and `update` writes it in the fallback font. To rewrite another broken story's, take its failure out as its section above says, build the Storybook, run `update --filter` with the story's ID, then put the failure back and build again. For `wait--throws`, that's its `wait` with the `throw` taken out, and `update --filter '^wait--throws$'`.
