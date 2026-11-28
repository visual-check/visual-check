# Page errors fail `test` without breaking the story

A snapshot whose page raised page errors — a `console.error`, an uncaught error, an unhandled rejection, or a load from its Storybook's origin that failed or got an error status — is compared or written as usual and has page errors besides; by default `test` fails on them and `update` writes the baseline and lists them ([#177](https://github.com/visual-check/visual-check/issues/177)). Making such a story broken, as the migration target's own harness did, lost because a page error says nothing about whether the pixels are wrong: its source is unknown, so withholding the comparison or the baseline would hide a real outcome behind a guess. Listing them only in the report lost because nobody reads the report of a green run, so a broken story would still pass CI as it did before ([#173](https://github.com/visual-check/visual-check/issues/173)). A story that raises one on purpose, such as an error-state story with a mocked error response, declares it as an expected page error, which documents what the story is for.

## Consequences

- `pageErrors: 'fail' | 'warn' | 'off'` in config and in a story's `parameters.visualCheck`, `'fail'` by default. `'warn'` lists them without failing the run, for a project moving over.
- `expectedPageErrors: (string | RegExp)[]` in config and in `parameters.visualCheck`. The config's list is always added to the story's merged list; within parameters a story's list replaces its meta's or preview's, as Storybook merges any array. An entry that matched no page error of the snapshot is a warning, so an error-state story that stopped erroring is noticed.
- A mocked error response counts as one from the server, so every error-state story needs an expected entry.
- Page errors belong to a snapshot, from every load of it in the run, each once, so an error raised on one load of several is not hidden.
- A story broken for another reason keeps that reason; its entry still lists its page errors, since they often explain why it broke.
- Loads from other origins aren't page errors. Real network requests are checked on their own ([#178](https://github.com/visual-check/visual-check/issues/178)).
