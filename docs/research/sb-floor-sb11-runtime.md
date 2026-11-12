# Storybook 9 / 10 / 11 runtime facts for visual-check

Checked 2026-11-12 by reading source only (nothing executed).

| Ref | SHA |
|---|---|
| `v11.0.0-beta.1` | `bb6077ad1b156c9712302890b8456e45aad7a881` |
| `next` HEAD (2026-11-11 19:44Z, merge of #37344) | `885191848790dd99b8ee39a2e1d17f1aa7ede0ba` |
| `v10.6.7` (npm `latest`) | `fe4037caa4130753c27fe3e6dd73bda52550f68b` |
| `v9.1.21` (npm `v9`, latest 9.1.x) | `9abaf68f9a8dd45f0c861e9e1500ba1f6a850e0a` |
| `v9.1.0` / `v9.0.18` (to check when the check was added) | `073a65a8…` / `2a20661e…` |

Short link prefixes used below:
- **B11** = `https://github.com/storybookjs/storybook/blob/bb6077ad1b156c9712302890b8456e45aad7a881`
- **BN** = `https://github.com/storybookjs/storybook/blob/885191848790dd99b8ee39a2e1d17f1aa7ede0ba`
- **B10** = `https://github.com/storybookjs/storybook/blob/fe4037caa4130753c27fe3e6dd73bda52550f68b`
- **B9** = `https://github.com/storybookjs/storybook/blob/9abaf68f9a8dd45f0c861e9e1500ba1f6a850e0a`

Between beta.1 and `next`, these files are byte-identical: `animation-utils.ts`, `StoryRender.ts`, `core-events/index.ts`, `Preview.tsx`, `PreviewWithSelection.tsx`, `UrlStore.ts`, `GlobalsStore.ts`, `StoryStore.ts`, `hideArgTypes.ts`, `csf/story.ts`, `types/modules/{story,indexer}.ts`, `shared/constants/tags.ts`, `csf/core-annotations.ts`, `component-testing/preview.ts`, `setupStoryFreezer.ts`, React `renderToCanvas.tsx`, both builder entry templates, `channel-slot.ts`, `node-version.ts` and `environments-support.ts`. Anything below that says "beta.1" also holds on `next`.

## Summary

| # | Fact | Verdict | Evidence |
|---|---|---|---|
| 1a | `isTestEnvironment()` matches `/StorybookTestRunner/` on `navigator.userAgent` in 11 | **Confirmed** (9.1.0+, 10.x, 11 beta.1, next) | [B11 animation-utils.ts#L5-L15](https://github.com/storybookjs/storybook/blob/bb6077ad1b156c9712302890b8456e45aad7a881/code/core/src/preview-api/modules/preview-web/render/animation-utils.ts#L5-L15) |
| 1b | Vitest check | It reads the global **`globalThis.__vitest_browser__`**. It does not read `import.meta.env` | same |
| 1c | UA check exists in all of Storybook 9 | **Wrong for 9.0.x.** 9.0.0 to 9.0.18 check `__vitest_browser__ \|\| __playwright__binding__`. There is no UA check, so raw CDP never gets the test path on 9.0.x. The UA check arrived in 9.1.0 (PR #32123) | [v9.0.18 animation-utils.ts#L5-L17](https://github.com/storybookjs/storybook/blob/2a20661e3fdb15951ead096d09f30b95126fea2c/code/core/src/preview-api/modules/preview-web/render/animation-utils.ts#L5-L17) |
| 1d | What the check gates in the iframe | Only one thing in the story render: the `completing` phase pauses animations instead of waiting for them. It also hides the custom button in Storybook's own `Form/Select` UI component | [B11 StoryRender.ts#L386-L392](https://github.com/storybookjs/storybook/blob/bb6077ad1b156c9712302890b8456e45aad7a881/code/core/src/preview-api/modules/preview-web/render/StoryRender.ts#L386-L392) |
| 1e | Any TODO, PR or issue about removing the UA check | **None found.** The file has no TODO or deprecation comment. No issue or PR since 2026-06 mentions it. Removing the test-runner from CI (#36481) left `animation-utils.ts` alone | see §1 |
| 2 | Signal visible from outside that the test path is on | No explicit flag. The usable signals are: the gap between the `completing` and `completed` phase events (about 0 ms on the test path, at least 100 ms otherwise), `previewInitialized{userAgent}`, and the pause `<style>` in 9.1/10 | §2 |
| 3a | `storyFinished` when `play` throws | **Confirmed `success` in 10.6.7 and in 11.** `playFunctionThrewException` is emitted, then status is `'success'` unless there are unhandled errors or a failed reporter | [B11 StoryRender.ts#L358-L370](https://github.com/storybookjs/storybook/blob/bb6077ad1b156c9712302890b8456e45aad7a881/code/core/src/preview-api/modules/preview-web/render/StoryRender.ts#L358-L370), [L408-L422](https://github.com/storybookjs/storybook/blob/bb6077ad1b156c9712302890b8456e45aad7a881/code/core/src/preview-api/modules/preview-web/render/StoryRender.ts#L408-L422) |
| 3b | Event names (`playFunctionThrewException`, `storyThrewException`, `storyErrored`, `unhandledErrorsWhilePlaying`, `storyFinished`, `storyRendered`, `storyRenderPhaseChanged`) | **Unchanged** in 11. The only events removed are unrelated (create-new-story and file-component-search) | [B11 core-events/index.ts#L33-L45](https://github.com/storybookjs/storybook/blob/bb6077ad1b156c9712302890b8456e45aad7a881/code/core/src/core-events/index.ts#L33-L45) |
| 4a | 11 pauses with the Web Animations API, not a stylesheet | **Confirmed, with a caveat.** It only touches `CSSAnimation` and `CSSTransition` on a `DocumentTimeline`. Script animations from `element.animate()` keep running | [B11 animation-utils.ts#L18-L86](https://github.com/storybookjs/storybook/blob/bb6077ad1b156c9712302890b8456e45aad7a881/code/core/src/preview-api/modules/preview-web/render/animation-utils.ts#L18-L86) |
| 4b | `next` changed it since beta.1 | **No.** The file is identical. Its last commit is 2026-09-21 (PR #31900, first shipped in 11.0.0-alpha.2) | — |
| 4c | Pause stylesheet text is identical in 9.1.21 and 10.6.7 | **Confirmed.** The only difference in the file is `Promise.all` vs `allSettled` in `waitForAnimations` | [B9#L24-L39](https://github.com/storybookjs/storybook/blob/9abaf68f9a8dd45f0c861e9e1500ba1f6a850e0a/code/core/src/preview-api/modules/preview-web/render/animation-utils.ts#L24-L39), [B10#L24-L39](https://github.com/storybookjs/storybook/blob/fe4037caa4130753c27fe3e6dd73bda52550f68b/code/core/src/preview-api/modules/preview-web/render/animation-utils.ts#L24-L39) |
| 5a | `__STORYBOOK_PREVIEW__`, `.ready()`, `.loadStory()`, `.storyStoreValue`, `__STORYBOOK_ADDONS_CHANNEL__` | **Unchanged.** `Preview.tsx` is identical between 10.6.7 and beta.1 | [B11 Preview.tsx#L61](https://github.com/storybookjs/storybook/blob/bb6077ad1b156c9712302890b8456e45aad7a881/code/core/src/preview-api/modules/preview-web/Preview.tsx#L61), [#L140](https://github.com/storybookjs/storybook/blob/bb6077ad1b156c9712302890b8456e45aad7a881/code/core/src/preview-api/modules/preview-web/Preview.tsx#L140), [#L477](https://github.com/storybookjs/storybook/blob/bb6077ad1b156c9712302890b8456e45aad7a881/code/core/src/preview-api/modules/preview-web/Preview.tsx#L477) |
| 5b | `play-fn` tag | **Unchanged** (`Tag.PLAY_FN = 'play-fn'`) | [B11 tags.ts#L12](https://github.com/storybookjs/storybook/blob/bb6077ad1b156c9712302890b8456e45aad7a881/code/core/src/shared/constants/tags.ts#L12) |
| 5c | URL parsing of `iframe.html?id=&viewMode=story&globals=` | **Parsing unchanged** (`UrlStore.ts` identical). **How globals are applied changed:** URL globals are now deep-merged, and nothing is seeded from `globalTypes[].defaultValue` any more | [B11 GlobalsStore.ts#L24-L54](https://github.com/storybookjs/storybook/blob/bb6077ad1b156c9712302890b8456e45aad7a881/code/core/src/preview-api/modules/store/GlobalsStore.ts#L24-L54) |
| 5d | `index.json` `v` and entry shape | **Unchanged.** `v: 5` and the same `StoryIndexEntry` fields. Only the unused `StoryIndexV2` type was removed | [B11 StoryIndexGenerator.ts#L822-L825](https://github.com/storybookjs/storybook/blob/bb6077ad1b156c9712302890b8456e45aad7a881/code/core/src/core-server/utils/StoryIndexGenerator.ts#L822-L825) |
| 5e | `argTypes` removed from the context of play, loaders, `beforeEach` and `afterEach` | **Confirmed, both at runtime and in the types.** Reading it inside `play` *throws* `ArgTypesRemovedFromStoryContextError`. `StoryContext` no longer declares `argTypes`; the new `StoryContextForRender` does | [B11 hideArgTypes.ts](https://github.com/storybookjs/storybook/blob/bb6077ad1b156c9712302890b8456e45aad7a881/code/core/src/preview-api/modules/store/csf/hideArgTypes.ts#L6-L29), [B11 csf/story.ts#L270-L316](https://github.com/storybookjs/storybook/blob/bb6077ad1b156c9712302890b8456e45aad7a881/code/core/src/csf/story.ts#L270-L316) |
| 5f | `kind` and `story` on the story context and on `loadStory()` results | **Removed in 11.** `extract()` still adds them | [B10 prepareStory.ts#L254-L258](https://github.com/storybookjs/storybook/blob/fe4037caa4130753c27fe3e6dd73bda52550f68b/code/core/src/preview-api/modules/store/csf/prepareStory.ts#L254-L258) |
| 5g | CSF 1 to 3 deprecated | **Wrong.** CSF 3 "still works". CSF 4 is only the recommended format, and moving to it is listed as an optional migration | [B11 migration-guide.mdx#L251-L255](https://github.com/storybookjs/storybook/blob/bb6077ad1b156c9712302890b8456e45aad7a881/docs/releases/migration-guide.mdx#L251-L255) |
| 6a | Node floor | 9.1: Node 20+ (major-version check only). 10.6: 20.19+ or 22.12+. 11: **22.12+**. **No `engines` field** in the published `storybook` package for any of the three; the floor is enforced only by the CLI at runtime | §6 |
| 6b | Browser floor | 9.1 and 10.6: Chrome 131, Edge 134, Firefox 136, Safari 18.3, Opera 117. 11: **Chrome 147, Edge 150, Firefox 152, Safari/iOS 26.5**, Opera dropped | [B11 environments-support.ts#L4-L13](https://github.com/storybookjs/storybook/blob/bb6077ad1b156c9712302890b8456e45aad7a881/code/core/src/shared/constants/environments-support.ts#L4-L13) |

---

## 1. Test-path trigger

### Definition (identical in 9.1.21, 10.6.7, 11.0.0-beta.1 and next)

`code/core/src/preview-api/modules/preview-web/render/animation-utils.ts` L5-15 ([B11](https://github.com/storybookjs/storybook/blob/bb6077ad1b156c9712302890b8456e45aad7a881/code/core/src/preview-api/modules/preview-web/render/animation-utils.ts#L5-L15), [BN](https://github.com/storybookjs/storybook/blob/885191848790dd99b8ee39a2e1d17f1aa7ede0ba/code/core/src/preview-api/modules/preview-web/render/animation-utils.ts#L5-L15), [B10](https://github.com/storybookjs/storybook/blob/fe4037caa4130753c27fe3e6dd73bda52550f68b/code/core/src/preview-api/modules/preview-web/render/animation-utils.ts#L5-L15), [B9](https://github.com/storybookjs/storybook/blob/9abaf68f9a8dd45f0c861e9e1500ba1f6a850e0a/code/core/src/preview-api/modules/preview-web/render/animation-utils.ts#L5-L15)):

```ts
export function isTestEnvironment() {
  try {
    return (
      // @ts-expect-error This property exists in Vitest browser mode
      !!globalThis.__vitest_browser__ ||
      !!globalThis.window?.navigator?.userAgent?.match(/StorybookTestRunner/)
    );
  } catch {
    return false;
  }
}
```

- The Vitest check reads the global `globalThis.__vitest_browser__`. It does not read `import.meta.env`; that was dropped in May 2025 (commit fc081d24bb).
- **9.0.x is different.** In 9.0.0 through 9.0.18 the check was `__vitest_browser__ || __playwright__binding__`, with no UA match ([v9.0.18 L5-17](https://github.com/storybookjs/storybook/blob/2a20661e3fdb15951ead096d09f30b95126fea2c/code/core/src/preview-api/modules/preview-web/render/animation-utils.ts#L5-L17)). PR #32123 ("Avoid pausing animations in non-Vitest Playwright environments", merged 2025-07-25) swapped it for the UA check. It first shipped in **9.1.0** ([v9.1.0](https://github.com/storybookjs/storybook/blob/073a65a8353ab0e42408b3b5830ef87898981a85/code/core/src/preview-api/modules/preview-web/render/animation-utils.ts#L5-L15)). Raw CDP does not create `__playwright__binding__`, so **the UA suffix has no effect on 9.0.x**: those versions run `waitForAnimations` and never pause.
- `isTestEnvironment` is not exported publicly. `storybook/preview-api` exports only `pauseAnimations` and `waitForAnimations`.

### What it gates in 11

The function is called in three places. A GitHub code search on `next` for `isTestEnvironment`, `animation-utils` and `StorybookTestRunner` found only these:

1. **`StoryRender` `completing` phase**, the only effect on the iframe render ([B11 StoryRender.ts#L386-L392](https://github.com/storybookjs/storybook/blob/bb6077ad1b156c9712302890b8456e45aad7a881/code/core/src/preview-api/modules/preview-web/render/StoryRender.ts#L386-L392); identical at [B10 L381-L387](https://github.com/storybookjs/storybook/blob/fe4037caa4130753c27fe3e6dd73bda52550f68b/code/core/src/preview-api/modules/preview-web/render/StoryRender.ts#L381-L387)):
   ```ts
   await this.runPhase(abortSignal, 'completing', async () => {
     if (isTestEnvironment()) {
       this.store.addCleanupCallbacks(story, pauseAnimations());
     } else {
       await waitForAnimations(abortSignal);
     }
   });
   ```
2. **Portable stories** (`composeStory(...).run()`), [B11 portable-stories.ts#L364-L367](https://github.com/storybookjs/storybook/blob/bb6077ad1b156c9712302890b8456e45aad7a881/code/core/src/preview-api/modules/store/csf/portable-stories.ts#L364-L367). This is not used on the iframe path.
3. **Storybook's own UI `Form/Select` component.** On the test path it omits its custom `<button><selectedcontent>` ([B11 Select.tsx#L124-L125](https://github.com/storybookjs/storybook/blob/bb6077ad1b156c9712302890b8456e45aad7a881/code/core/src/components/components/Form/Select.tsx#L124-L125), with a TODO pointing at facebook/react#33609). The same code is in 9.1.21 and 10.6.7. It only matters for stories that render `storybook/internal/components` `Select`.

Nothing else is gated: not addons, not highlight, not a11y. a11y's manual run always calls `waitForAnimations()` ([B11 a11yRunner.ts#L166-L168](https://github.com/storybookjs/storybook/blob/bb6077ad1b156c9712302890b8456e45aad7a881/code/addons/a11y/src/a11yRunner.ts#L166-L168)), but that run starts from a manager request, not from the story render.

### Removal plans

- `animation-utils.ts` has no TODO or deprecation comment.
- The commit history of `animation-utils.ts` on `next` shows the UA line last touched on 2025-07-25 (242a0adca3). Later commits (up to 2026-09-21) only change the pause and wait logic.
- `gh search issues` and `gh search prs` for `StorybookTestRunner` in storybookjs/storybook found **0 results**. `isTestEnvironment` matches only #31900 (merged), #34529 (open, about CSS-injection opacity) and #36097 (closed, cleanup leak). Neither `userAgent` nor `user agent` gives any hit since 2026-06-01.
- The test-runner work since June is #36481 ("Remove test-runner from CI and sandboxes") and #36482 (docs), both merged 2026-09-28. Neither touches `animation-utils.ts`. `storybookjs/test-runner` is `archived=true`.
- MIGRATION ("Test runner support ended", [B11 MIGRATION.md#L1409-L1411](https://github.com/storybookjs/storybook/blob/bb6077ad1b156c9712302890b8456e45aad7a881/MIGRATION.md#L1409-L1411)): "it no longer receives fixes or compatibility updates and prints a warning on every run." It says nothing about the preview-side UA check.

## 2. Detecting the test path from outside

### Render phases (9.1.21 = 10.6.7 = 11 beta.1 = next)

The `RenderPhase` type lists `preparing | loading | beforeEach | rendering | playing | played | completing | completed | afterEach | finished | aborted | errored` ([B11 StoryRender.ts#L37-L49](https://github.com/storybookjs/storybook/blob/bb6077ad1b156c9712302890b8456e45aad7a881/code/core/src/preview-api/modules/preview-web/render/StoryRender.ts#L37-L49); identical type in B10 and B9 at L36).

Every phase change goes through `runPhase`, which emits on the channel ([B11 L106-L117](https://github.com/storybookjs/storybook/blob/bb6077ad1b156c9712302890b8456e45aad7a881/code/core/src/preview-api/modules/preview-web/render/StoryRender.ts#L106-L117)):
```ts
this.channel.emit(STORY_RENDER_PHASE_CHANGED, {
  newPhase: this.phase, renderId: this.renderId, storyId: this.id,
});
```
The event name is `storyRenderPhaseChanged`. `renderId` has been in the payload since 9.1.0; 9.0.x has no `renderId`.

Order emitted for a story with `play` (no `mount` destructuring):
`preparing → loading → rendering → playing → played|errored → completing → completed → afterEach → finished`.
Without `play`, `playing` and `played` are skipped.

- `beforeEach` is in the type but **never emitted**: `applyBeforeEach` is not wrapped in `runPhase`.
- `aborted` is emitted only on cancel.
- `storyRendered` is emitted inside `completed`. `storyFinished` is emitted inside `finished`, so it arrives *after* the `finished` phase event.

**The test path skips no phase.** The sequence is the same; only the work inside `completing` differs.

### Usable signals

| Signal | 9.0.x | 9.1.x / 10.x | 11 |
|---|---|---|---|
| **Gap between the `completing` and `completed` phase events.** The non-test path awaits `waitForAnimations`, which always waits at least 100 ms before checking (`setTimeout(…, 100)`; [B11 L101-L125](https://github.com/storybookjs/storybook/blob/bb6077ad1b156c9712302890b8456e45aad7a881/code/core/src/preview-api/modules/preview-web/render/animation-utils.ts#L101-L125), [B10 L70-L88](https://github.com/storybookjs/storybook/blob/fe4037caa4130753c27fe3e6dd73bda52550f68b/code/core/src/preview-api/modules/preview-web/render/animation-utils.ts#L70-L88)). The test path calls `pauseAnimations()` synchronously, so the gap is about 0 ms. | gap ≥100 ms (never on the test path) | ~0 ms on the test path, ≥100 ms otherwise | same |
| `previewInitialized` channel event payload `{ userAgent }`. This is the UA the preview saw, at [B11 Preview.tsx#L131-L134](https://github.com/storybookjs/storybook/blob/bb6077ad1b156c9712302890b8456e45aad7a881/code/core/src/preview-api/modules/preview-web/Preview.tsx#L131-L134) (same line in B10 and B9). It fires once at init, so the listener must be attached before init. | present, but the UA is irrelevant | present | present |
| An unnamed `<style>` in `document.head` containing `animation-play-state: paused !important` (from `completing` until story cleanup) | no | yes | **no** (no stylesheet) |
| CSS animations in `document.getAnimations()` with `playState` `'paused'` or `'finished'` after `storyFinished` | — | yes (paused) | yes, but only when the story has CSS animations |
| `navigator.userAgent.match(/StorybookTestRunner/)` evaluated in the page. This is exactly half of the gate; the other half is `__vitest_browser__`. | not the gate | the gate | the gate |

Unrelated but relevant: since 10.5.0 there is a separate **`?freeze=finished`** iframe query mode (`setupStoryFreezer.ts`, PR #34939, made for the review screen; [B11 setupStoryFreezer.ts#L32-L36](https://github.com/storybookjs/storybook/blob/bb6077ad1b156c9712302890b8456e45aad7a881/code/core/src/preview-api/modules/preview-web/setupStoryFreezer.ts#L32-L36), [#L284-L329](https://github.com/storybookjs/storybook/blob/bb6077ad1b156c9712302890b8456e45aad7a881/code/core/src/preview-api/modules/preview-web/setupStoryFreezer.ts#L284-L329)).
- At load it injects a pre-freeze reverse-and-pause stylesheet.
- On the `finished` phase it calls `finish()` and then `pause()` on **all** `document.getAnimations()`, strips `<script>` tags and inline handlers, blocks input events, and stubs timers, rAF and `queueMicrotask`.
- It is identical in 10.6.7 and 11, and is not in 9.1.21.

## 3. Throwing `play`, render errors and unhandled errors in 11

`StoryRender.ts` in 10.6.7 and in beta.1 differs only in the following. Error and event emission is otherwise unchanged:
- `hideArgTypes(context)` is passed to the hooks.
- `kind` and `story` are removed from `renderContext`.
- `checkIfAborted` ignores a superseded controller.
- There is a new early `return` when the render is aborted during `completing`: no `storyRendered` or `storyFinished` for that render (commit b6badb2043, PR #36519).
- `teardown({ keepRenderedDom })`.

**`throwPlayFunctionExceptions` defaults to `false`**, set by the core `component-testing` annotations ([B11 component-testing/preview.ts#L17-L23](https://github.com/storybookjs/storybook/blob/bb6077ad1b156c9712302890b8456e45aad7a881/code/core/src/component-testing/preview.ts#L17-L23), always included through [core-annotations.ts#L86](https://github.com/storybookjs/storybook/blob/bb6077ad1b156c9712302890b8456e45aad7a881/code/core/src/csf/core-annotations.ts#L86); the same in 9.1.21 and 10.6.7).

| Situation | Events (10.6.7 and 11 beta.1/next) | `storyFinished` |
|---|---|---|
| `play` throws (default params) | `errored` phase → `playFunctionThrewException` (`{name,message,stack}`) → `console.error` → `completing` → `completed` + `storyRendered` → `afterEach` → `finished` | `{status:'success', reporters: context.reporting.reports}` unless a reporter has `status:'failed'` or there were unhandled errors ([B11 L358-L370](https://github.com/storybookjs/storybook/blob/bb6077ad1b156c9712302890b8456e45aad7a881/code/core/src/preview-api/modules/preview-web/render/StoryRender.ts#L358-L370), [L408-L422](https://github.com/storybookjs/storybook/blob/bb6077ad1b156c9712302890b8456e45aad7a881/code/core/src/preview-api/modules/preview-web/render/StoryRender.ts#L408-L422)) |
| `play` throws with `parameters.throwPlayFunctionExceptions: true` | `playFunctionThrewException`, then the error is rethrown → outer catch → `showException` → `storyThrewException`. No `storyRendered` | `{status:'error', reporters: []}` ([B11 L423-L434](https://github.com/storybookjs/storybook/blob/bb6077ad1b156c9712302890b8456e45aad7a881/code/core/src/preview-api/modules/preview-web/render/StoryRender.ts#L423-L434)) |
| Render throws and `renderToCanvas` rejects | outer catch → `storyThrewException`. No `storyRendered` | `{status:'error', reporters: []}` |
| Render throws but the renderer catches it itself. **React does this**: its `ErrorBoundary.componentDidCatch` → `showException` ([B11 renderToCanvas.tsx#L32-L36](https://github.com/storybookjs/storybook/blob/bb6077ad1b156c9712302890b8456e45aad7a881/code/renderers/react/src/renderToCanvas.tsx#L32-L36)) | `storyThrewException`, phase set to `errored`, so **`play` is skipped** (`this.phase !== 'errored'`, L333). Then `completing` → `completed` + **`storyRendered`** → `afterEach` → `finished` | **`'success'`** (by source reading). Only `storyThrewException` shows the failure |
| Renderer calls `showError` (story returned something invalid) | `storyErrored` (`{title, description}`); otherwise as in the row above | `'success'` |
| Unhandled `error` or `unhandledrejection` *during play* | `errored` phase (instead of `played`) → `unhandledErrorsWhilePlaying` (array of `{name,message,stack}`) → `completing` → … → `finished` | `{status:'error', reporters}` unless `parameters.test.dangerouslyIgnoreUnhandledErrors === true` (L317-L376, L408-L414) |
| **New in 11:** `play`, a loader, `beforeEach`, `afterEach` or `step` reads `context.argTypes` | `ArgTypesRemovedFromStoryContextError` is thrown. In `play` this becomes `playFunctionThrewException` (status `success`, per the rows above) | — |

`storyThrewException` and `storyErrored` are emitted by `PreviewWithSelection.renderException` and `renderError` ([B11 L558-L599](https://github.com/storybookjs/storybook/blob/bb6077ad1b156c9712302890b8456e45aad7a881/code/core/src/preview-api/modules/preview-web/PreviewWithSelection.tsx#L558-L599); the same code at [B10 L514-L555](https://github.com/storybookjs/storybook/blob/fe4037caa4130753c27fe3e6dd73bda52550f68b/code/core/src/preview-api/modules/preview-web/PreviewWithSelection.tsx#L514-L555)).

`StoryFinishedPayload` is unchanged since 9: `{ storyId: string; status: 'error' | 'success'; reporters: Report[] }` ([B11 phases.ts#L3-L7](https://github.com/storybookjs/storybook/blob/bb6077ad1b156c9712302890b8456e45aad7a881/code/core/src/core-events/data/phases.ts#L3-L7)).

Event string values in beta.1 ([core-events/index.ts#L33-L45](https://github.com/storybookjs/storybook/blob/bb6077ad1b156c9712302890b8456e45aad7a881/code/core/src/core-events/index.ts#L33-L45)) are `storyRendered`, `storyFinished`, `storyMissing`, `storyErrored`, `storyThrewException`, `storyRenderPhaseChanged`, `playFunctionThrewException` and `unhandledErrorsWhilePlaying`. Comparing core-events 10.6.7 with beta.1:
- **Removed:** `fileComponentSearchRequest/Response` and `createNewStoryfileRequest/Response`.
- **Added:** `sidebarOpenContextMenu`.
- **Renamed:** none.

## 4. Pause behaviour

### 11 (beta.1 = next)

`pauseAnimations(atEnd = true)` is called with no argument, so `atEnd` is `true` ([B11 L18-L86](https://github.com/storybookjs/storybook/blob/bb6077ad1b156c9712302890b8456e45aad7a881/code/core/src/preview-api/modules/preview-web/render/animation-utils.ts#L18-L86)):

```ts
if (atEnd && isFiniteAnimation(animation)) {
  try { animation.finish(); } catch { animation.pause(); animation.currentTime = 0; }
} else {
  animation.pause();
  animation.currentTime = 0;
}
...
addEventListener('animationstart', pauseAllAnimations);
addEventListener('transitionrun', pauseAllAnimations);
```

- **Filter:** `(anim instanceof CSSAnimation || anim instanceof CSSTransition) && anim.timeline instanceof DocumentTimeline` ([L147-L152](https://github.com/storybookjs/storybook/blob/bb6077ad1b156c9712302890b8456e45aad7a881/code/core/src/preview-api/modules/preview-web/render/animation-utils.ts#L147-L152)).
  - **Script WAAPI animations (`element.animate()`, e.g. Motion/framer-motion) are not touched.**
  - Scroll and view timelines are not touched either.
- **Roots covered:** `document` plus every nested shadow root, at the time of the sweep. New animations are caught through the `window` listeners, but not inside shadow roots, because those events are not composed.
- **Finite vs infinite** is decided by `effect.getTiming().iterations === Infinity`.
- **No stylesheet** is involved.
- The cleanup (on story cleanup) restores `currentTime` and the play state.
- **Behaviour changes against 9/10** (from the PR #31900 description; **not mentioned in MIGRATION.md**):
  - A finite animation with `fill-mode: none` falls back to the element's base style after `finish()`. The 9/10 stylesheet held it on the `to` keyframe.
  - An infinite animation freezes on its **first** frame. In 9/10 it showed the **last** keyframe.
- Shipped first in `v11.0.0-alpha.2`. alpha.0 and alpha.1 still used the stylesheet. Last change: 8c8a5ab99b on 2026-09-21. **Nothing has changed on `next` since beta.1.**

### 9.1.21 and 10.6.7 stylesheet (text identical)

From [B9 L24-L39](https://github.com/storybookjs/storybook/blob/9abaf68f9a8dd45f0c861e9e1500ba1f6a850e0a/code/core/src/preview-api/modules/preview-web/render/animation-utils.ts#L24-L39) and [B10 L24-L39](https://github.com/storybookjs/storybook/blob/fe4037caa4130753c27fe3e6dd73bda52550f68b/code/core/src/preview-api/modules/preview-web/render/animation-utils.ts#L24-L39):

```ts
disableStyle.textContent = `*, *:before, *:after {
    animation: none !important;
  }`;
...
pauseStyle.textContent = `*, *:before, *:after {
    animation-delay: 0s !important;
    animation-direction: ${atEnd ? 'reverse' : 'normal'} !important;
    animation-play-state: paused !important;
    transition: none !important;
  }`;
```

- `disableStyle` is removed again after a forced reflow. `pauseStyle` stays in `<head>`, with no `id`, until cleanup.
- With `atEnd = true` the direction is `reverse`.
- `diff` between the 9.1.21 and 10.6.7 files: the only change is `Promise.all` → `Promise.allSettled` in `waitForAnimations`.

## 5. Adapter surface: 10.6.7 vs 11.0.0-beta.1

### Unchanged

- **Preview global.** `window.__STORYBOOK_PREVIEW__` and `__STORYBOOK_STORY_STORE__` are set the same way in both builders:
  - Vite: [B11 codegen-modern-iframe-script.ts#L65-L67](https://github.com/storybookjs/storybook/blob/bb6077ad1b156c9712302890b8456e45aad7a881/code/builders/builder-vite/src/codegen-modern-iframe-script.ts#L65-L67).
  - Webpack: [virtualModuleModernEntry.js#L31-L32](https://github.com/storybookjs/storybook/blob/bb6077ad1b156c9712302890b8456e45aad7a881/code/builders/builder-webpack5/templates/virtualModuleModernEntry.js#L31-L32).
  - The only diffs are import-path templating.
- **Preview methods.** `Preview.tsx` is **identical** between 10.6.7 and beta.1:
  - `protected storyStoreValue` (L61)
  - `ready()` (L140)
  - `async loadStory({storyId})` (L477)
  - `extract()` (L493)
- **Channel global.** `__STORYBOOK_ADDONS_CHANNEL__` is mirrored by `setChannel` ([B11 channel-slot.ts#L15-L17](https://github.com/storybookjs/storybook/blob/bb6077ad1b156c9712302890b8456e45aad7a881/code/core/src/channels/channel-slot.ts#L15-L17)). The file is identical to 10.6.7.
- **Event names.** See §3.
- **`play-fn` tag.** Added by `CsfFile` when the story or meta has `play` ([B11 CsfFile.ts#L1218-L1220](https://github.com/storybookjs/storybook/blob/bb6077ad1b156c9712302890b8456e45aad7a881/code/core/src/csf-tools/CsfFile.ts#L1218-L1220), [#L1248-L1250](https://github.com/storybookjs/storybook/blob/bb6077ad1b156c9712302890b8456e45aad7a881/code/core/src/csf-tools/CsfFile.ts#L1248-L1250)). `tags.ts` is identical to 10.6.7.
- **URL parsing.** `UrlStore.ts` is identical to 10.6.7; `args` and `globals` are parsed with `parseArgsParam` ([B11 L88-L103](https://github.com/storybookjs/storybook/blob/bb6077ad1b156c9712302890b8456e45aad7a881/code/core/src/preview-api/modules/preview-web/UrlStore.ts#L88-L103)). It still reads legacy `?path=` despite its "TODO: Remove in SB11" comment.
- **`index.json`.**
  - It is `{ v: 5, entries }`.
  - `StoryIndexEntry` = `{id, name, title, tags?, importPath, type:'story', subtype:'story'|'test', componentPath?, exportName?, parent?, parentName?}` ([B11 indexer.ts#L67-L81](https://github.com/storybookjs/storybook/blob/bb6077ad1b156c9712302890b8456e45aad7a881/code/core/src/types/modules/indexer.ts#L67-L81)).
  - 9.1.21 entries have no `subtype`, `componentPath`, `exportName` or `parent`.

### Changed in 11 and relevant to a tool that loads iframe.html (MIGRATION.md at beta.1, "From version 10.x to 11.0.0" starts at L643)

1. **`argTypes` removed from the context of loaders, `beforeEach`, `play`, `afterEach` and `step`** ([MIGRATION#L1081-L1111](https://github.com/storybookjs/storybook/blob/bb6077ad1b156c9712302890b8456e45aad7a881/MIGRATION.md#L1081-L1111)).
   - L1083 says: "The story context passed to loaders, `beforeEach`, `play`, `afterEach` and `step` callbacks no longer contains `argTypes`. Reading it throws an error that links here."
   - L1111 says: "Their context type is the new `StoryContextForRender`; the `StoryContext` type no longer declares `argTypes`."
   - Runtime: a `Proxy` throws on `.argTypes`, and also hides it from `in`, `ownKeys` and `getOwnPropertyDescriptor` ([hideArgTypes.ts#L6-L29](https://github.com/storybookjs/storybook/blob/bb6077ad1b156c9712302890b8456e45aad7a881/code/core/src/preview-api/modules/store/csf/hideArgTypes.ts#L6-L29)). The error is `ArgTypesRemovedFromStoryContextError`, code 17.
   - Types at beta.1: `StoryContext extends Omit<StoryContextForEnhancers, 'argTypes'>` (L270-292), `StoryContextForRender extends StoryContext { argTypes }` (L300-305), and `PlayFunction = (context: StoryContext) => …` (L314). So **at beta.1 the `play` context type does *not* include `argTypes`**.
   - `PreparedStory`, which `loadStory()` returns, still extends `StoryContextForEnhancers` and so **still has `argTypes`**.
   - Introduced by PR #36484 (merged 2026-09-30).
2. **`kind` and `story` removed** from the story context and from `PreparedStory` ([MIGRATION#L1113-L1131](https://github.com/storybookjs/storybook/blob/bb6077ad1b156c9712302890b8456e45aad7a881/MIGRATION.md#L1113-L1131), PR #36706).
   - In 10.6.7 `prepareStory` set `kind: title` and `story: name` "Back compat" ([B10 L156](https://github.com/storybookjs/storybook/blob/fe4037caa4130753c27fe3e6dd73bda52550f68b/code/core/src/preview-api/modules/store/csf/prepareStory.ts#L156), [L254-L258](https://github.com/storybookjs/storybook/blob/fe4037caa4130753c27fe3e6dd73bda52550f68b/code/core/src/preview-api/modules/store/csf/prepareStory.ts#L254-L258)). In 11 they are gone.
   - `StoryStore.extract()` still adds `kind` and `story` (`ExtractedStory`).
3. **Globals** ([MIGRATION#L1023-L1059](https://github.com/storybookjs/storybook/blob/bb6077ad1b156c9712302890b8456e45aad7a881/MIGRATION.md#L1023-L1059)).
   - `globalTypes[].defaultValue` no longer seeds globals: "In 11.0 that seeding stops and globals are seeded from `initialGlobals` only" (L1039). In code: `this.initialGlobals = { ...globals }` ([GlobalsStore.ts#L29](https://github.com/storybookjs/storybook/blob/bb6077ad1b156c9712302890b8456e45aad7a881/code/core/src/preview-api/modules/store/GlobalsStore.ts#L29); PR #36733).
   - **URL `globals=` values are now deep-merged** with `combineArgs` instead of a shallow spread ([L49-L54](https://github.com/storybookjs/storybook/blob/bb6077ad1b156c9712302890b8456e45aad7a881/code/core/src/preview-api/modules/store/GlobalsStore.ts#L49-L54); PR #36976). Example: `globals=viewport.value:x` now keeps `viewport.isRotated` from the initial globals.
4. **`viewport.defaultViewport` parameter and `responsiveViewport` removed.** Use `initialGlobals.viewport.value` instead ([MIGRATION#L945](https://github.com/storybookjs/storybook/blob/bb6077ad1b156c9712302890b8456e45aad7a881/MIGRATION.md#L945)). This matters if the tool reads that parameter.
5. **`argTypes.<name>.defaultValue` removed** ([L991](https://github.com/storybookjs/storybook/blob/bb6077ad1b156c9712302890b8456e45aad7a881/MIGRATION.md#L991)).
6. **Server-side docgen is on by default** ([L1135](https://github.com/storybookjs/storybook/blob/bb6077ad1b156c9712302890b8456e45aad7a881/MIGRATION.md#L1135)). Per L1085, "the preview no longer infers arg types from components or args". So `loadStory().argTypes` may hold only hand-declared arg types.
7. **Story-id and title risk from the OXC parser** ([L1661](https://github.com/storybookjs/storybook/blob/bb6077ad1b156c9712302890b8456e45aad7a881/MIGRATION.md#L1661)). Quoted string keys are now read and computed keys ignored: "`export default { 'title': 'X' }` now gives story ids under `X`, where Babel used the automatic title". Baseline keys can move. Flow-only syntax in story files no longer parses.
8. **`Story.story = {…}` annotations ignored** ([L2422](https://github.com/storybookjs/storybook/blob/bb6077ad1b156c9712302890b8456e45aad7a881/MIGRATION.md#L2422)). Names and parameters set that way are lost. Ids come from the export name, so they are unaffected.
9. **`storySort` in preview replaced by `storySorts` in main** ([L1596](https://github.com/storybookjs/storybook/blob/bb6077ad1b156c9712302890b8456e45aad7a881/MIGRATION.md#L1596)). This changes `index.json` entry order only.
10. **Web Components default render binds args by key** ([L1983](https://github.com/storybookjs/storybook/blob/bb6077ad1b156c9712302890b8456e45aad7a881/MIGRATION.md#L1983)). Rendered output can change.
11. **Security changes, also backported to 10.6.2+ and 9.1.21** ([L778](https://github.com/storybookjs/storybook/blob/bb6077ad1b156c9712302890b8456e45aad7a881/MIGRATION.md#L778), [L811](https://github.com/storybookjs/storybook/blob/bb6077ad1b156c9712302890b8456e45aad7a881/MIGRATION.md#L811)).
    - `storybook dev` sends `frame-ancestors`.
    - The preview accepts `postMessage` only from its own origin or a localhost manager.
    - A top-level CDP load of `iframe.html` that talks through `__STORYBOOK_ADDONS_CHANNEL__` in the page is unaffected. Embedding iframe.html in a page on another origin would be blocked in dev.
12. **`--preview-url` removed**: "Storybook always builds its preview and always loads `iframe.html`" ([L1906](https://github.com/storybookjs/storybook/blob/bb6077ad1b156c9712302890b8456e45aad7a881/MIGRATION.md#L1906)).
13. **Removed feature flags**: `argTypeTargetsV7` is always on, so targeted args go into `argsByTarget` (L2451). `disallowImplicitActionsInRenderV8` is always on, so an implicit action called during render or play throws (L2470).
14. **Not deprecated**: CSF 1 to 3. The docs guide says "Your CSF 3 stories still work" under *Optional migrations* ([migration-guide.mdx#L251-L255](https://github.com/storybookjs/storybook/blob/bb6077ad1b156c9712302890b8456e45aad7a881/docs/releases/migration-guide.mdx#L251-L255)).
15. **Not documented in MIGRATION**: the animation-pause change from §4.

Between beta.1 and next, MIGRATION.md only adds the `@storybook/codemod` unpublishing, the `--no-open` flag removal, TypeScript 7.1 docgen notes, the skills split and the SvelteKit `sveltekit_experimental` removal. None of these concerns iframe internals.

## 6. Node and browser floors

| | Node | How enforced | Browsers (esbuild `BROWSER_TARGETS` + `code/package.json` browserslist) |
|---|---|---|---|
| 9.1.21 | 20+ ([MIGRATION L602](https://github.com/storybookjs/storybook/blob/9abaf68f9a8dd45f0c861e9e1500ba1f6a850e0a/MIGRATION.md#L602)) | `code/core/bin/index.cjs` exits if `majorNodeVersion < 20` ([B9 L3-L7](https://github.com/storybookjs/storybook/blob/9abaf68f9a8dd45f0c861e9e1500ba1f6a850e0a/code/core/bin/index.cjs#L3-L7)) | chrome131, edge134, firefox136, safari18.3, ios18.3, opera117 ([B9 environments-support.ts#L6-L13](https://github.com/storybookjs/storybook/blob/9abaf68f9a8dd45f0c861e9e1500ba1f6a850e0a/code/core/src/shared/constants/environments-support.ts#L6-L13)); `NODE_TARGET` `node20` |
| 10.6.7 | 20.19+ or 22.12+ ([MIGRATION L1083-L1085](https://github.com/storybookjs/storybook/blob/fe4037caa4130753c27fe3e6dd73bda52550f68b/MIGRATION.md#L1083-L1085)) | `MIN_SUPPORTED_NODE_VERSIONS` = 20.19.0 and 22.12.0 ([B10 node-version.ts#L13-L16](https://github.com/storybookjs/storybook/blob/fe4037caa4130753c27fe3e6dd73bda52550f68b/code/core/src/common/node-version.ts#L13-L16)), checked in `bin/dispatcher.ts` | same as 9.1 ([B10 environments-support.ts#L4-L14](https://github.com/storybookjs/storybook/blob/fe4037caa4130753c27fe3e6dd73bda52550f68b/code/core/src/shared/constants/environments-support.ts#L4-L14)); `node20.19` |
| 11.0.0-beta.1 / next | **22.12+** ([MIGRATION L1204-L1206](https://github.com/storybookjs/storybook/blob/bb6077ad1b156c9712302890b8456e45aad7a881/MIGRATION.md#L1204-L1206)) | `[{ major: 22, minor: 12, patch: 0 }]` ([B11 node-version.ts#L13-L15](https://github.com/storybookjs/storybook/blob/bb6077ad1b156c9712302890b8456e45aad7a881/code/core/src/common/node-version.ts#L13-L15)), checked in `dispatcher.ts` and in the `cli-storybook` and `create-storybook` bins. Prereleases use semver `includePrerelease` | **chrome147, edge150, firefox152, safari26.5, ios26.5**; Opera dropped ([B11 environments-support.ts#L4-L13](https://github.com/storybookjs/storybook/blob/bb6077ad1b156c9712302890b8456e45aad7a881/code/core/src/shared/constants/environments-support.ts#L4-L13); MIGRATION [L1309-L1322](https://github.com/storybookjs/storybook/blob/bb6077ad1b156c9712302890b8456e45aad7a881/MIGRATION.md#L1309-L1322)); `node22.12` |

- **None of them sets `engines`.** `npm view storybook@{9.1.21,10.6.7,11.0.0-beta.1} engines` returns nothing. The root `package.json` of the 9.1.21 monorepo has `engines.node >=20.0.0`, but that file is not published.
- **Other 11 minimums** (docs guide): TypeScript 5.9, Vite 6.3, webpack 5.101, Vitest 4, React 18, Next 15, Angular 21. Yarn PnP is removed.
- **Browser floor scope.** MIGRATION scopes the floor to "the manager UI". However, `BROWSER_TARGETS` is also the esbuild `target` for Storybook's prebuilt browser runtime bundles ([B11 scripts/build/utils/generate-bundle.ts#L204-L207](https://github.com/storybookjs/storybook/blob/bb6077ad1b156c9712302890b8456e45aad7a881/scripts/build/utils/generate-bundle.ts#L204-L207)), which include the preview runtime. A capture Chromium older than 147 is therefore not supported for 11, even for `iframe.html`.

## Not verified / caveats

- Everything here comes from reading source. No Storybook was run, so the event orders and timings above were not observed.
- **React render error leading to `storyFinished{status:'success'}`** is inferred from the code: the error boundary calls `showException`, `renderToCanvas` resolves, and `hasStoryErrored` ignores the `errored` phase. In particular, React 18 or 19 dev mode might also raise a window `error` event, but the `onError` listener is only attached during `play`, so it would not count anyway.
- I could not show that the 11 preview runtime actually *uses* syntax newer than Chrome 131. Only the esbuild target was raised. User-land preview code is compiled by Vite or webpack with their own targets.
- Issue and PR searches used GitHub search (`gh search issues/prs/code`, `search/commits`). Code search covers the default branch (`next`) only; for beta.1 I relied on `next` being identical for the files involved. Issue search may not match tokens inside code blocks.
- I did not check whether `__vitest_browser__` is read anywhere outside the Storybook repo (user libraries). That matters only if someone thinks of injecting it to force the test path on 9.0.x.
- I did not check `@storybook/addon-a11y` reporter behaviour when `play` throws, beyond "it adds a report whose status follows its own `parameters.a11y.test` setting".
