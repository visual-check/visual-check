# Commits

Commit messages and PR titles feed release-please, which sets the versions and writes the changelogs ([Release process](../prd/19-release.md)).

- The format is conventional and lowercase: `<type>(<scope>): <behaviour>`. The scope is the package folder, such as `cli`, or none.
- A commit counts for each package whose folder it touches. Files outside `packages/`, such as `.github/` and the root config, count for none.
- release-please versions the lockstep group alone. A commit under `packages/chromium/` releases nothing through it: the browser package releases when its version changes on main.
- `feat` and `fix` release that package and show in its changelog. So do `perf`, `revert` and `deps`.
- `docs`, `test`, `ci`, `build`, `refactor`, `style` and `chore` release nothing.
- `<type>!:` or a `BREAKING CHANGE:` footer marks a breaking change. While at `0.x`, it bumps the minor, and anything else that releases bumps the patch. From `1.0.0`, `feat` bumps the minor and `fix` the patch.
- A PR merges as a merge commit whose message is its title and body. The title is conventional too, and the body's footers count. Write a footer's keyword in a body only inside backticks mid-sentence.
- Never write `Release-As:`. The browser package's bump PR sets its version in its `package.json`. Its title is `feat(cli): …` for a new Chromium major, which raises the CLI's browser range, and `build(chromium): …` otherwise, as for a point release.
- Never write an empty commit. It counts for every lockstep package.
