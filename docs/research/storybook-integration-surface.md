# Storybook integration surface

Research for [#5](https://github.com/visual-check/visual-check/issues/5), part of map [#1](https://github.com/visual-check/visual-check/issues/1). Checked 2026-11-02.

**Question:** what does visual-check depend on from Storybook, and what changed across the last three majors?

## Answer

Visual-check needs five things from Storybook, and all of them exist in every major from 7 to 10: `index.json`, `iframe.html?id=<id>&viewMode=story`, the in-page globals `__STORYBOOK_PREVIEW__` and `__STORYBOOK_ADDONS_CHANNEL__`, the `storyRendered` event, and the `play-fn` tag. Capture logic needs little version branching. Most breakage is in the addon and in configuration formats, not in capture.

- **Page side:** the differences are small. They are lifecycle phases, animation handling, the index `v` and tags, and how per-story parameters are read.
- **Addon side:** the package paths and build format change at 9 and again at 10, so this is a build-time split.
- **Stability:** the page globals and channel events are undocumented, but the first-party test-runner relies on them. Keep them behind one adapter.

## How this was checked

All facts come from Storybook source at release tags, its `MIGRATION.md` and docs, the npm registry, and GitHub advisories.

**Nothing was run.** Claims marked *(inference)* are my reading of the code, not observed behaviour. The first capture prototype should confirm them.

## Versions in scope

| Major | Line tested | First release | Status |
|---|---|---|---|
| 10 (current) | 10.6.5, published 2026-10-27 | 2025-10-28 | npm `latest` |
| 9 | 9.1.21 | 2025-05-28 | npm `v9` |
| 8 | 8.6.19 | 2024-03-11 | npm `v8` |
| 7 (three back) | 7.6.24 | 2023-03-31 | npm `v7` |
| 11 (not counted) | 11.0.0-alpha.8 | prerelease | npm `next`, used only to test the seam |

Sources: `npm view storybook dist-tags` and `time`.

[SECURITY.md](https://github.com/storybookjs/storybook/blob/next/SECURITY.md) backports only High and Critical fixes, and only to the previous two majors. The October 2026 advisories patched 8, 9, 10 and 11 but not 7 ([GHSA-f2ph-cmg5-wxc8](https://github.com/storybookjs/storybook/security/advisories/GHSA-f2ph-cmg5-wxc8), [GHSA-px85-f4q5-jh77](https://github.com/storybookjs/storybook/security/advisories/GHSA-px85-f4q5-jh77)).

## Story index

`./index.json` is the source for listing stories in every major. The preview itself fetches this relative path ([`STORY_INDEX_PATH` in 7.6](https://github.com/storybookjs/storybook/blob/v7.6.24/code/lib/preview-api/src/modules/preview-web/Preview.tsx), [in 10.6](https://github.com/storybookjs/storybook/blob/v10.6.5/code/core/src/preview-api/modules/preview-web/Preview.tsx)). Resolve it against the target's base URL, so a Storybook hosted under a subpath works.

| | 7.6 | 8.x | 9.1 | 10.6 / 11 alpha |
|---|---|---|---|---|
| Index `v` | 4 | 4 up to 8.1, 5 from 8.2 | 5 | 5 |
| `stories.json` | Also written and served | [Removed in 8.0](https://github.com/storybookjs/storybook/blob/v10.6.5/MIGRATION.md#removed-storiesjson) | No | No |
| Default tags | No `dev`/`test`; `story`/`docs` system tags | `dev`, `test` from 8.1, when `story`/`docs` were [removed](https://github.com/storybookjs/storybook/blob/v10.6.5/MIGRATION.md#docs-and-story-system-tags-removed) | Same | Adds `manifest` |
| `play-fn` tag | Yes | Yes | Yes | Yes, plus `test-fn` |
| Entry shape | `id name title importPath type tags` | Generator adds `componentPath` (seen in 8.6, not in the public type) | Same | [Type adds `subtype`, `componentPath`, `exportName`, `parent`, `parentName`](https://github.com/storybookjs/storybook/blob/v10.6.5/code/core/src/types/modules/indexer.ts) |
| Index without a build | No | No | [`storybook index -o`](https://github.com/storybookjs/storybook/blob/v9.1.21/docs/api/cli-options.mdx) | Same |

What this means for visual-check:

- **Keep `type === 'story'` entries.** On 10, also decide what to do with `subtype: 'test'` entries. They come from the experimental `.test()` syntax, and their IDs look like `<parent>:<test>` ([`toTestId`](https://github.com/storybookjs/storybook/blob/v10.6.5/code/core/src/csf/csf-utils.ts)).
- **Treat a missing `test` tag on 7 as included.** Filtering on `test` means nothing there *(inference)*.
- **Use `id` from the index and never compute it.** A story can override its ID through `__id` or `meta.id`. A renamed story gets a new ID, which orphans its baseline.
- **Don't use `v` to pick an adapter.** It is 5 for everything from 8.2 to 11 alpha.
- **The index has no parameters.** Viewports, masks and thresholds set as parameters can only be read in the browser:
  - 8 and later: `__STORYBOOK_PREVIEW__.loadStory({ storyId })`, after `preview.ready()`.
  - 7: `preview.storyStore.loadStory`. There is no `ready()` on 7.
  - The `storyStore` proxy was [due for removal in 9](https://github.com/storybookjs/storybook/blob/v10.6.5/MIGRATION.md#storystore-and-methods-deprecated), but it still exists in 10.6.5 and [test-runner 0.26 still uses it](https://github.com/storybookjs/test-runner/blob/v0.26.0/src/setup-page-script.ts).

## Render-complete signal

There is no documented "ready for snapshot" API. The closest reference is the test-runner ([`setup-page.ts`](https://github.com/storybookjs/test-runner/blob/v0.26.0/src/setup-page.ts), [`setup-page-script.ts`](https://github.com/storybookjs/test-runner/blob/v0.26.0/src/setup-page-script.ts)). It waits for `STORY_FINISHED ?? STORY_RENDERED` on `__STORYBOOK_ADDONS_CHANNEL__`.

| Major | Order after render ([`StoryRender.ts`](https://github.com/storybookjs/storybook/blob/v10.6.5/code/core/src/preview-api/modules/preview-web/render/StoryRender.ts)) |
|---|---|
| [7.6](https://github.com/storybookjs/storybook/blob/v7.6.24/code/lib/preview-api/src/modules/preview-web/render/StoryRender.ts) | `playing`, `played`, `completed` (emits `storyRendered`) |
| 8.0 to 8.4 | Same; `beforeEach` phase before render by 8.2 |
| [8.5 to 8.6](https://github.com/storybookjs/storybook/blob/v8.6.19/code/core/src/preview-api/modules/preview-web/render/StoryRender.ts) | Same, then `afterEach`, then `finished` (emits `storyFinished`) |
| 9.0 to 11 alpha | `playing`, `played`, **`completing`**, `completed` (`storyRendered`), `afterEach`, `finished` (`storyFinished`) |

**Recommendation: snapshot on `storyRendered` in every major.**

- It has the same name in all of them, and it fires after play has finished.
- `afterEach` runs after it. On 9 and later, that includes [the a11y addon's axe run](https://github.com/storybookjs/storybook/blob/v10.6.5/code/addons/a11y/src/preview.tsx) unless a11y is turned off.
- Waiting for `storyFinished` would therefore cost time, and a user's `afterEach` cleanup could change the DOM before the snapshot *(inference)*.

**Listen for failures too**, as the test-runner does: `storyErrored`, `storyThrewException`, `playFunctionThrewException`, `unhandledErrorsWhilePlaying` (8+), `storyMissing`, and `storyUnchanged` (selecting the same story again emits no render event).

- A play exception normally goes to the error display and never emits `storyRendered`. The exception is `parameters.throwPlayFunctionExceptions: false`.
- `storyFinished` with `status: 'error'` also reports this on 8.5 and later.

**The 9.0 `completing` phase matters for speed.** [`animation-utils.ts`](https://github.com/storybookjs/storybook/blob/v10.6.5/code/core/src/preview-api/modules/preview-web/render/animation-utils.ts) behaves in one of two ways:

- If the user agent contains `StorybookTestRunner`, or Vitest browser mode is detected, it pauses animations and moves on.
- Otherwise it waits at least 100 ms per story, and up to 5 s for running animations.

So on 9 and later, a browser with a normal user agent pays at least 100 ms per story *(inference; measure in [#4](https://github.com/visual-check/visual-check/issues/4))*. Setting that user agent would skip the wait, but it is an undocumented switch. The function was rewritten in 11 alpha, so isolate any use of it.

On 7 and 8 there is no animation handling, so the adapter must freeze animations itself.

**`storyRendered` does not cover fonts or images.** The test-runner's own [`waitForPageReady`](https://github.com/storybookjs/test-runner/blob/v0.26.0/src/playwright/hooks.ts) waits for `load`, `networkidle` and `document.fonts.ready`. Visual-check needs its own asset-readiness step.

**Other page details:**

- The render root has been `#storybook-root` since [7.0](https://github.com/storybookjs/storybook/blob/v10.6.5/MIGRATION.md).
- The body classes `sb-show-main`, `sb-show-errordisplay` and `sb-show-nopreview` exist in the [7.6](https://github.com/storybookjs/storybook/blob/v7.6.24/code/lib/preview-api/src/modules/preview-web/WebView.ts), 8.6 and [10.6](https://github.com/storybookjs/storybook/blob/v10.6.5/code/core/src/preview-api/modules/preview-web/WebView.ts) sources.
- `storyRendered` is an event, so a listener attached after page load can miss it. Either attach it early, or read `preview.currentRender.phase` first *(inference)*.

## Play functions

- **When play runs:** only on a remount with `autoplay` on, which is the default for a story render. Since `storyRendered` follows play in all four majors, nothing extra is needed to capture the post-play state.
- **Knowing in advance:** the `play-fn` tag marks these stories in the index, so slower stories can be scheduled separately.
- **`mount` (present by 8.6):** if play destructures `mount`, rendering happens inside play. The signal is unaffected, but the canvas may be empty for longer.
- **Hooks:** `beforeEach` arrived in [8.1](https://github.com/storybookjs/storybook/blob/v8.6.19/CHANGELOG.md). `afterEach` was experimental in 8 and [stable in 9](https://github.com/storybookjs/storybook/blob/v10.6.5/MIGRATION.md#experimental_aftereach-has-been-stabilized).
- **Changing globals does not rerun play.** `updateGlobals` calls `rerender()`, not a remount ([`Preview.tsx`](https://github.com/storybookjs/storybook/blob/v10.6.5/code/core/src/preview-api/modules/preview-web/Preview.tsx)). To capture a theme variant of a play story, either load the URL with `?globals=` or emit `forceRemount` *(inference)*.
- **Test libraries:** `@storybook/testing-library` on 7, `@storybook/test` on 8, `storybook/test` on 9 and later. This only affects test apps, not the engine.

## Addressing stories by URL

`iframe.html?id=<id>&viewMode=story` works unchanged in all majors ([`UrlStore.ts`](https://github.com/storybookjs/storybook/blob/v10.6.5/code/core/src/preview-api/modules/preview-web/UrlStore.ts)).

- **`?globals=k:v;k2:v2` and `?args=`** use the same parser, with a restricted character set ([`parseArgsParam.ts`](https://github.com/storybookjs/storybook/blob/v10.6.5/code/core/src/preview-api/modules/preview-web/parseArgsParam.ts)). Values outside it are omitted with a warning, so don't rely on this for arbitrary values.
- **Avoid `?path=` on the iframe.** The source marks it `TODO: Remove in SB11`, though it is still there in 11 alpha.8.
- **Faster than navigating:** emit `setCurrentStory` with `{ storyId, viewMode: 'story' }` on the channel in an already loaded page. The test-runner does this, and the event exists in all four majors. If the previous story is still pending, `teardown()` reloads the page, so wait for each story to end before moving on.
- **Viewports are not applied on the bare iframe.** In 10, [`viewport/preview.ts`](https://github.com/storybookjs/storybook/blob/v10.6.5/code/core/src/viewport/preview.ts) only sets initial globals, and the resizing lives in the manager. Visual-check must read the setting and resize the browser itself *(inference from source layout)*. The format changes too:
  - 7 and early 8: `parameters.viewport.viewports` and `defaultViewport`.
  - [8.3, behind a flag](https://github.com/storybookjs/storybook/blob/v10.6.5/MIGRATION.md#new-parameters-format-for-addon-viewport): `options` plus `globals.viewport`.
  - [9](https://github.com/storybookjs/storybook/blob/v10.6.5/MIGRATION.md#viewportbackgrounds-addon-synchronized-configuration-and-globals-usage): flag removed.
  - [11](https://github.com/storybookjs/storybook/blob/v11.0.0-alpha.8/MIGRATION.md#viewportdefaultviewport-parameter-and-responsiveviewport-removed): `defaultViewport` removed.

## Dev server vs static build

The in-page contract is the same in both modes. `PreviewWeb` sets the same globals, and the channel is available in the page either way. This feeds [#15](https://github.com/visual-check/visual-check/issues/15).

| | `storybook dev` | `storybook build` |
|---|---|---|
| Index | [Live route](https://github.com/storybookjs/storybook/blob/v10.6.5/code/core/src/core-server/utils/index-json.ts), emits `storyIndexInvalidated` on change | Static file from the same generator |
| WebSocket channel | Yes, with token ([`channels/index.ts`](https://github.com/storybookjs/storybook/blob/v10.6.5/code/core/src/channels/index.ts)) | None |
| `experimental_serverChannel`, `experimental_devServer` (9+) | Yes | Not applied in `build-static.ts` (all majors) |
| Host check | [403 for unknown hosts](https://github.com/storybookjs/storybook/blob/v10.6.5/code/core/src/core-server/utils/getHostValidationMiddleware.ts) | Depends on your static server |
| `NODE_ENV` | Development | Production, unless [`features.developmentModeForBuild`](https://github.com/storybookjs/storybook/blob/v10.6.5/MIGRATION.md#introducing-featuresdevelopmentmodeforbuild) (8.5+) |
| Stability during a run | HMR and index changes can re-render stories *(inference)* | Fixed |
| Cost | Compiles on demand | Full build first |

Points that affect the decision:

- **Docker:** in dev, a hostname that isn't local, such as `host.docker.internal`, needs `core.allowedHosts` or `--host`. Binding `--host 0.0.0.0` with an empty list also passes (read in the 10.6 source). The check itself is present in the 7.6.24, 8.6.19, 9.1.21 and 10.6.5 sources.
- **Faster builds:**
  - [`build --test`](https://github.com/storybookjs/storybook/blob/v10.6.5/docs/api/main-config/main-config-build.mdx) (8+) removes docs, docgen and chosen addons. Stories that rely on inferred argTypes could render differently *(inference)*.
  - `--preview-only` (9+) skips the manager.
- **Mixed modes:** React's development and production builds can differ, so don't compare a snapshot from one mode with a baseline from the other without testing it first *(inference)*.
- **Patch releases can change behaviour.** The October 2026 fixes changed iframe embedding, `postMessage` origins and the `highlight` event in 8.6.19, 9.1.21 and 10.6.2. In-page channel use should be unaffected *(inference)*, but test against patch levels as well as majors.
- **Dev mode on 7 has no fix for those advisories,** so a future 7 adapter should prefer static builds.
- **For [#3](https://github.com/visual-check/visual-check/issues/3):** 10.x has a dev-server [`change-detection`](https://github.com/storybookjs/storybook/tree/v10.6.5/code/core/src/core-server/change-detection) service with a module graph, behind `features.changeDetection`. I did not evaluate it.

## Addon API

**Stable in the 7, 8, 9 and 10 [docs](https://github.com/storybookjs/storybook/blob/v10.6.5/docs/addons/addons-api.mdx):** `addons.register`, `addons.add`, `addons.getChannel`, `useChannel`, `useStorybookApi`, `useParameter`, `useGlobals`, `useArgs`. The calls don't change, but where they are imported from does.

| | 7 | 8 | 9 | 10 |
|---|---|---|---|---|
| Manager API import | `@storybook/manager-api` | Same | [`storybook/manager-api`](https://github.com/storybookjs/storybook/blob/v10.6.5/MIGRATION.md#dropped-support-for-legacy-packages) | Same |
| Preview API import | `@storybook/preview-api` | Same | `storybook/preview-api` | Same |
| Build format | CJS and ESM | CJS and ESM | CJS and ESM | [ESM only](https://github.com/storybookjs/storybook/blob/v10.6.5/docs/addons/addon-migration-guide.mdx#esm-only-builds) |
| Presets and `main.*` | CJS allowed | CJS deprecated | CJS deprecated | [Must be valid ESM](https://github.com/storybookjs/storybook/blob/v10.6.5/MIGRATION.md#the-storybookmain-file-and-other-presets-must-be-valid-esm) |
| Node | 16+ | 18+ | 20+ | [20.19+ or 22.12+](https://github.com/storybookjs/storybook/blob/v10.6.5/MIGRATION.md#nodejs-2019-or-2212-required) |
| `experimental_devServer` preset | Not found | Not found | Yes (Polka) | Yes (Polka) |

- **`experimental_serverChannel`** exists in all four majors and only in dev, which is one way the addon could reach the engine. In 10.6 the WebSocket also [checks events by client role](https://github.com/storybookjs/storybook/blob/v10.6.5/code/core/src/core-server/utils/get-server-channel.ts). Events with no declared sender pass, so custom events look fine, but confirm this when designing the addon.
- **Static builds have no server channel.** Addon features there would need direct HTTP to the engine.
- **`experimental_indexers`** replaced `storyIndexers`, which [was removed in 8](https://github.com/storybookjs/storybook/blob/v10.6.5/MIGRATION.md#storyindexers).
- **Version ranges:** Storybook's guide allows a peer range like `^9.0.0 || ^10.0.0`, but [recommends a new addon major per Storybook major](https://github.com/storybookjs/storybook/blob/v10.6.5/docs/addons/addon-migration-guide.mdx#supporting-earlier-versions).

## What a future adapter must absorb

Relative to the current major, 10:

| Target | Capture adapter | Addon |
|---|---|---|
| **9** | `subtype` absent. `storyFinished`, `completing` and `storybook index` all present. Almost no change. | Same import paths. Needs a CJS-compatible build, or a shared `^9 \|\| ^10` build if it works. |
| **8** | No `completing` phase, so freeze animations here. No `storyFinished` before 8.5. Index `v` 4 before 8.2. No `storybook index`, so read the index from a running target or a build. Viewport format depends on the 8.3 flag. | `@storybook/*` imports, so a separate build. No `experimental_devServer`. |
| **7** | All of 8, plus: no `dev`/`test` tags, no `preview.ready()`, `storyStore.loadStory`, no `unhandledErrorsWhilePlaying`, no `--test`, optional `stories.json`, `storyStoreV7: false` opt-out, and `storiesOf` stories that may not be indexed. No fixes for the October 2026 advisories, so prefer static targets. | Same as 8, plus an older manager React ([8 moved it to React 18](https://github.com/storybookjs/storybook/blob/v10.6.5/MIGRATION.md#manager-addons-are-now-rendered-with-react-18)). |
| **11** (preview) | Index and events unchanged. Node 22.12+. `?path=` may go. Animation code rewritten. `defaultViewport` gone. [Manager browser floors raised](https://github.com/storybookjs/storybook/blob/v11.0.0-alpha.8/MIGRATION.md#raised-browser-support-floors); the iframe floor depends on the builder. | `types.TAB` removed, so use panels or tools. Sidebar API changes. |

## Where to put the seam

Recommendation *(my judgement, for the map to confirm)*:

**1. One `StorybookAdapter`, used only by the engine.** Everything else depends on this interface, never on Storybook globals:

- `listStories(target)`: returns normalized entries (`id`, `title`, `name`, `importPath`, `tags`, `hasPlay`).
- `storyUrl(id, { globals, args })`.
- `selectStory(page, id)`: navigates or uses `setCurrentStory`.
- `waitForRendered(page)`: returns `rendered`, `errored` or `missing`, with the error.
- `readStoryOptions(page, id)`: returns parameters.
- `prepareDeterminism(page)`: handles animations.

This also lines up with the map's constraint that capture outside Storybook must be addable later: that source would provide the same list, select and wait steps.

**2. Choose by capability, not only by major.** Read the major from the project's installed `storybook` package, or from `project.json` (`storybookVersion`) as a fallback. `project.json` is telemetry metadata and can be disabled with `core.disableProjectJson`. In the page, check for features directly, as the test-runner does with `STORY_FINISHED ?? STORY_RENDERED`.

**3. Keep the addon outside this adapter.** It runs inside Storybook, and its version split happens at build time. Align `@visual-check/storybook-addon` majors or entry points to Storybook ranges, and share only a protocol with the engine.

**4. Implement only one adapter in v1,** for the major found by [#2](https://github.com/visual-check/visual-check/issues/2). That audit was still open when this was written, so this research doesn't assume which major it is.

First-party precedent for this split: the [test-runner compatibility table](https://github.com/storybookjs/test-runner#storybook-compatibility) has separate version lines for Storybook 7, 8.0, 8.2 to 9, and 10.

## Open questions

- Run the 100 ms `completing` wait and `storyRendered` timing in a real browser. This belongs with the [#4](https://github.com/visual-check/visual-check/issues/4) benchmark.
- Should capture set the `StorybookTestRunner` user agent to skip the wait? It is fast but undocumented.
- Should `subtype: 'test'` entries be captured? The feature is still experimental.
- Does `sanitize` in the external `@storybook/csf` used by 7 match later versions? I compared only 8.6 and 10.6. Baselines from a 7 adapter would depend on this only if IDs were computed, which this design avoids.
