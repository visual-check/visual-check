# Landing prototypes: shared brief

PROTOTYPE, throwaway. Five static HTML landing pages for visual-check (issue #102), each a radically different concept, all built on the same design system and the same message. The real build is a Next.js page (with Fumadocs docs under `/docs`), Tailwind and shadcn/ui, skinned only by design-system tokens.

## The page's one job

A front-end developer with a Storybook lands here and runs `init` the same day, even "just to try it". Everything on the page serves that: show it works, show it's cheap to try, remove the reasons to wait.

## Positioning

**Code review shows what changed in the code. visual-check shows what changed on screen.**

- **Who:** developers and design-system owners with one or more Storybooks, in a single repo or a monorepo. Increasingly they ship UI written with a coding agent.
- **The problem:** a one-line change to a shared token or component moves forty stories, and nobody reads pixels in review. Coding agents make this worse: more UI changes, larger diffs, less deliberate edits, and an agent can't see what it changed.
- **What people use today, and why it hurts:** hosted services bill per snapshot and keep your images on their servers; screenshot tests on Playwright fail on another OS because fonts and anti-aliasing render differently; hand-built harnesses grow to 2,000 lines per project; the open-source option many used (Loki) is no longer maintained.
- **What visual-check is:** an open-source CLI. It snapshots every story in a browser pinned inside its own Docker image, compares each with the approved baseline committed in your repo, and tells you exactly which stories moved, by how many pixels, with a visual diff. Locally, in CI, inside Storybook, and from your coding agent.

## What the research says (read `research/landing.md` for sources)

- **The top pain in every visual-testing tracker is pixels that differ between a laptop and CI** (OS, CPU, fonts, anti-aliasing): Playwright, jest-image-snapshot, Percy and Happo issues all have it, and Vitest's own docs recommend Docker. No open-source Storybook tool pins the rendering environment. "Same pixels on your laptop and in CI" is the strongest single hook; give it at least one headline alternative and a prominent place.
- **Hosted tools cap free use around 5,000 snapshots a month** and bill per snapshot × browser × mode beyond it. Speak about "per-snapshot bills" as a category; don't name competitors or quote their prices on the page.
- **Many alternatives are unmaintained or archived** (Loki, Lost Pixel, the Storybook test-runner). A short "Coming from Loki, Lost Pixel or the test-runner?" line in the FAQ that points to the docs is fair; don't assert anything about those projects beyond that.
- **The best dev-tool pages:** a copyable install command in the hero, repeated at the end; real terminal output as the demo; verifiable proof (numbers with where they came from, "reproduce" links, "replaces X"); honest labels on demos ("simulated", "real output from CI run …").
- **The agent angle lands when it names the mechanism, not "AI":** "Your agent can't see the UI" beats any "AI-powered" wording (an "AI" label measurably lowers trust). A CLI plus a skill is what developers prefer to an MCP server, which is what visual-check ships. Stress that a person approves baselines; the agent never does.
- **AI-made page tells** found in the research, on top of the list below: the badge pill above the hero, a serif-italic accent word in the headline, always-dark pages, coloured card borders, the "1, 2, 3" step row, the "No X. No Y. Just Z." sentence shape. The brand's ink and paper sit near the purple tell, so keep cyan and magenta flat: never a gradient, never a glow.
- **Apple silicon:** say plainly that the default `linux/amd64` image runs emulated (slower) on M-series Macs, and that `linux/arm64` is the faster option with the default tolerance absorbing the difference.

## Message hierarchy (use this order of importance, any visual order)

1. **It sees what review can't.** Every story compared with what you approved; which ones moved, by how much, with a visual diff in the logo's cyan and magenta.
2. **Same pixels on every machine.** The browser runs in visual-check's own image, pinned by digest, as `linux/amd64` by default. A baseline written on a Mac passes in Linux CI and on Windows. This is the differentiator: the reason other screenshot tests turn flaky.
3. **One command to try it.** `npx @visual-check/cli init` finds your Storybooks, asks a few questions, installs what it needs and writes one config file. A first `update` then `test` passes without editing a story.
4. **Nothing leaves your machine.** No service, no account, no per-snapshot bill. Baselines are PNG files in your repo, reviewed in the pull request like code. MIT licence.
5. **Built for agents.** `init` writes an agent skill. Your agent runs visual-check after UI changes, before it says the work is done, and reports which stories moved, with the diff paths. It never accepts its own changes: no `update`, no raised tolerance, no disabled story without your OK.
6. **Fast because it's narrow.** Only the stories a change can reach (affected stories); its own browser driver, no Playwright; sharding with a consistency check.
7. **Honest with real stories.** Animations captured at their end state, readiness for fonts and images, a `wait` hook, masks by selector or host, flaky snapshots retried and listed but never failing a run.
8. **Where you review:** terminal, the Storybook addon (Check and Update the open story, with a wipe slider), the GitHub Action (step summary + report artifact), the JSON report.

## Proof points you may use (exact; don't round up, don't invent)

- `108 passed · 10.8s` — a real CI run: 108 snapshots on a GitHub-hosted runner, 4 workers (sb11 test app).
- `110 passed · 19.1s` — five Storybooks in one repo (React, vanilla, Vue, Solid, Svelte), one run.
- Windows with Docker Desktop: `108 passed · 16.9s`.
- 3.30 captures/s against 2.71 for Playwright's `run-server`, 2 workers on 2 vCPUs, 300 real stories (18–24% faster).
- A story ready in 80 ms instead of 170 ms, through Storybook's test path.
- Identical bytes pass without decoding images, 98–99% of the time on unchanged snapshots.
- The default tolerance `{ color: 0.01, pixels: 20 }` still catches 89–100% of small deliberate changes in the measured set.
- Counting anti-aliased pixels caught 259 of 260 hidden icons, against 118 when they're ignored.
- Storybook 9.1, 10 and 11. React, Vue, Svelte, Solid and vanilla in the test apps. Node 22.17+. npm, pnpm, Yarn, Bun.
- Never claim: beating 4:45 (not measured yet), grid stories (not shipped), a version number, download counts, users, logos, testimonials, stars.

## Real strings for demos (quote exactly; full list in `research/product-facts.md`)

```
$ npx @visual-check/cli init
✓✓ visual-check init
? Name of the Storybook in apps/web  › web
? URL of web  › http://127.0.0.1:6006
? Install the agent skill?  › ● Yes  ○ No
✓ visual-check is set up
Next
  1  pnpm storybook       Start Storybook, and keep it running
  2  pnpm visual:update   Write the first baselines
  3  pnpm visual:check    Check the stories against the baselines
  4  Commit the changes, baselines included
```
```
visual-check 0.1.0 · test · 108 snapshots · 4 workers
✗ web  components-button--default  differs: 312 differ, 20 allowed
✗ web  components-modal--default  mobile  differs: 1904 differ, 80 allowed (20 at scale 2)
── 2 failures ──
web  components-button--default
  differs: 312 differ, 20 allowed
  diff: .visual-check/report/images/web/components-button--default.diff.png
106 passed · 2 differs · 11.4s
Report: .visual-check/report/report.json
```
- The CLI says **differs** (`2 differs`); the design system's badge says **changed**. In terminal output use the CLI's words; in badges use the design system's. (Open question for the owner.)
- Addon strings: panel `Visual check`; buttons `Check`, `Update`; status `Capturing 3 of 4…`, `2 visual diffs`, `Passed`, `2 written, 1 untouched`; rows `Default`, `dark`, `mobile` with `Passed` / `Visual diff` / `Missing baseline`; viewer toggle `Slider` | `Visual diff`; caption `Left: baseline  Right: snapshot`.
- Action: `uses: visual-check/action@v1`; jobs `Plan`, `Consistency check`, `Shard 2 of 3`; step summary heading `### visual-check 0.1.0 · test`.
- Agent skill runner: `node .agents/skills/visual-check/scripts/run.mjs test`; its lines `Reused Storybook web, which was already running at http://127.0.0.1:6006.`; the agent's report shape is in product-facts §6.
- Install: `npx @visual-check/cli init` (also `pnpm dlx`, `yarn dlx`, `bunx`). The binary is `visual-check`.

## Objections the page must answer (FAQ material)

| Objection | Answer |
|---|---|
| Do I need Docker? | By default, yes: that's how the pixels match everywhere. Without Docker, `platform: 'host'` uses a local browser, and baselines then only match on the same OS. |
| I'm on Apple silicon. | It runs `linux/amd64` through Rosetta by default, or `linux/arm64`, which the default tolerance absorbs. |
| Will it be flaky? | Animations end-state, readiness waits for fonts and images, a failing snapshot is retried once, and a flaky one is listed but never fails the run. |
| Where do baselines live? Who writes them? | `.visual-check/baselines/` beside each Storybook, committed. Only a person running `update` writes them; CI never does (`update` with `CI` set exits 2). |
| How is it different from a hosted visual-testing service? | It runs in your CI and on your machine. No per-snapshot pricing, no upload, no hosted review: you review in the pull request, the Storybook addon and the report. |
| Which Storybooks and CIs? | Storybook 9.1, 10, 11 (the addon: 10). GitHub Actions has an Action and a reusable workflow; the CLI runs anywhere Docker does. |
| What does it change in my repo? | `visual-check.config.ts` at the root, `.storybook/visual-check.ts` for modes, two npm scripts, the agent skill and `.visual-check/` folders. It never edits your preview or stories. |
| What does it cost? | Nothing. MIT. |
| Coming from Loki, Lost Pixel or the Storybook test-runner? | Run `init` beside it; the docs have a page for moving over. |
| Is the amd64 default slow on my M-series Mac? | It runs emulated, so slower than native. `platform: 'linux/arm64'` is faster, and the default tolerance absorbs the small rendering difference. |

## Voice (from the design-system brand book; non-negotiable)

- Plain and exact. Short declarative sentences, one fact each. Confidence comes from specifics (numbers, file names, real output), never from adjectives.
- Say what happens, then why.
- Glossary words: Storybook, story, snapshot, baseline, missing baseline, orphan, visual diff, tolerance, mode, mask, flaky snapshot, broken story, affected stories, end state, shard. Never: screenshot, golden, reference image, threshold, matrix, "project" for a Storybook, "test" for a story.
- British spelling. Sentence case for every heading, button and nav item. `visual-check` always lower case and hyphenated. "You" for the reader. No emoji. No exclamation marks.
- Banned: "supercharge", "seamless", "effortless", "blazing", "lightning", "game-changer", "next-gen", "unlock", "empower", "in seconds", "AI-powered", "magic", "revolutionise", "10x", "Get up and running".
- Avoid mannered devices: "It's not X, it's Y", colon-then-reveal, em-dash asides, rhetorical questions in every heading.
- Code examples use the `visualCheck(...)` helper spread into `parameters`, never hand-written `parameters.visualCheck` objects, and never `process.env` branches in config.

## Design system (read the files; don't approximate)

- `shared/tokens.css`: every colour (light + dark), type, spacing, radius, shadow, easing, duration token. `shared/bundle.css`: `vc-btn` (primary / accent / secondary / ghost, `--sm` / `--lg`, `vc-btn__arrow`), `vc-icon-btn`, `vc-badge` (+ `vc-badge-row`, `__glyph`, `__count`), `vc-code` (+ `--register`, `__bar`, `__copy`, spans `.p .c .s .k`), `vc-inline-code`, `vc-callout`, `vc-header`, `vc-search`, `vc-kbd`, `vc-link`, `vc-icon`, `vc-only-light/-dark`.
- Brand idea: a check printed twice, off register. Cyan plate = baseline, magenta plate = snapshot, the overlap is solid ink. Cyan leans "baseline / passed / link", magenta leans "snapshot / changed". Don't use magenta as decoration next to a diff.
- `shadow-register` (the off-register plates) is the one flourish: one element in view at a time. `action-accent` (magenta button) is for the single loudest call to action on the page.
- Type: Bricolage Grotesque for display (`.display` is one per page, the hero), Atkinson Hyperlegible Next for text (`body-lg` on landing), Atkinson Hyperlegible Mono for code and `label`. Code always on `code-bg`.
- Space: `space-24` between landing sections, `space-12` between blocks in a section. Radii small: `radius-md` buttons, `radius-lg` code and cards.
- Motion: hovers spring (`ease-spring` + `duration-spring`), colours fade. The design system says nothing loops or animates on its own; product demos are the exception being evaluated here, under the kit's motion setting (plays when seen / click to play / end state), never looping, always pausable, and showing their end state under reduced motion.
- Logo files: `shared/logo/` (`logo-horizontal(-dark).svg`, `mark(-dark).svg`, `mark-mono(-white).svg`, `wordmark(-dark).svg`). Never recolour the plates or close their gap.
- Values the system lacks (container width, a hero size between `display` and `h1`, a demo frame height…): use them, and list them at the top of your `<style>` under "Values the design system doesn't have yet". They become tokens before the real build.

## Not an AI-template page

Avoid every one of these: purple-to-blue gradients, glows, glassmorphism, blurred blobs, emoji or icon-in-a-circle feature cards, three identical feature cards in a row, bento grids for no reason, everything centred, `rounded-2xl` on everything, fake logos or testimonials, "Trusted by", stats tiles with invented numbers, a giant headline over a stock dashboard screenshot, sparkles, a pill eyebrow above every heading. The design system already has a strong identity: print, plates, registration marks, ink on paper, a dark terminal. Use the subject's own world: stories, baselines, pixel counts, file names, the CLI's real output.

## Files and wiring (the contract that makes mixing work)

- Your file: `landing/<x>.html` (`a`…`e`), a full HTML document. Start from `landing/_template.html`.
- `window.VC_PAGE = { set: 'landing', key: '<X>', toggles: [...] }` before `../shared/proto-kit.js`. Read `shared/proto-kit.js` once; it documents everything below.
- The page header is `<div data-kit="header"></div>` (the design system's SiteHeader) and the footer `<div data-kit="footer"></div>`, unless your concept truly needs its own (say why in a comment).
- **Eight sections, each `<section data-slot="…">`, in this set:** `hero`, `problem`, `demo`, `commands`, `features`, `agent`, `faq`, `cta`. Order them however your concept wants; the mixer stacks them in that canonical order, each from any variant. So:
  - each section is self-contained: its own background, padding and container; no CSS or JS that depends on another section being present;
  - prefix every class and id with your letter (`a-hero`, `#a-demo`); no global element selectors beyond what `proto-base.css` sets;
  - no `vh`-sized sections beyond the hero, no sticky/scroll-linked effects that span sections (a sticky element inside one section is fine, but it won't stick in the mixer);
  - use `VCProto.onView` (IntersectionObserver) for in-view triggers, not CSS scroll timelines.
- **Copy alternatives:** give the hero headline (and, if useful, the subhead or a section heading) 2–3 alternatives with `data-copy` / `data-copy-alt`. The bar's Copy button cycles them. Write them as real contenders, not filler.
- **Idea toggles:** 2–3 `VC_PAGE.toggles` for real questions inside your concept (each visibly changes the page through `html[data-t-<id>="<option>"]`).
- **Demos:** build with `VCProto.scene(root, script, { controls, chapters, label })` unless your concept calls for another technique (say which and why). `research/animation.md` explains the choice: rebuilt product UI in HTML/CSS with real text, driven by a timeline, is what Warp, Linear, Raycast, Bun and others do; animated SVG fits brand motifs only (an `<img>` SVG can't follow the theme toggle or be paused). The scene's resting state is its end state, so the page is complete at rest. Give every demo visible controls (pause/replay, chapters when there are several parts). Never loop. Text in demos is real text (selectable, readable by screen readers), not images.
- Accessibility: focus ring on everything interactive, contrast per the tokens' usage notes, a glyph and a word on every status, sliders and toggles keyboard-operable with labels, `prefers-reduced-motion` respected (the kit already defaults the motion setting to end state).
- Phone width (375px) must work: no horizontal page scroll; code blocks scroll inside themselves.

## Verify before you finish

The local server runs at `http://localhost:4173` (serving `prototypes/102-site`). Open your page in the built-in browser **in a new tab of your own** (`tabs_create`, then `navigate`); don't touch other tabs, they belong to other agents. Check 1440, 768 and 375 widths, light and dark, every toggle, every copy alternative, each demo playing and at its end state, and the console. Also open `http://localhost:4173/landing/mix.html?hero=<X>&problem=<X>&demo=<X>&commands=<X>&features=<X>&agent=<X>&faq=<X>&cta=<X>` to check every section renders on its own. Fix what you find. Close your tab when done.

## Report back (≤ 15 lines)

The concept in one line, the headline alternatives, the toggles and the question each answers, the demo technique and why, new values the design system would need, and anything in this brief you think is wrong.
