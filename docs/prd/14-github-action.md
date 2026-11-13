# GitHub Action and reusable workflow

Part of the [v1 PRD](README.md). Terms come from the [glossary](../../GLOSSARY.md).

A composite Action and a reusable workflow live in the public repo `visual-check/action`. They run the project's own installed CLI, and on failure they upload the report and link it from the job log and the step summary.

## The repo

- `visual-check/action` is public and holds:
  - a composite `action.yml` at its root, so the Marketplace can list it. It's YAML only, with no build;
  - the reusable workflow `.github/workflows/test.yml`. It calls the Action through a same-repo reference, which resolves to the commit the caller pinned. That reference doesn't exist on GitHub Enterprise Server.
- **Versions:** immutable releases `vX.Y.Z`, plus a moving `v1` tag that the docs show. Its major goes up only when an input or a behaviour breaks, apart from the CLI's version.

## Which CLI it runs

- The project's own `@visual-check/cli`, resolved from the working directory. The lockfile picks the version, and the Action never installs one.
- Action `v1` accepts every CLI from the first published `0.x` up to, but not including, 2.0.
- It fails, naming the install command, when the CLI is missing or outside that range.
- It relies only on the four flags it passes (`--storybook`, `--shard`, `--affected` and `--consistency`), the exit code and the report folder. A CLI change that breaks any of them ships with a new Action major.
- It never runs `update`.
- It runs on any runner OS. The docs show Linux.

## The Action's inputs

| Input | Does |
|---|---|
| `storybook` | Runs one named Storybook |
| `shard` | `k/n`, passed as `--shard`. The Action also reads the index from it for the artifact's name |
| `affected` | Passes `--affected`, on pull requests only. On other events it's ignored with a note |
| `consistency` | Runs only the consistency check |
| `working-directory` | Where the config search starts |
| `args` | Extra CLI arguments, such as `--workers` |
| `retention-days` | Passed to the artifact upload. Defaults to the repo's setting |

- **Outputs:** `exit-code`, `report-dir` and `artifact-url`.
- With no selection input, CI covers all stories.
- With `affected` on, the Action fetches the base's history until the merge base resolves.

## On a non-zero exit

For exit 1 and exit 2 alike, the Action:

1. uploads `.visual-check/report/` as one artifact, named `visual-check-report[-<storybook>][-<k>-of-<n>]`, or `visual-check-consistency[-<storybook>]` for the consistency check;
2. appends the artifact's link to the step summary the CLI wrote;
3. prints the run summary's link and the artifact's link as the job log's last lines, which is where a failed check's Details opens;
4. exits with the CLI's code.

- This needs no permissions and works on fork PRs.
- The Action writes no summary of its own and no annotations, and caches nothing.
- Not in v1, and addable later as opt-in inputs: a commit status, a PR comment, and images shown in CI.

## The reusable workflow

`uses: visual-check/action/.github/workflows/test.yml@v1`

| Input | Default | Does |
|---|---|---|
| `shards` | Required | The number of shards |
| `setup` | Required | A shell script, run after checkout and Node setup, that installs, builds and serves Storybook and leaves it running |
| `node-version-file` | `.nvmrc` | |
| `runs-on` | `ubuntu-24.04` | |
| `working-directory` | The repo root | |
| `storybook` | Every Storybook | |

- Secrets come through `secrets: inherit`, for private registries.
- A plan job turns `shards` into the matrix, with `fail-fast: false`.
- A consistency job runs `setup`, then the Action with `consistency: true`. The shard jobs `needs:` it, so no shard runs when it fails.
- Each shard runs `setup`, so it builds and serves its own Storybook.

## Workflows the docs show

- **Linux runners only.** Hosted Windows runners have no Linux container runtime out of the box, and hosted Apple Silicon runners can't run one.
- **A single job,** which is Storybook's own CI recipe:
  1. `actions/checkout` and `actions/setup-node`;
  2. install;
  3. `storybook build`;
  4. serve the static build on the port in the Storybook's `url`, in the background;
  5. wait for the port;
  6. `uses: visual-check/action@v1`.
- There's one server per Storybook.
- An unsharded CI `test` runs the consistency check first and stops when it fails.
- **Sharded:** the hand-written matrix or the reusable workflow ([Sharding and the consistency check](12-sharding-and-consistency.md)).
- **Job containers and devcontainers** are covered in [Browser and platform](05-browser-and-platform.md). The docs lead with plain runners.

## Testing it

- The test apps' CI runs visual-check through the Action and the reusable workflow, including a sharded run and a consistency job. So every test-app run tests them ([Test apps](17-test-apps.md)).
- From the Action's own repo, the same workflow runs against the commit under test.

## Sources

- [GitHub Action design][40], [Sharding across CI jobs][27], [Reading per-story options][46], [Failure report format][39], [Affected stories rules][14], [Windows and macOS on GitHub Actions][33], [Combined snapshots and network paths in v1][47].
- Decided while writing this PRD: the CLI versions `v1` accepts, and how the Action's repo is tested.

[14]: https://github.com/visual-check/visual-check/issues/14
[27]: https://github.com/visual-check/visual-check/issues/27
[33]: https://github.com/visual-check/visual-check/issues/33
[39]: https://github.com/visual-check/visual-check/issues/39
[40]: https://github.com/visual-check/visual-check/issues/40
[46]: https://github.com/visual-check/visual-check/issues/46
[47]: https://github.com/visual-check/visual-check/issues/47
