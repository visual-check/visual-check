# Release process

Part of the [v1 PRD](README.md). Terms come from the [glossary](../../GLOSSARY.md).

A release publishes only the package files that passed the test apps. The CLI, the storybook helper and the addon always release together at one version. The browser package releases by itself, on its own version line.

## Versions

- Packages are `0.x` until v1's done criteria are met. Then they become 1.0.0 ([index](README.md)).
- While at `0.x`, a breaking change bumps the minor, and a feature or a fix the patch.
- A change to the flags the Action passes, or to the report folder, also needs a new Action major ([GitHub Action](14-github-action.md)).
- **The lockstep group:** `@visual-check/cli`, `@visual-check/storybook` and `@visual-check/storybook-addon` share one version and always release together.
- **`@visual-check/chromium`** has its own versions, whose major is the Chromium major ([Packages](01-packages.md)).
- **The Action** has its own versions in its own repo: immutable `vX.Y.Z` releases and a moving `v1` tag.

What waits for a visual-check major:

- dropping a Storybook major, and only after Storybook stops fixing it;
- raising the floor of the supported browser range;
- changing the grid's layout, its captions or how states are forced;
- bumping the report's `version`.

## Releasing the lockstep group

The tool is release-please, in manifest mode. Its linked-versions plugin keeps the group on one version in one release PR. It never publishes to npm, so the steps below are the workflow's own.

1. Merging the release PR sets the new version, the changelogs and the tags.
2. The workflow packs the three packages once.
3. It runs the test apps on those files, through test-apps' reusable workflow.
4. Only when every job passes, it publishes those same files to npm.
5. It then publishes the GitHub releases, which stay drafts until npm has the packages.

Rules:

- Publishing uses npm's trusted publishing from GitHub Actions, with provenance and no stored token.
- A version that fails the test apps is never published. The fix ships as the next version.
- A CI check keeps the three versions equal ([CI for this repo](18-repo-ci.md)), because the linked-versions plugin has old open bugs.
- Versions and changelogs come from commit messages, so commits keep the conventional format the repo already uses.
- release-please doesn't version the browser package. Its bump PR sets its version, and merging it publishes it ([Releasing the browser package](#releasing-the-browser-package)).
- The docs site's live version updates on each release ([Docs site](20-docs-site.md)).

## Checks by hand

Three checks don't run on hosted runners. Each runs before a release that changes its area, and all run once more before 1.0.0.

| Check                                                                                                                               | Before a release that changes                      |
| ----------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| The agent skill in Claude Code, Codex, Cursor, Copilot and Antigravity: it's listed once, and its script starts and stops Storybook | The skill                                          |
| The browser container on an Apple Silicon Mac, with OrbStack and with Docker Desktop, including the container's hardening options   | The container, the driver or the browser package   |
| The test apps' react-inspector on Windows with Docker Desktop, from the host and from inside WSL, through the proxy                 | The container, the proxy or the CLI's Docker probe |

## Releasing the browser package

- A scheduled job, `chromium-bump.yml`, runs on the 1st of each month. When Chrome for Testing's Stable build is newer than the browser package's, major or point release, it opens a PR from `chromium-bump/<Chromium version>` with the new version and the new checksums. When it isn't, or that branch exists, it does nothing.
- For a new Chromium major, the same PR adds that major to the CLI's browser range, so the CLI packed on that PR accepts the new package. That PR is titled `feat(cli): …`, so the next lockstep release ships the range. A point release, or a major the range lists already, is titled `build(chromium): …` and touches only `packages/chromium/`.
- A PR a workflow opens starts no workflow, so the job starts the PR's checks itself: CI, the Browser package workflow and the checksums.
- On that PR the Browser package workflow builds the image for amd64 and arm64 on native runners, pushes both by digest with gzip layers and no tag, and runs the test apps on the amd64 image as pushed, with the packages packed from the same commit.
- A maintainer reviews the launch arguments and the pixel changes, then merges.
- This repository's test Storybooks' baselines move with the bump, rewritten by hand in its PR.
- When the new build moves the test apps' pixels, their committed baselines no longer match. The maintainer rewrites them on a `visual-check/test-apps` branch named like the bump's, with test-apps' Update baselines workflow and its `visual-check-ref` set to that branch. test-apps' reusable workflow runs from a branch named like the caller's when one exists. The bump PR merges first, then that branch.
- Merging changes the version on main. `chromium-release.yml`, apart from the lockstep release, then: finds the candidate a successful Browser package run pushed and tested for the same `packages/chromium` tree; tags its two images as one index, `ghcr.io/visual-check/chromium:<version>`; checks anyone can pull it; writes and records the index digest in `chromium.json` on main; publishes that package to npm with provenance; and creates the GitHub release `chromium-v<version>`. Nothing is built again.

Running it:

- "Allow GitHub Actions to create and approve pull requests" stays on, or the bump job can't open its PR.
- The release records the digest on main with the workflow's own token, so main lets GitHub Actions push. A ruleset added to main needs a bypass for it.
- When main changes `packages/chromium` while a bump PR is open, update the PR's branch before merging, so its Browser package run tests the tree main gets. Otherwise the release finds no candidate: run the Browser package workflow by hand on main, then the release again.
- When main records the version's digest already, the release skips the candidate and only checks the tag against that digest. So a release that stopped part-way runs again by hand on main: it publishes to npm when npm doesn't have the version, and creates the GitHub release when it's missing.
- npm's provenance names the merged commit, the one the release started on. The package is packed from the record commit, which changes only the digest.
- The Publish job may get an OIDC token on a dry run too, and the trusted publisher names no environment. Only this repository's branches get one: a fork's PR doesn't.

The image:

- The workflow builds it for amd64 and arm64 on native runners and pushes gzip layers to GHCR by digest, and merging tags them `ghcr.io/visual-check/chromium:<version>`.
- The GHCR package is public, so anyone can pull it without signing in.
- The image's index digest is written into the browser package before the package is published.
- The image is rebuilt only on purpose, never on a schedule. A rebuild with the same Chromium ships as a browser package minor.

The first browser package:

- It holds the Stable build current when it's built, and the CLI's range starts at that major.
- Its launch arguments are copied from the Playwright release for the same Chromium major, or the nearest one. The file and version are recorded beside the data. The comparison against Playwright on 300 real stories is run once on that build before the first publish.

If Google objects to shipping its headless shell inside the image, the fallback is a download at run time or Debian's Chromium, shipped as a new browser package version.

## One-off tasks

- Publish the unscoped `visual-check` placeholder with its deprecation message.
- Make `visual-check/test-apps` and `visual-check/action` public repos.
- Register the release workflows as trusted publishers on npm, with no environment: `release.yml` for each lockstep package, and `chromium-release.yml` for the browser package. npm takes this only for a package that's already on npm, the first publish must follow within 2 days, and a registration can't be edited afterwards, only revoked and made again.
- Make the GHCR package `ghcr.io/visual-check/chromium` public. The browser package's release checks an anonymous pull before it publishes.
- The first release's order, after the npm setup (`scripts/npm-bootstrap-wizard.sh`): run the Browser package workflow by hand on main, which pushes the image and its candidate; make the GHCR package public; run the Browser package release workflow by hand on main; then merge the lockstep release PR.

## Sources

- [Test apps repo][34], [GitHub Action design][40], [Storybook addon][41], [Playwright peer dependency and Chromium version][45], [Reading per-story options][46], [Storybook 9 floor and Storybook 11][48], [Cartesian stories helper][50], [Chromium sandbox in the browser image][51], [Windows and macOS on GitHub Actions][33], [Agent skill shape][20], [Package layout and naming][16].
- [ADR 0007](../adr/0007-browser-build-comes-from-a-peer-package.md), [ADR 0008](../adr/0008-browser-runs-in-our-own-image.md), [ADR 0009](../adr/0009-grid-stories-draw-everything-in-the-story.md).
- Decided while writing this PRD: `0.x` versions, release-please, the release steps, trusted publishing, when the checks by hand run, the two-weekly browser job, how the test apps' baselines move on a bump, and the first browser package's build.
- Decided while building the lockstep release (#94):
  - `.github/workflows/release.yml` runs release-please on every push to main through `googleapis/release-please-action` v5.0.0 (release-please 17.6.0), with `release-please-config.json` and `.release-please-manifest.json` at the root;
  - the components are `cli`, `storybook` and `storybook-addon`, tagged `<component>-v<version>`. The linked-versions group is `visual-check`, and its release PR is "chore(main): release visual-check libraries";
  - `group-pull-request-title-pattern` repeats that title, without which release-please makes no release from the merged PR (googleapis/release-please#2306). `separate-pull-requests` stays on, the setting the group's release PR title was checked with;
  - the group starts at 0.1.0. release-please reads commits after `bootstrap-sha`, the commit before this workflow, so 0.1.0's changelog starts there. While at `0.x`, a breaking change bumps the minor, and a `feat` or a `fix` the patch (`bump-minor-pre-major`, `bump-patch-for-minor-pre-major`), so a caret range on `0.x` never takes a breaking change. The highest bump in the group wins;
  - GitHub releases are created as drafts, and their tags are created at once, because GitHub makes a draft's tag only on publishing and release-please finds the last release by its tag;
  - the release PR is opened with the workflow's own token, so no workflow runs on it. The release run checks the lockstep versions and release-please's config on the tagged commit before it packs, and that the CLI's version there is the one release-please released. "Allow GitHub Actions to create and approve pull requests" is on;
  - the run packs the tagged commit with the pack workflow CI uses, so the test apps and npm get one artifact. Pack and publish print each tarball's SHA-256;
  - publishing waits for every test-apps job. It publishes the CLI, then the storybook helper, then the addon, with `npm publish <file> --access public --provenance` and the job's OIDC token (npm 11.5.1 or later). Each package names this repository, which npm's provenance check needs. A version already on npm is skipped, so re-running a run's failed jobs is safe while its artifact lasts, 3 days. Re-running all jobs releases nothing;
  - then the GitHub releases are published, the CLI's marked latest;
  - run by hand, or on a PR that changes the release or pack workflow, it's a dry run of the checked-out commit: no release-please, `npm publish --dry-run --force` without an OIDC token, and no GitHub releases;
  - a PR's merge commit is its title and body, so the title's type counts and so does a footer in the body. An empty commit counts for every component.
- Decided while building the browser package release (#95):
  - `.github/workflows/chromium-bump.yml` runs on the 1st of each month and reads `last-known-good-versions-with-downloads.json`. A newer Stable build in the same major is the next minor, and a higher major is that major's `.0.0`. The bump downloads the five headless shell zips for their SHA-256s, since the response has none. Its branch is `chromium-bump/<Chromium version>`, and an existing branch means nothing to do;
  - the job starts the PR's checks with `gh workflow run … --ref <branch>`, since `workflow_dispatch` is the one event a workflow token may start, so no token is stored;
  - the Browser package workflow pushes a version that isn't in GHCR as a candidate: both images by digest, with no tag, on the PR or in a run by hand. Its artifact `chromium-candidate-<tree>` is keyed by the git tree of `packages/chromium` and kept 90 days. It holds the version, Chromium, tree, both digests, the PR's head commit and the run attempt. The release takes the newest one from a successful Browser package run of this repository, and checks it names that run's commit and one of its attempts;
  - the test apps run on the amd64 image as pushed, pulled by digest and saved with a tag, because `setup-app.sh` reads the loaded image's name. The pack workflow takes that image through its `image-artifact` input instead of building one;
  - the test apps run from a `visual-check/test-apps` branch named like the caller's when one exists. test-apps resolves it itself, and the Action's reusable workflow got a `ref` input for its sharded job. Its Update baselines workflow takes `visual-check-ref`, the visual-check branch whose packages and image it runs;
  - release-please no longer versions the browser package. It would need a second release PR, opened with the workflow token and so with no CI. A new major's merge commit touches `packages/cli/`, so a `Release-As:` there would set the CLI's version too. And the release's digest commit under `packages/chromium/` would count;
  - `chromium-release.yml` is the browser package's trusted publisher, since npm checks the calling workflow's file name. It runs when `packages/chromium/package.json` changes on main, and a version npm has already publishes nothing;
  - it checks the index pulls without signing in before anything is recorded or published;
  - it records the digest on main in one commit through GitHub's contents API, `chore(chromium): record the index digest of …`, with the blob's sha, so it never overwrites a newer change. When main records the digest already, the candidate isn't looked for: the tag is checked against that digest;
  - it packs with `pnpm pack` and publishes with `npm publish <file> --access public --provenance`, as the lockstep group does;
  - its GitHub release, `chromium-v<version>`, isn't marked latest. It's created also when npm has the version already, so a run that stopped after npm can finish;
  - run by hand off main, or on a PR that changes it, it's a dry run. So is the bump workflow, on a PR that changes it or its code;
  - a new major's PR is titled `feat(cli): …`, so the next lockstep release ships the range, and any other bump's `build(chromium): …`.

[16]: https://github.com/visual-check/visual-check/issues/16
[20]: https://github.com/visual-check/visual-check/issues/20
[33]: https://github.com/visual-check/visual-check/issues/33
[34]: https://github.com/visual-check/visual-check/issues/34
[40]: https://github.com/visual-check/visual-check/issues/40
[41]: https://github.com/visual-check/visual-check/issues/41
[45]: https://github.com/visual-check/visual-check/issues/45
[46]: https://github.com/visual-check/visual-check/issues/46
[48]: https://github.com/visual-check/visual-check/issues/48
[50]: https://github.com/visual-check/visual-check/issues/50
[51]: https://github.com/visual-check/visual-check/issues/51
