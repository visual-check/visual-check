# @visual-check/test-storybook-10-react

One of this repo's own test Storybooks ([PRD 18](../../docs/prd/18-repo-ci.md#this-repos-own-test-storybooks)): a private React Storybook on Storybook 10 with a few plain stories, a set of [hazard stories](#the-hazard-stories), a set of [readiness stories](#the-readiness-stories), a set of [per-story options stories](#the-per-story-options-stories), a set of [animation stories](#the-animation-stories), a set of [capture area stories](#the-capture-area-stories), a set of [mask stories](#the-mask-stories), a set of [remote content stories](#the-remote-content-stories), a set of [network stories](#the-network-stories), a set of [mode stories](#the-mode-stories), a set of [grid stories](#the-grid-stories), a set of [forced states stories](#the-forced-states-stories) and a set of [page errors stories](#the-page-errors-stories), their committed baselines in `.visual-check/baselines/` and the expected outcome of every snapshot in `expected-outcomes.json`. Every story renders beside Storybook's pseudo-states addon, `storybook-addon-pseudo-states`, which `.storybook/test-storybook-config.ts` loads from each test Storybook's own package; on its own it changes no snapshot. A snapshot is a story's default capture, keyed by the story ID, or one of the modes it lists, keyed `<story-id>.<mode>`; its baseline is `<key>.png`.

The React test Storybooks on Storybook 9.1 ([`storybook-9-react`](../storybook-9-react/README.md)) and 11 ([`storybook-11-react`](../storybook-11-react/README.md)) read these stories, take their config from `.storybook/test-storybook-config.ts` as this one does, and run this `e2e.ts` from their own folders.

`e2e.ts` is its end-to-end check. It serves the static build on `127.0.0.1`, runs the built CLI against it and checks thirty cases. Every run of the CLI is without `CI` in its environment, unless a case sets its own, so the outcomes don't depend on where the check runs. The server leaves the two `load-fails` stories out of `index.json`, except in the first four cases below. Inside visual-check's image the last three are replaced, on the host other cases run, and on the arm64 image only the checks of the first, without the `load-fails` stories, and with `--oldest-browser` one smoke case; see below.

- `test` against the committed baselines, on a server whose `index.json` lists every story, the two `load-fails` stories included, with 2 workers, gives exactly the expected outcomes. The line of each broken readiness story says why: what it threw, that Storybook never sent `storyFinished`, or the font face `Never Loads`. So does the line of each broken per-story options story: what its `wait` hook threw, or that its stories file failed to load and what the file threw. So does the line of each broken capture area story: that its element selector `matched nothing` or a `box of zero size`, that the full page is `over 32,767 on a side. Set element`, or how far content reaches past the viewport's right edge, the card's right and bottom edges or the page's left edge. So does the line of the broken grid story: that the grid is `wider than the 1280 px viewport`. The two disabled stories have no line, though `index.json` lists them, and the header counts exactly the snapshots in `expected-outcomes.json`, the modes' included. `modes--dark-and-mobile` has exactly three lines, `modes--own-modes-only` has none for `dark`, and `modes--modes-only` has exactly two, one per mode, and none for its default capture. Its stderr has no test-path warning. In the 9.1 and 11 test Storybooks, every committed `animations--*.png` is byte-identical to this Storybook's, and both folders hold the same ones, so on 11, Storybook's own pause of animations followed by visual-check's end state gives snapshots that pass against 10's baselines within the tolerance. Its stdout's last line is `Report: .visual-check/report/report.json`, and that `report.json` counts exactly the expected outcomes and lists an entry for each snapshot that doesn't pass, with its outcome as the status, and none for a plain pass. Its `images/` folder holds exactly the images the entries list. The entry of each broken readiness, per-story options, capture area and grid story gives its reason, an image of its page in `images.snapshot`, and no baseline or diff: `error` for the render that throws; `play-threw` for the `play` that throws, with its message and a non-empty `details.play.stack`, which shows the stack reaches visual-check through Storybook's channel, and for the `play` that leaves an unhandled error, with a `console` message of level `error`; `timeout` with `details.timeoutMs`; `fonts-not-loaded` with `Never Loads` in `details.pendingFonts`; `wait-threw`; `element-missing` for the element selector that matches nothing and the one that matches a box of zero size; `grid-too-wide` with `details.grid`, the grid's width, 1400, and the viewport's, 1280; and `overflows` with `details.overflow`, each side, the area and the viewport's width, for the three stories that overflow. `capture-area--too-tall` is `too-tall` with `details.size` and no image, and each `load-fails` story is `load-failed` with the file's error in `details.loadError` and no image.
- `test --all` with `CI=true` against the committed baselines, on a server whose `index.json` lists every story, the two `load-fails` stories included, stops before capturing: its consistency check finds those two stories broken, and nothing else, since every other story has a committed baseline and the folder holds no orphan. It exits 1, its only snapshot lines are those two stories', each saying that its stories file failed to load and what the file threw, its header is the consistency output's, `visual-check <version> · test · consistency · <n> snapshots`, counting exactly the snapshots in `expected-outcomes.json`, and its stdout ends with `In CI, test stops before capturing when the consistency check finds anything.` The server is asked for no story page.
- `test --consistency` against the committed baselines, on a server whose `index.json` lists every story, the two `load-fails` stories included, and without `CI`, captures nothing: it finds those two stories broken, and nothing else. It exits 1, its only snapshot lines are those two stories', each saying that its stories file failed to load and what the file threw, its header is the consistency output's, counting exactly the snapshots in `expected-outcomes.json`, and its stdout has no line about CI. The server is asked for no story page. Its report has `consistencyOnly: true` and counts and lists exactly those two stories, `load-failed`, with the file's error and no image.
- `test --shard k/4`, for each `k` from 1 to 4, one after the other, against the committed baselines with 2 workers, on a server whose `index.json` lists every story, the two `load-fails` stories included, runs one shard's share of the stories files. Each shard's header says `· test · shard k/4 ·`, the line after it is `Missing baselines and orphans are left to test --consistency.`, it exits with the code its snapshots' expected outcomes give, and the server is asked only for story pages of the stories files the shard has lines for. Each shard's report, read before the next shard replaces it, has `shard: { index: k, total: 4 }`, and counts and lists the expected outcomes of the shard's snapshots. Together the four print exactly one line for each snapshot in `expected-outcomes.json`, with its expected outcome, and each stories file `index.json` lists has lines in exactly one shard.
- `test` runs the animation stories against the committed baselines 10 times, one run after the other on one server, with a config that sets 2 workers, `retries: 0` and `tolerance: { pixels: 0 }`, and every run passes them all. With no retries and no pixel allowed to differ, every pixel of each snapshot is within the preview's color tolerance, 0.01, of its baseline on every run. The case reports every run's problems, each led by its run's number, so a story whose snapshot changes shows how often it did. A run that times out or that a signal ends stops the case, since that's a broken setup rather than a snapshot that changed.
- `update` into an empty folder writes every story that isn't broken, `test` then passes them and finds the broken ones missing, and its report counts and lists those outcomes, each missing entry with no image. Right after that, `test --consistency` with the same config exits 1: it finds exactly the broken stories missing, since `update` writes no baseline for them, and nothing else, so its stdout ends with `15 missing`, its header counts exactly the snapshots in `expected-outcomes.json`, and the server is asked for no story page during that run. The baselines of the stories expected to pass are byte-identical to the committed ones. When they aren't, the written baselines are copied to `e2e-output/`. `update`'s standard error ends with its network warning, which is exactly two lines, each led by the [remote origin](#the-remote-origin)'s host, `localhost` on the server's port: one that `network--real-fetch` makes real network requests, then one that `network--remote-image` shows remote content. So `MockedFetch`, the remote content stories and every other story aren't listed, and no other host gets a line. Both commands take 2 workers from the config.
- With 1 worker, the two storage stories run one after the other on the same page and both pass. Each checks that visual-check's markers aren't in cookies, `localStorage`, `sessionStorage` or IndexedDB, then writes them and checks they stuck, so the second fails when storage isn't cleared between captures. A broken storage story's line gives only Storybook's generic status: the stores it found are named in the error it throws in its page, which the CLI doesn't print. Opening the story in an ordinary browser won't show them, because nothing clears storage there, so every store holds the marker from the second visit on.
- With 1 worker and a `readyTimeout` of 60 s, the hazard stories run one after the other, and `test` gives exactly their expected outcomes. The story that navigates away says it went to `/categories/burgers`, and the server is asked for its page 3 times: once, then on each of its 2 retries. The story that crashes says its page crashed. The stories after `BeforeUnload` and `Crashes` pass: the first loads once the `beforeunload` dialog is accepted, the second on a fresh page. The report counts and lists the expected outcomes. The entry of `hazards--crashes` is `crashed`, with no image. The entry of `hazards--navigates-away` is `navigated-away`, with no image, `details.url` ending `/categories/burgers`, and in its `console` the warning its `play` logs before it follows the link, which shows console messages survive the navigation.
- A stylesheet that changes the card story makes `test` exit 1 with that story differing.
- A script that sets `globalThis.__visualCheckE2eGrow` widens the bar `masks--grows` masks from 200 to 300 px, so its mask grows with it, and `test --filter '^masks--grows$'` exits 1 with that story differing.
- A stylesheet that draws one black pixel on the white page beside the card, through a fixed `body::after` that takes no space in the layout, changes one pixel of `card--default`'s snapshot. `test` on that story alone, with a config that sets `tolerance: { pixels: 0 }`, exits 1: the story differs, its line says `1 differ, 0 allowed`, and the report beside the config lists it `differs`, `pixels`, with `pixels: { differ: 1, allowed: 0, budget: 0, scale: 1 }` and its baseline, snapshot and diff, which `.visual-check/report/images/react/` holds as `card--default.baseline.png`, `.snapshot.png` and `.diff.png`. With the default tolerance, the same `test` passes it.
- The same stylesheet as the deliberate change goes into the card story's first page load only, so a retry captures the story as its baseline has it. `test` on that story alone, with a config that leaves `retries` at its default, `1`, passes it flaky and exits 0: its line ends with `· flaky`, `test` lists it under `Flaky snapshots, which passed on a retry:`, its counts say `1 passed (1 flaky)`, and the report beside the config lists it passed with `flaky: true`, `attempts: 2` and its first capture's baseline, snapshot and diff, which it holds. With `retries: 0`, `test` exits 1 with the story differing, and the server is asked for its page once. With `retries: 2` and the stylesheet in its first 2 page loads, `test` passes it flaky after 3 page loads, with `attempts: 3`.
- Four stability cases run `update` on the card story alone, each on a server of its own whose `index.json` lists only that story: `update` takes every snapshot whose baseline is missing whatever the selection, so with every story listed it would write the baselines of all the others. The server adds the case's markup to the story's page loads, load by load. The config's baselines folder holds the story's committed baseline, or nothing where the case has it missing, and after the run it must hold that baseline alone, byte-identical to the committed one, so nothing else is written. When the baseline isn't the committed one, it's copied to `e2e-output/update-stability/<case>/`. Each runs `update --reporter json`, so its lines are on stderr and its stdout is one `update` document. With the deliberate change's stylesheet in the first page load only and the baseline there, the first load differs from the baseline and the second is within tolerance of it: `update` keeps the baseline untouched after 2 page loads, its line says `kept · flaky`, it lists the story under `Flaky snapshots, whose loads disagreed:` at the end of its lines, and it exits 0. Its document counts the story `kept` and `flaky` and lists no entry, since a kept baseline is only counted.
- With the baseline missing and the same stylesheet in the first page load only, the first two loads disagree and the third agrees with the second, so `update` writes the third after 3 page loads, byte-identical to the committed one. Its line says `written: missing · flaky`, it lists the story as flaky, and it exits 0. Its document lists it `written`, `missing`, with `flaky: true` and `attempts: 3`.
- With a red, a green, then a blue card in the first 3 page loads, each logging its load's number, and the baseline there, no two loads agree, so after 3 page loads the story is broken: its line says `No two of the story's 3 loads agreed, so its baseline wasn't written.`, and `update` exits 1 with the baseline untouched and no flaky snapshot listed. Its document lists it `broken`, `unstable`, with that message and `attempts: 3`, and of the loads' console messages its `console` keeps the third's alone.
- With a script in every page load that logs a warning, adds a fixed clock and sets its text to `Date.now()` at once and every 50 ms after, so even a fast machine's first capture shows it, and the baseline there, the first load's page captured again a second later differs, so after 1 page load the story is broken: its line says `The story changed in the second after its capture:`, how many pixels differ and how many are allowed, then `Use its wait hook to wait until it settles.`, and `update` exits 1 with the baseline untouched and no flaky snapshot listed. Its document lists it `broken`, `changed-after-capture`, with that message and `attempts: 1`, and its `console` keeps the warning.
- A script that sets `globalThis.__visualCheckE2eUnmask` drops the mask `remote` of `remote-content--every-kind`, so its snapshot shows the remote content its baseline has masked. `test` on that story alone exits 1 with it differing. Every differing pixel of its retry lies inside remote content, so its failure in the end block holds the one-line hint: that it differs only inside remote content from `localhost` on the server's port, the mask `{ host: 'localhost:<port>' }` and the docs page. visual-check reads the mask on the options-reading page, which gets the script too.
- Once asked for `card--default`'s page, the server destroys the connection of every request for its stories file, `assets/card.stories-<hash>.js`. The options-reading page asks for it first, so it gets the file. `test` on that story alone, with `retries: 0`, exits 1 with it broken: its line says its page couldn't load that file from Storybook, with the browser's `net::ERR_` error, its failure in the end block holds the hint about the server, naming `python3 -m http.server`, and its `report.json` entry has a `failed-loads` hint whose first file is that stories file.
- A script that gives every `iframe.html` a plain browser's `navigator.userAgent`, without `StorybookTestRunner`, takes Storybook off its test path. `test` with 2 workers passes the button stories and exits 0, and its stderr warns exactly once that the Storybook seems to ignore the test path's user agent, naming `Storybook react` and the version of the `storybook` package installed in the folder. The case writes its own config naming the Storybook `react`, so the warning names `react` whichever folder the check runs from.
- With a script in every page that asks `InvalidWhenAsked` for invalid options, `test` exits 2 before any capture. Its stderr names the story, `options--invalid-when-asked`, and the key, `visualCheck.tolerance.pixels`, and its stdout is empty.
- With a script in every page that asks `InvalidModeWhenAsked` for invalid modes, `test` exits 2 before any capture, and its stdout is empty. It runs twice. With `undeclared`, the stderr names the story, `modes--invalid-mode-when-asked`, and the key, `visualCheck.modes.e2e-undeclared.globals.e2eNever`, a global Storybook doesn't declare. With `pinned`, it names the story, the key `visualCheck.modes.dark.globals.theme` and says the story pins it. The CLI reads the declared globals from the real Storybook, in a way that differs between versions, so this case is the only check of that read against Storybook 9.1, 10 and 11.
- Three runs in one temporary folder check the JSON and the error report. With a copy of the committed baselines, in which `card--default.png` is `capture-area--element.png`, the card alone at 320 × 160, and a stray `stray--orphan.png` beside them, `test --reporter json` on `card--default` alone exits 1: its stdout is exactly `report.json`, one document on one line, its stderr holds the header, and its stderr's last line is the report line. The report counts 1 differs and 1 orphan. It lists the story `differs`, `size`, with `size: { baseline: [320, 160], snapshot: [1280, 720] }` and its baseline, snapshot and diff, which the report holds, and the orphan with `story: null` and its baseline copied to `images/react/stray--orphan.baseline.png`. Then, with the server stopped, `test --all` exits 2, its stderr's last line is the report line, and the report holds only the error: `error.storybooks` names `react` at the stopped server's URL, there's no entry, and none of the first run's images is left. Last, over a report folder made beforehand, `update --reporter json` on `card--default` alone, on a server whose `index.json` lists only that story, into a baselines folder that holds the 320 × 160 baseline as `card--default.png` and a stray `stray--orphan.png`, exits 0 and prints one `update` document on one line, with `reportDir: null`. It counts 1 written and 1 deleted, and lists that story `written` because it `differs`, then the orphan `deleted`, with `story: null`. The baselines folder then holds the committed `card--default.png` alone, byte for byte, and the report folder is left byte for byte as it was.
- With the page errors script in every page, `test` of every [page errors story](#the-page-errors-stories) against the committed baselines exits 1, though every snapshot passes, since some have page errors that fail it. Its end block heads its page errors block `── 10 snapshots with page errors, 9 of which fail the run · 1 stale expected page error ──`, and its report counts every snapshot passed and lists those 11 alone, passed, each with its page errors, in order: their kind, their message, or for a load its full URL on the server and its load error, `HTTP 404`, `HTTP 500` or a `net::ERR_` error, and their severity. `Stale`'s lists no page error and the stale entry `"an error this story stopped raising"`, `Warn`'s its `console.error` with severity `warn`, and of `TwoModes` only the `dark` snapshot is listed. `WorkerError`'s 500 is a load page error with `HTTP 500`.
- With the same script, `test` of each story that raises one kind of page error nothing expects, `ConsoleError`, `UncaughtError`, `UnhandledRejection`, `MissingFile`, `ServerError`, `DroppedLoad` and `WorkerError`, alone, one after the other, exits 1 though the story passes, and its report lists the story with that page error alone.
- With the same script, `test` of `ConsoleWarn`, `OtherOrigin`, `ExpectedWorkerError`, `ExpectedErrors`, `Stale`, `Warn` and `Off` exits 0 with every snapshot passed, and its report lists only `Stale` and `Warn`.
- With the same script and a config whose `expectedPageErrors` are `ExpectedByConfig`'s message as a string and its file's URL as a regular expression, `test` of `ExpectedByConfig` and `ConsoleWarn` exits 0 with both passed, and its report lists neither: the config expects the first's page errors, and a config's entries never go stale.
- With the same script, on a server whose `index.json` lists only `MissingFile`, `update --reporter json` of that story into an empty baselines folder exits 0 and writes its baseline, byte-identical to the committed one. Its lines, on standard error, hold `── 1 snapshot with page errors ──`, which update never says fails the run, and its page error marked `(fails test)`, and its document counts it written and lists it `written`, `missing`, with its page error.
- Killing the CLI while it captures leaves none of its containers behind.
- With 2 workers, `docker kill` on the browser's container while both workers capture breaks those 2 stories, each line saying the browser exited. The browser relaunches for the stories left, which get their expected outcomes, `test` exits 1, its stderr says the browser exited and visual-check relaunches it once, and none of its containers is left. Its stdout's last line is the report line, and the report counts and lists those outcomes, the 2 stories `broken`, `browser-exited`, with no image.
- With 2 workers, `docker kill` on the browser's container while both workers capture, then on the relaunched browser's once it captures, stops `test` with exit 2. The first browser's 2 stories are broken, each line saying the browser exited, and no other story finished. Its stderr says the browser exited and visual-check relaunches it once, then that the browser exited again and "Run visual-check again.", and none of its containers is left. Its stderr's last line is the report line, and the report holds only the error: `exitCode: 2`, an `error.message` and no entry.

The server never answers `/visual-check-e2e/never-loads.woff2`, the font file `FontNeverLoads` asks for, so that story is broken in every case; stopping the server drops the request. It answers `/visual-check-e2e/server-error` with a 500 and destroys the connection of `/visual-check-e2e/dropped`, which only the page errors stories ask for. A story page is an `iframe.html` with an `id`. The page visual-check reads every story's options on, `iframe.html?viewMode=story`, has none: the server never holds it, and the kill cases don't count it. The markup a case adds goes into every `iframe.html`, that page included, at the end of its `<head>`, apart from the flaky and stability cases', which go only into the card story's page loads, load by load. Storybook's own scripts there are modules, which run once the document is parsed, so a script the case adds runs before Storybook imports any stories file. The deliberate change, the growing mask and the CLI kill run with the default `workers`, `'auto'`. In the last three the server holds every story page, so the run is still capturing when the kill comes, and containers that were there before the run don't count. Where the browser exits once, the server answers the story pages right after the kill, so the stories left can pass; where it exits twice, it holds them throughout. A case that runs with `--url` and no config of its own takes the config in the folder the check runs from, so `test` writes its report to `.visual-check/report/` there, which git ignores.

## The hazard stories

`stories/hazards.stories.tsx` has one story for each thing a page can do that visual-check deals with itself. They're in this order, so that with 1 worker `BeforeUnload` and `Crashes` are each followed by a story that passes:

- `Alert`, `Confirm` and `Prompt` open their dialog as they render. visual-check accepts the alert and dismisses the other two, so the snapshots show `alert() returned`, `confirm() returned false` and `prompt() returned null`.
- `BeforeUnload` leaves a `beforeunload` handler that asks to stay, so the next story's `goto` on the same page opens a dialog. visual-check accepts it, so that story loads; dismissing it would cancel the navigation and break that story.
- `Popup` opens a popup in a loader, which visual-check closes. The loader waits until it's closed, so a popup left open makes the loader throw, which breaks the story.
- `Crashes` allocates in `play` until its page reaches V8's heap limit, about 3.8 GB, and its renderer crashes: within a few seconds on a Mac, but 14 to 19 s on CI's runners, which is why the hazards case gives it 60 s. It's broken, `crashed`, and isn't retried; the next story gets a fresh page.
- `Download` clicks a download link, which visual-check denies. The page can't tell a denied download from an allowed one, so this only checks that a download doesn't hold up the capture.
- `Permissions` asks for the notification and geolocation permissions in a loader. visual-check denies both, so the snapshot shows `denied` and geolocation's `PERMISSION_DENIED` error.
- `SrcdocIframe` shows an iframe with a `srcdoc` document, which visual-check captures with the page. `play` waits for that document's own text, since the iframe's first, empty document is complete at once.
- `NavigatesAway` logs the warning `Following the burgers link`, then follows a link to `/categories/burgers` in `play` and waits forever, so its page always leaves before Storybook reports it finished. It's broken, `navigated-away`, after 2 retries, and its report entry keeps the warning from the document it left.

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

Five stories files cover per-story options. Four of them set `parameters.visualCheck` through `visualCheck` from `.storybook/visual-check.ts`, which declares four modes: `narrow`, 375 px wide, and `wide`, 1600 px wide, which set only a viewport; `dark`, which sets the `theme` global to `dark`; and `mobile`, 375 × 667 at scale 2 with touch. Only the mode stories list `dark` or `mobile`. It imports `@visual-check/storybook`'s built `dist`. Turbo builds it before `build-storybook`, but `pnpm storybook` runs without Turbo, so on a fresh checkout build it first, from the repo root: `pnpm turbo run build --filter @visual-check/storybook`.

Every React test Storybook's preview also loads `.storybook/shared-preview.ts`, through `previewAnnotations` in `.storybook/test-storybook-config.ts`. It isn't named `preview.ts`, so Storybook doesn't load it on its own. It declares the `theme` global in `initialGlobals`, as `light`, so the `dark` mode can set it in the story's URL. Its decorator wraps the story in a dark surface, `#111` with `#eee` text, only when `theme` is `dark`; with `light` it renders the story as it is. It also sets three options for every story, none of which changes a snapshot:

- `tolerance: { color: 0.01 }`, the default color tolerance.
- The mask `e2e-never`, for `[data-visual-check-e2e-never]`, which no story has.
- A `wait` hook that sets the text of the story's `[data-wait-target]` element to `preview wait ran`, when it has one. Only the wait stories do.

The stories files:

- `merged-options.stories.tsx` has one story, `Default`, which shows its merged `parameters.visualCheck` as JSON, with each function as `a function`. Its meta and the story each set every option but `wait` and `disable`, so the snapshot pins how Storybook merges them: `modes` is the story's empty list, so all four modes are `null`; `viewport` is `{ width: 1280, height: 720 }` and `tolerance` is `{ color: 0, pixels: 0 }`, merged key by key; `masks` holds `e2e-never`, `never-a` and `never-c`, with `dropped` set to `null`; `element` is the story's `null`; `wait` is the preview's. None of it changes the capture: the viewport is the config's default, no mask matches anything, `element: null` is the full page, and no mode is listed.
- `wait.stories.tsx` has one story for each way a story gets its `wait` hook:
  - `InheritsPreviewWait` sets no `wait`, so the preview's writes `preview wait ran` into its note.
  - `OwnWait`'s own `wait` replaces the preview's and writes `story wait ran`.
  - `WaitTurnedOff` sets `wait: null`, so the note still says `wait didn't run`.
  - `AwaitsLateContent` shows `Late content` 1500 ms after it renders, long after Storybook reports it finished. Its `wait` finds that text through `canvas`, which visual-check builds from `storybook/test` as `play` gets it, so the snapshot shows `Late content`.
  - `Throws`'s `wait` throws. It's broken, `wait-threw`.
- `disabled.stories.tsx` sets `disable: true` on its meta. `Skipped` inherits it, so visual-check never captures it, prints a line for it or counts it. `BroughtBack` sets `disable: false` and passes.
- `options.stories.tsx` has `DisabledOnItsOwn`, which sets `disable: true` on the story alone and is left out the same way, and `InvalidWhenAsked`. That one passes, unless the page's `globalThis.__visualCheckE2eInvalidOptions` is `true` when its stories file is imported. Then its hand-written `parameters.visualCheck` sets `tolerance.pixels` to `'120%'`, which the invalid-options case checks.
- `load-fails.stories.tsx` throws as the browser imports it, so loading it fails, and both its stories, `First` and `Second`, are broken, `load-failed`. Storybook's indexer reads the exports without running the file, so the build succeeds and `index.json` still lists them. The throw sits behind a `window` check only because an unconditional top-level throw would make the rest of the file unreachable, which Biome's `noUnreachable` rejects. Every browser has a `window`, so the check changes nothing there.

`Throws` has a committed baseline, the story with a `wait` that does nothing. The two `load-fails` stories need none: visual-check breaks them before it reads a baseline. The server's `index.json` leaves them out, except in the cases that check the load failure.

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
- `CssSvgAnimations` shows SVG with SMIL animations as CSS images: a `::before`'s background from a `data:image/svg+xml` URL, and an `::after`'s `content` from a file URL, whose path ends in `.svg`, imported with Vite's `?no-inline`. An SVG image's clock is out of reach of scripts, so visual-check rewrites each SVG with its animations held, and the snapshot shows both at time 0.
- `Gifs` shows a GIF from a file URL, whose path ends in `.gif`, and from a `data:image/gif` URL, imported with Vite's `?no-inline` and `?inline`. The snapshot shows both on their first frame.

On the test path, Storybook 9.1 and 10 add two stylesheets that pause every animation after `play`, which visual-check empties, so the stories keep running until visual-check finishes them. Storybook 11 itself finishes finite CSS animations and transitions after `play`, and parks infinite ones on their first frame, but leaves script animations alone. visual-check's end state then takes what's left. Each animation story has the same baseline file on 9.1, 10 and 11, and `test` passes its snapshot against it on each, within the tolerance.

visual-check leaves some motion to the project, so no story has it: SVG in `<img>`, GIFs as CSS backgrounds or cross-origin without CORS, APNG, animated WebP, canvas, Lottie and other script-driven motion.

## The capture area stories

`stories/capture-area.stories.tsx` has one story for each area visual-check captures, or can't. Its stories are laid out with no padding, so a page is as tall as its content. Its meta sets `element: '[data-capture-me]'`, which each story inherits or overrides:

- `FullPage` sets `element: null` and `growViewport: false`, so the snapshot is the full page, captured beyond the viewport without growing it: the viewport's width by the content's height, 1280 × 2000. The page has a fixed header, a hero `100vh` tall and four bands, and `play` opens a modal `<dialog>` that's portaled to `document.body`. The snapshot shows the hero 720 px tall, the header once at the top, and the dialog and its backdrop over the first viewport only. The dialog has square corners: rounded ones over the translucent backdrop rasterize ±1 level differently between captures, which tolerance absorbs in `test`, but `update` would then write a baseline that isn't byte-identical to the committed one.
- `FullPageGrows` sets `element: null` and leaves the viewport's growth on, on a page of five 400 px sections and a save bar that sticks to the viewport's bottom, with a badge fixed 96 px above the viewport's bottom right corner. The viewport grows to the page, so the snapshot, 1280 × 2064, shows the save bar at the page's bottom, below the fifth section, and the badge 96 px above the page's bottom. Without the growth they'd sit mid-page, at the bottom of the first 720 px.
- `FullPageGrowsReacts` sets `element: null` and leaves the viewport's growth on, on a page of a scroll-spy rail and five 400 px sections, 2056 px tall. An `IntersectionObserver` marks the rail item of each section wholly in view, an animation frame after its callback, so in a 720 px viewport only the first is marked. Frames pass once the viewport grew, so the snapshot, 1280 × 2056, shows all five marked. Without them, the page would mark the others only after the capture, and `update` would find it changed in the second after it or its loads disagreeing ([#169](https://github.com/visual-check/visual-check/issues/169)).
- `FullPageShrinksWhileWaiting` sets `element: null` and leaves the viewport's growth on, on a page that shows a loading block 2400 px tall, then, 1500 ms after it renders, three 400 px sections in its place, 1200 px in all. The viewport grows to the loading block before the `wait` hook, which waits for the third section. The hook ran, so the page is measured again after it at the story's 720 px viewport, and the snapshot, 1280 × 1200, ends with the third section. Measured only before the hook, it would be 1280 × 2400, with a blank band 1200 px tall below the sections ([#174](https://github.com/visual-check/visual-check/issues/174)).
- `FullPageGrowsWhileWaiting` sets `element: null` and leaves the viewport's growth on, on a page that shows a short note saying it's loading, which fits the 720 px viewport, then, 1500 ms after it renders, `FullPageGrows`'s page, 2064 px tall. The viewport doesn't grow before the `wait` hook, which waits for the save bar. The hook ran, so the page is measured again after it and the viewport grows to it: the snapshot, 1280 × 2064, shows the save bar at the page's bottom and the badge 96 px above it. Measured only before the hook, the page would be captured beyond the 720 px viewport, with both mid-page ([#174](https://github.com/visual-check/visual-check/issues/174)). Its baseline is byte-identical to `FullPageGrows`'s.
- `Element` inherits the meta's `element`, so the snapshot is the card's box alone, 320 × 160, though the card is 1500 px down the page.
- `ElementOff` is the same page, but sets `element: null`, so the snapshot is the full page, 1280 × 1984, with the card 1500 px down.
- `ElementMissing`'s selector, `[data-not-there]`, matches nothing. It's broken, `element-missing`.
- `ElementZeroSize`'s selector matches an empty `div`, which has no height. It's broken, `element-missing`.
- `TooTall` sets `element: null` on a page 33,000 px tall, over the 32,767 device px a capture can be on a side. It's broken, `too-tall`, and its line says to set `element`.
- `WiderThanViewport` sets `element: null` on a page 1500 px wide, 220 px wider than the 1280 px viewport, so the capture would cut it. It's broken, `overflows`, with `details.overflow.right` of 220, and its line says how far past the viewport's right edge the content reaches.
- `WiderThanViewportClipped` is the same page with `overflow-x: hidden` on `body`, so the page cuts it itself and the story passes.
- `AllowsOverflow` is the same page with `allowOverflow: true`, so the cut is intended and the story passes: the snapshot is the page cut at the viewport's right edge, 1280 × 720.
- `ElementSpills` captures a card, 320 × 160, whose bar spills 80 px past its right edge and 40 px past its bottom edge, which the card doesn't clip. It's broken, `overflows`, with `details.overflow` of 80 right and 40 bottom.
- `ElementClips` is the same card with `overflow: hidden`, so it clips its bar and the story passes: the snapshot is the card's box, 320 × 160.
- `ElementPastLeftEdge` is the clipping card 64 px left of its place, 40 px past the page's left edge. It's broken, `overflows`, with `details.overflow.left` of 40.
- `ElementScaled` is a card drawn at 95% of its size, whose bar fills it. Its layout is 320 px wide but its box is drawn 304 px wide, so measuring one against the other would make a spill that isn't there. Nothing spills and the story passes: the snapshot is the card's drawn box, 304 × 152.

The six broken stories have committed baselines: `ElementMissing` and `ElementZeroSize` with `element: null`, the full page, `TooTall` 1000 px tall, and the three that overflow with `allowOverflow: true`, the cut capture. `WiderThanViewport`'s, `WiderThanViewportClipped`'s and `AllowsOverflow`'s are byte-identical. Every capture area baseline is byte-identical on 9.1, 10 and 11. Every story but `wait--wait-turned-off` runs a `wait` hook, the preview's or its own, so every full-page story with the growth on is measured again after it.

## The mask stories

Two stories files cover masks. visual-check paints each mask as an opaque magenta box, the config's default `maskColor`, in the top layer, so over a modal dialog too. They all pass:

- `masks.stories.tsx`:
  - `SelectorOverDialog` opens a modal `<dialog>` in `play` that holds a clock, which the mask `clock` covers by its selector, `[data-clock]`. The snapshot shows the dialog with a magenta box over the clock's text.
  - `HostOverDialog` opens a modal `<dialog>` in `play` that holds an image from the [remote origin](#the-remote-origin), which the mask `remote` covers by its host, `localhost`. The snapshot shows the dialog with a magenta box over the image.
  - `Grows` masks a bar by its selector, `[data-grows]`. The bar is 200 px wide, so the snapshot shows a magenta box 200 × 40, unless the page's `globalThis.__visualCheckE2eGrow` is `true` when its stories file is imported: then it's 300 px wide, which the growing mask case checks.
- `masks-merging.stories.tsx` has a meta that sets the masks `a` and `b`, over three boxes `a`, `b` and `c`:
  - `MergedByName` sets `b: null` and adds `c`. Storybook merges `masks` by name, so the snapshot shows `a` and `c` magenta and `b` as it is.
  - `AllDropped` sets `masks: null`, which drops every mask, the meta's and the preview's, so the snapshot shows all three boxes.

The dialogs have square corners, as `FullPage`'s has.

## The remote content stories

`stories/remote-content.stories.tsx` has a meta whose mask `remote` covers everything from the host `localhost`, the [remote origin](#the-remote-origin)'s. Its stories load a 48 × 48 teal square, `/remote-content/square.png`, from the `static` folder, which `staticDirs` serves at the Storybook's root. They all pass:

- `EveryKind` shows each kind of remote content the search finds in a labelled tile: an `<img>`, a `<picture>` whose `<source srcset>` picks the remote square, an SVG `<image>`, a video's `poster` with `preload="none"` and no `src`, `background-image`, `mask-image` on a violet box, `border-image`, `list-style-image` on a list, `content: url()` on a `::before`, a cross-origin iframe of `/remote-content/frame.html`, and a `srcdoc` iframe whose remote image overflows its bottom right corner. `play` waits for both iframes to load. The snapshot shows every tile's content magenta, the list as a whole, the cross-origin iframe by its border box, and the `srcdoc` iframe only where its image shows inside the frame. When the page's `globalThis.__visualCheckE2eUnmask` is `true` as the stories file is imported, the meta sets the mask to `null`, which drops it, for the remote content hint case.
- `ExcludedKinds` shows content the search leaves out: a `data:` image, a `blob:` image of the same-origin square, the same-origin square, a remote image with `visibility: hidden` next to the same-origin square, and text in a remote `@font-face` font. The snapshot shows none of it masked. The server sends no CORS headers, so the browser refuses the font and the text shows in the fallback font, but its `@font-face` names a remote URL all the same.
- `ServiceWorkerMocked` registers `/sw-scope/sw.js` in a loader with the scope `/sw-scope/` and waits until it's active, then shows `/sw-scope/frame.html`, which the worker controls, in an iframe. The frame shows the remote square twice. The worker answers the request whose URL has the marker `visual-check-e2e-mocked` with an orange square it fetches itself and wraps in a response of its own, as a mocking library does, and leaves the other alone. `play` waits until both have loaded. A mocked image doesn't taint a canvas, so visual-check drops it: the snapshot shows the orange square and a magenta box over the passed-through one. The scope keeps the worker off every other story's page.

### The remote origin

The stories load remote content from `localhost` on the story page's own port, a different origin from `127.0.0.1`, which the end-to-end check serves the Storybook on. The browser reaches loopback through visual-check's proxy, so both reach the same server. Viewed on `localhost`, as `pnpm storybook` prints it, the same content is same-origin, so the stories show no remote content and a run against that URL masks none of it. Serve the Storybook on `127.0.0.1` as the check does, and as [Rewriting the baselines](#rewriting-the-baselines) says.

## The network stories

`stories/network.stories.tsx` has one story for each kind of network use the warning at the end of `update` lists, or leaves out. Its meta sets no mask, and they all pass:

- `RealFetch` fetches the teal square from the [remote origin](#the-remote-origin) in a loader, with `mode: 'no-cors'`, since the server sends no CORS headers. That's a real network request, so `update` lists it on the remote origin's host's line. The snapshot shows only `fetched: opaque response, status 0`, no remote content.
- `MockedFetch` registers the remote content stories' service worker as `ServiceWorkerMocked` does, then shows `/sw-scope/fetch.html`, which the worker controls, in an iframe. The frame fetches a URL of the remote origin with the marker `visual-check-e2e-mocked`, which the worker answers with a response it made. Nothing goes over the network, so `update` doesn't list it. The server sends no CORS headers, so the fetch succeeds only when the worker answers it. `play` waits until the frame says what came back, and throws when the fetch failed. The snapshot shows `Mocked fetch answered 200, image/png`, and no remote content.
- `RemoteImage` shows the teal square from the remote origin in an `<img>`, which no mask covers, and `play` waits until it has loaded. An image's request isn't a real network request, but the image is remote content, so `update` lists it on the remote origin's host's line. The snapshot shows the square.

Viewed on `localhost`, the remote origin is the page's own, so none of them is listed.

## The mode stories

`stories/modes.stories.tsx` shows, in an `Environment` panel, what each capture looked like to the story as it rendered: the `theme` global, `innerWidth × innerHeight`, `devicePixelRatio`, whether `(hover: none)` and `(pointer: coarse)` match, and `navigator.maxTouchPoints`. Below them is a box that only a `(hover: hover)` rule colors green and labels `hover style applied`; otherwise it says `no hover style`. The meta lists `dark` and sets a width of 640.

- `DarkAndMobile` lists `dark` and `mobile`, so it has three baselines: its default capture, `.dark` on the dark surface, and `.mobile` at 375 × 667 and scale 2, with no hover, a coarse pointer, 5 touch points and no hover style.
- `InheritsMetaModes` sets nothing, so it gets its default capture and the meta's `.dark`.
- `OwnModesOnly` lists only `narrow`, so the meta's `dark` doesn't reach it: its default capture and `.narrow`.
- `ModesOnly` sets `defaultCapture: false` and lists `dark` and `narrow`, so it has only `.dark`, 640 px wide on the dark surface, and `.narrow`, 375 px wide, and no default capture. Each is byte-identical to the same mode of `InheritsMetaModes` and `OwnModesOnly`, which render the same panel at the same viewport.
- `ViewportPrecedence` sets a width of 500 and lists `narrow`. Its default capture is 500 × 720: the story's width over the meta's 640 and the config's 1280, and the config's height. Its `.narrow` is 375 × 720: the mode's width over the story's.
- `TallTouch` is about 3000 px tall, with the panel at the top and again at the bottom, and lists `mobile`. Its `.mobile` is the full page at scale 2, and both panels show no hover and a coarse pointer. The panels' text is read when the story renders, so the hover-only box is what shows the capture itself kept touch on.
- `InvalidModeWhenAsked` has only its default capture, unless the page's `globalThis.__visualCheckE2eInvalidModes` is set when its stories file is imported. With `undeclared`, its hand-written `parameters.visualCheck` lists the mode `e2e-undeclared`, which sets the global `e2eNever` that no Storybook declares. With `pinned`, it lists `dark` and pins `theme` to `light` in its own `globals`. The invalid-modes case checks both.

## The grid stories

`stories/grid.stories.tsx` renders a `Chip`, a rounded label, through `<Combinations>` from `@visual-check/storybook/react`. An accent chip takes its colour from a React context whose default is red; the meta's decorator provides green around every story, so a red chip in a snapshot means the context didn't reach the grid's cells. The stories' chips, styles and `play` checks live in `stories/grid-parts.ts`, with no framework, which other ports' grid stories read.

- `EveryCombination` lists two tones, two sizes and two titles, one of them `undefined`, and passes `label` in `args`: 8 captioned rows, such as `tone: accent, size: lg, title: undefined`, 16 px apart, every accent chip green. The long title's captions wrap at the column's width rather than widening it.
- `ForcedStates` forces `hover` and `focus-visible` on a chip styled by a `<style>`: a header row, `default`, `:hover` and `:focus-visible`, above 2 captioned rows of 3 columns. The default tone's hover cell is blue, with the blue text a theme class outside the grid gives it; the quiet tone's stays grey, since its own rule, declared after the hover rule at the same specificity, still wins; both focus-visible cells have a purple outline. `play` checks the headers and each cell's computed style.
- `LateStyles` forces `hover`, and its `play` adds the hover rules once the grid is there: one with `insertRule`, as CSS-in-JS does in production, the other as a text node appended to a `<style>`, as it does in development. It waits until both hover cells show their colours, green and yellow, and the default cells don't.
- `ShadowRoots` forces `hover` and `focus-within` on chips styled from a shadow root's adopted sheet, a shadow root's `<style>`, an adopted sheet in a shadow root nested in another, and a sheet the document adopts in `beforeEach`. `play` checks that every hover cell is blue, every focus-within cell has a purple outline, the default cells have neither, and the hosts in state cells, the nested one included, carry their state's class.
- `BesidePseudoStates` forces `hover` beside Storybook's pseudo-states addon, with a chip outside the grid that has the addon's own class, `pseudo-hover`. `play` checks our hover cell. Its `wait` hook, which runs after the addon's rewrite, checks that the addon's chip and our cell are both yellow and that the hover rule has the addon's two twins and ours once each; then it calls `forceStates(['focus-visible'])` and checks that the rule the addon already replaced gains our twin in place and keeps the addon's. No cell is focus-visible, so plain Storybook looks the same.
- `TooWide` sets a `cellWidth` of 1400, wider than the 1280 px viewport, and `element` to the grid itself. It's broken, `grid-too-wide`, whatever the capture area, and its line says the grid is wider than the viewport.

`TooWide`'s committed baseline is the story with `cellWidth={1200}`: a 1200 px wide grid of 2 rows. Every grid baseline is byte-identical on 9.1, 10 and 11. A broken forced state makes its story `play-threw` or `wait-threw`, rather than passing with a wrong baseline.

The plain-DOM test Storybooks, [`storybook-9-html`](../storybook-9-html/README.md), [`storybook-10-html`](../storybook-10-html/README.md) and [`storybook-11-html`](../storybook-11-html/README.md), draw `EveryCombination`, `ForcedStates` and `LateStyles` with `combinations()` from `@visual-check/storybook`, and their end-to-end check needs their baselines here byte for byte. So do the Vue test Storybooks, [`storybook-9-vue`](../storybook-9-vue/README.md), [`storybook-10-vue`](../storybook-10-vue/README.md) and [`storybook-11-vue`](../storybook-11-vue/README.md), which draw them with `<Combinations>` from `@visual-check/storybook/vue`, and the Angular test Storybooks, [`storybook-9-angular`](../storybook-9-angular/README.md), [`storybook-10-angular`](../storybook-10-angular/README.md) and [`storybook-11-angular`](../storybook-11-angular/README.md), which draw them with `combinations()` from `@visual-check/storybook/angular`. When one of them changes, copy it into each one's `.visual-check/baselines/`.

## The forced states stories

`stories/forced-states.stories.tsx` forces states outside a grid, with `forceStates` from `@visual-check/storybook`.

- `OutsideAGrid` calls `forceStates(['hover', 'focus-within'])` in its `beforeEach`, whose cleanup stops it. A chip two levels below a `visual-check-hover` section is blue, a field inside a `visual-check-focus-within` wrapper has its purple outline though nothing has focus, and a control chip outside both stays grey. `play` checks all three. Its baseline is byte-identical on 9.1, 10 and 11.

## The page errors stories

`stories/page-errors.stories.tsx` has one story for each kind of [page error](../../GLOSSARY.md), and for each way one is expected, warned about or left unchecked. Each raises its page errors only when `globalThis.__visualCheckE2ePageErrors` is set, which the page errors cases do through a script the server adds to every `iframe.html`, apart from those it expects, which it raises always. `Stale` does the opposite: it raises its expected error only without the script. `ExpectedByConfig`'s errors are expected only by the page errors config case's config, so the other page errors cases list them. So every other case, and a run on an ordinary static server, captures them as plain passing stories that list nothing, and the general runs stay green. A story raises its page errors in a loader, which finishes before it renders, or in its orders frame, which its `play` waits for, and shows the same note or frame whether it raised them or not, so its baseline holds in every run. They all pass.

- `ConsoleError` logs a `console.error`.
- `UncaughtError` throws an error in a timer, which nothing catches.
- `UnhandledRejection` rejects a promise nobody handles.
- `MissingFile` fetches `/visual-check-e2e/missing.json`, which the server answers 404.
- `ServerError` fetches `/visual-check-e2e/server-error`, which the end-to-end check's server answers 500.
- `DroppedLoad` fetches `/visual-check-e2e/dropped`, whose connection the end-to-end check's server destroys, a network failure.
- `WorkerError` registers the mocking service worker the network stories use, then shows `/sw-scope/orders.html`, which the worker controls, in an iframe. The frame fetches `/visual-check-e2e/orders?visual-check-e2e-status=500`, which the worker answers with a JSON response of status 500 it built, as a mocking library's error response is. Without the script it asks for a 200. `play` throws unless the frame got the status it asked for, so a server's 404 never passes for the worker's answer.
- `ConsoleWarn` logs a `console.warn`, which isn't a page error.
- `OtherOrigin` loads an image the [remote origin](#the-remote-origin) answers 404, a failed load from another origin, which isn't a page error.
- `ExpectedWorkerError` is `WorkerError` asking for the 500 always, as an error-state story does, with `expectedPageErrors` holding a regular expression that matches its URL.
- `ExpectedErrors` always logs a `console.error` and fetches a file the server doesn't have, and expects the first with a regular expression that matches its message and the second with a string in its URL.
- `ExpectedByConfig` logs a `console.error` and fetches a file the server doesn't have. Only the config case's config expects them, the message with a string and the URL with a regular expression.
- `Stale` expects an error it logs only without the script, so with it, it's an error-state story whose error went away, and its entry is stale.
- `Warn` logs a `console.error`, with `pageErrors: 'warn'`.
- `Off` logs a `console.error` and fetches a file the server doesn't have, with `pageErrors: 'off'`.
- `TwoModes` lists the `dark` mode and logs a `console.error` only when its `theme` global is `dark`, so only `page-errors--two-modes.dark` has a page error.

The worker-built 500 shows that a response a service worker made reaches the browser's log as a load page error on the image's `linux/amd64` browser, as it does on the machine visual-check's driver was probed on.

## Running the end-to-end check

`e2e.ts` works in the folder it starts in, so the 9.1 and 11 test Storybooks run the same file from their own folders.

Until the browser image is published, every run names a locally built image through `TEST_STORYBOOK_IMAGE`. From the repo root:

```sh
packages/chromium/image/build.sh amd64 --output type=docker,name=visual-check-chromium:amd64
TEST_STORYBOOK_IMAGE=visual-check-chromium:amd64 pnpm turbo run e2e --filter @visual-check/test-storybook-10-react
```

Turbo builds the CLI, `@visual-check/storybook` and the Storybook first. The check prints one line per case, then each of its problems, and exits 1 when any case fails.

## Running it inside visual-check's image

`--inside-image` runs the check the way a job container on visual-check's image would: the CLI starts the browser itself, with no Docker. It needs the image's marker (`/etc/visual-check/chromium.json`) and no `docker` on the `PATH`, and it doesn't need `TEST_STORYBOOK_IMAGE`. It runs the first twenty-one cases above, then these two in place of the three that kill the CLI or the browser's container:

- With `platform: 'host'`, `test` uses the image's browser and gives exactly the expected outcomes.
- With `platform: 'linux/arm64'`, `test` exits 2 before any capture, and its message names the image's architecture and the configured platform.

The host case takes 2 workers from the config. The deliberate change and the growing mask run with `'auto'`, which here reads the machine's own CPUs and memory, since no Docker is used.

Mount the repo and a Linux Node into the image, with no network so that nothing can be downloaded. Build the CLI and the Storybook first, as in the next section, and `$NODE_DIR` is a Linux amd64 Node installation (the committed baselines are linux/amd64, so only the amd64 image works):

```sh
docker run --rm --network none -e CI=true -v "$PWD:$PWD" -v "$NODE_DIR:/opt/node:ro" -w "$PWD/test-storybooks/storybook-10-react" \
  -e PATH=/opt/node/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
  visual-check-chromium:amd64 node e2e.ts --inside-image
```

CI's "Inside the image" job does this on every PR.

## Running it on the host

`--host` checks `platform: 'host'` on your machine, in place of all the cases above. It needs no `TEST_STORYBOOK_IMAGE` and no Docker. Two cases capture `card--default` against baselines the run writes, since the committed ones need the image's fonts. Their server's `index.json` lists only `card--default`, since `update` writes every missing baseline whatever the selection, so `update` writes only that baseline:

- With an empty cache, `update` downloads the headless shell, says so, writes the baseline, and leaves the cache's marker for this machine's build.
- `test` then downloads nothing and passes.

The cache is `VISUAL_CHECK_CACHE_DIR` when set, which must name an empty or missing folder, else a temporary folder removed at the end. `--no-docker` adds a case for a machine with no `docker` on the `PATH`: with the default platform, `test` exits 2 with the no-Docker error before any capture.

```sh
pnpm turbo run e2e --filter @visual-check/test-storybook-10-react -- --host --no-docker
```

`--affected`, with `--host` and without `--no-docker`, runs seven affected stories cases in place of the host cases. Each runs `test --base HEAD` with `CI` unset, so `test` covers the stories the working tree's changes affect, and a checkout of one commit works too. The working tree's own changes must affect no story. The first three use the host config, whose baselines folder holds a baseline for every expected snapshot, so the consistency check finds nothing:

- With no change, `test` captures nothing, its note says no story is affected, and the next note says the Storybook `react` is left out.
- With a stories file changed, `test` captures only that file's stories.
- With a helper changed, `test` captures only the stories of the stories files that import it.

The last four use a config of the three test Storybooks, `storybook-9`, `storybook-10` and `storybook-11`, each at a URL nothing answers at. The CLI reads each one's stories globs with that test Storybook's own Storybook (9.1, 10 and 11), and 9.1's and 11's point into this package's stories. A run that requires a Storybook stops with exit 2 before any capture, and the report's `error.storybooks` names the Storybooks it required:

- With no change, `test` exits 0, its notes say no story is affected and all three Storybooks are left out, and the report has no error.
- With a stories file changed, `error.storybooks` names all three, 9.1 and 11 through their globs into this package.
- With Storybook 9.1's `.storybook/main.ts` changed, `error.storybooks` names `storybook-9` alone.
- With Storybook 11's `.storybook/main.ts` changed, `error.storybooks` names `storybook-11` alone, which shows 9.1's and 10's globs were read: a Storybook whose globs can't be read is always required.

The cases with a change add a comment line to a tracked file while the CLI runs, so each `main.ts` still loads, and put back its exact bytes after, also on Ctrl+C. They share the cache as the host cases do, but it needn't start empty.

```sh
pnpm turbo run e2e --filter @visual-check/test-storybook-10-react -- --host --affected
```

CI's "Ubuntu host" job runs `--host` where Chromium's sandbox can't start, so the CLI relaunches without it. "macOS without Docker" runs `--host --no-docker`, then `--host --affected` with the same cache.

## Running the skill script cases

`--skill-script` checks the agent skill's runner script, `packages/cli/skill/scripts/run.mjs`, in place of every other case: with `--host` on your machine, else with `TEST_STORYBOOK_IMAGE` naming the browser image. Each case installs the script in a temporary folder with a `setup.json` whose CLI command is `pnpm exec visual-check` in this folder. In the cases that start a Storybook, its start command is `pnpm run storybook`, which serves a test Storybook on port 6006 with `storybook dev`:

- With nothing on port 6006, the script starts this Storybook with `--ci --exact-port`, waits until it answers, runs `test` on `card--default` and stops it. It exits with the report's code, and its standard output is `report.json`'s one document.
- With a server already answering at the Storybook's URL, and a start command that would fail, the script starts nothing, says it reused the server, and leaves it running.
- With the Storybook's URL on another port than 6006, the script exits 2 naming both ports, and stops the Storybook it started.
- With a config of Storybook 9.1 on port 6006 and this one at another URL, and Storybook 9.1's `.storybook/main.ts` changed, `test --base HEAD` through the script starts Storybook 9.1 alone. Once the CLI captures, an interrupt ends the script, which stops Storybook 9.1 and the CLI: outside Windows no process the script started is left, on the host on Windows no headless shell from the run's cache, and with the image no container.
- With the image, killing the CLI leaves no container behind, as in the cases above.

Port 6006 must be free. The interrupt case adds a comment line to Storybook 9.1's `main.ts` while the script runs, and puts back its exact bytes after, also on Ctrl+C. The working tree's own changes must reach no story, so that line is the only change `test --base HEAD` sees: the case first checks that `test --base HEAD` requires no Storybook, and fails saying so when it does. A Storybook that fails to start writes `debug-storybook.log` into its package folder, which git ignores. On the host, the cases share the cache as the host cases do, but it needn't start empty.

```sh
pnpm turbo run e2e --filter @visual-check/test-storybook-10-react -- --host --skill-script
TEST_STORYBOOK_IMAGE=visual-check-chromium:amd64 pnpm turbo run e2e --filter @visual-check/test-storybook-10-react -- --skill-script
```

CI's "macOS without Docker" and "Windows skill script" jobs run the first.

## Running it on the arm64 image

`--arm64` runs one case: the checks of the first case above, on a server that leaves out the `load-fails` stories, with a config that sets `platform: 'linux/arm64'` and the default tolerance, against the committed baselines, which are written on amd64. It shows the default tolerance absorbs arm64's differences from amd64. When the case fails, `test`'s report, with the baseline, snapshot and diff of each snapshot that differs, is copied to `e2e-output/arm64-report/`. It needs `TEST_STORYBOOK_IMAGE` to name an arm64 build of the browser image. From the repo root:

```sh
packages/chromium/image/build.sh arm64 --output type=docker,name=visual-check-chromium:arm64
TEST_STORYBOOK_IMAGE=visual-check-chromium:arm64 pnpm turbo run e2e --filter @visual-check/test-storybook-10-react -- --arm64
```

CI's "arm64 image" job does this on a Linux arm64 runner.

## Running it with the oldest browser package

`--oldest-browser` runs one smoke case: `update` of `card--default` into an empty folder, on a server whose `index.json` lists that story alone, writes its baseline and exits 0. It launches the browser and captures, with no image comparison. It runs with the installed browser package, in that package's own image, which the CLI pulls as `<image.tag>@<image.digest>` without signing in, unless `TEST_STORYBOOK_IMAGE` names another; with no `TEST_STORYBOOK_IMAGE` it also checks that image is now on the machine. It needs docker.

CI's "Oldest browser" job puts npm's oldest browser package in the CLI's range in place of the workspace's `packages/chromium` files, which the CLI resolves through its workspace link. While no browser package in the range is on npm, it runs the workspace's package with a locally built image. Locally, from the repo root, this runs the case with the workspace's package:

```sh
TEST_STORYBOOK_IMAGE=visual-check-chromium:amd64 pnpm turbo run e2e --filter @visual-check/test-storybook-10-react -- --oldest-browser
```

## Running the addon's end-to-end check

This Storybook lists visual-check's addon in its `.storybook/main.ts`, which the two others don't. The addon has no preview entry, so it changes no snapshot.

`addon-e2e.ts` is the addon's end-to-end check. It starts `storybook dev` on port 6158 on a throwaway project, `.addon-e2e/`, which has the addon and copies of three stories files and their committed baselines, opens the real manager in the headless shell, through the CLI's own driver, and checks:

- Before the first check, the panel has nothing to show, and the addon has started no process.
- A check of a story with a passing, a changed and a missing baseline gives three rows, writes their images and no baseline, and the next check uses the same browser.
- The viewer's slider moves where the snapshot is cut, the visual diff shows alone, an image's URL answers its own page and path only, an image whose file is gone says so, and images of different sizes show at one scale.
- A changed stories file marks the result stale and takes its status icon, and nothing runs. So does a changed component that a stories file imports, which leaves Storybook's index as it was.
- The item of a story's menu checks it and its status icon shows, "Run tests" runs nothing, and a reload of the manager keeps the results.
- A check cancelled while its config loads, or while it captures, leaves the story's result as it was.
- A config for another Storybook, or none, shows the CLI's message and the hint, and a good one again needs no restart. A `url` at another port makes a notice.
- Update of a story with a baseline within tolerance, one that differs and a missing one writes the three, a check then passes, and a second Update leaves every file's bytes and modification time as they were. Outside `--host` the baselines it writes equal the committed ones byte for byte.
- Update of a story whose clock ticks says it's broken, since it changed in the second after its capture, and writes no baseline.
- With `CI` set for Storybook, Update shows the CLI's refusal and writes nothing. Every other case starts Storybook without `CI`, so Update runs there in CI too.
- With the browser's container killed between two checks, the next one passes in another. With `--host` this isn't run.
- Once `SIGKILL` or `SIGTERM` has ended Storybook, the addon's process, the browser and its container are gone.
- Neither Storybook's start nor the panel runs docker. With no docker, the check shows the CLI's message.
- A static build, made with `storybook build` and served on `127.0.0.1`, shows the story's `test` and `update` commands with copy buttons, and served on the machine's network address shows no Visual check tab.
- At the end no container is left. With `--host` this isn't run.

The manager's mobile layout, the Webpack builder and Storybook 10.0 aren't run.

```sh
TEST_STORYBOOK_IMAGE=visual-check-chromium:amd64 pnpm turbo run e2e:addon --filter @visual-check/test-storybook-10-react
pnpm turbo run e2e:addon --filter @visual-check/test-storybook-10-react -- --host
```

With `--host` the checks run with `platform: 'host'`, against baselines that `update` writes first. Both run the manager on the machine itself, in the headless shell that the CLI downloads into its cache. When a case fails, Storybook's output and a screenshot of the manager are in `e2e-output/addon/`. CI's "Own Storybooks" job runs the first, and "macOS without Docker" the second.

## Rewriting the baselines

Baselines must come from the default `linux/amd64` platform, the one CI renders on. Build the CLI, `@visual-check/storybook`, which the stories import, and the Storybook:

```sh
pnpm turbo run build build-storybook --filter @visual-check/test-storybook-10-react...
```

Serve `storybook-static/` on `127.0.0.1` with any static server, then from this folder, with `CI` unset:

```sh
TEST_STORYBOOK_IMAGE=visual-check-chromium:amd64 pnpm exec visual-check update --all --url http://127.0.0.1:<port>
```

Run `test` the same way to check them, update `expected-outcomes.json` when a story or a mode it lists is added or its outcome changes, and commit both. A story writes one baseline for its default capture and one for each mode it lists, `<story-id>.<mode>.png`, and `expected-outcomes.json` has an entry for each. The disabled stories are never captured, so they get no baseline and no entry there. With an ordinary static server `FontNeverLoads` passes, since its font file 404s, though `expected-outcomes.json` gives it as broken; the end-to-end check, whose server never answers that file, confirms its outcome.

`update` leaves the baselines of the broken stories as they are, apart from `FontNeverLoads`: an ordinary static server 404s its font file, so there the story passes and `update` writes it in the fallback font. To rewrite another broken story's, take its failure out as its section above says, build the Storybook, run `update --filter` with the story's ID, then put the failure back and build again. For `wait--throws`, that's its `wait` with the `throw` taken out, and `update --filter '^wait--throws$'`. For the broken capture area stories, it's `element: null` in `ElementMissing` and `ElementZeroSize`, `TooTall` 1000 px tall, and `update --filter '^capture-area--(element-missing|element-zero-size|too-tall)$'`. For the broken grid story, it's `cellWidth={1200}` in `TooWide`, and `update --filter '^grid--too-wide$'`.
