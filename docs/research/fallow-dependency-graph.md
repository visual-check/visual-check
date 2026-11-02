# Fallow as a dependency graph source

Research for [#3](https://github.com/visual-check/visual-check/issues/3), feeding [#14 Affected stories rules](https://github.com/visual-check/visual-check/issues/14). Checked 2026-11-02 against fallow 3.38.1, knip 6.44.1 and Storybook 9.1.21 with Vite 7.

## Answer

Yes. Fallow can supply the dependency graph for affected stories through a documented, typed CLI call: `fallow dead-code --impact-closure <file> --format json`, once per changed file, unioned. It handles monorepos, CSS `@import`, path aliases and framework files with no config and no `node_modules`.

It has one gap that #14 must cover. **Assets and JSON are not in the graph**: images, fonts, `.json` and `?raw` files have no nodes, and asking about one exits 2. Bundler stats have the opposite gap: they include imported assets and JSON but miss CSS `@import` targets.

## Recommendation

Use fallow, called as a subprocess behind a small seam in the engine:

1. Depend on an exact fallow version. It moves fast and has one main author.
2. Run with a config file visual-check owns (`--config`), so a user's `.fallowrc` cannot drop stories from the graph.
3. Take the story list from Storybook's `index.json`, not from fallow. Affected stories are those whose `importPath` is in the union of changed files and their closures.
4. Treat what the graph can't answer as an explicit rule in #14 (see [Rules #14 needs](#rules-14-needs)).

Knip stays the fallback if fallow disappoints. Bundler stats are not worth building on for v1: they need a Storybook build before selection can start, and they still miss CSS `@import`.

## What fallow exposes

| Surface | What it gives | Usable? |
|---|---|---|
| `dead-code --impact-closure <file>` | Transitive importers of one file, re-exports included, in `affected_not_shown` | **Yes: the primary call** |
| `dead-code --trace-file <file>` | Direct `imports_from` and `imported_by`, plus reachability | Yes, for debugging |
| `viz --viz-format dot` | Every node and edge in one run | Works, but the DOT shape has no schema |
| `list --files` | Every file in the graph | Yes, to sort changed files before asking |
| `audit --brief` | Closure over a whole diff | No: `affected_not_shown` is capped at 10 paths |
| `@fallow-cli/fallow-node` | Nine `detect*`/`compute*` functions | No: no trace or graph function |
| Rust crates, including `fallow-graph` | The graph itself | No: explicitly not a supported API |

Sources: [`FileTrace`, `ImpactClosureTrace`](https://github.com/fallow-rs/fallow/blob/v3.38.1/docs/output-schema.json) (also published as `fallow/types`), [closure engine](https://github.com/fallow-rs/fallow/blob/v3.38.1/crates/graph/src/graph/impact_closure.rs), [Node binding README](https://github.com/fallow-rs/fallow/blob/v3.38.1/crates/napi/README.md).

`--impact-closure` takes one seed and rejects a repeated flag (tested). Upstream documents the workaround: run it ["once per changed file and union the results"](https://github.com/fallow-rs/fallow/blob/v3.38.1/docs/backwards-compatibility.md). The result was not capped in testing (457 paths on the Primer run below).

### Stability

From the [compatibility policy](https://github.com/fallow-rs/fallow/blob/v3.38.1/docs/backwards-compatibility.md):

- Fallow follows semver from v1. Config, JSON output and CLI are covered, and removals go through a deprecation first.
- New JSON fields can arrive in any minor, so parse leniently.
- `kind: "trace"` shapes are typed but carry no `schema_version`, so a change to them has no version number to detect.
- Detection accuracy can change in a minor. The set of affected stories can therefore shift on upgrade even if the shapes don't, which is another reason to pin.
- Rust crates are excluded from the semver promise.

Maturity is the real risk. The [repo](https://github.com/fallow-rs/fallow) was created in March 2026, reached v3.0.0 in July and releases every few days. One author has about 4,300 of its commits. Knip dates from 2022.

Telemetry is [opt-in and off by default](https://github.com/fallow-rs/fallow/blob/v3.38.1/docs/telemetry.md). The trace features are marked free in `capabilities.json`.

## Test results

All runs used fallow 3.38.1 on throwaway fixtures. Only the Storybook fixture had dependencies installed.

### Coverage compared with bundler stats

A React and Vite fixture, built with `storybook build --stats-json`, compared against the same files in fallow:

| Changed file, imported via | Fallow | `preview-stats.json` |
|---|---|---|
| `.ts`/`.tsx` import | Yes | Yes |
| Path alias (`@/helper`) | Yes | Yes |
| CSS Module imported from JS | Yes | Yes |
| CSS `@import` chain (`base.css`, `tokens.css`) | **Yes** | **No** |
| `?inline` CSS | Yes | Yes |
| `.storybook/preview` imports | Yes | Yes |
| `import` of `.svg` | **No** | **Yes** |
| `import` of `.json` | **No** | **Yes** |
| `import` of `.md?raw` | **No** | **Yes** |
| `new URL("./u.png", import.meta.url)` | No | No |
| CSS `url(./bg.png)` | No | No |
| `import type` only | Yes (selects extra stories) | No |
| Barrel re-export | Yes (selects extra stories) | Yes (selects extra stories) |

The bundler's `@import` miss follows from how Storybook builds the stats: its [Vite plugin](https://github.com/storybookjs/storybook/blob/next/code/builders/builder-vite/src/plugins/webpack-stats-plugin.ts) records only Rollup's `moduleParsed` imports. That CSS inlining hides `@import` from Rollup is my inference from the result, not something I traced in Vite. Chromatic [tells users to list](https://www.chromatic.com/docs/turbosnap/setup/) files processed outside the bundler in `--externals`.

### Other fallow cases

| Case | Result |
|---|---|
| Workspace package via `exports`, including subpaths | Followed, without `node_modules` |
| `exports` pointing at unbuilt `dist/`, source in `src/` | Mapped back to `src/` |
| Per-package tsconfig `paths` | Followed |
| Package `imports` (`#sub/*`) | Followed |
| CSS `@import "@pkg/theme.css"` across workspaces | Followed |
| SCSS `@use "vars"` to `_vars.scss` | Followed |
| Vite aliases: computed with `path.resolve`, and regex | Followed |
| Storybook `viteFinal` alias | **Missed**: no edge, reported as an unlisted dependency |
| `import.meta.glob` | Followed |
| Template-literal `import()` | Followed, broadly: every file under the static prefix |
| `import(variable)` | **Missed**, as expected |
| `.mdx`, Vue `<script>`, `<style src>` and `@import`, Svelte `<script>` | Followed |
| Stories listed in `main.ts` outside the app's folder | Found |
| Next.js app routes | Found as entries by the plugin, one of [149 built in](https://github.com/fallow-rs/fallow/blob/v3.38.1/npm/fallow/capabilities.json) |
| Deleted file | Exit 2, `not found in module graph` |
| Unreachable file | Stays in the graph, so closures don't depend on entry detection |

Not tested: Angular, webpack `require.context`, Nuxt auto-imports. Fallow's [CSS extractor](https://github.com/fallow-rs/fallow/blob/v3.38.1/crates/extract/src/css.rs) handles `@import`, `@use`, `@forward` and `@plugin`.

### Traps

- A `.fallowrc` with `ignorePatterns` matching stories, or `production: true`, removes stories from closures without any error. Passing `--config` with an empty file visual-check owns restored the full result.
- A closure excludes its seed, so a changed story file must be added back.
- `.storybook/preview` has no importers, so its closure reaches no stories. "Affects everything" has to be a rule in visual-check.
- Assets, deleted files and ignored files all give the same exit 2 and message. Sort changed files with `list --files` rather than parsing the error.
- Fallow writes a `.fallow/` cache to the project root (8.3 MB on Primer). It ignores itself in git, and `FALLOW_CACHE_DIR` moves it.

### Speed

[primer/react](https://github.com/primer/react) at `6826a6a`, not installed: 1,317 graph files, 3,108 edges. Timings are from one laptop.

| Call | Time |
|---|---|
| `list --files`, no cache | 0.28 s |
| One closure, first run | 0.42 s |
| One closure, warm | 0.33 s |
| 40 closures in sequence | 13.4 s (0.34 s each) |
| 40 closures, 8 in parallel | 10.4 s |
| `viz --viz-format dot`, whole graph | 0.42 s |

One closure on `ButtonBase.tsx` found 457 files, 174 of them story files.

Parallel runs barely help. If per-file cost ever matters, the DOT graph is a tested alternative: a reverse walk over it matched `--impact-closure` on all 65 fixture files and on 32 of 32 Primer seeds. It has no schema, so it would need a contract test. A multi-seed `--impact-closure` would be the better fix, and it's worth asking upstream.

## Comparison

| | Fallow | Knip | Bundler stats (TurboSnap's approach) |
|---|---|---|---|
| Evidence here | Run | **Source and docs only** | Run on a small fixture |
| Access | CLI JSON | No public graph; see below | File from `storybook build --stats-json` |
| Closure built in | Yes | No, walk it yourself | No, walk it yourself |
| CSS `@import` | Yes, by default | Only with a compiler; plain CSS needs a custom one | No |
| Imported assets, JSON | No | Assets no; JSON not confirmed | Yes |
| Needs | Nothing installed | Installed deps, for config loading | A full Storybook build first |
| Runs project code | No, reads configs as AST | Yes, loads configs with jiti | Yes, it's a build |
| Node | `>=22` | `^20.19 \|\| >=22.12` | Whatever Storybook needs |
| Install | 1.8 MB + 46 MB native binary | 47 MB with TypeScript | None extra |
| Maturity | Since March 2026 | Since 2022, known-working baseline | Used by Chromatic in production |

**Knip.** Its graph comes from the internal `run()`, as `session.getGraph()`. The [package exports](https://github.com/webpro-nl/knip/blob/knip@6.44.1/packages/knip/package.json) only reach `.`, `./config` and `./session`, and the public `Session` type offers `describeFile` but not the graph. Its [docs](https://knip.dev/features/compilers) say plain CSS needs a custom compiler, and its [source manager](https://github.com/webpro-nl/knip/blob/knip@6.44.1/packages/knip/src/typescript/SourceFileManager.ts) reads foreign extensions as empty text without one. Config loading failures [exit 2](https://knip.dev/reference/known-issues).

**Bundler stats.** Chromatic's [tracer](https://github.com/chromaui/chromatic-cli/blob/main/node-src/lib/turbosnap/v1/getDependentStoryFiles.ts) walks stats back to story files, and it [recaptures everything](https://www.chromatic.com/docs/turbosnap/) on Storybook config, `preview` imports, static folders, `--externals` and lockfile mismatches. That list is a useful checklist for #14 (ideas only). The stats exist only after a build, which conflicts with cheap local selection before capture. My build took 3.2 s on the tiny fixture. I did not measure a large Storybook.

## Rules #14 needs

The graph can't answer these on its own:

| Changed file | Suggested rule |
|---|---|
| In the graph | Seed plus closure |
| Closure or seed includes `.storybook/preview*` | All stories of that Storybook |
| `.storybook/main*`, static dirs | All stories of that Storybook |
| Lockfile, `package.json`, tsconfig, Vite or PostCSS config | All stories |
| Image, font, `.json` and other asset types | All stories, or a filename search (open question) |
| Other files not in the graph (README, CI config) | Ignore |
| Deleted file | Its importers changed too, so usually covered. Glob imports are the exception (open question) |
| Fallow exits non-zero for any other reason | All stories |

## Open questions for #14

- Should an asset change trigger all stories, or search graph files for the filename and seed from the matches? I'd start with all stories because it's simple and safe.
- Should unlisted dependencies trigger all stories? A missed `viteFinal` alias shows up as one, so it can be detected (unlike `import(variable)`), but reading them takes a second call.
- Is Node 22 acceptable as visual-check's minimum? Fallow's `engines` require it.

## Limits of this research

- **Knip was not run.** Running it against a cloned public repo was blocked by a permission check, because it would load that repo's config files. I did not retry it on a local fixture, so everything on knip is from its source and docs.
- Bundler stats were tested with Vite only, not webpack.
- Stats plugin source was read from Storybook's `next` branch, while the fixture ran 9.1.21.
- Fixtures were small and synthetic. Primer was used for scale and for DOT agreement, not checked for correctness against a real build.
