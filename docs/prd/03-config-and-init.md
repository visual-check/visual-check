# Config and `init`

Part of the [v1 PRD](README.md). Terms come from the [glossary](../../GLOSSARY.md).

One `visual-check.config.ts` at the workspace root names every Storybook. `init` detects the project, asks five questions and writes the setup. Options for a Storybook, a stories file or a story don't live here: they're in Storybook parameters ([Per-story options](07-per-story-options.md)).

## The config file

- **Name:** `visual-check.config.ts`. `.mts`, `.js` and `.mjs` also work. JSON and YAML don't.
- **Search:** the current folder, then each parent up to the git root. The first config found wins, and `--config <path>` overrides the search.
- **Loading:** always through jiti, on every supported Node, never through Node's own type stripping. tsconfig `paths` aren't supported.
- **Helper:** `export default defineConfig({ ... })`, imported from `@visual-check/cli`.
- **Validation:** unknown keys and wrong types exit 2.

```ts
import { defineConfig } from '@visual-check/cli'

export default defineConfig({
  storybooks: {
    web: { dir: 'apps/web', url: 'http://127.0.0.1:6006' },
    ui: {
      dir: 'packages/ui',
      url: { local: 'http://127.0.0.1:2137', ci: 'http://127.0.0.1:6007' },
    },
  },
})
```

## Keys

| Key                           | Default                                              | Notes                                                                                                                                                            |
| ----------------------------- | ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `storybooks.<name>.dir`       | The config file's folder                             | The folder Storybook runs in. `index.json`'s `importPath` is relative to it                                                                                      |
| `storybooks.<name>.configDir` | `.storybook`, inside `dir`                           |                                                                                                                                                                  |
| `storybooks.<name>.url`       | None, required                                       | One value or `{ local, ci }`. No user name or password: visual-check sends no login                                                                              |
| `storybooks.<name>.baselines` | `<dir>/.visual-check/baselines`                      | The only folder a project can move in v1                                                                                                                         |
| `platform`                    | `'linux/amd64'`                                      | Or `'linux/arm64'` or `'host'` ([Browser and platform](05-browser-and-platform.md))                                                                              |
| `image`                       | The browser package's image                          | A custom image must be built `FROM` it                                                                                                                           |
| `tolerance`                   | `{ color: 0.01, pixels: 20 }`                        | [Visual diff](09-visual-diff.md)                                                                                                                                 |
| `viewport`                    | `{ width: 1280, height: 720, deviceScaleFactor: 1 }` | The default capture's viewport when `preview` sets none                                                                                                          |
| `maskColor`                   | `'#FF00FF'`                                          |                                                                                                                                                                  |
| `timezone`                    | `'UTC'`                                              | Emulated in the browser                                                                                                                                          |
| `locale`                      | `'en-US'`                                            | Emulated in the browser                                                                                                                                          |
| `colorScheme`                 | `'light'`                                            | Or `'dark'`. Emulated in the browser                                                                                                                             |
| `workers`                     | `'auto'`                                             | A number, or `{ local, ci }`. One pool for the whole run                                                                                                         |
| `readyTimeout`                | `10_000` ms                                          | A number, or `{ local, ci }`                                                                                                                                     |
| `retries`                     | `1`                                                  | How many more times a differing snapshot is captured before failing. The same for each story                                                                     |
| `silenceHosts`                | `[]`                                                 | Exact hosts or `*.example.com`. Silences `update`'s two warnings                                                                                                 |
| `affected.selectAll`          | `[]`                                                 | Globs, relative to the config file. A changed file that matches selects every story. `*` and `**` skip names that start with `.`: name the dot, as in `**/.env*` |
| `affected.ignore`             | `[]`                                                 | Globs, relative to the config file. A changed file that matches selects nothing. `*` and `**` skip names that start with `.`: name the dot, as in `**/.env*`     |

Rules for the keys:

- **Paths:** a Storybook's `dir` is relative to the config file's folder. Its `configDir` and `baselines` are relative to `dir`. Absolute paths work everywhere.
- **Storybook names** take lowercase letters, digits and `-`. Every entry of `storybooks` runs unless `--storybook` narrows the run.
- **Project-wide keys:** everything outside `storybooks` applies to the whole project. One Storybook's own tolerance or viewport goes in that Storybook's `preview`.
- **Modes** are declared per Storybook in `<configDir>/visual-check.ts`, never in the config.
- **No `browser` or `extraBrowsers` key** in v1. They can come back without breaking anyone.
- **`timezone`, `locale` and `colorScheme`** change pixels, so each is one committed value. A mode can't set them in v1.

### Local runs and CI share every setting but three

- Only `storybooks.<name>.url`, `workers` and `readyTimeout` take `{ local, ci }`. The `CI` env var picks the side.
- The type rejects the pair on every other key, so nothing that changes pixels can differ between a local run and CI.
- There are no `local` and `ci` blocks.

### `workers: 'auto'`

- It's the smaller of the CPU count and the memory in GiB, rounded to the nearest GiB, minus 1. A VM reports a little less than its size, such as 11.73 GiB for OrbStack set to 12 GiB, so a floor would give one worker fewer.
- Both are read where the browser runs: from `docker info` when it runs in visual-check's container, and from the machine itself for `host` and inside visual-check's image.
- Expected values:
  - 2 on a private repo's hosted runner (2 vCPU, 7 GB);
  - 4 on a public repo's runner (4 vCPU, 16 GB);
  - 7 in Docker Desktop's default VM (8 GiB);
  - 11 on OrbStack with 12 CPUs and 12 GiB.

## Monorepos

- One config at the workspace root lists every Storybook. A run gives one report and one exit code.
- A config inside a package still works through the search, but `init` never writes one there.
- The CLI never narrows a run by the folder it's started from. A package's own script is `visual-check test --storybook <name>`.

## Folders

| Folder                                     | Holds                                         | In git    |
| ------------------------------------------ | --------------------------------------------- | --------- |
| `<dir>/.visual-check/baselines/`           | Baselines                                     | Committed |
| `<dir>/.visual-check/snapshots/`, `diffs/` | The addon's images. The CLI never writes them | Ignored   |
| `<config folder>/.visual-check/report/`    | The report. Its place is fixed in v1          | Ignored   |

- Each `<dir>/.visual-check/` and the root `.visual-check/` get a `.gitignore` holding `/*`, `!/baselines/` and `!/.gitignore`.
- `init` never touches the root `.gitignore` and writes no `.gitattributes`. Git already treats PNG as binary, and a nested file would override a project's LFS attributes.

## `init`: what it detects

- **Workspace and packages:**
  - `pnpm-workspace.yaml`'s `packages`. Without that field, the repo is one package;
  - `package.json#workspaces` for npm, Yarn and Bun;
  - `lerna.json`, `nx.json` and `rush.json`. Lerna's packages are `lerna.json#packages`, else the package manager's workspaces, else `packages/*`. Nx's are every folder with a `project.json`, plus the package manager's workspaces, plus Lerna's packages.

  Turbo uses the package manager's workspaces.

  Run inside a package, `init` works at the workspace root and says so. A workspace root without a `package.json`, such as Rush's, stops `init`: it needs the root's scripts and a place for the CLI.
- **Package manager:** `rush.json`'s `pnpmVersion`, `npmVersion` or `yarnVersion`, then the `packageManager` or `devEngines.packageManager` field, then the lockfile.
  - npm, pnpm, Yarn 1 and Yarn 4 are supported. Bun works but isn't tested.
  - Yarn counts as Yarn 2 or later when there's a `.yarnrc.yml`, `yarn.lock` opens with Yarn 2's `__metadata:` entry, or the declared version is 2 or later.
  - With nothing found, `init` asks, with npm as the default.
- **Storybooks:** `git ls-files` for `**/.storybook/main.{ts,js,mjs,cjs,mts,cts}`, plus any `-c <dir>` in scripts. That skips ignored worktrees and copies.
  - Each is matched to the deepest package that holds it.
  - One under a folder with its own lockfile that isn't a listed package is skipped with a note.
- **Start command,** the first that exists:
  1. the package's `storybook` script, when it runs `storybook dev`;
  2. the first script that runs `storybook dev` with a matching `-c`, in the package or at the root;
  3. an Nx target: `storybook` in `project.json`, or the target `@nx/storybook/plugin` infers in `nx.json` (its `serveStorybookTargetName`, else `storybook`);
  4. otherwise `init` asks.

  The command runs from the workspace root:
  - a package's script runs through the package manager's own workspace form when its list names the package: `pnpm --filter <name> run`, `npm run … --workspace <dir>`, `yarn workspace <name> run` or `bun run --filter`. Otherwise it's `cd <dir> && <pm> run …`;
  - a root script keeps its `-c`;
  - an Nx target runs as `nx run <project>:<target>`.

  `init` runs the `storybook` binary itself with `yarn exec` on Yarn 2 or later and `npx --no-install` on Yarn 1, so a script named `storybook` can't shadow it.
- **Port:** the script's `-p` or `--port`, or `SBCONFIG_PORT` or `PORT` set in it. With none, `init` asks and suggests adding `-p`. It never edits the script.
- **URL:** `http://127.0.0.1:<port>`, never `localhost`.
- **Docker:** through `docker info`.
- **Storybook version** of each Storybook.

## `init`: the five questions

1. **Which Storybooks to include.** A checklist with all ticked, shown only when there's more than one.
2. **For each Storybook:** its name, its URL, and its start command when none was found. The name is the package's name without its scope when the config folder is `.storybook` in a package, or sits directly in a package that isn't the root. Otherwise it's the config folder's name, or the name of the folder that holds `.storybook`. An Nx project without a `package.json` takes its `project.json` name, else its folder's name. A name already taken gets `-2`, `-3` and so on.
3. **Script names,** `visual:check` and `visual:update` by default. A name another script has replaces that script, unless it starts a Storybook. A script that already runs `visual-check test` or `update` is reused, and when the default name is taken by the other script or by a script that starts Storybook, the suggestion is `visual:test` or `visual:update-baselines`.
4. **"Install the agent skill?"**, yes by default.
5. **"Add the Storybook addon?"** A checklist of the chosen Storybooks on 10, all ticked, or one item when there's only one. It's shown only when at least one is on 10. Storybooks on another major are skipped with a note.

Rules:

- When two Storybooks use one port, `init` warns that they can't run together. It still writes.
- It never asks about the platform, tolerance, workers or a CI URL. One `url` serves both environments.
- It never writes `platform: 'host'`.
- `init --yes` takes every default, the addon included.

Yarn 4 refuses a package version published less than a day ago by default (`npmMinimalAgeGate`, 1440 minutes in Yarn 4.18, which the Setup check runs), so `yarn dlx @visual-check/cli init` can fail on a release day. Wait a day, or list `@visual-check/*` under `npmPreapprovedPackages` in `.yarnrc.yml`, as the Setup check does.

## `init`: terminal UI

- In a terminal (stdin and stdout are TTYs, and `CI` is unset, empty, `0` or `false`), `init` runs an Ink UI, which it loads only then. It shows the brand header, then each question with a hint. Arrows choose, and an answered question collapses to one line.
- After the questions it lists the setup steps under a progress bar of the steps that have ended, with the time taken:
  - a step not started yet is dim after `○`;
  - the running step turns the spinner and counts its time up each second, with its command and the last three lines of its output under it, dim;
  - a step that ended shows `✓`, `▲` or `✕` in the accent, caution or danger colour, and how long it took. A failed step keeps the last 15 lines of its output, and the steps after it end dim after `−`, marked skipped.
- It ends with the steps as they ended, printed once, then a summary:
  - **Set up:** `✓ visual-check is set up`, a dim line naming any scripts it replaced, the warnings, then the numbered next steps, each a command and what it does, the commands in a column of their own in the accent colour. A command over 32 characters takes a line of its own, with its text under the other rows' text. In a terminal too narrow for the column and 20 columns of text beside it, every command takes a line of its own, with its text under it. Then, dim, where to set options for every story and the line pointing to the CI docs, with paths and URLs in the accent colour. The words match the plain closing message; the headings differ. It lists no files written.
  - **The install failed:** the line naming any scripts it replaced, then the problem after `✕`.
  - **Stopped before writing:** the warnings and hints, then why it stopped after `✕`.
- Elsewhere it prints plain text.
- The package manager question is a list.
- Ctrl+C or Ctrl+D during a question stops `init` with exit code 2. It writes nothing.

## `init`: what it writes

- **The config** at the workspace root, holding only what differs from the defaults.
- **For each Storybook:**
  - `<configDir>/visual-check.ts`, which exports `visualCheck = defineVisualCheck({ modes: {} })` and carries a commented example of a `mobile` mode at 375×667, scale 2, with touch, and a comment that shows how to spread `visualCheck` into the parameters in `preview`, which sets options for every story;
  - `<dir>/.visual-check/.gitignore`.
- **The root `.visual-check/.gitignore`.**
- **Dependencies,** as [Packages](01-packages.md) lists them:
  - `@visual-check/cli`, `@visual-check/storybook` and `@visual-check/storybook-addon` at the CLI's exact version (`--save-exact`, or `--exact` for Yarn and Bun);
  - `@visual-check/chromium` at the CLI's peer range, in an add of its own at the root;
  - the CLI and the browser go to the workspace root, and `@visual-check/storybook` and the addon to each Storybook's package, which is the deepest workspace package holding it that has a `package.json`, else the root;
  - at a root that is a workspace, pnpm adds with `-w` and Yarn 1 with `-W`. npm adds to a listed package from the root with `--workspace <dir>`; the others add from the package's folder;
  - a package only Nx or Lerna lists gets its add in its own folder, where npm leaves a nested lockfile and Yarn 2 and later refuse;
  - if a package manager's add fails, including the one that adds the addon, `init` stops with exit 2 and names the command to run;
  - under Rush it prints the install steps instead of running them.
- **The addon:** for each ticked Storybook it adds the addon at the CLI's exact version, runs `storybook add @visual-check/storybook-addon@<cli version> --skip-install` in that Storybook's package, then sets the spec in `package.json` back to the exact version, because `storybook add` rewrites it to a `^` range. If `storybook add` fails, it warns, prints the command and carries on. Under Yarn Plug'n'Play (a `.pnp.cjs` or `.pnp.js`, `nodeLinker: pnp`, or Yarn 2 or later with no `nodeLinker` and no `node_modules`), `init` can't read Storybook's version, so it skips the addon, with one hint to set `nodeLinker: node-modules`.
- **The two npm scripts.** The summary names the scripts it replaced, not what they ran.
- **The agent skill** ([Agent skill](16-agent-skill.md)).

What it never does:

- edit `preview.*`, and it edits `main.*` only through `storybook add`;
- edit other scripts, `turbo.json`, `nx.json` or the root `.gitignore`;
- pull the image, need a running Storybook or capture anything.

Run again, `init`:

- leaves an existing config alone, and prints any Storybook missing from it as a hint;
- rewrites the skill files and refreshes the skill's `setup.json` from the config;
- adds any per-Storybook file that's missing.

## `init`: checks

It exits 2 and writes nothing when:

- Node is below 22;
- no Storybook is found;
- a Storybook is below 9.1;
- the project uses Deno;
- the workspace root has no `package.json`;
- there's no terminal and no `--yes`.

It warns and still writes when:

- a Storybook is above 11, which is untested;
- Docker is missing or not running, naming both fixes;
- Docker runs Windows containers;
- no Docker is found on Windows. The warning adds that if Docker runs inside WSL, visual-check should run from inside WSL too;
- two Storybooks share a port;
- a URL's port doesn't match its start command;
- Fallow finds unlisted dependencies, because a missed `viteFinal` alias shows up as one;
- `storybook add` fails.

## `init`: closing message

Each step is a command and what it does, the commands in a column of their own. A command over 32 characters takes a line of its own, with its text under the other rows' text:

1. Start each Storybook with its command, and keep it running.
2. `visual:update` writes the first baselines. Left out when every Storybook set up already has a baseline in its baselines folder. Shown when none was set up.
3. `visual:check` checks the stories against them.
4. Commit the changes, baselines included.

Then a line pointing to each `visual-check.ts` for options for every story (its comment shows how to spread it into `preview`), and a docs link for CI. Before the closing message, a line names any scripts `init` replaced. It lists no files written and says nothing about remote content.

The commands and paths are the workspace root's. Run below the root, the heading names it to run them from, as in `Next, from ../..:`, and so do Rush's printed install steps.

## Sources

- [Config file shape and init wizard][38], [Storybook target modes][15], [Storybook addon][41], [Playwright peer dependency and Chromium version][45], [Reading per-story options][46], [Storybook 9 floor and Storybook 11][48], [Failure report format][39], [Agent skill shape][20], [Container runtimes on Windows][36], [Affected stories rules][14].
- [ADR 0004](../adr/0004-per-story-options-in-storybook-parameters.md), [ADR 0005](../adr/0005-only-reachability-and-speed-differ-between-environments.md).
- Decided while writing this PRD: `retries`, `timezone`, `locale` and `colorScheme`, what relative paths are measured from, and the WSL sentence in the no-Docker warning.

[14]: https://github.com/visual-check/visual-check/issues/14
[15]: https://github.com/visual-check/visual-check/issues/15
[20]: https://github.com/visual-check/visual-check/issues/20
[36]: https://github.com/visual-check/visual-check/issues/36
[38]: https://github.com/visual-check/visual-check/issues/38
[39]: https://github.com/visual-check/visual-check/issues/39
[41]: https://github.com/visual-check/visual-check/issues/41
[45]: https://github.com/visual-check/visual-check/issues/45
[46]: https://github.com/visual-check/visual-check/issues/46
[48]: https://github.com/visual-check/visual-check/issues/48
