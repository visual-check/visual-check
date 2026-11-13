# Sharding and the consistency check

Part of the [v1 PRD](README.md). Terms come from the [glossary](../../GLOSSARY.md).

`test --shard k/n` runs one shard's share of the stories files as a complete run. The consistency check finds missing baselines and orphans without capturing anything, and it runs before any capture in CI.

## The consistency check

- It compares the baselines that the current stories and their options call for with the files in each baselines folder.
- It needs the browser and a served Storybook, because options live in Storybook parameters. It loads every stories file and captures nothing.
- **It covers every story that isn't disabled,** whatever `--filter` or affected stories select. Only `--storybook` narrows it.
- A stories file that fails to load fails the check, naming the file and its error. That file's baselines are never reported as orphans.

When it runs:

| Run | The check |
|---|---|
| Local `test` | Reports what it finds, still captures and compares, then exits 1. A new story's missing baseline doesn't hide another story's visual diff |
| CI `test`, not sharded | Runs first. If it finds anything, the run exits 1 without capturing, and the report holds only the check's findings |
| CI, sharded | `test --consistency` runs in a job of its own, and the shard jobs wait for it. If it fails, no shard runs |
| `test --shard k/n` | Skips it, and prints a note that missing baselines and orphans are left to `test --consistency` |
| `update` | Uses it to know what to write and delete |

### `test --consistency`

- It runs only the check.
- Exit codes: 0 when consistent, 1 on a missing baseline, an orphan or a stories file that fails to load, 2 on a tool failure.
- It writes the report, marked as consistency only ([Report and output](13-report-and-output.md)).
- It takes `--storybook` and no other selection flag.

## `test --shard k/n`

- `k` and `n` are whole numbers with 1 ≤ k ≤ n. Anything else exits 2.
- There's no config key and no env var for it.
- `--filter` and `--storybook` narrow the run before the split. Without `--storybook`, one split spans every Storybook.
- A shard takes its share of all stories, also on a developer's machine, where the default would be affected stories.
- `--shard` exits 2 with `--affected`, with `--consistency`, and on `update`.

### The split

- **Unit:** a stories file, with all its stories and modes.
- **Input:** `index.json` and the baselines folder. No browser is needed.
- **Weight:** a file's number of baselines, or its number of stories when it has none.
- Files are dealt largest first to the shard with the lowest total so far, with ties broken by path.
- Every shard works out the same split from the same checkout, then loads only its own stories files.
- The split is only roughly even. Nothing is stored between runs, so the algorithm can change later without breaking anyone.

### Each shard

- It's a complete run with its own exit code, log and report. Nothing merges them.
- Its header line shows only its own share, for example `visual-check 0.1.0 · test · shard 2/4 · 12 stories files · 251 snapshots · 2 workers`.
- A shard with nothing to capture exits 0 with a note.
- An unreachable Storybook exits 2 on every shard.
- The report folder has the same name on every shard, and image names never clash across shards. So merging reports later is a matter of joining files.
- The whole run passes only when every shard and the consistency check exit 0.

## On GitHub Actions

GitHub can only make jobs through a workflow matrix, so the workflow sets the shard count.

- **A hand-written matrix:**
  - `strategy: { fail-fast: false, matrix: { shard: [1, 2, 3, 4] } }`;
  - `shard: ${{ matrix.shard }}/${{ strategy.job-total }}` passed to the Action;
  - one more job with `consistency: true`, which the shard jobs `needs:`.
- **The reusable workflow** takes a shard count and builds that layout itself ([GitHub Action](14-github-action.md)).
- `fail-fast: false` is required, so one failing shard doesn't cancel the others.
- Each shard builds and serves its own Storybook. A shard has the browser up about 8 s after it starts pulling the image, and nothing is cached.
- Shards start only after the consistency job has installed, built, served and loaded every stories file. That took about 1:20 on the migration target.

## Sources

- [Sharding across CI jobs][27], [Reading per-story options][46], [Baseline storage and update flow][12], [GitHub Action design][40], [Combined snapshots and network paths in v1][47], [Failure report format][39].
- [ADR 0004](../adr/0004-per-story-options-in-storybook-parameters.md).
- Decided while writing this PRD: the shard's header line.

[12]: https://github.com/visual-check/visual-check/issues/12
[27]: https://github.com/visual-check/visual-check/issues/27
[39]: https://github.com/visual-check/visual-check/issues/39
[40]: https://github.com/visual-check/visual-check/issues/40
[46]: https://github.com/visual-check/visual-check/issues/46
[47]: https://github.com/visual-check/visual-check/issues/47
