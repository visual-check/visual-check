## Agent skills

### Issue tracker

Issues and specs live in GitHub Issues at https://github.com/visual-check/visual-check/issues. See `docs/agents/issue-tracker.md`.

### Triage labels

Default vocabulary: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `GLOSSARY.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.

### Task execution

Executing a ticket or plan: use the `subagent-driven-development` skill. Split the work into atomic commits, each one a single coherent change that passes checks on its own.
