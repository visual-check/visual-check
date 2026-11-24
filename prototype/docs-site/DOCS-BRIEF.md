# Docs prototypes: shared brief

PROTOTYPE, throwaway. Three static HTML prototypes of the visual-check docs (`/docs`), to decide what the Fumadocs app in issue #102 should look like. The real build is Next.js + Fumadocs + Tailwind + shadcn/ui, skinned only by the design system's tokens. Each prototype must be **implementable with Fumadocs**: mimic its real layout, DOM structure and dimensions, and say in a short HTML comment which Fumadocs layout or component each part maps to (or that it's a custom MDX component).

## Read first

- `research/fumadocs.md`: Fumadocs layouts, DOM skeleton, dimensions, components, showcase takeaways, the three directions (§4) and the token mapping. Two corrections to it: the config file is `visual-check.config.ts` (TypeScript, `defineConfig`), never `visual-check.json`; and CI docs cover **GitHub Actions only** (the CLI runs anywhere, but there are no GitLab/CircleCI integrations, so don't show tabs for them).
- `research/product-facts.md`: exact CLI strings, prompts, config, addon strings, numbers. Quote these exactly. Note: nothing is on npm yet; write the docs as if `0.x` is released.
- The design system: `shared/tokens.css` (every token), `shared/bundle.css` (components: `vc-btn`, `vc-badge`, `vc-code`, `vc-inline-code`, `vc-callout`, `vc-header`, `vc-search`, `vc-kbd`, `vc-icon`), and its brand book, summarised below.
- The spec for page content: `docs/prd/` in the visual-check repo (`20-docs-site.md` lists every docs page and what it says; `09-visual-diff.md` holds tolerance, the worked example and the measured table; `02-cli.md`, `03-config-and-init.md`, `07-per-story-options.md`, `06-readiness-and-stability.md`) and `GLOSSARY.md` in that repo.

## Files and wiring

- Your file: `docs/<n>.html`, a full HTML document (doctype, head, body). Start from the head of `landing/_template.html` (links to `../shared/tokens.css`, `../shared/bundle.css`, `../shared/proto-base.css`, then `window.VC_PAGE` and `../shared/proto-kit.js`). Use `VC_PAGE = { set: 'docs', key: '<n>', toggles: [...] }`.
- All pages of your prototype live in that one file, routed by `location.hash` (`#getting-started`, `#color-and-pixels`, and your third page's slug). No hash → the first page. Sidebar links to pages you don't draft show a short stub page ("Not drafted in this prototype") with the page's real title and its bullet list from `20-docs-site.md`, so the IA can be judged.
- The kit gives you: theme (`data-theme` + `.dark` on `<html>`; any `[data-kit-theme-toggle]` button toggles it), the bottom prototype bar, idea toggles (`VC_PAGE.toggles` → `html[data-t-<id>="<option>"]`), and the DS SiteHeader via `<div data-kit="header" data-current="docs"></div>` if your layout uses a top header. Read `shared/proto-kit.js` once.
- Give the prototype 2–3 **idea toggles** for real design questions within your direction (for example TOC style default/clerk, page actions shown/hidden, sidebar with separators vs folders). Each toggle must visibly change the page.

## Must have

- Every page piece Fumadocs gives: sidebar (with the full IA below, current page marked), breadcrumb, title + description, page actions (Copy Markdown, Open ▾ with ChatGPT/Claude/Cursor/View as Markdown, Edit on GitHub), TOC with scrollspy, prev/next footer, last updated.
- A working ⌘K / Ctrl+K search dialog over a small static index of the IA (titles + a few headings), keyboard navigable, Escape closes, focus returns.
- Mobile (< 768px): sidebar becomes a drawer opened from the header; TOC collapses to an "On this page" disclosure. No horizontal page scroll at 375px.
- Install commands in package-manager tabs (npm / pnpm / yarn / bun; `npx @visual-check/cli init` → `pnpm dlx` / `yarn dlx` / `bunx`), with a copy button that doesn't copy the `$` prompt.
- Code blocks on `code-bg` in both themes (`vc-code`), file title bar, copy button; syntax colours only from `code-*` tokens.
- Callouts only from `vc-callout` (note / warning / danger), status only with `vc-badge` (glyph + word).
- Light and dark both right. Focus ring on everything interactive.

## Content rules (from the brand book)

- Plain and exact: short declarative sentences, one fact each, no marketing voice. Say what happens, then why.
- Glossary words only: Storybook, story, snapshot, baseline, missing baseline, orphan, visual diff, tolerance, mode, mask, flaky snapshot, broken story, end state, shard, affected stories. Never "screenshot", "golden", "threshold", "matrix", "project" for a Storybook.
- British spelling (colour, behaviour, licence). Sentence case everywhere. Product name always `visual-check`. "You" for the reader. No emoji, no exclamation marks.
- Examples use the `visualCheck(...)` helper from `.storybook/visual-check.ts` (spread into `parameters`), never hand-written `parameters.visualCheck` objects, and never branch on `process.env` in config.
- Real content. Write the drafted pages properly from the PRD: they should read like the finished docs.

## IA (sidebar, in this order)

Start: Getting started · Config · Modes
Capture: Full page and `element` · Grid stories · Animations · The `wait` hook · Remote content
Compare: `color` and `pixels` · Baselines · Flaky snapshots · Stories that break
Run: Browser · Platforms and Docker · CI · Security
Integrate: Storybook addon · Agent skill · Supported Storybooks
Reference: JSON reference

## Design-system rules for code

- Values come from tokens (`var(--…)`, the `.display/.h1/.h2/.h3/.body/.small/.code/.label` type classes, the `--text-*` font shorthands). Where you need a value the system lacks (sidebar width, content max width, a 56px header…), use it and list it at the top of your `<style>` under "Values the design system doesn't have yet". Those become tokens before the real build.
- Motion: hovers spring (`ease-spring`, `duration-spring`), colours fade (`ease-out`, `duration-fade`), nothing moves on its own. Respect `prefers-reduced-motion`.
- No AI-template looks: no gradients, glass, emoji, glow, left-border cards, `rounded-xl` everywhere.

## Verify before you finish

The local server is running at `http://localhost:4173` (serving `prototypes/102-site`). Open your page in the built-in browser **in a new tab of your own** (`tabs_create`, then `navigate`); don't touch other tabs, they belong to other agents. Check desktop (1440), tablet (768) and phone (375) widths, light and dark, the search dialog, the toggles, hash routing, and the console for errors. Fix what you find. Close your tab when done.

## Report back (≤ 15 lines)

What you built, the toggles and what each answers, the Fumadocs mapping in one line per region, new values the design system would need, and anything in the brief or the research you found wrong.
