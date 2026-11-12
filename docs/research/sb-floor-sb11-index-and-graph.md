# Storybook 11 facts: test index entries, module graph, test-runner, support policy, downloads

Checked 2026-11-12. Read-only: source at pinned SHAs, npm registry, GitHub API, one published `index.json`.

| Ref | SHA |
|---|---|
| `v11.0.0-beta.1` | `bb6077ad1b156c9712302890b8456e45aad7a881` |
| `next` HEAD | `885191848790dd99b8ee39a2e1d17f1aa7ede0ba` (2026-11-11T19:44Z, merge of #37344) |
| `v10.6.7` | `fe4037caa4130753c27fe3e6dd73bda52550f68b` |
| `v10.0.0` | `88a02e67cd158c174542912961d4d2a75fb65d75` |
| `v9.1.21` (latest 9.1.x) | `9abaf68f9a8dd45f0c861e9e1500ba1f6a850e0a` |
| `v8.5.0` / `v8.4.0` | `92770672e5…` / `939651b867…` |

All files cited below are byte-identical between `v11.0.0-beta.1` and `next` HEAD (checked by hash), except `docs/api/main-config/main-config-features.mdx`. Its only difference is an unrelated svelte block. Links point at beta.1 unless noted.

## Summary

| # | Fact | Verdict | Evidence |
|---|---|---|---|
| 1a | Index entries carry `subtype: 'story' \| 'test'` | **Confirmed, since 10.0.0.** Absent in 9.1.21. Unchanged in 11 | [indexer.ts L74-81 @11](https://github.com/storybookjs/storybook/blob/bb6077ad1b156c9712302890b8456e45aad7a881/code/core/src/types/modules/indexer.ts#L74-L81), [@10.0.0](https://github.com/storybookjs/storybook/blob/88a02e67cd158c174542912961d4d2a75fb65d75/code/core/src/types/modules/indexer.ts#L74-L81), [@9.1.21 (no subtype)](https://github.com/storybookjs/storybook/blob/9abaf68f9a8dd45f0c861e9e1500ba1f6a850e0a/code/core/src/types/modules/indexer.ts#L74-L76) |
| 1b | A test entry comes from CSF Next `Story.test('name', [annotations,] fn)` | **Confirmed.** Added in 10.0.0-beta.7 (PR #32455). Still **experimental** in 11 | [CsfFile.ts L1070-1101](https://github.com/storybookjs/storybook/blob/bb6077ad1b156c9712302890b8456e45aad7a881/code/core/src/csf-tools/CsfFile.ts#L1070-L1101) |
| 1c | Test ID format `<parentStoryId>:<sanitized-test-name>` | **Confirmed** (`toTestId`) | [csf-utils.ts L39-41](https://github.com/storybookjs/storybook/blob/bb6077ad1b156c9712302890b8456e45aad7a881/code/core/src/csf/csf-utils.ts#L39-L41) |
| 1d | Test entries are in `index.json` by default (dev and static) | **Confirmed.** No flag check in the indexer or index generator. Also seen in a real static build | [StoryIndexGenerator L469-492](https://github.com/storybookjs/storybook/blob/bb6077ad1b156c9712302890b8456e45aad7a881/code/core/src/core-server/utils/StoryIndexGenerator.ts#L469-L492) |
| 1e | `iframe.html?id=<testId>` renders the parent story extended by the test, and `play` runs the parent's play then the test fn | **Confirmed (code reading)** | [csf-factories.ts L314-344](https://github.com/storybookjs/storybook/blob/bb6077ad1b156c9712302890b8456e45aad7a881/code/core/src/csf/csf-factories.ts#L314-L344), [processCSFFile.ts L60-72](https://github.com/storybookjs/storybook/blob/bb6077ad1b156c9712302890b8456e45aad7a881/code/core/src/preview-api/modules/store/csf/processCSFFile.ts#L60-L72) |
| 1f | React needs `features.experimentalTestSyntax`, otherwise rendering a test entry throws | **Confirmed** (React renderer only) | [react entry-preview.tsx L39-47](https://github.com/storybookjs/storybook/blob/bb6077ad1b156c9712302890b8456e45aad7a881/code/renderers/react/src/entry-preview.tsx#L39-L47) |
| 1g | Chromatic's handling of test entries | **Not verified** (closed source, not in the docs). Storybook's `extract()` maps a test to its parent for Chromatic | [StoryStore.ts L307-355](https://github.com/storybookjs/storybook/blob/bb6077ad1b156c9712302890b8456e45aad7a881/code/core/src/preview-api/modules/store/StoryStore.ts#L307-L355) |
| 1h | Vitest addon: a story with tests becomes a `describe` with a "base story" test plus one test per `.test()` | **Confirmed** | [vitest-plugin/transformer.ts L243-257](https://github.com/storybookjs/storybook/blob/bb6077ad1b156c9712302890b8456e45aad7a881/code/core/src/csf-tools/vitest-plugin/transformer.ts#L243-L257) |
| 2a | "11 writes its bundler's module graph to a stats file" | **Partly right, misleading.** The file is opt-in (`--stats-json`), has existed since 8.0 (Vite) and earlier for webpack, and is build-only for Vite. **New in 11** (alpha.9, PR #36345): the Vite file is now the *full, unfiltered* Rollup graph | [webpack-stats-plugin.ts L1, L62-111](https://github.com/storybookjs/storybook/blob/bb6077ad1b156c9712302890b8456e45aad7a881/code/builders/builder-vite/src/plugins/webpack-stats-plugin.ts#L1-L111), [MIGRATION.md L1531-1539](https://github.com/storybookjs/storybook/blob/bb6077ad1b156c9712302890b8456e45aad7a881/MIGRATION.md#L1531-L1539) |
| 2b | Change detection (sidebar new/modified/related) | **Exists since 10.4.0**, dev-only. Uses Storybook's **own oxc-based graph**, not the bundler graph. The flag was removed in 11 (always on). Third parties can reach it only through MCP or `storybook tools stories …` | [change-detection.mdx L20-27, L140-142](https://github.com/storybookjs/storybook/blob/bb6077ad1b156c9712302890b8456e45aad7a881/docs/configure/user-interface/change-detection.mdx#L20-L27) |
| 3 | test-runner archived | **Confirmed**: `archivedAt` 2026-09-30T13:07:26Z. Last npm release 0.26.0 (2026-09-30). Not npm-deprecated. Replacement: the Vitest addon | GraphQL `archivedAt`, [MIGRATION.md L1409-1422](https://github.com/storybookjs/storybook/blob/bb6077ad1b156c9712302890b8456e45aad7a881/MIGRATION.md#L1409-L1422) |
| 4 | Support policy | **Documented.** Latest major gets all fixes, but only on its latest minor. The previous **two** majors get High/Critical CVSS security fixes only. Older majors get nothing. No LTS. **No public 11.0 stable date** | [SECURITY.md L3-11](https://github.com/storybookjs/storybook/blob/885191848790dd99b8ee39a2e1d17f1aa7ede0ba/SECURITY.md#L3-L11), [releases/index.mdx L26-40](https://github.com/storybookjs/storybook/blob/885191848790dd99b8ee39a2e1d17f1aa7ede0ba/docs/releases/index.mdx#L26-L40) |
| 5 | Downloads share (last week) | 10: 72.8%, 8: 16.6%, 9: 7.8%, 7: 2.6%, 11: 0.08% | `api.npmjs.org/versions/storybook/last-week` |
| 6 | 8.5+ has `storyFinished` and no `completing` phase | **Confirmed.** 8.4.0 has neither `STORY_FINISHED` nor `finished` | [StoryRender.ts L31-42, L374-375 @8.5.0](https://github.com/storybookjs/storybook/blob/92770672e5112dc397bd864c8013ea899e86fa47/code/core/src/preview-api/modules/preview-web/render/StoryRender.ts#L31-L42) |

## 1. `.test()` index entries

### Type shape (10.0.0 → 11 beta.1 → next, all identical)

[`code/core/src/types/modules/indexer.ts` L74-81 @11](https://github.com/storybookjs/storybook/blob/bb6077ad1b156c9712302890b8456e45aad7a881/code/core/src/types/modules/indexer.ts#L74-L81):

```ts
export type StoryIndexEntry = BaseIndexEntry & {
  type: 'story';
  subtype: 'story' | 'test';
  componentPath?: string;
  exportName?: string;
  parent?: StoryId; // exists only on tests
  parentName?: StoryName; // exists only on tests
};
```

- In 9.1.21 [L74-76](https://github.com/storybookjs/storybook/blob/9abaf68f9a8dd45f0c861e9e1500ba1f6a850e0a/code/core/src/types/modules/indexer.ts#L74-L76) the type is only `type: 'story'`, with no `subtype`, `parent` or `parentName`. 9.1.21's `CsfFile.ts` contains no `.test` parsing. **`.test()` does not exist in 9.x.**
- In 10.0.0 the shape is identical to 11. The changelog places "CSF: Add Storybook test syntax (Storybook v10) – #32455" in **10.0.0-beta.7**, and "Core: Make `subtype` an optional property on an index input – #32602" in 10.0.0-beta.10. `StoryIndexInput.subtype` is optional ([L147-152](https://github.com/storybookjs/storybook/blob/bb6077ad1b156c9712302890b8456e45aad7a881/code/core/src/types/modules/indexer.ts#L147-L152)). The generator defaults a missing subtype to `'story'` ([StoryIndexGenerator L469](https://github.com/storybookjs/storybook/blob/bb6077ad1b156c9712302890b8456e45aad7a881/code/core/src/core-server/utils/StoryIndexGenerator.ts#L469)), so **every** story entry in a 10+ `index.json` carries `subtype`.
- **No change in 11.** It is not stabilised and the subtype is not renamed. The index stays at `v: 5` (L795 in both 10.6.7 and 11). The docs still call it experimental ([csf/api.mdx L229](https://github.com/storybookjs/storybook/blob/bb6077ad1b156c9712302890b8456e45aad7a881/docs/writing-stories/csf/api.mdx#L229)): "While this API is still experimental, it is documented in the RFC … and must be enabled via the `experimentalTestSyntax` feature flag." The flag is documented only under `<If renderer="react">` ([main-config-features.mdx L298-310](https://github.com/storybookjs/storybook/blob/bb6077ad1b156c9712302890b8456e45aad7a881/docs/api/main-config/main-config-features.mdx#L298-L310)).

### What a test entry is

It is a CSF Next (factory) story method. Docs example ([`docs/_snippets/csf-4-story-test.md`](https://github.com/storybookjs/storybook/blob/bb6077ad1b156c9712302890b8456e45aad7a881/docs/_snippets/csf-4-story-test.md)):

```ts
export const PrimaryDisabled = Primary.extend({ args: { disabled: true } });
PrimaryDisabled.test('should be disabled', async ({ canvas, userEvent, args }) => { … });
```

The static indexer recognises `X.test('literal', fn)` and `X.test('literal', annotations, fn)` when `X` is a story identifier ([CsfFile.ts L1070-1101](https://github.com/storybookjs/storybook/blob/bb6077ad1b156c9712302890b8456e45aad7a881/code/core/src/csf-tools/CsfFile.ts#L1070-L1101)). The test name must be a string literal.

Index inputs ([CsfFile.ts L1380-1411](https://github.com/storybookjs/storybook/blob/bb6077ad1b156c9712302890b8456e45aad7a881/code/core/src/csf-tools/CsfFile.ts#L1380-L1411)). The parent is pushed first, then one entry per test:

```ts
index.push({ ...storyInput, type: 'story', subtype: 'test', name: test.name,
  parent: story.id, parentName: story.name,
  tags: [...storyInput.tags, `!${Tag.AUTODOCS}`, ...test.tags, Tag.TEST_FN],
  __id: test.id });
```

The test entry's fields work as follows:

- **id**: `toTestId(parentId, testName)` = `` `${parentId}:${sanitizeSafe(testName,'test')}` `` ([csf-utils.ts L39-41](https://github.com/storybookjs/storybook/blob/bb6077ad1b156c9712302890b8456e45aad7a881/code/core/src/csf/csf-utils.ts#L39-L41); in 10.0.0 this lives in `csf/index.ts` L30-32). The name is sanitised to `[a-z0-9-]`, so the only separator is a **colon**.
- **name**: the test name.
- **title**: the parent's title (there is a TODO about nesting).
- **importPath**: same as the parent.
- **exportName**: **same as the parent** (it comes from `storyInput`).
- **tags**: the parent's tags, plus `!autodocs`, plus the test's own `tags` from its annotations, plus `test-fn` ([`Tag.TEST_FN = 'test-fn'`](https://github.com/storybookjs/storybook/blob/bb6077ad1b156c9712302890b8456e45aad7a881/code/core/src/shared/constants/tags.ts#L13-L14)). The sidebar's built-in `_test` filter is just `subtype === 'test'` ([tags.ts L40-43](https://github.com/storybookjs/storybook/blob/bb6077ad1b156c9712302890b8456e45aad7a881/code/core/src/shared/constants/tags.ts#L40-L43)).

**Real static-build sample.** This is Storybook's own UI Storybook, built from `next` and published at `next--635781f3500dd2c49e189caf.chromatic.com/index.json`: 1741 entries, 16 with `subtype: 'test'`.

```json
{"type":"story","subtype":"test","id":"component-testing-test-fn--test-function-types:with-overrides",
 "name":"with overrides","title":"component-testing/test-fn",
 "importPath":"./core/src/component-testing/components/test-fn.stories.tsx",
 "tags":["dev","test","manifest","vitest","some-tag","test-fn"],
 "parent":"component-testing-test-fn--test-function-types","parentName":"Test Function Types",
 "exportName":"TestFunctionTypes"}
```

### Present by default in dev and static builds?

Yes. Neither `CsfFile.indexInputs` nor `StoryIndexGenerator.extractStories` checks `experimentalTestSyntax` ([StoryIndexGenerator L469-492](https://github.com/storybookjs/storybook/blob/bb6077ad1b156c9712302890b8456e45aad7a881/code/core/src/core-server/utils/StoryIndexGenerator.ts#L469-L492)). Both writers serialise `generator.getIndex()` unfiltered: the static build's `writeIndexJson` and the dev `/index.json` route ([index-json.ts L17-24, L61-70](https://github.com/storybookjs/storybook/blob/bb6077ad1b156c9712302890b8456e45aad7a881/code/core/src/core-server/utils/index-json.ts#L17-L70)). The flag only gates **rendering**, and only in React ([entry-preview.tsx L39-47](https://github.com/storybookjs/storybook/blob/bb6077ad1b156c9712302890b8456e45aad7a881/code/renderers/react/src/entry-preview.tsx#L39-L47)):

```ts
if (context.tags?.includes(Tag.TEST_FN) && !global.FEATURES?.experimentalTestSyntax) {
  throw new Error('To use the experimental test function, you must enable the experimentalTestSyntax feature flag. …');
}
```

So in a React project without the flag, the test entries are still in `index.json`, but loading one renders an error. In 11, Vue 3, web-components and Svelte also expose `definePreview` (CSF factories). Their `entry-preview` has no such gate, so `.test()` would render without the flag there. That last point is inferred from the code and was not run.

### What loading `iframe.html?id=<testId>&viewMode=story` does (code reading)

1. `Story.test()` builds the test as `this.extend({...annotations, name, tags: [TEST_FN, '!autodocs', ...], play})`. Its `play` is `await this.play?.(context); await testFunction(context);` ([csf-factories.ts L314-344](https://github.com/storybookjs/storybook/blob/bb6077ad1b156c9712302890b8456e45aad7a881/code/core/src/csf/csf-factories.ts#L314-L344)).
2. `extend` **inherits the parent's annotations and merges the overrides** ([L345-374](https://github.com/storybookjs/storybook/blob/bb6077ad1b156c9712302890b8456e45aad7a881/code/core/src/csf/csf-factories.ts#L345-L374)):
   - `args` and `globals` are shallow-merged.
   - `parameters` and `argTypes` are deep-merged with `combineParameters`.
   - decorators, loaders, `beforeEach` and `afterEach` are concatenated.

   A test therefore has the parent's args, parameters and globals unless it passes an annotations object. With one, it can override them; for example, Storybook's own fixture "with overrides" does this.
3. The preview registers each child under its test ID (`csfFile.stories[childId] = normalizeStory(name, child.input, meta)`, [processCSFFile.ts L60-72](https://github.com/storybookjs/storybook/blob/bb6077ad1b156c9712302890b8456e45aad7a881/code/core/src/preview-api/modules/store/csf/processCSFFile.ts#L60-L72)). So `?id=<testId>` resolves like any story. It renders with the merged args, then runs the parent's play followed by the test fn.
4. **The end screen can differ from the parent story.** The test fn gets the full play context (`canvas`, `userEvent`, `args`) and may click or type. Args overrides also change the initial render.

### Chromatic

**Not verified.** Chromatic's docs (snapshots, interactions, modes) say nothing about `.test`, test entries or `subtype`. chromatic-cli has no reference to `subtype` or `test-fn`, because captures happen server-side. The only hint is in Storybook: commit [b6c6e94](https://github.com/storybookjs/storybook/commit/b6c6e9498f) by Gert Hengeveld of Chromatic, titled "Make it possible to distinguish tests from stories in StoryStore.extract, and track the parent story name for a test". `extract()` keys each test under its own ID but sets `storyId: entry.parent` and `story: entry.parentName` ([StoryStore.ts L351-353](https://github.com/storybookjs/storybook/blob/bb6077ad1b156c9712302890b8456e45aad7a881/code/core/src/preview-api/modules/store/StoryStore.ts#L351-L353)). That suggests Chromatic groups tests under their parent story, but it is not proof. (`extract()` also still has leftover `console.log('extract: …')` calls at L312 and L361 in 10.0 through next.)

### Vitest addon

The transformer emits `describe('<Story name>  ', () => { test('base story', …); test('<test name>', …) })`, passing `storyId: testId` for each test ([transformer.ts L243-257](https://github.com/storybookjs/storybook/blob/bb6077ad1b156c9712302890b8456e45aad7a881/code/core/src/csf-tools/vitest-plugin/transformer.ts#L243-L257)). The UI maps an index entry that has a `parent` to the Vitest name pattern "parent describe + test name" ([vitest-manager.ts L267-288](https://github.com/storybookjs/storybook/blob/bb6077ad1b156c9712302890b8456e45aad7a881/code/addons/vitest/src/node/vitest-manager.ts#L267-L288)).

## 2. Module graph / stats file

### `--stats-json` → `preview-stats.json` (opt-in, not always on)

- **History.** Webpack had `--webpack-stats-json` before 8. 8.0 added Vite support and renamed the flag to `--stats-json`, keeping the old one as an alias ([MIGRATION.md L4462-4470, "From 7.x to 8.0.0"](https://github.com/storybookjs/storybook/blob/bb6077ad1b156c9712302890b8456e45aad7a881/MIGRATION.md#L4462-L4470)). Both `dev` and `build` list the flag ([cli-options.mdx L59, L95](https://github.com/storybookjs/storybook/blob/bb6077ad1b156c9712302890b8456e45aad7a881/docs/api/cli-options.mdx#L59)).
- **Written only when the flag is set.** Build: [build-static.ts L206-210](https://github.com/storybookjs/storybook/blob/bb6077ad1b156c9712302890b8456e45aad7a881/code/core/src/core-server/build-static.ts#L206-L210). Dev: [build-dev.ts L317-321](https://github.com/storybookjs/storybook/blob/bb6077ad1b156c9712302890b8456e45aad7a881/code/core/src/core-server/build-dev.ts#L317-L321). The file is `<dir>/preview-stats.json`; by default `<dir>` is the output dir, so it sits beside `index.json` ([output-stats.ts L21-23](https://github.com/storybookjs/storybook/blob/bb6077ad1b156c9712302890b8456e45aad7a881/code/core/src/core-server/utils/output-stats.ts#L21-L23)).
- **Vite: build only.** The dev builder's stats throw `NoStatsForViteDevError` ([builder-vite index.ts L76-82](https://github.com/storybookjs/storybook/blob/bb6077ad1b156c9712302890b8456e45aad7a881/code/builders/builder-vite/src/index.ts#L76-L82)). The stats plugin is always registered ([vite-config.ts L186-187](https://github.com/storybookjs/storybook/blob/bb6077ad1b156c9712302890b8456e45aad7a881/code/builders/builder-vite/src/vite-config.ts#L186-L187)), but its output is only written with the flag.
- **Webpack** writes webpack's native `stats.toJson()` minus `chunks`, in dev and in build.
- **Format.** Webpack-style `{ modules: [{ id, name, reasons: [{ moduleName }] }] }`, with paths relative to the working dir as `./src/…`. It was designed for Chromatic TurboSnap.

### What changed in 11

PR [#36345](https://github.com/storybookjs/storybook/pull/36345) "Builder-Vite: Write the full bundler graph to preview-stats.json" was merged to `next` on 2026-10-21 and shipped in **11.0.0-alpha.9**. Its author is codykaup, from Chromatic. It was not backported: 10.6.7 still filters with `isUserCode` ([10.6.7 L42-58, L113-135](https://github.com/storybookjs/storybook/blob/fe4037caa4130753c27fe3e6dd73bda52550f68b/code/builders/builder-vite/src/plugins/webpack-stats-plugin.ts#L42-L58)). The 11 plugin header ([L1](https://github.com/storybookjs/storybook/blob/bb6077ad1b156c9712302890b8456e45aad7a881/code/builders/builder-vite/src/plugins/webpack-stats-plugin.ts#L1)) is the likely source of the ticket's wording:

> `// Writes the bundler's module graph as webpack-style stats for TurboSnap.`

The plugin now records every `moduleParsed` id and every edge to its `importedIds` and `dynamicallyImportedIds`. The only transformation is relativising paths ([L62-111](https://github.com/storybookjs/storybook/blob/bb6077ad1b156c9712302890b8456e45aad7a881/code/builders/builder-vite/src/plugins/webpack-stats-plugin.ts#L62-L111)). From the PR body: "We want the builder to produce the full graph, not a graph shaped for one consumer … other tools get the same data." [MIGRATION.md L1531-1539](https://github.com/storybookjs/storybook/blob/bb6077ad1b156c9712302890b8456e45aad7a881/MIGRATION.md#L1531-L1539) lists what the file now also contains:

- virtual modules such as `/virtual:/@storybook/builder-vite/project-annotations.js`;
- `\0` proxy modules (`\0./node_modules/react/index.js?commonjs-es-import`);
- query sub-modules (`./src/Button.vue?vue&type=style&index=0&lang.css`).

It also states the consumer requirement: "It needs `chromatic-cli` v18.13.1 or later". The PR body explains why the change was needed: since 10.3 the filtered Vite graph had a hole, with no edge from `.storybook/preview` to the entry.

**Coverage (inferred from Rollup and webpack semantics, not run):**

- In the Vite graph, JS-imported CSS, JSON and images (`import x from './a.png'`) are nodes.
- CSS `@import` is inlined by Vite's CSS pipeline, and `url()` fonts and images inside CSS are not Rollup module-graph edges. Expect both to be missing from the Vite file.
- Webpack stats include css-loader `@import` and `url()` asset modules as modules.

### Change detection (separate feature; dev-only; not the bundler graph)

- Introduced in **10.4.0** (2026-05-14): "Implement Git change detection" #34420, plus the `changeDetection` flag #34314. In 11 the flag is removed and change detection is always on ([MIGRATION.md L1859-1866](https://github.com/storybookjs/storybook/blob/bb6077ad1b156c9712302890b8456e45aad7a881/MIGRATION.md#L1859-L1866)).
- The docs call it a "development-only feature … not available in static builds", supporting Vite and webpack5 ([change-detection.mdx L20-27](https://github.com/storybookjs/storybook/blob/bb6077ad1b156c9712302890b8456e45aad7a881/docs/configure/user-interface/change-detection.mdx#L20-L27)). Under "How it works" ([L140-142](https://github.com/storybookjs/storybook/blob/bb6077ad1b156c9712302890b8456e45aad7a881/docs/configure/user-interface/change-detection.mdx#L140-L142)): "Storybook builds its own dependency graph by parsing each story file (and its imports) with oxc and resolves module specifiers through the builder's resolve config."
- The builder adapter only supplies the resolve config (aliases, conditions, root) and file-watch events ([vite change-detection-adapter L11-60](https://github.com/storybookjs/storybook/blob/bb6077ad1b156c9712302890b8456e45aad7a881/code/builders/builder-vite/src/change-detection-adapter/index.ts#L11-L60)).
- **Coverage.** The parsers are JS/TS (oxc) and MDX (regex); `.vue` and `.svelte` come via the `experimental_importParsers` preset ([builtins.ts L7-29](https://github.com/storybookjs/storybook/blob/bb6077ad1b156c9712302890b8456e45aad7a881/code/core/src/shared/open-service/services/module-graph/engine/parser-registry/builtins.ts#L7-L29)). The walk records every resolved dependency but stops at files with no parser ([walk-from-story.ts L35-58](https://github.com/storybookjs/storybook/blob/bb6077ad1b156c9712302890b8456e45aad7a881/code/core/src/shared/open-service/services/module-graph/engine/dependency-graph/walk-from-story.ts#L35-L58)). JS-imported `.css`, `.json` and images are therefore **leaf** nodes, and CSS `@import` and `url()` are **not** followed. The walk is capped at depth 50. Barrel re-exports are resolved.
- **Exposure to third parties:**
  - The `core/module-graph` service is declared `internal: true` ([definition.ts L87-91](https://github.com/storybookjs/storybook/blob/bb6077ad1b156c9712302890b8456e45aad7a881/code/core/src/shared/open-service/services/module-graph/definition.ts#L87-L91)).
  - Public entry points are the MCP tools `stories-changed` and `stories-find-by-component` (docs/ai/mcp), and the CLI `storybook tools <toolset> <tool>` ([bin/core.ts L229-234](https://github.com/storybookjs/storybook/blob/bb6077ad1b156c9712302890b8456e45aad7a881/code/core/src/bin/core.ts#L229-L234), also present in 10.6.7). These are toolset definitions ([stories toolset L197-214](https://github.com/storybookjs/storybook/blob/bb6077ad1b156c9712302890b8456e45aad7a881/code/core/src/shared/open-service/toolsets/stories/definition.ts#L197-L214)). `findByComponent` returns story IDs with an import distance. The Vite builder has a **headless** adapter so `storybook tools` can build the graph without a dev server ([headless.ts L6-17](https://github.com/storybookjs/storybook/blob/bb6077ad1b156c9712302890b8456e45aad7a881/code/builders/builder-vite/src/change-detection-adapter/headless.ts#L6-L17)). Webpack has no headless adapter.
  - The `STORYBOOK_CHANGE_DETECTION_DEBUG=1|<path>` environment variable dumps the graph JSON at dev startup ([change-detection.mdx L125-138](https://github.com/storybookjs/storybook/blob/bb6077ad1b156c9712302890b8456e45aad7a881/docs/configure/user-interface/change-detection.mdx#L125-L138)). It is a debug aid, not a stable format.

## 3. storybookjs/test-runner

- GraphQL: `isArchived: true`, `archivedAt: 2026-09-30T13:07:26Z`, `pushedAt: 2026-09-30T12:38:17Z`. Last commit: 2026-09-29, "Merge pull request #610 … fix/remove-official-support".
- npm `@storybook/test-runner`: `latest` is 0.26.0, published 2026-09-30T12:40:33Z. It is **not** npm-deprecated. Its peer range is `^10… || ^11.0.0-0 || >=11`. It "prints a warning on every run".
- The README banner says: "Official support for Storybook Test Runner has ended." It points to the Vitest addon for Vite projects.
- [MIGRATION.md L1409-1422 (10→11)](https://github.com/storybookjs/storybook/blob/bb6077ad1b156c9712302890b8456e45aad7a881/MIGRATION.md#L1409-L1422) recommends:
  - for Vite: the Vitest addon;
  - for Webpack: switch to a Vite framework first (`nextjs-to-nextjs-vite`, `angular-to-angular-vite`, react-vite);
  - otherwise: keep the runner unsupported, or use "plain Playwright with a minimal setup that generates tests from stories" (a gist by AriPerkkio).

  The 11 docs page title is "Test runner (unsupported)".

## 4. Support policy and release dates

- [SECURITY.md L5-11](https://github.com/storybookjs/storybook/blob/885191848790dd99b8ee39a2e1d17f1aa7ede0ba/SECURITY.md#L5-L11) (next):
  - "Latest major version: All security vulnerabilities"
  - "Previous two major versions: High or Critical CVSS scores only"
  - "Older versions: Not supported"
- [docs/releases/index.mdx L28](https://github.com/storybookjs/storybook/blob/885191848790dd99b8ee39a2e1d17f1aa7ede0ba/docs/releases/index.mdx#L28): "We actively maintain the latest major version … Within the current major, we patch only the latest minor version." There is **no LTS** and no time-based window; support depends on the major count.
  - When 11.0 goes stable, 9 becomes "previous two" (security-only) and 8 drops out.
  - Practice deviates from the policy: 7.6.24 shipped on 2026-03-06 while 10 was latest.
- Cadence:
  - The releases page says majors come "roughly once per year".
  - [roadmap.mdx L12](https://github.com/storybookjs/storybook/blob/885191848790dd99b8ee39a2e1d17f1aa7ede0ba/docs/releases/roadmap.mdx#L12) says minors come "every eight weeks", and the major "typically in Feb/Mar". This is stale: 9.0 shipped in May 2025 and 10.0 in Oct 2025.
- **No public 11.0 stable date.** The GitHub milestone "11" has no due date and 40 open issues. "[SB 11 QA]" issues are being filed daily (2026-11-11 and 2026-11-12). Neither the blog nor discussions have a date.

| Version | npm publish time |
|---|---|
| 9.0.0 | 2025-05-28 |
| 9.1.0 | 2025-07-31 |
| 10.0.0 | 2025-10-28 |
| 10.4.0 / 10.5.0 / 10.6.0 | 2026-05-14 / 2026-07-10 / 2026-09-02 |
| 11.0.0-alpha.0 | 2026-09-02 |
| 11.0.0-beta.0 / beta.1 | 2026-11-03 / 2026-11-09 |
| **latest 9.1.x: 9.1.21** | 2026-10-12. Security batch shared with 8.6.19 (iframe embedding block, postMessage origin restriction, channel role split) |
| **latest 10.x: 10.6.7** | 2026-11-10 |

Old-major patches since 10.0:

- 9.1.17 to 9.1.21: 2025-12-17, 2026-02-17, 2026-02-18, 2026-03-05, 2026-10-12.
- 8.6.15 to 8.6.19 on the same days.
- 7.6.21 to 7.6.24.

`npm view storybook dist-tags`:

- `latest` 10.6.7, `next` 11.0.0-beta.1
- `v9` 9.1.21, `v8` 8.6.19, `v7` 7.6.24
- canaries
- **no `beta` tag**

## 5. Downloads by major (`storybook`, last-week window ending 2026-11-11; total 38,499,417)

| Major | Downloads | Share | Top minors |
|---|---|---|---|
| 10 | 28,025,362 | **72.79%** | 10.6: 51.3%, 10.4: 6.8%, 10.5: 5.9%, 10.3: 4.5%, 10.2: 3.0%, 10.1: 0.8%, 10.0: 0.5% |
| 8 | 6,376,301 | **16.56%** | 8.6: 14.3% |
| 9 | 3,004,171 | **7.80%** | 9.1: 7.0%, 9.0: 0.8% |
| 7 | 1,006,385 | **2.61%** | 7.6: 2.1% |
| 11 | 30,636 | **0.08%** | prereleases |
| ≤6, canary | ~56k | 0.15% | |

There are more downloads of 8 than of 9. The 9 + 10 floor covers about 80.6%. Downloads include CI installs. The `storybook` package was a thin CLI in 7.x, so 7 is probably under-counted.

## 6. 8.x reference

8.5.0 has `STORY_FINISHED = 'storyFinished'` ([core-events L35](https://github.com/storybookjs/storybook/blob/92770672e5112dc397bd864c8013ea899e86fa47/code/core/src/core-events/index.ts#L35)). Its `RenderPhase` is `preparing | loading | beforeEach | rendering | playing | played | afterEach | completed | finished | aborted | errored`, with **no `completing`** ([StoryRender.ts L31-42](https://github.com/storybookjs/storybook/blob/92770672e5112dc397bd864c8013ea899e86fa47/code/core/src/preview-api/modules/preview-web/render/StoryRender.ts#L31-L42)); `STORY_FINISHED` is emitted in the `finished` phase (L374-375). 8.6.19 is the same. 8.4.0 has neither `STORY_FINISHED` nor `finished`. `completing` is present in 9.1.21, 10.6.7 and 11.

## Implications worth flagging (beyond the asked facts)

- **The test ID contains `:`.** A baseline named `<testId>.png` is an illegal filename on Windows (NTFS) and awkward on macOS. Test entries need an escaping rule, or must be skipped.
- **A test entry shares `exportName` and `importPath` with its parent, inherits its parameters, and usually ends on a different screen.** Treat it as its own story if it is captured. Fallow's file graph maps it to the same story file as its parent.
- **React without the flag:** test entries are still in `index.json`, but rendering them throws. Either filter on `subtype === 'test'` or `tags` containing `test-fn`, or expect error screens.
- In 9.1.21, 8.6.19, 10.6.2+ and 11, `storybook dev` sends `frame-ancestors` and restricts `postMessage`. Top-level navigation to `iframe.html` is unaffected; only embedding from non-localhost origins is blocked.

## Could NOT verify

- **Chromatic's treatment of test entries** (captured or not, keyed by test ID or parent). There is no public doc or code; only the `extract()` hint above.
- **Runtime behaviour of `iframe.html?id=<testId>`.** This is based on code reading only; no browser was run. Index presence is confirmed from a real static build.
- **What the Vite and webpack stats contain for CSS `@import`, `url()` fonts and images.** Inferred from bundler semantics, not from a generated file.
- **An 11.0 stable target date.** None was found in the milestone, discussions, docs or blog search.
- The exact date `.test()` was announced to users. It was merged on 2025-09-24 (PR #32455) and first released in 10.0.0-beta.7, but the 10.0 blog was not checked.
