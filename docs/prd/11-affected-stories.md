# Affected stories

Part of the [v1 PRD](README.md). Terms come from the [glossary](../../GLOSSARY.md).

Locally, `test` and `update` cover only the stories that the changed files can alter. In CI they cover every story unless `--affected` is passed. Whenever the answer can't be worked out, every story is selected.

## When it applies

| Run        | Default                                                         |
| ---------- | --------------------------------------------------------------- |
| `CI` unset | Affected stories                                                |
| `CI` set   | All stories. The graph isn't read unless `--affected` is passed |

- `--all`, `--affected` and `--filter` are exclusive. Two of them together exit 2.
- `test --consistency` takes none of the three. Any of them exits 2.
- `--shard` with `--affected` exits 2. A shard run on a developer's machine takes its share of all stories, as in CI.

## The base and the changed files

- **The base** is the merge base of `HEAD` and the first of these that resolves:
  1. `--base <ref>`;
  2. `origin/$GITHUB_BASE_REF`;
  3. `origin/HEAD`;
  4. `origin/main`, `origin/master`, then the local branch of the same name.
- The CLI never fetches and never changes git state.
- **Changed files** are the working tree compared with the base, plus untracked files. Gitignored files are left out, and a rename counts as both its old and its new path.

## The graph

- One internal interface: changed files go in, and affected stories files or "can't answer" come out.
- Fallow is its only source in v1, with no option to pick another. Storybook's own graph can replace it later without a config change.
- Fallow is called once per run, as `fallow viz --viz-format dot`, and the graph is walked backwards in memory from each changed file.
  - Fallow is pinned to one exact version.
  - visual-check passes its own Fallow config, so a project's `.fallowrc` can't drop stories.
  - The output is read as a stream, because it passes Node's default 1 MiB buffer.
- The unit is the stories file. An affected file selects all its stories in every mode. Over-selection through barrel files and type-only imports is accepted.

## Rules by changed file

| Changed file                                                                                                  | Selects                                                                                                     |
| ------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| In the graph                                                                                                  | The stories reached by walking back from it, the file itself included when it's a stories file              |
| `preview*`, `main*`, `preview-head.html` or `preview-body.html`, or a walk that reaches `preview*` or `main*` | All stories of that Storybook                                                                               |
| Other files in a Storybook's config folder, such as `visual-check.ts`                                         | What the graph says                                                                                         |
| visual-check's config file                                                                                    | All stories of every Storybook                                                                              |
| A lockfile, `pnpm-workspace.yaml`                                                                             | All stories of every Storybook                                                                              |
| `package.json`, `tsconfig*`, a Vite, PostCSS, Tailwind or Next config, `.env*`                                | All stories of the Storybooks whose graph reaches that package. Every Storybook for a file at the repo root |
| An image, a font or a JSON file that isn't config                                                             | The same scope as the row above                                                                             |
| A baseline                                                                                                    | That baseline's story                                                                                       |
| A match for `affected.selectAll`                                                                              | All stories of every Storybook                                                                              |
| A match for `affected.ignore`                                                                                 | Nothing                                                                                                     |
| Anything else outside the graph, such as a README                                                             | Nothing                                                                                                     |
| A deleted source file                                                                                         | Nothing. Its importers changed too, or the build breaks                                                     |

- A deleted or renamed stories file, or one the graph doesn't hold such as `.mdx`, selects no story, but it still makes its Storybook required.
- A changed baseline also makes its Storybook required.

## Required Storybooks

Before it reaches any Storybook, a local affected run works out which Storybooks it requires, from what needs no server: the changed files, the graph's walk back from them and the rules above.

- **Reading the globs:** each Storybook's own `storybook` package reads its `stories` globs, with `loadMainConfig` and `normalizeStories` from `storybook/internal/common`, in a child process with a 30 s limit. Only as many read at once as the machine has CPUs.
  - A file matches when Storybook's own matcher matches its path relative to the Storybook's real `dir`, starting `./` or `../`, as `index.json` writes import paths.
  - Globs often point into another package, so a change there requires the Storybook.
- **A Storybook is required when:**
  - a changed or reached file matches its globs, deleted, renamed and `.mdx` files included;
  - a rule above selects all its stories: a `preview*` or `main*` file in its config folder, or a changed package its graph reaches;
  - its folder or config folder is outside the git root, since git doesn't see its changes;
  - a changed baseline sits in its baselines folder;
  - its globs can't be read: no `storybook` package resolves from a `node_modules` in its `dir` or a parent folder (so under Yarn PnP it's always required), `main.*` is missing or fails to load, `stories` isn't a list (a function, say), or the child process exits other than with 0, prints no valid matchers or takes over 30 s.
- Every Storybook is required when every story is selected: visual-check's config file, a lockfile, `pnpm-workspace.yaml`, a match for `affected.selectAll`, or git or the graph can't answer. The globs aren't read then.
- None is required when no changed file counts: none changed, or `affected.ignore` matches them all. The globs aren't read then either.
- Only required Storybooks are reached, have `index.json` read and get the consistency check. `error.storybooks` names only the required ones that are down. The CLI still never starts a Storybook.
- A note after the header, after the note of an empty selection, names the ones left out, in config order: `Storybook docs is left out, since no changed file reaches it.` or `Storybooks web, docs and admin are left out, since no changed file reaches them.` It's not in `report.json`, whose `storybooks` lists only the required ones.
- A run in CI, even with `--affected`, and a run with `--all`, `--filter`, `--shard` or `test --consistency` require every Storybook in the run. `--storybook` narrows the run first, so the Storybook it names can be left out too.

## When it can't answer

| Case                                                              | Result                                                                                                                                                                                                                                                                                                                                                     |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No merge base, for example in a shallow clone                     | All stories, with a warning                                                                                                                                                                                                                                                                                                                                |
| An invalid `--base`                                               | Exit 2                                                                                                                                                                                                                                                                                                                                                     |
| Fallow fails, runs out of memory or has no binary for the machine | All stories, with a warning                                                                                                                                                                                                                                                                                                                                |
| No changed files, or `affected.ignore` matches them all           | Locally, no Storybook is required. None is reached or checked, nothing is captured, written or deleted, and the run exits 0. Notes say no story is affected, hint at `--all` and name the Storybooks left out. In CI with `--affected`, every Storybook is still required: nothing is captured, but the consistency check runs, so the exit code is 0 or 1 |
| A Storybook's globs can't be read                                 | It's required whenever a changed file counts                                                                                                                                                                                                                                                                                                               |

## What selection doesn't change

- The consistency check covers every story of the Storybooks in the run, whatever is selected. A local affected run's Storybooks are its required ones, and it loads every stories file of those ([Sharding and the consistency check](12-sharding-and-consistency.md), [ADR 0011](../adr/0011-a-local-affected-run-checks-only-its-required-storybooks.md)).
- `test` never selects a story because its baseline is missing. The consistency check reports it.
- `update` writes every missing baseline and deletes every orphan of the Storybooks in the run, whatever is selected ([Baselines and update](10-baselines-and-update.md)).

## What the report says

- The JSON carries one `selection` field for the run:
  - `by`, how stories were picked: `affected`, `all` or `filter`;
  - the base commit and the number of changed files;
  - whether it fell back to all stories, and why.
- There's no reason per story.

## Known misses

- A file loaded through a glob import, when it's deleted.
- A file type that's outside the graph and not in the rules.

`affected.selectAll` covers both.

## In the Action

- The Action's `affected` input applies on pull requests only. On other events it's ignored with a note.
- When it's on, the Action fetches the base's history until the merge base resolves, because the CLI never fetches.

## Size

On a repo with 12,116 files in the graph, the Fallow call took 1.6 s warm and 2.7 s cold at about 850 MiB, and the walk about 1 ms. Memory is the limit on very large repos, and running out falls back to all stories.

## Sources

- [Fallow as a dependency graph source][3], [Affected stories rules][14], [Sharding across CI jobs][27], [Config file shape and init wizard][38], [Reading per-story options][46], [Storybook 9 floor and Storybook 11][48], [GitHub Action design][40].
- Decided while writing this PRD: exclusive selection flags, the config file selecting every story, and the run-level `selection` field.
- [Start only the Storybooks a local affected run needs][137]: required Storybooks.

[3]: https://github.com/visual-check/visual-check/issues/3
[14]: https://github.com/visual-check/visual-check/issues/14
[27]: https://github.com/visual-check/visual-check/issues/27
[38]: https://github.com/visual-check/visual-check/issues/38
[40]: https://github.com/visual-check/visual-check/issues/40
[46]: https://github.com/visual-check/visual-check/issues/46
[48]: https://github.com/visual-check/visual-check/issues/48
[137]: https://github.com/visual-check/visual-check/issues/137
