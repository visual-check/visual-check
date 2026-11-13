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

| Key | Default | Notes |
|---|---|---|
| `storybooks.<name>.dir` | The config file's folder | The folder Storybook runs in. `index.json`'s `importPath` is relative to it |
| `storybooks.<name>.configDir` | `.storybook`, inside `dir` | |
| `storybooks.<name>.url` | None, required | One value or `{ local, ci }` |
| `storybooks.<name>.baselines` | `<dir>/.visual-check/baselines` | The only folder a project can move in v1 |
| `platform` | `'linux/amd64'` | Or `'linux/arm64'` or `'host'` ([Browser and platform](05-browser-and-platform.md)) |
| `image` | The browser package's image | A custom image must be built `FROM` it |
| `tolerance` | `{ color: 0.01, pixels: 20 }` | [Visual diff](09-visual-diff.md) |
| `viewport` | `{ width: 1280, height: 720, deviceScaleFactor: 1 }` | The default capture's viewport when `preview` sets none |
| `maskColor` | `'#FF00FF'` | |
| `timezone` | `'UTC'` | Emulated in the browser |
| `locale` | `'en-US'` | Emulated in the browser |
| `colorScheme` | `'light'` | Or `'dark'`. Emulated in the browser |
| `workers` | `'auto'` | A number, or `{ local, ci }`. One pool for the whole run |
| `readyTimeout` | `10_000` ms | A number, or `{ local, ci }` |
| `retries` | `1` | How many more times a failing snapshot is captured before it fails. The same for every story |
| `silenceHosts` | `[]` | Exact hosts or `*.example.com`. Silences `update`'s two warnings |
| `affected.selectAll` | `[]` | Globs, relative to the config file. A changed file that matches selects every story |
| `affected.ignore` | `[]` | Globs, relative to the config file. A changed file that matches selects nothing |

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

- It's the smaller of the CPU count and ⌊(memory − 1 GiB) ÷ 1 GiB⌋.
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

| Folder | Holds | In git |
|---|---|---|
| `<dir>/.visual-check/baselines/` | Baselines | Committed |
| `<dir>/.visual-check/snapshots/`, `diffs/` | The addon's images. The CLI never writes them | Ignored |
| `<config folder>/.visual-check/report/` | The report. Its place is fixed in v1 | Ignored |

- Each `<dir>/.visual-check/` and the root `.visual-check/` get a `.gitignore` holding `/*`, `!/baselines/` and `!/.gitignore`.
- `init` never touches the root `.gitignore` and writes no `.gitattributes`. Git already treats PNG as binary, and a nested file would override a project's LFS attributes.

## `init`: what it detects

- **Workspace and packages:**
  - `pnpm-workspace.yaml`'s `packages`. Without that field, the repo is one package;
  - `package.json#workspaces` for npm, Yarn and Bun;
  - `lerna.json`, Nx `project.json` files and `rush.json`.

  Turbo uses the package manager's workspaces.

  Run inside a package, `init` works at the workspace root and says so.
- **Package manager:** the `packageManager` or `devEngines.packageManager` field, then the lockfile.
  - npm, pnpm, Yarn 1 and Yarn 4 are supported. Bun works but isn't tested.
  - Yarn counts as Yarn 2 or later when there's a `.yarnrc.yml`, or the declared version is 2 or later.
  - With nothing found, `init` asks, with npm as the default.
- **Storybooks:** `git ls-files` for `**/.storybook/main.{ts,js,mjs,cjs,mts,cts}`, plus any `-c <dir>` in scripts. That skips ignored worktrees and copies.
  - Each is matched to its package.
  - One under a nested workspace with its own lockfile is skipped with a note.
- **Start command,** the first that exists:
  1. the package's `storybook` script, when it runs `storybook dev`;
  2. the first script that runs `storybook dev` with a matching `-c`;
  3. Nx's `storybook` target;
  4. otherwise `init` asks.
- **Port:** the script's `-p` or `--port`, or `SBCONFIG_PORT` or `PORT` set in it. With none, `init` asks and suggests adding `-p`. It never edits the script.
- **URL:** `http://127.0.0.1:<port>`, never `localhost`.
- **Docker:** through `docker info`.
- **Storybook version** of each Storybook.

## `init`: the five questions

1. **Which Storybooks to include.** A checklist with all ticked, shown only when there's more than one.
2. **For each Storybook:** its name (the package name without its scope, or the folder name), its URL, and its start command when none was found.
3. **Script names,** `visual:test` and `visual:update` by default.
4. **"Install the agent skill?"**, yes by default.
5. **"Add the Storybook addon?"** A checklist of the chosen Storybooks on 10 or later, all ticked, or one item when there's only one. It's shown only when at least one is on 10 or later. Storybook 9 entries are skipped with a note.

Rules:

- It never asks about the platform, tolerance, workers or a CI URL. One `url` serves both environments.
- It never writes `platform: 'host'`.
- `init --yes` takes every default, the addon included.

## `init`: what it writes

- **The config** at the workspace root, holding only what differs from the defaults.
- **For each Storybook:**
  - `<configDir>/visual-check.ts`, which exports `visualCheck = defineVisualCheck({ modes: {} })` and carries a commented example of a `mobile` mode at 375×667, scale 2, with touch;
  - `<dir>/.visual-check/.gitignore`.
- **The root `.visual-check/.gitignore`.**
- **Dependencies,** as [Packages](01-packages.md) lists them. Under Rush it prints the install steps instead.
- **The addon:** for each ticked Storybook it runs `storybook add @visual-check/storybook-addon@<cli version>` in that Storybook's package. If that fails, it warns, prints the command and carries on.
- **The two npm scripts.**
- **The agent skill** ([Agent skill](16-agent-skill.md)).

What it never does:

- edit `preview.*`, and it edits `main.*` only through `storybook add`;
- edit existing scripts, `turbo.json`, `nx.json` or the root `.gitignore`;
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
- there's no TTY and no `--yes`.

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

1. Start each Storybook with its command.
2. Run `visual:update` to write baselines. The first run downloads the browser image.
3. Run `visual:test`. It should pass. If a story fails, ask your agent to run visual-check, or see the docs.
4. Commit the config, `.visual-check/baselines/`, `.agents/skills/visual-check/` and the `.claude/skills/visual-check` link.

Then it prints the line to add to `preview` and a docs link for CI. It says nothing about remote content.

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
