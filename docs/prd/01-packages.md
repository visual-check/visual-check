# Packages

Part of the [v1 PRD](README.md). Terms come from the [glossary](../../GLOSSARY.md).

v1 publishes four npm packages and reserves one name. The Action, the test apps and the docs site aren't npm packages.

## Published packages

| Package                         | Holds                                                                            | Versioning                               |
| ------------------------------- | -------------------------------------------------------------------------------- | ---------------------------------------- |
| `@visual-check/cli`             | The CLI, the engine and the public config API                                    | Lockstep group                           |
| `@visual-check/storybook`       | Code that runs in Storybook's preview: the options helper and the grid component | Lockstep group                           |
| `@visual-check/storybook-addon` | The Storybook panel                                                              | Lockstep group                           |
| `@visual-check/chromium`        | Data naming one exact Chromium build                                             | Its own: the major is the Chromium major |
| `visual-check` (unscoped)       | A README-only placeholder                                                        | Published once                           |

The three packages of the lockstep group always share one version and release together ([Release process](19-release.md)).

## `@visual-check/cli`

- Its only binary is `visual-check`. `vc` is ruled out because the Vercel CLI uses it.
- It exports `defineConfig`, the config types and the report's JSON types. v1 ships no JSON Schema file.
- It supports Node 22 and later, because Fallow needs 22.
- It depends on `sharp` and `pixelmatch` ([Visual diff](09-visual-diff.md)), on Fallow at one exact version ([Affected stories](11-affected-stories.md)), and on `yauzl` for the `host` download ([Browser and platform](05-browser-and-platform.md)).
- Nothing in it calls Playwright, and it has no `playwright-core` dependency or peer.
- It has an internal entry that the addon forks as a child process. That protocol is internal.
- It has no `@visual-check/cli/storybook` subpath.
- The Storybook adapter, the capture-source seam, the driver interface and the affected-stories graph interface are internal modules, not packages, until a second implementation exists. The engine can split into `@visual-check/core` later, with `cli` re-exporting it.

### The browser package as a peer

- `@visual-check/chromium` is a peer dependency of the CLI. The range lists only the Chromium majors that CLI release was tested on.
- The range starts at the major of the first browser package visual-check publishes.
- A CLI minor raises the upper bound once a new browser package passes the test apps. Raising the floor forces projects onto a new browser, so it waits for a CLI major.
- At startup the CLI exits 2 when the browser package is missing or out of range, and prints the install command. pnpm only warns about an out-of-range peer, and Yarn never installs a missing one.

## `@visual-check/chromium`

- It holds data only, with no dependencies and no install script.
- Each version records:
  - visual-check's image as `ghcr.io/visual-check/chromium:<version>` with its index digest;
  - the exact Chromium version inside it;
  - the headless shell's path inside the image;
  - the SHA-256 of each Chrome for Testing download that `platform: 'host'` uses: Linux x64 and arm64, macOS x64 and arm64, Windows x64.
- It follows Chrome for Testing's Stable channel only.
- Version numbers:
  - the major is the Chromium major, for example `158.x.x`;
  - a minor is anything else that can move pixels: a Chromium point release or a rebuilt image;
  - a patch never moves pixels, for example a corrected hash.
- The image's Dockerfile sits beside this package in the monorepo ([Browser and platform](05-browser-and-platform.md)).
- A browser added later gets a package of its own.

## `@visual-check/storybook`

- It holds only code that runs in Storybook's preview, and it's safe in a browser.
- The root entry exports:
  - `defineVisualCheck` and its types ([Per-story options](07-per-story-options.md));
  - the framework-free grid module, the plain-DOM `combinations()` and the forced-states utility ([Grid stories](08-grid-stories.md)).
- Subpaths export one port each:
  - `/react`: `Combinations`, for React 18 and 19;
  - `/vue`: `Combinations`, for Vue 3;
  - `/angular`: `combinations()`, for Angular 18 and later.
- It has no run-time dependencies. `storybook`, `react`, `vue` and `@angular/core` are optional peers. `storybook` is there only for the `wait` hook's `StoryContext` type.
- A missing framework never breaks the install. Only importing that framework's entry fails.
- It has no dependency on the CLI. If a newer helper writes a key an older CLI doesn't know, the CLI exits 2 and names the key.
- A project imports it from `<configDir>/visual-check.ts` and from stories files that render the grid.
- It carries the MIT notice of Storybook's pseudo-states addon, which the forced-states utility is adapted from.

## `@visual-check/storybook-addon`

- In v1 it supports Storybook 10. Storybook 11 is decided later.
- It has a manager entry and a preset, with no preview entry and no postinstall.
- It peer-depends on exactly its own version of `@visual-check/cli`. On a mismatch, the panel says which package to upgrade.
- Its behaviour is in [Storybook addon](15-storybook-addon.md).

## The unscoped `visual-check` name

- It's a README-only placeholder with an npm deprecation message that points to `@visual-check/cli`. It exists so nobody else can publish under the name.
- It has no binary and no re-exports. A forwarding wrapper can be added later without breaking anyone.

## What a project installs

`init` installs the packages ([Config and init](03-config-and-init.md)):

- `@visual-check/cli` and `@visual-check/chromium` as devDependencies of the workspace root. The browser package is added at the newest version in the CLI's range, even where npm would install the peer by itself, so Renovate sees it.
- `@visual-check/storybook`, at the CLI's version, as a devDependency of the package that holds each Storybook's `configDir`.
- The addon through `storybook add`, for each Storybook on 10 that the developer ticks.

## Not npm packages

- The composite Action and the reusable workflow live in the public repo `visual-check/action` ([GitHub Action](14-github-action.md)).
- The test apps live in the public repo `visual-check/test-apps` ([Test apps](17-test-apps.md)).
- The docs site and this repo's own test Storybooks are private workspace packages in this repo ([Docs site](20-docs-site.md), [CI for this repo](18-repo-ci.md)).

## Sources

- [Package layout and naming][16], [Playwright peer dependency and Chromium version][45], [Reading per-story options][46], [Cartesian stories helper][50], [Storybook addon][41], [GitHub Action design][40], [Test apps repo][34].
- [ADR 0007](../adr/0007-browser-build-comes-from-a-peer-package.md), [ADR 0008](../adr/0008-browser-runs-in-our-own-image.md).

[16]: https://github.com/visual-check/visual-check/issues/16
[34]: https://github.com/visual-check/visual-check/issues/34
[40]: https://github.com/visual-check/visual-check/issues/40
[41]: https://github.com/visual-check/visual-check/issues/41
[45]: https://github.com/visual-check/visual-check/issues/45
[46]: https://github.com/visual-check/visual-check/issues/46
[50]: https://github.com/visual-check/visual-check/issues/50
