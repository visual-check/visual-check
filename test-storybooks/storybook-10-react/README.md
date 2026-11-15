# @visual-check/test-storybook-10-react

One of this repo's own test Storybooks ([PRD 18](../../docs/prd/18-repo-ci.md#this-repos-own-test-storybooks)): a private React Storybook on Storybook 10 with a few plain stories, a set of [hazard stories](#the-hazard-stories) and a set of [readiness stories](#the-readiness-stories), their committed baselines in `.visual-check/baselines/` and the expected outcome of every story in `expected-outcomes.json`.

The React test Storybooks on Storybook 9.1 ([`storybook-9-react`](../storybook-9-react/README.md)) and 11 ([`storybook-11-react`](../storybook-11-react/README.md)) read these stories, take their config from `.storybook/test-storybook-config.ts` as this one does, and run this `e2e.ts` from their own folders.

`e2e.ts` is its end-to-end check. It serves the static build on `127.0.0.1`, runs the built CLI against it and checks nine cases. Inside visual-check's image the last three are replaced, and on the host other cases run; see below.

- `test` against the committed baselines, with 2 workers, gives exactly the expected outcomes. The line of each broken readiness story says why: what it threw, that Storybook never sent `storyFinished`, or the font face `Never Loads`. Its stderr has no test-path warning.
- `update` into an empty folder writes every story that isn't broken, `test` then passes them and finds the broken ones missing, and the baselines of the stories expected to pass are byte-identical to the committed ones. When they aren't, the written baselines are copied to `e2e-output/`. Both commands take 2 workers from the config.
- With 1 worker, the two storage stories run one after the other on the same page and both pass. Each checks that visual-check's markers aren't in cookies, `localStorage`, `sessionStorage` or IndexedDB, then writes them and checks they stuck, so the second fails when storage isn't cleared between captures. A broken storage story's line gives only Storybook's generic status: the stores it found are named in the error it throws in its page, which the CLI doesn't print. Opening the story in an ordinary browser won't show them, because nothing clears storage there, so every store holds the marker from the second visit on.
- With 1 worker and a `readyTimeout` of 60 s, the hazard stories run one after the other, and `test` gives exactly their expected outcomes. The story that navigates away says it went to `/categories/burgers`, and the server is asked for its page 3 times: once, then on each of its 2 retries. The story that crashes says its page crashed. The stories after `BeforeUnload` and `Crashes` pass: the first loads once the `beforeunload` dialog is accepted, the second on a fresh page.
- A stylesheet that changes the card story makes `test` exit 1 with that story differing.
- A script that gives every `iframe.html` a plain browser's `navigator.userAgent`, without `StorybookTestRunner`, takes Storybook off its test path. `test` with 2 workers passes the button stories and exits 0, and its stderr warns exactly once that the Storybook seems to ignore the test path's user agent, naming `Storybook react` and the version of the `storybook` package installed in the folder. The case writes its own config naming the Storybook `react`, so the warning names `react` whichever folder the check runs from.
- Killing the CLI while it captures leaves none of its containers behind.
- With 2 workers, `docker kill` on the browser's container while both workers capture breaks those 2 stories, each line saying the browser exited. The browser relaunches for the stories left, which get their expected outcomes, `test` exits 1, its stderr says the browser exited and visual-check relaunches it once, and none of its containers is left.
- With 2 workers, `docker kill` on the browser's container while both workers capture, then on the relaunched browser's once it captures, stops `test` with exit 2. The first browser's 2 stories are broken, each line saying the browser exited, and no other story finished. Its stderr says the browser exited and visual-check relaunches it once, then that the browser exited again and "Run visual-check again.", and none of its containers is left.

The server never answers `/visual-check-e2e/never-loads.woff2`, the font file `FontNeverLoads` asks for, so that story is broken in every case; stopping the server drops the request. A story page is an `iframe.html` with an `id`. The page visual-check reads every story's options on, `iframe.html?viewMode=story`, has none: the server never holds it, and the kill cases don't count it. The markup a case adds goes into every `iframe.html`, that page included, at the end of its `<head>`. The deliberate change and the CLI kill run with the default `workers`, `'auto'`. In the last three the server holds every story page, so the run is still capturing when the kill comes, and containers that were there before the run don't count. Where the browser exits once, the server answers the story pages right after the kill, so the stories left can pass; where it exits twice, it holds them throughout.

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

## Running the end-to-end check

`e2e.ts` works in the folder it starts in, so the 9.1 and 11 test Storybooks run the same file from their own folders.

Until the browser image is published, every run names a locally built image through `TEST_STORYBOOK_IMAGE`. From the repo root:

```sh
packages/chromium/image/build.sh amd64 --output type=docker,name=visual-check-chromium:amd64
TEST_STORYBOOK_IMAGE=visual-check-chromium:amd64 pnpm turbo run e2e --filter @visual-check/test-storybook-10-react
```

Turbo builds the CLI and the Storybook first. The check prints one line per case, then each of its problems, and exits 1 when any case fails.

## Running it inside visual-check's image

`--inside-image` runs the check the way a job container on visual-check's image would: the CLI starts the browser itself, with no Docker. It needs the image's marker (`/etc/visual-check/chromium.json`) and no `docker` on the `PATH`, and it doesn't need `TEST_STORYBOOK_IMAGE`. It runs the first six cases above, then these two in place of the three that kill the CLI or the browser's container:

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

Baselines must come from the default `linux/amd64` platform, the one CI renders on. Build the CLI and the Storybook:

```sh
pnpm turbo run build build-storybook --filter @visual-check/test-storybook-10-react...
```

Serve `storybook-static/` on `127.0.0.1` with any static server, then from this folder, with `CI` unset:

```sh
TEST_STORYBOOK_IMAGE=visual-check-chromium:amd64 pnpm exec visual-check update --all --url http://127.0.0.1:<port>
```

Run `test` the same way to check them, update `expected-outcomes.json` when a story is added or its outcome changes, and commit both. With an ordinary static server `FontNeverLoads` passes, since its font file 404s, though `expected-outcomes.json` gives it as broken; the end-to-end check, whose server never answers that file, confirms its outcome.

`update` leaves the baselines of the broken stories as they are, apart from `FontNeverLoads`: an ordinary static server 404s its font file, so there the story passes and `update` writes it in the fallback font. To rewrite another broken story's, take its failure out as its section above says, build the Storybook, run `update --filter` with the story's ID, then put the failure back and build again.
