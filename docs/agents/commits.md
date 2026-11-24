# Commits

Commit messages and PR titles feed release-please, which sets the versions and writes the changelogs ([Release process](../prd/19-release.md)).

- The format is conventional and lowercase: `<type>(<scope>): <behaviour>`. The scope is the package folder, such as `cli`, or none.
- A commit counts for each package whose folder it touches. Files outside `packages/`, such as `.github/` and the root config, count for none.
- `feat` (minor) and `fix` (patch) release that package and show in its changelog. So do `perf`, `revert` and `deps`.
- `docs`, `test`, `ci`, `build`, `refactor`, `style` and `chore` release nothing.
- `<type>!:` or a `BREAKING CHANGE:` footer marks a breaking change. While at `0.x`, it bumps the minor.
- A PR merges as a merge commit whose message is its title and body. The title is conventional too, and the body's footers count. Write a footer's keyword in a body only inside backticks mid-sentence.
- `Release-As: <version>` sets the version of every package the commit touches. Only the browser package's bump uses it, on a commit touching only `packages/chromium/`.
- Never write an empty commit. It counts for every package, the browser package included.
