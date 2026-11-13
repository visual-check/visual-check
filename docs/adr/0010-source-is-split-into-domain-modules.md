# Source is split into domain modules, each with a tagged interface

Each package's `src/` holds its entry files and one folder per module. A module is named with a glossary term, or for what it does when it has no domain concept. Entries are the files package.json names, listed one by one in the Fallow config. They only wire modules together, so the root of `src/` can't fill up with helpers. A module's interface is the exports its JSDoc tags `@public`. Everything else stays private to its folder and its subfolders. Imports go to the file that defines the symbol, and no file re-exports, so a package's `src/index.ts` imports what it publishes and exports it. Code reaches an outside system (Storybook, Chromium over CDP, Docker, git and Fallow's graph, the image libraries, GitHub) only through that system's adapter module, which returns visual-check's own types. From domain-driven design we keep the shared language and the adapters at the edges, not the tactical patterns. Biome, Fallow and a source-layout check in `repo-checks` enforce the layout. The check covers what the other two can't: zones without rules, type re-exports, suppression comments and catch-all folder names. Six alternatives lost ([Package layout and PR code checks](https://github.com/visual-check/visual-check/issues/53)):

- **Folders by technical role,** such as `services/`, `models/` and `utils/`. A change to one feature touches every layer, and catch-all folders grow without an owner.
- **Feature-Sliced Design.** Its layers (pages, widgets, entities) describe a web UI, not a CLI.
- **Tactical DDD.** Entities, aggregates, repositories and domain events add ceremony that a tool this size doesn't repay.
- **An `index.ts` per module re-exporting its interface.** Re-export files slow tools down and invite import cycles, and keeping imports to the index needs extra path rules. The `@public` tag marks the interface where it's defined.
- **One `shared/` folder.** It becomes the home of code nobody named. Reusable code gets a module named for what it does, or a workspace package when two packages need it.
- **Many small packages,** as Changesets and Turborepo do. Each published package would join the lockstep release, while internal modules cost nothing to split out later.

## Consequences

- Adding a module means its folder, its Fallow zone and the rule naming what it may import, in one change. Adding an entry means listing it by name in the Fallow config.
- A subfolder is a module of its own. Its parent sees only what it tags `@public`, and so does every module allowed to import the parent, unless the subfolder gets a zone of its own.
- Fallow checks which module imports which, and Biome checks which symbols. Nothing checks names against the glossary, so review does.
- The change that adds an adapter also bans its outside package everywhere else.
