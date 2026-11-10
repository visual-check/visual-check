# Per-story options live in Storybook parameters, read before capture

Every option a project sets for a Storybook, a stories file or a story lives in `parameters.visualCheck`: modes, viewport, capture element, masks, tolerance, `wait`, `disable` and combined snapshots. They are set in `preview`, meta or story, merged by Storybook, and written through a typed `defineVisualCheck` function. Each run reads every story's merged options from the preview store with `extract()` on one page, then captures. The alternative was static planning: modes defined in visual-check's config and picked with tags, so `index.json` alone would give the baseline set. It lost because tags must be literal strings and can't carry values, so per-story width lists (common in projects coming from Lost Pixel's `breakpoints`) would each become a named mode in config. `wait` and masks also had to live in parameters anyway. One typed place, merged the way Storybook merges everything else, keeps setup easy ([Per-story options](https://github.com/visual-check/visual-check/issues/37)).

## Consequences

- Knowing the baseline set (missing baselines, orphans, `test --consistency`) takes a browser page that imports every stories file, not just `index.json`. It still captures nothing. On a dev server, even an `--affected` run compiles every stories file once per server.
- `extract()` and the preview store are Storybook internals. The adapter absorbs changes to them.
- visual-check reads no tags, not even Storybook's `!test`.
- Moving options out of parameters later would break every project's stories.
