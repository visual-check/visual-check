# Only reachability and speed differ between local runs and CI

Baselines are written locally and checked in CI from one config. Any setting that changes pixels and differs between the two makes every story a visual diff, as ADR 0003 found for the platform. So the config has no `local` and `ci` blocks. Every setting has one committed value. Only a Storybook's `url`, `workers` and `readyTimeout` may take `{ local, ci }`, with the `CI` env var choosing between them. These three change whether a Storybook is reached and how fast, never a snapshot's pixels. Blocks, first sketched in [Storybook target modes](https://github.com/visual-check/visual-check/issues/15), lost because a Storybook's `dir` and `baselines` can't differ between environments. With blocks, a monorepo entry was split across three places and each name was written three times ([Config file shape and init wizard](https://github.com/visual-check/visual-check/issues/38)).

## Consequences

- The type rejects `{ local, ci }` on every other key. Tolerance, viewport, mask colour, platform and image can't drift between environments.
- The config is a module, so a project can still branch on `process.env` itself. visual-check can't stop it, and the docs never show it.
- Letting another key take the pair later is additive. Bringing back blocks, or taking the pair away from a key, breaks every config that uses them.
