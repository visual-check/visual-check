# Agent skill formats

Research for [#9](https://github.com/visual-check/visual-check/issues/9), part of the [v1 spec map](https://github.com/visual-check/visual-check/issues/1). Sources read 2026-11-02.

**Question:** how do we package one skill that runs visual checks for Claude, OpenAI and other agents? What are the current formats, what is portable, and how can a skill prefer a low-cost model on each platform?

## Answer

1. **Package one `SKILL.md`.** The [Agent Skills](https://agentskills.io/specification) format is the shared layer. Claude Code, Codex, Cursor, Copilot, Antigravity and Gemini CLI all document it, and the [client list](https://raw.githubusercontent.com/agentskills/agentskills/main/docs/snippets/clients.jsx) names 46 products.
2. **Install it in two places.** `.agents/skills/visual-check/` covers everyone except Claude Code, and `.claude/skills/visual-check/` covers Claude Code.
3. **Model choice isn't portable.** The spec has no `model` field, so the skill can only prefer a cheap model through each platform's own mechanism:
   - Claude Code: frontmatter on the skill.
   - Codex and Antigravity: a small runner subagent file next to the skill.
   - Cursor and Copilot: nothing in v1, the skill runs on the session model.
4. **The dependable saving is the CLI.** A deterministic `visual-check test --reporter json` with exit codes costs little on any model, and works on every client. The cheap model is a best-effort extra.

## Current formats

### The shared format

A skill is a directory holding `SKILL.md`, with optional `scripts/`, `references/` and `assets/` ([spec](https://agentskills.io/specification)). Frontmatter has six fields:

| Field | Required | Limit |
| --- | --- | --- |
| `name` | Yes | 64 characters, lowercase letters, digits and hyphens, must match the directory |
| `description` | Yes | 1024 characters |
| `license` | No | |
| `compatibility` | No | 500 characters |
| `metadata` | No | String-to-string map |
| `allowed-tools` | No | Experimental, support varies |

The spec recommends keeping the body under 500 lines and 5000 tokens. It defines what goes inside a skill, not where skills live; `.agents/skills/` is a [convention it recommends clients scan](https://agentskills.io/client-implementation/adding-skills-support).

### Where each client differs

| Client | Project skill paths | Extra skill frontmatter | Skill-level model field |
| --- | --- | --- | --- |
| [Claude Code](https://code.claude.com/docs/en/skills) | `.claude/skills/` only (its docs don't mention `.agents/skills`) | Many, including `model`, `effort`, `context`, `agent`, `background`, `paths` | **Yes** |
| [Codex](https://learn.chatgpt.com/docs/build-skills) | `.agents/skills/`, from the working directory up to the repo root | Optional sidecar `agents/openai.yaml` | No |
| [Cursor](https://cursor.com/docs/skills) | `.agents/skills/`, `.cursor/skills/`, plus `.claude/skills/` and `.codex/skills/` for compatibility | `paths`, `disable-model-invocation`, `icon`, `color` | No |
| [Copilot](https://docs.github.com/en/copilot/concepts/agents/about-agent-skills) | `.github/skills/`, `.claude/skills/`, `.agents/skills/` | [VS Code](https://code.visualstudio.com/docs/copilot/customization/agent-skills) adds `argument-hint`, `user-invocable`, `disable-model-invocation`, experimental `context: fork` | No |
| [Antigravity](https://antigravity.google/docs/skills) | `.agents/skills/` (and legacy `.agent/skills/`) | `name` is optional | No |
| [Gemini CLI](https://geminicli.com/docs/cli/skills/) | `.gemini/skills/`, `.agents/skills/` | Not documented on that page | Not documented |

Gemini CLI's docs carry a [banner](https://geminicli.com/docs/cli/skills/), aimed at unpaid and Google One users, saying Antigravity CLI replaced it on 18 June 2026. Treat Antigravity as the Google target. `.agents/skills/` covers both.

### Instruction files are a separate layer

[`AGENTS.md`](https://agents.md/) is plain Markdown with no required fields, stewarded under the Linux Foundation. It's always loaded rather than loaded on demand. [Claude Code](https://code.claude.com/docs/en/memory) reads it by default only when no `CLAUDE.md` exists (v2.1.277 or later).

Skills are the better fit here, since they cost about 100 tokens until used. `init` shouldn't edit a user's instruction files.

### Distribution

| Route | Fit |
| --- | --- |
| Files committed to the project by `visual-check init` | Best for v1. The skill ships with the CLI version it describes, and [travels with the repo into cloud sandboxes](https://agentskills.io/client-implementation/adding-skills-support) |
| [`npx skills add`](https://github.com/vercel-labs/skills) (Vercel, third party) | Free reach to [79 agents](https://raw.githubusercontent.com/vercel-labs/skills/main/docs/agents.md). It [scans a repo's `skills/` directory](https://raw.githubusercontent.com/vercel-labs/skills/main/docs/creating-skills.md), so keeping the skill there is all it needs |
| [Claude plugin](https://code.claude.com/docs/en/plugins/marketplace-reference) | Supports an `npm` source. Names the skill `/plugin:skill`. Post-v1 |
| [Codex plugin](https://developers.openai.com/codex/plugins/build) | Root `plugin.json` with `skills/`. The page doesn't list agents as a component, so it may not be able to ship a runner. Post-v1 |
| [Claude API and claude.ai upload](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview) | Not a target. The API sandbox has no network and no package installs, and visual checks need the user's checkout and a browser |

## What is portable

**Portable**
- The directory layout, `name`, `description` and the Markdown body.
- Bundled files referenced by relative path from the skill root.
- Shell commands in the body, with [JSON on stdout, diagnostics on stderr, distinct exit codes and no prompts](https://agentskills.io/skill-creation/using-scripts). The [CLI decision](https://github.com/visual-check/visual-check/issues/17) already provides `--reporter json` and exit codes 0/1/2.

**Not portable**
- `model`, `effort`, `context` and `background`. Their meaning is client-specific.
- `$ARGUMENTS` and `` !`command` `` substitution, which are documented for [Claude Code](https://code.claude.com/docs/en/skills). Other clients may show them literally, so the body should avoid them.
- `allowed-tools`. Syntax and support vary: the spec uses `Bash(git:*)`, while [Copilot CLI](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/create-skills) talks about `shell` and `bash` and warns against pre-approving them.
- Subagent files. Each platform has its own path and format (below).

**Unknown frontmatter keys are safe locally, but not everywhere**

| Tool | Behaviour with a key like `model` | Evidence |
| --- | --- | --- |
| Codex | Ignored | [Parser](https://github.com/openai/codex/blob/main/codex-rs/skills/src/parser.rs) has no strict mode; a [test](https://github.com/openai/codex/blob/main/codex-rs/skills/src/parser_tests.rs) loads a skill with unknown fields |
| VS Code | Grayed out, no warning | [Issue #294520](https://github.com/microsoft/vscode/issues/294520), fixed in 1.115 |
| Agent Skills client guide | Advises lenient loading for name and description problems; doesn't address unknown keys directly | [Guide](https://agentskills.io/client-implementation/adding-skills-support) |
| `skills-ref validate` | **Error** | [Validator](https://github.com/agentskills/agentskills/blob/main/skills-ref/src/skills_ref/validator.py) allows only the six fields |
| claude.ai, Skills API, `package_skill.py` | **Hard error** | [Claude Code docs](https://code.claude.com/docs/en/skills) |

Cursor's, Copilot CLI's and Antigravity's handling isn't stated in their docs. Test it before relying on it.

## Preferring a low-cost model

The spec has no such field. [Issue #495](https://github.com/agentskills/agentskills/issues/495), still open, is about which models a skill is offered to, not which model runs it. So there is no portable route, and none is close.

| Platform | Mechanism | Cheap value | If the model is unavailable |
| --- | --- | --- | --- |
| **Claude Code** | `model` and `context: fork` in the skill's frontmatter | `haiku` alias | Allowlisted out: [falls back](https://code.claude.com/docs/en/model-config) rather than failing |
| **Codex** | [`.codex/agents/<name>.toml`](https://learn.chatgpt.com/docs/agent-configuration/subagents), and the skill body asks for it | `gpt-6-luna` (no alias) | Not documented |
| **Antigravity** | [`.agents/agents/<name>.md`](https://antigravity.google/docs/subagents), and the skill body asks for it | `flash` tier alias | Not documented |
| **Cursor** | [`.cursor/agents/<name>.md`](https://cursor.com/docs/subagents) | [`composer-2.5`](https://cursor.com/docs/models), no alias | Falls back to a compatible model. Legacy plans without Max Mode always use Composer |
| **Copilot** | [Custom agent `model`](https://docs.github.com/en/copilot/reference/custom-agents-configuration) in [`.github/agents/`](https://code.visualstudio.com/docs/copilot/customization/custom-agents) | No alias documented | Not documented |

Details that shape the design:

- **Claude Code needs the fork.** [Without `context: fork`](https://code.claude.com/docs/en/skills), `model` applies for the rest of the turn, so any follow-up work in that turn also runs on Haiku. With the fork, it sets only the subagent's model.
- **The fork suits this skill.** The subagent [doesn't see the conversation](https://code.claude.com/docs/en/skills), but the default selection is affected stories, which comes from git rather than from the chat. Extra input arrives as `ARGUMENTS: <value>`.
- **Use `background: false`.** A forked skill [defaults to background](https://code.claude.com/docs/en/skills), and the calling agent normally needs the result before it continues.
- **`haiku` differs by provider.** It's [Haiku 5.5 on the Anthropic API and Haiku 4.5 on Bedrock, Foundry and Google Cloud](https://code.claude.com/docs/en/model-config). An alias is still the right choice.
- **Codex skills can trigger subagents.** Its docs say local releases spawn agents after a "direct request or applicable project or skill instruction". A model set in the agent file [takes precedence](https://learn.chatgpt.com/docs/agent-configuration/subagents).
- **Hardcoded model IDs go stale.** [`gpt-5.4-mini` left Codex's ChatGPT sign-in on 31 August 2026](https://learn.chatgpt.com/docs/models). Enterprise and Edu admins must also enable Luna. Keep IDs in a table in the CLI, overridable in config, so a new CLI release can correct them.
- **Cross-reading is unverified.** Cursor [reads `.claude/agents/` and `.codex/agents/`](https://cursor.com/docs/subagents) and VS Code [reads `.claude/agents/`](https://code.visualstudio.com/docs/copilot/customization/custom-agents), but neither says what happens to `model: haiku` or a Codex model ID there. Check this before shipping runner files in those paths.

Is delegation worth it at all? This is my inference, not a measured or sourced result. Running inline costs little in tokens read, but every extra turn re-sends the main agent's whole context at the main model's rate. A subagent replaces that with a small cheap context plus a short summary. The saving grows with session length, and is small in a fresh session. Measure it before adding more platforms.

## Recommendation

**Layout**, kept in the repo at `skills/visual-check/` and shipped inside `@visual-check/cli`:

```yaml
---
name: visual-check
description: Run visual regression checks on Storybook stories and report visual diffs against approved baselines. Use after changing UI code, or when asked whether a change alters how stories look.
compatibility: Requires @visual-check/cli as a project dependency.
metadata:
  visual-check-version: "1.0.0"
# Claude Code only. Other clients are expected to ignore these.
model: haiku
context: fork
background: false
---
```

**Body**, under about 60 lines:
- The command to run, and the meaning of exit codes 0, 1 and 2.
- Which fields of the JSON output to report.
- `test` with no flag checks affected stories; `--all` and `--filter` widen or change that.
- Run `update` only when the user explicitly asks, because it changes baselines.
- One fallback line for clients without a runner: delegate to a cheaper subagent if one exists, otherwise run inline.

**`visual-check init`**, as a wizard step:
1. Writes `.agents/skills/visual-check/`.
2. Links or copies it to `.claude/skills/visual-check/`. Claude Code [loads a symlinked skill once](https://code.claude.com/docs/en/skills). Windows may need a copy.
3. Writes a runner only for clients it detects: `.codex/agents/visual_check_runner.toml` and `.agents/agents/visual-check-runner.md`.
4. Leaves Cursor and Copilot on the session model in v1.

**One file over two renderings.** The alternative is a strict `SKILL.md` in `.agents/skills/` and a Claude variant in `.claude/skills/`. It would pass `skills-ref validate`, but the only surfaces that reject the extra keys are ones this skill can't run on anyway. Validate in CI by stripping the three Claude keys first.

**For the map's open question** ("one shared skill vs generated per app"): one shared skill, plus small generated runner files per client. `metadata.visual-check-version` lets the CLI warn when an installed skill has drifted from the CLI.

## Not verified

- **No client was run.** Everything here comes from docs and source code. Before release, run the skill on Claude Code, Codex and Antigravity, and confirm the cheap model actually ran.
- **Unknown-key behaviour** on Cursor, Copilot CLI and Antigravity (see above).
- **Docs disagree or lag.** The Codex models page names both `gpt-6-sol` and `gpt-6.1-sol`. Pricing wasn't compared across platforms, so "cheap" means each vendor's own positioning.
- **Codex custom agents in tool-backed sessions.** [Issue #15250](https://github.com/openai/codex/issues/15250) reported them unreachable and was closed as completed. I didn't test the fix.

## Open questions for the agent skill ticket

- **How the body invokes the CLI across package managers.** `init` could template the resolved command into the skill, at the cost of a generated line in the shared file. Using the npm script name is the alternative, since [`init` already writes those scripts](https://github.com/visual-check/visual-check/issues/17).
- **Whether to set `allowed-tools`.** It removes a permission prompt on some clients, but pre-approves shell access and isn't portable.
- **Whether the runner should look at images.** If a cheap model has to judge a visual diff, that model needs vision support on each platform. Otherwise it only reports what the CLI found, and judging stays with the main agent or the user.
