# Source layout

Where source files go and what they may import, in every workspace package. Why, and what lost: [ADR 0010](../adr/0010-source-is-split-into-domain-modules.md).

Three tools enforce the rules marked _enforced_. They run in CI, and Lefthook runs them before a push:

- **Biome**: `noPrivateImports`, `noBarrelFile`, `noReExportAll`.
- **Fallow**: zones and coverage.
- **The source-layout check** in `packages/repo-checks/src/source-layout/`: a unit test that reads every `src/` and `.fallowrc.json`.

Review covers the rest.

## Entries and modules

- `src/` holds **entries** and **modules**. _Enforced: Fallow fails on a file outside every module._
- An **entry** is a file package.json names: `bin`, `exports` or a script. It reads arguments and environment, hands them to modules, writes what they return and sets the exit code. The logic, parsing included, lives in modules. List each entry by name in `.fallowrc.json` › `boundaries.coverage.allowUnmatched`, the list of files allowed outside a module. Tool config files that fall under coverage go there by name too.
- A **module** is a kebab-case folder. Name a domain module with its [GLOSSARY.md](../../GLOSSARY.md) term. When the domain concept has no term yet, add it to the glossary in the same change. Name a module with no domain concept for what it does: `commands/`, `config/`, `child-process/`, or in `repo-checks` the check it runs. _Enforced (the source-layout check): `utils`, `util`, `helpers`, `helper`, `common`, `shared`, `lib`, `types`, `services`, `models` and `misc` are never folder names._
- Keep modules **deep**: a few `@public` exports with a lot behind them. Merge modules that always change together. A helper lives in the module that uses it.
- Code two packages need becomes a workspace package. Builds use plain `tsc` without bundling. So when a published package needs that code at run time, the new package is published and joins the lockstep group in `packages/repo-checks/src/lockstep/lockstep.ts`.

## Interfaces and imports

- An export is private to its folder and that folder's subfolders. Tag the exports that form the module's interface with `@public` in their JSDoc block. _Enforced: Biome `noPrivateImports` with `defaultVisibility: "package"`._
- Import a symbol from the file that defines it. No file re-exports, types included. A package's `src/index.ts` imports the `@public` symbols it publishes, then exports them. _Enforced: Biome `noBarrelFile` and `noReExportAll`, plus the source-layout check for type re-exports._
- `.fallowrc.json` › `boundaries` names which module may import which. _Enforced: Fallow `boundary-violation`; import cycles fail too. The source-layout check fails on a module folder without a zone, on a zone without a rule, and on any other zone shape._
- A dynamic `import()` skips Biome's `@public` check, so point it only at a `@public` symbol's file. Fallow's zones still apply.
- Fix a layout error by moving, tagging or allowing. Never suppress it. _Enforced: the source-layout check fails on a `biome-ignore` for these rules and on a `fallow-ignore` for `boundary-violation`, `boundary-coverage`, `boundary-call-violation` or `circular-dependency`._

## Submodules

- A subfolder is a **submodule** with an interface of its own. Its parent sees only what it tags `@public`, and it can import its parent's untagged exports. Nest only when the submodule hides real behaviour, such as `capture/driver/cdp/`.
- A submodule's `@public` exports are visible to every module allowed to import its parent. To keep them in, give the submodule its own zone, listed before its parent's zone (Fallow uses the first zone that matches): `{ "name": "cli/capture/driver", "patterns": ["packages/cli/src/capture/driver/**"] }`.

## Adding a module

1. Create `packages/<package>/src/<module>/`. `<package>` is the folder name under `packages/`.
2. In `.fallowrc.json` › `boundaries.zones`, add `{ "name": "<package>/<module>", "patterns": ["packages/<package>/src/<module>/**"] }`.
3. In `boundaries.rules`, add `{ "from": "<package>/<module>", "allow": [...] }` listing the zones it imports, `[]` for none.
4. Add the new zone to the `allow` list of every module that imports it. Entries need no zone or rule.
5. Tag the module's interface `@public`.

Done when `pnpm lint:fallow`, `pnpm lint:biome` and `pnpm test` pass.

## Outside systems

- Each outside system is reached through one **adapter** module, which returns visual-check's own types: Storybook, Chromium over CDP, Docker, git and Fallow's graph, sharp and pixelmatch, GitHub.
- The change that adds an adapter bans its package everywhere else with Biome `noRestrictedImports`, plus an override that allows it in the adapter's folder. An override's options replace the root list rather than merging with it. So each adapter's override lists every other banned package, and adding an adapter updates every existing adapter override.
- Put a **seam** (an interface that adapters satisfy) between a module and its adapters once two adapters exist or are planned. The driver interface is one, because the capture engine spec plans more browsers behind it. One adapter needs no seam.

## Tests

- Unit tests sit beside the code as `<file>.test.ts`. TypeScript fixture builders sit beside the test that uses them. A `<module>/fixtures/` folder holds data files only (JSON, images), because a `.ts` file there would be a submodule.
- Tests of an entry or of the built package live in `<package>/test/` as `*.test.ts`.

## `@visual-check/cli`, as it grows

A guide, not a commitment: each ticket names its modules from the glossary.

```
packages/cli/src/
  bin.ts                entry
  index.ts              entry: the public config API
  commands/             init, test, update
  config/
  storybook/            adapter: index.json
  capture/
    driver/             the driver seam
      cdp/              adapter: raw CDP
  container/            adapter: Docker and the proxy
  visual-diff/          adapter: sharp and pixelmatch
  baselines/
  affected-stories/     adapter: git and Fallow's graph
  sharding/
  report/
```
