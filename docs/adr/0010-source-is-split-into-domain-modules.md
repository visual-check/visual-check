# Source is split into domain modules, each with a tagged interface

Each package's `src/` holds its entry files and one folder per module, named with a glossary term. A module's interface is the exports its JSDoc tags `@public`. Everything else stays private to its folder. Code reaches an outside system (Storybook, Chromium over CDP, Docker, git and Fallow's graph, the image libraries, GitHub) only through that system's adapter module, which returns visual-check's own types. Biome and Fallow enforce the layout, so a stray file or a reach into another module's internals fails the checks before review. From domain-driven design we keep the shared language and the adapters at the edges, not the tactical patterns. Six alternatives lost:

- **Folders by technical role** (`services/`, `models/`, `utils/`): a change to one feature touches every layer, and catch-all folders grow without an owner.
- **Feature-Sliced Design**: its layers (pages, widgets, entities) describe a web UI, not a CLI.
- **Tactical DDD**: entities, aggregates, repositories and domain events add ceremony that a tool this size doesn't repay.
- **An `index.ts` per module re-exporting its interface**: re-export files slow tools down and invite import cycles, and keeping imports to the index needs extra path rules. The `@public` tag marks the interface where it's defined.
- **One `shared/` folder**: it becomes the home of code nobody named. Reusable code gets a module named for what it does, or a workspace package when two packages need it.
- **Many small packages**, as Changesets and Turborepo do: each published package would join the lockstep release, while internal modules cost nothing to split out later.

## Consequences

- Adding a module means its folder, its Fallow zone and the rule naming what it may import, in one commit.
- A subfolder is a module of its own. Its parent sees only what it tags `@public`, and so does every module allowed to import the parent.
- Fallow checks which module imports which, and Biome checks which symbols. Neither checks names against the glossary, so review does.
- The ticket that adds an adapter also bans its outside package everywhere else.
