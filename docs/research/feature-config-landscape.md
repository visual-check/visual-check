# Feature and config landscape

Research for [#6](https://github.com/visual-check/visual-check/issues/6), under map [#1](https://github.com/visual-check/visual-check/issues/1). Read 2026-11-02.

**Method.** Public docs and config references only. No competitor source code was read. Each claim links to the page that owns it. Recommendations are my inference and are marked as such. Vocabulary follows `GLOSSARY.md`; competitors' own option names are kept as they spell them.

## Summary

- The capture tools converge on the same core: a colour tolerance, a mismatch budget, selector masks, named variants, animation freezing and an update command.
- The real gaps visual-check can fill without a hosted service are a good local failure report and first-class multi-Storybook monorepos. lost-pixel OSS has neither ([README](https://raw.githubusercontent.com/lost-pixel/lost-pixel/main/README.md) marks the review UI and monorepo execution "Platform only").
- lost-pixel's README now says "We are sunsetting the product", as the team joins Figma. It gives no date and doesn't say what happens to the OSS package. The linked [announcement](https://lost-pixel.com/blog/lost-pixel-team-is-joining-figma) returned 504 when fetched. Treat lost-pixel as a source of ideas, not a moving target.
- Hosted-only features (flake history, per-diff ignores, review threads, branch ancestry baselines) depend on server state. They are out of scope under #1, though a small file-based quarantine could replace part of them.

## Must-haves vs nice-to-haves

These are my recommendations, based on the evidence below and the map's goals (fast capture, easy setup, no hosted service).

| Area | Must-have for v1 | Nice-to-have |
|---|---|---|
| Thresholds | Separate colour tolerance and mismatch budget; anti-aliasing ignored by default; project, component and story levels | Include-anti-aliasing switch, pluggable comparators, page shift detection |
| Masks | CSS selector list at every level; one documented meaning, with limits stated | Attribute marker, hide vs remove vs paint variants, mask colour |
| Viewports | Default viewport; several viewports per story; override per story | Device scale factor, user agent and mobile emulation |
| Themes and modes | Named modes built from Storybook globals; baselines keyed by mode name; stacking plus per-story disable | Media features (forced colours, reduced motion, print), args variants per story |
| Flake handling | Freeze animations, caret and media; wait for fonts, images and play functions; recapture before failing; per-story delay; CSS injection | Pre-capture hook, file-based quarantine, more stabilisers |
| Baseline workflow | `update` with selection flags; explicit first-run and CI behaviour; stale baseline pruning; keys include browser and mode | Update-only-changed mode, baseline update PR recipe |
| Failure reports | Static local HTML with side-by-side and overlay views; text output with counts and paths | Slider and strobe, auto-focus on tiny diffs, JUnit, move detection |
| Monorepos | One root config or discovery across Storybooks; per-Storybook overrides; one aggregated report and exit code; filter by Storybook | Config inheritance, merged reports from a CI matrix |
| Selection | Per-story disable that doesn't affect other tests; filters by file or name; affected stories with bail rules | Regex include/exclude in config, Chromatic parameter compatibility |

## Comparison

"n/d" means not documented on the pages read, which isn't proof the feature is missing. In the last row, "Yes" for Playwright, Vitest, Loki and BackstopJS is my reading of them as test runners that fail on a mismatch, not a documented default.

| | Chromatic | lost-pixel (OSS) | Argos | Percy | Playwright | Vitest | Loki | BackstopJS | reg-suit |
|---|---|---|---|---|---|---|---|---|---|
| Hosting | Hosted | Local | Hosted | Hosted | Local | Local | Local | Local | Own bucket |
| Colour tolerance | `diffThreshold` 0.063 | n/d | `threshold` 0.5 (scales tolerances) | n/d | `threshold` 0.2 | `threshold` 0.1 | `chromeTolerance` 0 (a percentage; kind unclear) | n/d | `matchingThreshold` |
| Mismatch budget | none documented | `threshold` 0 | none documented | n/d | `maxDiffPixels`, `maxDiffPixelRatio` | `allowedMismatchedPixels`, `allowedMismatchedPixelRatio` | n/d | `misMatchThreshold` 0.1% | `thresholdPixel`, `thresholdRate` 0 |
| Masks | `ignoreSelectors`, attribute, class | `mask` selectors | `data-visual-test` | `ignore-regions` | `mask` locators, `maskColor` | via `screenshotOptions.mask` | n/d | `hideSelectors`, `removeSelectors` | n/a (takes images) |
| Variants | modes | `breakpoints` | modes | `widths`, `additionalSnapshots` | `projects` | Vitest projects | `configurations` | `viewports` | n/a |
| Failing on changes by default | No in the Action, yes in the CLI | No | Commit status | n/d | Yes | Yes | Yes | Yes | n/d |

Sources: [Chromatic threshold](https://www.chromatic.com/docs/threshold/), [lost-pixel config](https://docs.lost-pixel.com/user-docs/api-reference/lost-pixel.config.js-or-ts.md), [lost-pixel page parameters](https://docs.lost-pixel.com/user-docs/api-reference/pagescreenshotparameter.md), [Argos diffing](https://argos-ci.com/docs/learn/platform-fundamentals/how-argos-detects-visual-differences), [Percy config](https://www.browserstack.com/docs/percy/references/config-options), [Playwright assertions](https://playwright.dev/docs/api/class-pageassertions), [Vitest assertions](https://vitest.dev/api/browser/assertions), [Loki CLI](https://loki.js.org/command-line-arguments.html), [BackstopJS README](https://github.com/garris/BackstopJS#readme), [reg-suit README](https://github.com/reg-viz/reg-suit#configuration).

## Thresholds

**"Threshold" means two different things across tools.**

- Colour tolerance is how far apart two pixels must be to count as changed. Chromatic's `diffThreshold` measures YIQ colour distance, default 0.063, and the docs warn a high value such as 0.8 may miss positioning changes ([docs](https://www.chromatic.com/docs/threshold/)).
- Mismatch budget is how many changed pixels are allowed. lost-pixel's `threshold` is this: 0 to 1 is a ratio of image size, 1 or more is a pixel count ([docs](https://docs.lost-pixel.com/user-docs/recipes/general-recipes/thresholds.md)).
- Playwright, Vitest and reg-suit expose both as separate options.

**The defaults aren't comparable.** Chromatic's 0.063, Vitest's 0.1 and Playwright's 0.2 sit on different scales or algorithms. Argos's 0.5 is a multiplier: tolerances are scaled by 2 × threshold, on top of two odiff passes ([docs](https://argos-ci.com/docs/learn/platform-fundamentals/how-argos-detects-visual-differences)).

**Ratio vs absolute.** The docs disagree:

- lost-pixel warns that percentages allow far more pixels on tall images, and suggests fixed values of 1 to 100 pixels.
- Vitest recommends the ratio because it scales with size. If both are set, the stricter applies ([guide](https://vitest.dev/guide/browser/visual-regression-testing), [API](https://vitest.dev/api/browser/assertions)).

**Anti-aliasing.** Ignored by default in Chromatic (`diffIncludeAntiAliasing` opts in) and Vitest (`includeAA: false`), and always detected in Argos. reg-suit is the outlier, with `enableAntialias` defaulting to false.

**Recommendation.** Name the two knobs differently, default the budget to 0, ignore anti-aliasing by default, and offer pixels and ratio with stricter-wins. The default colour tolerance depends on the engine from [#8](https://github.com/visual-check/visual-check/issues/8).

## Masks

| Tool | Mechanism | Meaning |
|---|---|---|
| [Chromatic](https://www.chromatic.com/docs/ignoring-elements/) | `ignoreSelectors`, `.chromatic-ignore`, `data-chromatic="ignore"` | Pixels in the bounding box are ignored, but dimension changes still trigger diffs |
| [Playwright](https://playwright.dev/docs/api/class-pageassertions) | `mask` locators, `maskColor` default `#FF00FF` | Mask painted in the given colour |
| [Argos](https://argos-ci.com/docs/learn/reliability-and-flakiness/flaky-tests/argos-helpers) | `data-visual-test` = `transparent`, `removed` or `blackout` | Keeps layout, removes from layout, or paints a box |
| [BackstopJS](https://github.com/garris/BackstopJS#readme) | `hideSelectors`, `removeSelectors` | `visibility: hidden` or `display: none` |
| [lost-pixel](https://docs.lost-pixel.com/user-docs/api-reference/mask.md) | `mask: [{ selector }]`, for all shots or per page | CSS selector; rendering not described |
| [Percy](https://www.browserstack.com/docs/percy/references/config-options) | `ignore-regions` by selector or XPath | Ignored in comparison |

Known limits to document: Chromatic can't ignore elements inside a nested iframe, only the whole iframe box, and selectors can't cross a shadow root boundary ([docs](https://www.chromatic.com/docs/ignoring-elements/)).

**Recommendation.** Start with a selector list, painted into the snapshot and ignored in the visual diff, with Chromatic's rule that size changes still fail. Painting makes the stored images honest about what was ignored. An attribute marker is cheap to add later.

## Viewports

- Chromatic made viewports part of modes and calls `chromatic.viewports` a legacy API ([params](https://docs.chromatic.com/docs/params/)). In Storybook, a story's `defaultViewport` is used automatically ([docs](https://www.chromatic.com/docs/viewports/)).
- lost-pixel uses `breakpoints: [640, 1024]`, with page or story values overriding top-level ones. Its default viewport is 1280 × 720 ([recipe](https://docs.lost-pixel.com/user-docs/recipes/general-recipes/viewport-tests.md), [parameters](https://docs.lost-pixel.com/user-docs/api-reference/pagescreenshotparameter.md)).
- Argos reads the story's `viewport` global, which can be a key, an object or a width ([docs](https://argos-ci.com/docs/reference/storybook)).
- Loki's `configurations` also carry `deviceScaleFactor`, `mobile`, `userAgent` and `media` ([docs](https://loki.js.org/configuration.html)). Percy has `widths` and `min-height`, default 1024 ([docs](https://www.browserstack.com/docs/percy/references/config-options)).

**Capture area differs and affects baselines.** Argos crops to the component by default (`fitToContent`, padding 16, zoom 2) ([docs](https://argos-ci.com/docs/reference/storybook)). Loki crops to `#root > *` ([CLI](https://loki.js.org/command-line-arguments.html)). Chromatic offers `cropToViewport` as an opt-in ([params](https://docs.chromatic.com/docs/params/)). Playwright's `fullPage` defaults to false, Argos's to true.

**Recommendation.** Treat viewports as part of modes, as Chromatic ended up doing, with a short form for the common case. Avoid a separate viewport API that later becomes legacy.

## Themes and modes

Chromatic's model is the reference, and Argos follows the same shape:

- A mode is a named set of Storybook globals, defined in `.storybook/modes.ts` and applied with `chromatic.modes` ([docs](https://www.chromatic.com/docs/modes/)).
- Baselines are keyed to the mode's name, not its values. Changing a mode's viewport compares against the same baseline; renaming creates a new one.
- Modes stack across project, component and story rather than override. `disable: true` drops one. This differs from other parameters, where story beats component beats project ([docs](https://www.chromatic.com/docs/config-with-story-params/)).
- Themes are just modes. Each produces its own snapshot, and the user's addon or decorator must read the global ([docs](https://www.chromatic.com/docs/themes/)).
- Argos uses `parameters.argos.modes` and also reads `parameters.chromatic.modes`, stopping once a story has an `argos` parameter ([docs](https://argos-ci.com/docs/learn/how-to-guides/visual-coverage/storybook-story-modes)).

Other useful surface: Chromatic's `forcedColors`, `prefersReducedMotion` and `media` ([params](https://docs.chromatic.com/docs/params/)), and Percy's `additionalSnapshots` with `args`, `globals` and `queryParams` ([docs](https://www.browserstack.com/docs/percy/references/storybook-advance-topics)).

**Recommendation.** Adopt named modes on globals, with stacking and per-story disable. This fits the existing Storybook model, and a capture source outside Storybook can treat a mode as an opaque name, which suits the seam in #1. Each mode multiplies snapshots, which matters for the speed goal.

## Flake handling

Tools tackle flakes in four layers, and only the last needs a server.

**1. Determinism by default**

- [Chromatic](https://www.chromatic.com/docs/animations/) pauses CSS transitions, CSS and SVG animations and videos. CSS animations stop on the last frame (`pauseAnimationAtEnd`). GIFs and videos stop on the first frame or use the poster. JS animations aren't controlled, so it offers `isChromatic()`.
- [Playwright](https://playwright.dev/docs/api/class-pageassertions) defaults to `animations: "disabled"` and `caret: "hide"`. Loki has `chromeEnableAnimations` false ([CLI](https://loki.js.org/command-line-arguments.html)).
- [Argos](https://argos-ci.com/docs/reference/playwright) has the fullest list, all on by default: `disableSpellCheck`, `fontAntialiasing`, `hideCarets`, `hideScrollbars`, `loadImageSrcset`, `pauseGifs`, `pauseSvgAnimations`, `roundImageSize`, `stabilizeSticky`, `waitForAriaBusy`, `waitForFonts`, `waitForImages`, `waitForBackgroundImages`, plus `disableHover`.

**2. Readiness signals**

- Chromatic: `delay`, or assertions in a `play` function, with 15 s to render plus 15 s for interaction tests ([docs](https://www.chromatic.com/docs/delay/)).
- Percy: `waitForTimeout`, `waitForSelector` ([docs](https://www.browserstack.com/docs/percy/references/storybook-advance-topics)). BackstopJS: `readySelector`, `readyEvent`, `delay` ([README](https://github.com/garris/BackstopJS#readme)). Argos: `aria-busy` ([docs](https://argos-ci.com/docs/learn/reliability-and-flakiness/flaky-tests)).
- lost-pixel: fixed waits by default, `waitBeforeScreenshot` 1000 ms, `waitForFirstRequest` 1000 ms, `waitForLastRequest` 1000 ms ([docs](https://docs.lost-pixel.com/user-docs/api-reference/lost-pixel.config.js-or-ts.md)).
- CSS injection: Playwright `stylePath`, Argos `argosCSS`, Percy `percy-css`. lost-pixel's `beforeScreenshot` hook hands over a Playwright `page` ([docs](https://docs.lost-pixel.com/user-docs/recipes/general-recipes/executing-arbitrary-code-before-tests-runs.md)).

**3. Recapture**

- [Vitest](https://vitest.dev/guide/browser/visual-regression-testing)'s stable screenshot detection is the best idea here. It starts from the reference image if one exists, then recaptures until two consecutive captures match or the timeout hits. Timeout default is 5000 ms ([API](https://vitest.dev/api/browser/assertions)).
- Chromatic's [flake filter](https://www.chromatic.com/docs/flake-filter/) renders each test several times and auto-ignores unstable ones, re-evaluated per build.
- Loki has `chromeRetries`, default 0 ([CLI](https://loki.js.org/command-line-arguments.html)). lost-pixel's README lists "Flaky test retries", but its flakiness page only links a blog post, so the option isn't documented there.

**4. History (hosted)**

- Argos scores flakiness across builds and ignores by test plus diff fingerprint, so a new change elsewhere in the image still flags. Auto-ignore defaults to 3 occurrences in auto-approved builds over 7 days ([docs](https://argos-ci.com/docs/learn/reliability-and-flakiness/flaky-test-detection)).
- Chromatic's [quarantine](https://www.chromatic.com/docs/quarantine-tests/) ignores a test's diffs on all builds until removed.

**Recommendation.**

- Ship layers 1 to 3. Layer 4 needs server state, except that a quarantine could be a list in the config file.
- Don't copy lost-pixel's fixed waits. By my arithmetic, a 1000 ms wait across 1000 stories at its default `shotConcurrency` of 5 adds at least 200 s. That conflicts with the speed goal.
- Vitest's approach is fast in the common case: if the first capture matches the baseline, an unchanged story costs one capture. Confirm this in [#10](https://github.com/visual-check/visual-check/issues/10).
- A `beforeScreenshot`-style hook exposes the capture engine in the public API, so hold it until [#11](https://github.com/visual-check/visual-check/issues/11) settles.

## Baseline workflow

Tools fall into two families. [#12](https://github.com/visual-check/visual-check/issues/12) owns the decision; the hosted family is out of scope under #1, but its problems are instructive.

**Hosted, chosen from git ancestry**

- [Chromatic](https://www.chromatic.com/docs/branching-and-baselines/) walks ancestor builds; accepted or unchanged snapshots become baselines, and the most recently accepted wins on merges. Squash and rebase merges break ancestry, so it needs provider APIs or auto-accept on main.
- [Argos](https://argos-ci.com/docs/learn/platform-fundamentals/baseline-build) picks the closest eligible build at or before the merge base, with auto-approved branches. Its [monitoring mode](https://argos-ci.com/docs/learn/platform-fundamentals/build-modes) ignores git and compares against the last approved monitoring build.
- [reg-suit](https://reg-viz.github.io/reg-suit/) uses the same idea with your own S3 or GCS bucket: a git-hash key plugin finds the parent commit's images.

**Files in the repo**

- [lost-pixel OSS](https://docs.lost-pixel.com/user-docs/guides/testing-and-updating-baseline-locally.md): run `npx lost-pixel docker update`, commit PNGs, review in GitHub's split view. A [recipe](https://docs.lost-pixel.com/user-docs/recipes/lost-pixel-oss/automatic-baseline-update-pr.md) opens an update PR from a manually triggered workflow, using `LOST_PIXEL_MODE: update`.
- [Playwright](https://playwright.dev/docs/test-cli): `--update-snapshots` takes `all`, `changed`, `missing`, `none` or `default`. Passing the flag without a value means `changed`. File names include browser and platform ([docs](https://playwright.dev/docs/test-snapshots)).
- [Vitest](https://vitest.dev/guide/browser/visual-regression-testing): the first run creates the reference and fails. Deleted or renamed tests leave stale files to remove by hand. References from a developer's machine often fail in CI, so it suggests a CI guard or Docker.
- [Loki](https://loki.js.org/command-line-arguments.html): `requireReference` is false locally, true on CI. [BackstopJS](https://github.com/garris/BackstopJS#readme): `approve` promotes results, `--filter` limits it, `--docker` runs in a container.

**Recommendation.**

- Make new-story behaviour explicit: create locally, fail in CI (Loki's split).
- Default `update` to rewriting only stories that changed, so PR diffs stay small.
- Prune stale baselines automatically. Vitest documents this as a manual chore.
- Include browser and mode in the baseline key from day one, even if v1 ships Chromium only. [Chromatic](https://www.chromatic.com/docs/browsers/) compares each browser only with its own baselines, which avoids cross-browser false positives.

## Failure reports

- [Chromatic's Diff Inspector](https://www.chromatic.com/docs/diff-inspector/) sets the bar: 1-up and 2-up views, neon green highlights, strobe, automatic focus on tiny changes with a zoom lens, and highlighted ignored regions. [Page shift detection](https://www.chromatic.com/docs/page-shift-detection/) (beta) stops inserted content from marking everything below it as changed. Review threads and approvals are hosted ([docs](https://www.chromatic.com/docs/review/)).
- [Vitest](https://vitest.dev/guide/browser/visual-regression-testing): the failure message has pixel count, ratio and paths to the three images. In diff images, red is changed and yellow is anti-aliasing. UI mode has tabs and an A/B slider.
- [reg-suit](https://github.com/reg-viz/reg-suit#configuration): HTML report; `ximgdiff` also shows which parts were inserted or moved. Notifier plugins post to GitHub, GitLab and Slack.
- [BackstopJS](https://github.com/garris/BackstopJS#readme): `report` takes `browser`, `CI` (JUnit) and `json`; the CLI report is always on.
- [Chromatic CLI](https://www.chromatic.com/docs/configure/) offers `--junit-report`. The [Action](https://www.chromatic.com/docs/github-actions/) outputs URLs, `code`, `changeCount`, `errorCount` and capture counts.
- [lost-pixel OSS](https://docs.lost-pixel.com/user-docs/recipes/lost-pixel-oss/access-test-run-images.md) has no viewer: upload `.lostpixel` as a CI artifact and download it.

**Exit codes are a trap in this space.** lost-pixel exits 0 on differences unless `failOnDifference: true` ([docs](https://docs.lost-pixel.com/user-docs/recipes/lost-pixel-oss/failing-github-action-check.md)). Chromatic's Action exits 0 on changes by default, because review happens in its UI ([docs](https://www.chromatic.com/docs/github-actions/)). visual-check has no hosted approval step, so the exit 1 decided in [#17](https://github.com/visual-check/visual-check/issues/17) is the right default.

**Recommendation.** A static HTML report that works from a CI artifact, with side-by-side, overlay, and pixel counts per story, grouped by Storybook and mode. This is the largest visible gap against lost-pixel OSS. Add a slider early, since it is cheap in a static page.

## Monorepos

None of the docs I read describe one config running several Storybooks with a single result. I only found monorepo guidance for the three tools below.

- **[Chromatic](https://www.chromatic.com/docs/monorepos/)** offers two options: combine stories into one principal Storybook, or one project per subproject, each with its own token, CI step and status. Parallel subprojects need a separate workflow file each, and `workingDir` selects the subproject ([Action docs](https://www.chromatic.com/docs/github-actions/)). `--skip` reports a pass for unaffected ones, and it suggests `lerna changed` to detect them. `storybookBaseDir` and `storybookConfigDir` help when Storybook isn't at the root ([docs](https://www.chromatic.com/docs/configure/)). `workingDir` changes the base path for only some TurboSnap options, a confusion worth avoiding.
- **[lost-pixel](https://docs.lost-pixel.com/user-docs/recipes/lost-pixel-platform/monorepo.md)** (Platform only) needs a config per package, a matrix job setting `LOST_PIXEL_CONFIG_DIR`, and a final `FINALIZE: true` job.
- **[Argos](https://argos-ci.com/docs/reference/storybook)** has `buildName` to split builds and no monorepo guidance I could find. It can't capture several browsers in one build either, so you run once per browser.

**Recommendation.** Make this a headline feature, as #1 already requires. One root config with discovered or listed Storybooks, per-Storybook overrides, baselines per Storybook, a `--storybook` style filter, one report and one exit code. Resolve all paths from one root, unlike Chromatic's mixed base paths.

## Selection and affected stories

- **Skipping a story.** Chromatic has `disableSnapshot`, but it also disables interaction testing for that test ([FAQ](https://www.chromatic.com/docs/faq/interaction-test-disabled-with-disablesnapshot/)). Argos has no screenshot-only skip: excluding by tag stops the story's tests too ([docs](https://argos-ci.com/docs/reference/storybook)). If visual-check stays a separate runner (see [#11](https://github.com/visual-check/visual-check/issues/11)), its skip can affect nothing else.
- **Filters.** Chromatic `--only-story-files`, `--only-story-names` ([docs](https://www.chromatic.com/docs/monorepos/)). Percy `include`, `exclude` regex. Loki `storiesFilter`, `skipStories`. BackstopJS `--filter`.
- **Affected stories.** [TurboSnap](https://www.chromatic.com/docs/turbosnap/) maps git changes through the Webpack or Vite graph to story files. It recaptures everything when dependency versions change without a valid lockfile, when Storybook config, files imported by `preview.js`, static folder files or `--externals` files change, or on `--force-rebuild`. `untraced` ignores paths, but must not include `preview.js|ts`. This list is direct input for [#14](https://github.com/visual-check/visual-check/issues/14).

## Config shape

- **Format.** lost-pixel offers typed `lostpixel.config.ts` via `init-ts` ([docs](https://docs.lost-pixel.com/user-docs/setup/project-configuration.md)). Chromatic uses `chromatic.config.json`, and Percy `.percy.yml`. Loki lets any `loki test` argument sit in config ([docs](https://loki.js.org/configuration.html)).
- **Levels.** Chromatic: story over component over project. Percy: snapshot over global. BackstopJS: `scenarioDefaults`, overridden per scenario.
- **Concurrency.** Capture and compare are limited separately: lost-pixel 5 and 10, BackstopJS 10 and 50. Loki defaults to 4. BackstopJS estimates about 100 MB plus 5 MB per concurrent comparison. The map's "10 locally, 5 in CI" covers one number; consider two.
- **Output dirs.** lost-pixel's `.lostpixel/{baseline,current,difference}` and Loki's `.loki/{reference,current,difference}` both match the map's proposed `.visual-check/{baselines,current,diff}`.
- **Engine.** lost-pixel `pixelmatch` or `odiff`; Loki `pixelmatch`, `gm` or `looks-same`; Vitest registers custom comparators. A config switch isn't essential if [#8](https://github.com/visual-check/visual-check/issues/8) picks one well.

**Recommendation (for the config ticket).** A typed TS config with `init`, `parameters.visualCheck` on stories, the same three levels, and every option named identically across CLI, config and story where they overlap. Don't read `parameters.chromatic` in v1; Argos's "stops reading once an `argos` parameter exists" rule shows the confusion that causes.

## Not covered

- Pricing was out of scope; it matters only as a reason users leave hosted tools.
- Happo, Applitools and Storycap weren't reviewed. The community Storybook addon `storybook-addon-vis`, a local Vitest-based option, appeared only in a search summary and wasn't read.
- lost-pixel's story-level parameters, retry option name and filters aren't on its current docs pages. I didn't fill these from memory, so they are absent here.
- Percy's sensitivity control wasn't found in its config docs.
- Many pages were read through a summarising fetch. The load-bearing ones were spot-checked against the raw page: lost-pixel README and config, `failOnDifference`, Chromatic ignore semantics, TurboSnap, Vitest stability detection, Argos `fitToContent`, Loki flags. Chromatic's 0.063 was confirmed in two separate reads but not against the raw page.

## Open questions for the grilling tickets

1. Capture area default: fit to content, viewport or full page? It affects every baseline and is expensive to change later.
2. Should the mismatch budget default to 0 with a tight colour tolerance, or be looser out of the box? This depends on [#7](https://github.com/visual-check/visual-check/issues/7) and [#8](https://github.com/visual-check/visual-check/issues/8).
3. Is a mask painted, ignored, or both? The recommendation above is both.
4. Is config-file quarantine worth having in v1, or does per-story disable suffice?
