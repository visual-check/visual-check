# @visual-check/test-setup

The Setup check ([PRD 18](../../docs/prd/18-repo-ci.md#setup-under-each-package-manager)): `init-check.ts` sets up a tiny Storybook the way a user would, with visual-check's packages packed from this repo, since that version isn't on npm.

`fixtures/pnpm/` is the Storybook: a pnpm project with one HTML story that renders a plain `<button>`, on `@storybook/html-vite` and Storybook 10, whose `storybook` script starts it on port 6106. It isn't a workspace package; the check copies it into a temporary folder and works there.

The check runs these steps, a line each, and stops at the first that fails:

1. `pnpm pack` makes a tarball of `@visual-check/cli`, `@visual-check/chromium`, `@visual-check/storybook` and `@visual-check/storybook-addon`.
2. A registry on `127.0.0.1` serves them. The project's `.npmrc` names it for the `@visual-check` scope, so everything else comes from npm, and gives the project a store and cache of its own, so nothing from an earlier run is reused.
3. The copy of the fixture becomes a git repo and installs, as a project that has its dependencies is.
4. `pnpm dlx @visual-check/cli init --yes`, without `CI`, exits 0 without a warning. It writes the config, `.storybook/visual-check.ts` and `.visual-check/.gitignore` exactly as the spec says, and adds the `visual:check` and `visual:update` scripts. It adds `@visual-check/cli` and `@visual-check/storybook` at the CLI's version and `@visual-check/chromium` at the CLI's peer range, and the addon through `storybook add`, which lists it in `.storybook/main.js` too. It leaves `.gitignore` alone, and ends with the closing message's CI line.
5. `pnpm install --frozen-lockfile` exits 0, and the project has its own `node_modules/.bin/visual-check`, so `pnpm run` and `pnpm exec` can't find another one on the `PATH`, such as this workspace's.
6. The config gets `image` from `TEST_STORYBOOK_IMAGE`, until the browser package names a published image.
7. `pnpm run storybook` answers for `index.json` within 120 s.
8. `pnpm run visual:update`, without `CI`, exits 0 and writes one baseline.
9. `pnpm run visual:check`, in the check's own environment, exits 0.
10. `pnpm exec visual-check init --yes` exits 0 without a warning, and changes no file git lists.

Then it stops Storybook's processes and removes the temporary folder. On a failure, it first copies the project, without `node_modules`, and every command's output to `init-check-output/`; `registry.log` lists the requests the registry didn't answer with 200. A SIGINT or SIGTERM stops every command the check started and skips the steps left; the check cleans up as on a failure and exits 130 or 143.

## Running it

Until the browser image is published, a full run names a locally built image through `TEST_STORYBOOK_IMAGE`. From the repo root:

```sh
packages/chromium/image/build.sh amd64 --output type=docker,name=visual-check-chromium:amd64
TEST_STORYBOOK_IMAGE=visual-check-chromium:amd64 pnpm turbo run init-check --filter @visual-check/test-setup -- --package-manager pnpm
```

Turbo builds the packages first. Port 6106 must be free: the Storybook step fails at once when anything listens there.

## Flags

- `--package-manager <name>`: the fixture in `fixtures/<name>` and the package manager that sets it up. It's required, and only `pnpm` has a fixture so far.
- `--init-only`: stops after step 4, and needs no `TEST_STORYBOOK_IMAGE`. It's for a machine without Docker, such as CI's macOS job: `init`'s only warning must be that there's no docker command, naming `platform: 'host'`, so where there's a `docker` command, step 4 fails.

## Trying a local build in another project

`try-local.ts` sets up one of your own projects with this checkout's packages, for a manual test before they're on npm. It builds and packs the packages of the checkout it runs from, a worktree included, with its uncommitted changes. It serves them the way the check does, and runs `init` through `pnpm dlx` in the project. The registry is named for the `@visual-check` scope through the environment, so the project's `.npmrc` doesn't change. Then it adds the browser image to the config.

```sh
pnpm try-local ~/code/my-app                # init asks its questions
pnpm try-local ~/code/my-app --yes          # init takes every default
pnpm try-local ~/code/my-app --image visual-check-chromium:arm64
```

- `init` runs in your terminal, so it shows its terminal UI there: the questions, the setup steps and the summary.
- The project must be in a git repo with nothing uncommitted. A relative path is taken from where you run `pnpm`.
- `--image` defaults to `visual-check-chromium:ci`. When Docker has no such image, the script prints the command that builds it.
- `init`'s installs reach the registry through `npm_config_@visual-check:registry`, which pnpm, npm and Yarn 1 read. Yarn 4 and Bun don't, so they can't install the packages.

When you're done, bring the project back:

```sh
pnpm try-local --restore ~/code/my-app
```

It resets the project's repo to the commit it was on, with `git reset --hard` and `git clean -fd`, and removes every `.visual-check/` folder's untracked files. Then it installs again with the package manager of the nearest lockfile. Anything else you changed in that repo since the try is dropped too. It refuses when the repo moved to another commit.

The try writes its record before `init` runs, so after you stop `init` with Ctrl+C, run `--restore` all the same. Until you do, another try in that project is refused.
