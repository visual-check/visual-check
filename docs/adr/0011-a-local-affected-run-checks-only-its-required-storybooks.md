# A local affected run checks only its required Storybooks

PRDs 02, 11 and 12 said the consistency check covers every story whatever is selected, so a local affected run had to reach every Storybook in the run, and one that was down exited 2 even with no changed files. In a monorepo with ten Storybooks, a change to one story needed all ten served. Now a local affected run works out its required Storybooks before it reaches any: those whose `stories` globs match a changed or reached file, those a changed file affects as a whole (a `preview*` or `main*` file in their config folder, a changed package they reach), those with a changed baseline in their baselines folder, and those whose globs can't be read. visual-check's config, a lockfile, `pnpm-workspace.yaml` or a match for `affected.selectAll` requires every Storybook, and so does git or the graph being unable to answer. The run checks, reads `index.json` from and runs the consistency check on only those, and `update` writes missing baselines and deletes orphans in only those. A note names the Storybooks it leaves out. The globs come from each Storybook's own `storybook` package loading its `main.*` in a child process, so they match the files Storybook itself indexes, and any failure makes that Storybook required. CI, `--all`, `--filter`, `--shard` and `test --consistency` still cover every Storybook in the run. Two alternatives lost ([Start only the Storybooks a local affected run needs](https://github.com/visual-check/visual-check/issues/137)):

- **Keep the local check on every Storybook,** narrowing only what's captured. Every local run would still need every Storybook served, and the agent skill's runner would start them all.
- **Read the globs as static strings from `main.*`,** falling back to required. Configs that build `stories` in code, as this repo's test Storybooks do, would always be required, and the CLI has no TypeScript parser.

## Consequences

- CI stays the full gate: an unsharded CI `test` runs the check first on every Storybook, and a sharded run checks in a `test --consistency` job of its own.
- Locally, an inconsistency already in a Storybook the change doesn't reach goes unreported until CI, `--all` or `test --consistency`. CI on the base would have caught it.
- PRD 10's promise holds within one scope: a consistency check over the same Storybooks passes straight after an `update` that wrote everything.
- With no changed file that counts, no Storybook is required, not even one whose globs can't be read, and a local run reaches none.
- The left-out Storybooks are named only in a note, not in `report.json`.
- The loader is Storybook's internal `storybook/internal/common`, which may change between versions. A change there makes every Storybook required again, never a crash.
