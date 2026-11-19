# @visual-check/test-setup

The Setup check ([PRD 18](../../docs/prd/18-repo-ci.md#setup-under-each-package-manager)): `init-check.ts` sets up a tiny Storybook the way a user would, under npm, pnpm, Yarn 1 or Yarn 4, with visual-check's packages packed from this repo, since that version isn't on npm.

## Fixtures

The fixtures name no package manager: the check copies one into a temporary folder and writes the package manager's files into the copy. Neither is a workspace package.

- `fixtures/single/` is one Storybook: one HTML story that renders a plain `<button>`, on `@storybook/html-vite` and Storybook 10, whose `storybook` script starts it on port 6106.
- `fixtures/monorepo/` is a workspace root with two such Storybooks, `apps/a` and `apps/b` (`@setup-monorepo/a` and `@setup-monorepo/b`), whose `storybook` scripts both use port 6106, so `init` must warn that they can't run at the same time.

The three `package.json` files pin the same `@storybook/html-vite`, `storybook` and `vite` versions: bump them in all three together. What the check expects of each fixture, such as the config `init` writes, its warnings and whether a Storybook starts, is in `fixtures.ts`; what differs between package managers is in `package-managers.ts`.

Into the copy, the check writes:

- the `packageManager` field: `pnpm@9.12.3`, `npm@11.19.1` (the npm Node 24 ships; nothing enforces it), `yarn@1.22.22` or `yarn@4.18.1`;
- for the monorepo, its packages, `apps/*`: in `pnpm-workspace.yaml` for pnpm, in `package.json#workspaces` for the others;
- the registry for the `@visual-check` scope, with a store and cache of the project's own, so nothing from an earlier run is reused:
  - npm and pnpm: `.npmrc`;
  - Yarn 1: `.npmrc`, which Yarn 1 and `npx` read, and `.yarnrc` for Yarn's cache folder;
  - Yarn 4: `.yarnrc.yml`, with `nodeLinker: node-modules`, its own cache and global folder (Yarn keeps registry metadata there by host, without the port), `127.0.0.1` in `unsafeHttpWhitelist`, and `@visual-check/*` in `npmPreapprovedPackages`, since Yarn 4 refuses versions published less than a day ago.

Yarn runs through Corepack, which Node 24 ships: the check makes Corepack's `yarn` shim in its temporary folder and puts it first on every command's `PATH`, `init`'s included, so `yarn` is the version the `packageManager` field names. Corepack's home, where it downloads that Yarn, is in the temporary folder too, so nothing outside it changes. Node 25 and later don't ship Corepack: there, run `npm i -g corepack` first; the check says so when it can't run `corepack`.

## Steps

The check runs these steps, a line each, and stops at the first that fails. Each package manager runs them its own way:

|                           | npm                | pnpm                                | Yarn 1                           | Yarn 4                        |
| ------------------------- | ------------------ | ----------------------------------- | -------------------------------- | ----------------------------- |
| First install             | `npm install`      | `pnpm install --no-frozen-lockfile` | `yarn install`                   | `yarn install --no-immutable` |
| Run `init`                | `npx -y`           | `pnpm dlx`                          | `npx -y`                         | `yarn dlx`                    |
| Install from the lockfile | `npm ci`           | `pnpm install --frozen-lockfile`    | `yarn install --frozen-lockfile` | `yarn install --immutable`    |
| Run a script              | `npm run`          | `pnpm run`                          | `yarn run`                       | `yarn run`                    |
| Run the installed CLI     | `npx --no-install` | `pnpm exec`                         | `npx --no-install`               | `yarn exec`                   |

1. `pnpm pack` makes a tarball of `@visual-check/cli`, `@visual-check/chromium`, `@visual-check/storybook` and `@visual-check/storybook-addon`.
2. A registry on `127.0.0.1` serves them. Everything else comes from npm.
3. The copy of the fixture, with the package manager's files, becomes a git repo and installs, as a project that has its dependencies is.
4. `init --yes`, run as the package manager runs a package it hasn't installed and without `CI`, exits 0. It warns only what the fixture should: nothing for the single fixture, and that `a` and `b` share port 6106 for the monorepo. It writes the config at the root, exactly as the spec says: one Storybook for the single fixture, and both, each with its `dir`, for the monorepo. It writes each Storybook's `.storybook/visual-check.ts` and `.visual-check/.gitignore`, and the root's `.visual-check/.gitignore`, and adds the `visual:check` and `visual:update` scripts at the root. It adds `@visual-check/cli` at the CLI's version and `@visual-check/chromium` at the CLI's peer range at the root, and `@visual-check/storybook` and the addon at the CLI's version to each Storybook's package, the addon through `storybook add`, which lists it in that Storybook's `.storybook/main.js` too. No package lists another of visual-check's packages. It leaves `.gitignore` alone, and ends with the closing message's CI line.
5. Installing from the lockfile exits 0, and the project has its own `node_modules/.bin/visual-check`, so running a script or the CLI can't find another one on the `PATH`, such as this workspace's.

The monorepo stops there: its Storybooks share a port. The single fixture goes on:

6. The config gets `image` from `TEST_STORYBOOK_IMAGE`, until the browser package names a published image.
7. The `storybook` script answers for `index.json` within 120 s.
8. The `visual:update` script, without `CI`, exits 0 and writes one baseline.
9. The `visual:check` script, in the check's own environment, exits 0.
10. `init --yes` through the installed CLI exits 0 without a warning, and changes no file git lists.

Then it stops Storybook's processes and removes the temporary folder. On a failure, it first copies the project, without `node_modules`, and every command's output to `init-check-output/`; `registry.log` lists the requests the registry didn't answer with 200. A SIGINT or SIGTERM stops every command the check started and skips the steps left; the check cleans up as on a failure and exits 130 or 143.

## Running it

Until the browser image is published, a full run of the single fixture names a locally built image through `TEST_STORYBOOK_IMAGE`. From the repo root:

```sh
packages/chromium/image/build.sh amd64 --output type=docker,name=visual-check-chromium:amd64
TEST_STORYBOOK_IMAGE=visual-check-chromium:amd64 pnpm turbo run init-check --filter @visual-check/test-setup -- --package-manager npm
pnpm turbo run init-check --filter @visual-check/test-setup -- --package-manager yarn4 --fixture monorepo
```

Turbo builds the packages first. Port 6106 must be free: the Storybook step fails at once when anything listens there. Yarn needs the `corepack` command, which Node 24 ships. A run needs a few GB of disk in the temporary folder, Yarn 1 the most: it unpacks every platform's optional packages into its cache.

## Flags

- `--package-manager npm|pnpm|yarn1|yarn4`: the package manager that sets the fixture up. It's required.
- `--fixture single|monorepo`: the fixture in `fixtures/<name>`, `single` by default.
- `--init-only`: stops after step 4, and needs no `TEST_STORYBOOK_IMAGE`. It's for a machine without Docker, such as CI's macOS job: besides the fixture's own warnings, `init`'s only warning must be that there's no docker command, naming `platform: 'host'`, so where there's a `docker` command, step 4 fails.

CI's Setup job runs every package manager with each fixture, and its macOS job runs pnpm on the single fixture with `--init-only`.

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
