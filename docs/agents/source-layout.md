# Source layout

Where source files go and what they may import, in every workspace package. Why, and what lost: [ADR 0010](../adr/0010-source-is-split-into-domain-modules.md). Rules marked _enforced_ fail Biome or Fallow, locally through Lefthook and in CI. Review covers the rest.

## Entries and modules

- `src/` holds **entries** and **modules**, nothing else. _Enforced: Fallow fails on a file outside every module._
- An **entry** is a file package.json names: `bin`, `exports` or a script. It parses input, wires modules together and sets the exit code. List each entry by name in `.fallowrc.json` › `boundaries.coverage.allowUnmatched`.
- A **module** is a kebab-case folder named with a [GLOSSARY.md](../../GLOSSARY.md) term. In tooling packages such as `repo-checks`, name it for what it checks.
- Reusable code with no domain gets a module named for what it does, such as `child-process/`. Code two packages need becomes a workspace package. Names that say nothing about the domain stay unused: `utils`, `helpers`, `common`, `shared`, `lib`, `types`, `services`, `models`.
- Keep modules **deep**: a few `@public` exports with a lot behind them. Merge modules that always change together. A single function stays a file, not a folder.
- A subfolder is a **submodule** with an interface of its own. Nest only when it hides real behaviour, such as `capture/driver/cdp/`. _Enforced by Biome._

## Interfaces and imports

- Every export is private to its folder. Tag the exports that form the module's interface with `@public` in their JSDoc block. _Enforced: Biome `noPrivateImports` with `defaultVisibility: "package"`._
- Import a symbol from the file that defines it. A package's `src/index.ts` is the only file that re-exports. _Enforced: Biome `noBarrelFile` and `noReExportAll`._
- `.fallowrc.json` › `boundaries` names which module may import which: one zone per top-level module, named `<package>/<module>`, and one rule per zone listing the zones it may import. A new module adds its zone and its rule in the same commit. _Enforced: Fallow `boundary-violation`. Import cycles fail too._

## Outside systems

- Each outside system is reached through one **adapter** module, which returns visual-check's own types: Storybook, Chromium over CDP, Docker, git and Fallow's graph, sharp and pixelmatch, GitHub.
- The ticket that adds an adapter also bans its package everywhere else, with Biome `noRestrictedImports` and an override for the adapter's folder.
- Put a **seam** (an interface that adapters satisfy) between a module and its adapters once two adapters exist or are planned. The driver interface is one, because the capture engine spec plans more browsers behind it. One adapter needs no seam.

## Tests

- Unit tests sit beside the code as `<file>.test.ts`. Fixtures go in `<module>/fixtures/`.
- Tests of an entry or of the built package live in `<package>/test/`.

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
