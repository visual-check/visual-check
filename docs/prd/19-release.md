# Release process

Part of the [v1 PRD](README.md). Terms come from the [glossary](../../GLOSSARY.md).

A release publishes only the package files that passed the test apps. The CLI, the storybook helper and the addon always release together at one version. The browser package releases by itself, on its own version line.

## Versions

- Packages are `0.x` until v1's done criteria are met. Then they become 1.0.0 ([index](README.md)).
- While at `0.x`, a breaking change bumps the minor.
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
- The browser package is a component of its own in the same manifest. Its version is set by the bump PR's commit, not worked out from commit types.
- The docs site's live version updates on each release ([Docs site](20-docs-site.md)).

## Checks by hand

Two checks can't run on hosted runners. Each runs before a release that changes its area, and both run once more before 1.0.0.

| Check | Before a release that changes |
|---|---|
| The agent skill in Claude Code, Codex, Cursor, Copilot and Antigravity: it's listed once, and its script starts and stops Storybook | The skill |
| The browser container on an Apple Silicon Mac, with OrbStack and with Docker Desktop, including the container's hardening options | The container, the driver or the browser package |

## Releasing the browser package

- A scheduled job runs every two weeks. When Chrome for Testing's Stable build has changed, major or point release, it opens a PR with the new version and the new checksums.
- On that PR, CI builds the image and runs the test apps with the new browser package.
- For a new Chromium major, the same PR raises the upper bound of the CLI's browser range, so the CLI packed on that PR accepts the new package. The next CLI minor ships that range.
- A maintainer reviews the launch arguments, the font table and the pixel changes, then merges.
- When the new build moves pixels, the test apps' committed baselines no longer match. The maintainer rewrites them with `update` on a branch of `visual-check/test-apps`, and the bump's PR runs the test apps from that branch. Both merge once every job passes.
- Merging publishes the image, then the package, in a workflow separate from the lockstep release. The image published is the one the PR built and tested, by digest. It isn't built again.

The image:

- The workflow builds it for amd64 and arm64 on native runners and pushes gzip layers to GHCR as `ghcr.io/visual-check/chromium:<version>`.
- The GHCR package is public, so anyone can pull it without signing in.
- The image's index digest is written into the browser package before the package is published.
- The image is rebuilt only on purpose, never on a schedule. A rebuild with the same Chromium ships as a browser package minor.

The first browser package:

- It holds the Stable build current when it's built, and the CLI's range starts at that major.
- Its launch arguments and font table are copied from the Playwright release for the same Chromium major, or the nearest one. The file and version are recorded beside the data. The comparison against Playwright on 300 real stories is run once on that build before the first publish.

If Google objects to shipping its headless shell inside the image, the fallback is a download at run time or Debian's Chromium, shipped as a new browser package version.

## One-off tasks

- Publish the unscoped `visual-check` placeholder with its deprecation message.
- Make `visual-check/test-apps` and `visual-check/action` public repos.
- Register the release workflow as each package's trusted publisher on npm.
- Include the MIT notice of Storybook's pseudo-states addon in `@visual-check/storybook`.

## Sources

- [Test apps repo][34], [GitHub Action design][40], [Storybook addon][41], [Playwright peer dependency and Chromium version][45], [Reading per-story options][46], [Storybook 9 floor and Storybook 11][48], [Cartesian stories helper][50], [Chromium sandbox in the browser image][51], [Windows and macOS on GitHub Actions][33], [Agent skill shape][20], [Package layout and naming][16].
- [ADR 0007](../adr/0007-browser-build-comes-from-a-peer-package.md), [ADR 0008](../adr/0008-browser-runs-in-our-own-image.md), [ADR 0009](../adr/0009-grid-stories-draw-everything-in-the-story.md).
- Decided while writing this PRD: `0.x` versions, release-please, the release steps, trusted publishing, when the checks by hand run, the two-weekly browser job, how the test apps' baselines move on a bump, and the first browser package's build.

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
