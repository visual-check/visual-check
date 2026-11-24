# visual-check landing page: research

Checked 2026-11-23. Sources: live sites fetched with WebFetch (or curl when the fetch got an llms.txt or an empty
shell), the GitHub API through `gh`, HN, GitHub issues, vendor docs and blogs.

**Caveats:**
- I could not reach Reddit, G2, Capterra or X, so pain quotes come from GitHub issues, HN, docs and blogs.
- A summarizing fetch tool pulled out the HN comment quotes. Spot-check any quote before it goes on the page.
- Quotes are kept under 15 words. "(vendor)" marks claims made by a competitor about the market.
- Read with `product-facts.md` (same folder). §5.4 lists the claims we must not make yet.

---

## 1. Dev-tool and OSS CLI landing pages: what makes a developer install now

### 1.1 Principles, with sources

| # | Principle | Evidence |
|---|---|---|
| 1 | **Lead with code or a command. It's the hero visual for tools without much UI.** | Evil Martians studied 100+ dev-tool landing pages and lists a code snippet as the hero visual for "libraries, SDKs, infra". https://evilmartians.com/chronicles/we-studied-100-devtool-landing-pages-here-is-what-actually-works-in-2025 |
| 2 | **No salesy copy. Be specific, at the lowest level of abstraction.** | The same study found two rules on almost every page: "No salesy BS." and "Clever and simple wins." Evil Martians' conversion post: "technical audiences need specificity and the lowest possible level of abstraction" https://evilmartians.com/chronicles/how-to-kill-conversions-on-your-developer-tool-landing-page |
| 3 | **A specific CTA, not "Get started".** | The study recommends specific verbs ("Start building", "Download now"). In the conversion post, a clearer CTA lifted clicks from 1.3% to 2.0%. |
| 4 | **Remove everything between the visitor and the first run.** | "strip away everything except what developers actually need"; "removing steps … is critical" (conversion post). Time-to-first-hello-world is the DevRel metric for this (https://dzone.com/articles/what-is-ttfhw). |
| 5 | **Two CTAs: a loud primary and a quiet secondary.** End with a full-width final CTA. | Evil Martians: "Make it big and loud. Don't lose your last chance to convert a visitor." |
| 6 | **Trust block straight after the hero.** For developer products that means GitHub stars, usage numbers and awards, not logo carousels. | Evil Martians: "Remember, open source users are users, too." For an early product, "even one short quote" from a first user is enough. |
| 7 | **Frame features as problems solved.** The study recommends this for early-stage products. | "Highlight real user problems … instead of talking about features." Function lists come out weakest. |
| 8 | **Put the bottom line up front, address the reader's concerns directly, and own the weak spots.** | Lee Robinson, https://leerob.com/developer-marketing: "Put the bottom line up front"; "When something sucks with your product, own it."; "Developers won't try your product the first time they hear about it." |
| 9 | **Name the incumbent and be opinionated.** | Plausible rewrote its homepage as a Google Analytics alternative: "Don't hide the fact that a popular competitor … exists" (https://plausible.io/blog/blog-post-changed-my-startup). The relaunch week brought 166 trials, more than the four months before combined. PostHog: "Be opinionated." and "Make honest claims about the functionality of your product." (https://posthog.com/newsletter/marketing-for-devs) |
| 10 | **Retire copy clichés, replace them with numbers.** | Evil Martians: https://evilmartians.com/chronicles/hey-developer-tool-teams-dont-copy-these-copywriting-cliches. The list: "Lightning-fast", "Blazing-fast", "Built by developers for developers", "Seamless developer experience", "Get started in minutes", "No vendor lock-in", "Best-in-class", "Next-gen". The fix: "provide numbers"; "pretend you're talking with a fellow developer". "No vendor lock-in" is on the list, so state the mechanism instead (PNGs in your repo, MIT). |
| 11 | **FAQ near the bottom.** Comparison tables are rare but used for switching pitches. | Evil Martians says early-stage products often need only an FAQ. Comparison tables appear when "pitching switching from competitors". |
| 12 | **Treat the site as a product and allow some humour.** | PostHog: "Treat your website like a product."; "Never underestimate the power of being funny on the internet." |

### 1.2 Exemplary sites: what each does

| Site | Hero (quoted) | Install / CTA | Demo | Proof | Steal / avoid |
|---|---|---|---|---|---|
| **bun.com** | "Bun is a fast JavaScript runtime & toolkit. All in one." The subhead lists six tools "in a single binary". | `curl -fsSL https://bun.sh/install \| bash` with a copy button and a "View install script" link. CTAs: "Quickstart" / "Read the docs". | Tabbed benchmark bars directly under the hero. Slow bars say "still going…". Each chart has "replay in real time", a **reproduce** link and a methodology footnote (hardware, versions, median of 3). | Used-by logos, production quotes, a comparison table vs Node/Deno. | **Steal:** the closing line "Try it on the repo you have open right now." plus the install command again; benchmarks you can reproduce. **Avoid:** benchmarks before saying what the tool is. |
| **biomejs.dev** | "One toolchain for your web project" / "Format, lint, and more in a fraction of a second." | Package-manager tabs, each with a copy button. "Get started" / "View on GitHub". | Before/after formatted code; a lint diagnostic with a code frame and a fix diff; "~35x faster than Prettier" (171k lines, CPU named); a one-line "try it on your project" command. | "97% compatibility with Prettier"; logo grid with "View all users"; contributor avatars; sponsors. | **Steal:** "N% compatible with <incumbent>", and a try-it command right after the demo. |
| **knip.dev** | "Knip" / "Declutter your JavaScript & TypeScript projects". | No install command (weak). | A playground link and a community video. | The heaviest proof in the set: live shields badges (npm version, downloads, stars); "86M downloads/month"; **logos that each link to a GitHub code search proving the org uses Knip**; 350 contributors; a dated list of articles; about 30 real posts from X, Bluesky and GitHub. | **Steal:** verifiable proof (code-search links, live badges). **Avoid:** a hero that is only the name. |
| **turborepo.com** | "Your codebase, faster" / "the build system for coding agents". | `npm i turbo` with a copy button, and a **"For humans / For agents" toggle**. | Mini terminal snippets (`>>> FULL TURBO`, cache hits in ms); three copyable setup blocks. | **A stats row directly under the install command**: compute hours saved, weekly downloads, stars, **"4 Open issues"** (a maintenance flex). The tweet wall uses quantified wins (CI hours saved, CI bill halved). | **Steal:** a numbers row under the install command; open issues as a health signal; the humans/agents toggle. |
| **mise.jdx.dev** | "mise-en-place" / "Dev tools, env vars, and tasks in one CLI". | `curl -fsSL https://mise.run \| sh` with a copy button. "Get started →" / "Watch the demo". | Tabbed config examples under the hero; real terminal output ("✓ installed 2 tools in 6.2s"); a video with text chapters; **a numbered 4-step "first task" walkthrough**; the install command repeated at the end. | No stars or logos. Only "Open source, MIT licensed" and "Releases several times a week". | **Steal:** the first-run walkthrough on the homepage, release cadence as proof, the voice ("Allez. Prep your station."). |
| **astro.build** | "The web framework for content-driven websites". | `npm create astro@latest` with a copy button. A single CTA. | A Core Web Vitals chart from **third-party data** (HTTP Archive). | A logo strip right under the hero, sponsors. | **Steal:** a neutral data source beats a self-run benchmark; the install command repeated in the final CTA. **Avoid:** a 15-card feature wall. |
| **playwright.dev** | "…reliable web automation for testing, scripting, and AI agents." | Three product cards, each with its own command (`npm init playwright@latest`, CLI, `npx @playwright/mcp@latest`). Star button showing "99k+". | Almost none (their best visual, the trace viewer, isn't shown). | Stars in the hero; logo strip at the bottom. | **Steal:** one command per entry point (CLI / CI / agent), live stars on a button. |
| **oxc.rs** | "The JavaScript Oxidation Compiler". | No install command. | Terminal screenshots; parser benchmark bars with the machine named and the source linked; "50~100x faster than ESLint". | "Passes all Test262 stage4 tests" (conformance). | **Steal:** "N× vs the tool you already use"; a conformance claim. **Avoid:** a jargon headline. |
| **vitest.dev** | "Next Generation Testing Framework" / "…It's fast!" | No install command. | One static terminal screenshot. | Sponsors only. | **Avoid:** this is the default VitePress template, with an unproven claim and nothing to copy. Weakest OSS page in the set. |
| **ghostty.org** | No H1: an animated ASCII ghost in a fake terminal, then a one-line tagline. | "Download" / "Documentation". | The animation is product output itself. | None. | **Steal:** one memorable, on-brand animation. Only works with existing hype. |
| **resend.com** | "Email for developers" / "…reach humans instead of spam folders." | "Get started" / "Documentation". | A big tabbed code block (13 languages); **a fake "Send" button that streams realistic HTTP 200 responses**; React Email code beside its rendered email. | Logos under the hero; named founder/CTO testimonials, including a "migrated from SendGrid in 30 minutes" story. | **Steal:** a clickable fake run with real-looking output; a migration-time testimonial. |
| **posthog.com** | "Your product's context layer". | "Get started" / "Install with AI". **"Happier in the terminal? Skip the browser:"** `npx -y @posthog/wizard@latest`. | An animated agent run labelled **"Illustrative demo… sample data"**. | A section literally titled "Social proof" with self-aware copy; "97% of users pay us $0"; a final section called "Shameless CTA". | **Steal:** honest labels on fake demos; self-aware humour; the terminal-user path. |
| **tailwindcss.com** | "Rapidly build modern websites without ever leaving your HTML." | "Get started" + ⌘K search. | **Hero code whose class names animate into the rendered result.** | Sponsors under the hero; "Tailwind in the wild" (real sites). | **Steal:** code → result in one animation. Ours: a terminal run → a magenta/cyan visual diff. |
| **linear.app** | "The product development system for teams and agents". | "Get started" / "Contact sales". | High-fidelity UI shots. | Logos, two quotes, **the changelog on the homepage** (a velocity signal). | **Steal:** a recent changelog shows the project is alive. |
| **docs.astral.sh/ruff** (young-tool playbook) | "An extremely fast Python linter and code formatter, written in Rust." | Install command in the docs. | One benchmark bar chart. | "Drop-in parity with Flake8, isort, and Black"; an explicit list of the tools it replaces; **quotes from maintainers of the tools it replaces**. | **Steal:** "replaces X" plus endorsements from incumbents' maintainers, the strongest proof for a new tool. |

Lost ground: **charm.land** now leads with a paid product, which buries the OSS CLIs, and **zed.dev** and **warp.dev**
moved to abstract company or platform headlines ("The software factory infrastructure platform"). Both show what
happens when the OSS tool stops being the hero.

### 1.3 Patterns that make a developer install now (synthesis)

1. **A copyable install command above the fold, repeated in the final CTA.** bun, biome, astro, mise, turbo and
   posthog do this. Pages without one (vitest, knip, oxc) feel passive.
2. **A "try it on the repo you have open" frame.** bun's closing line, biome's per-feature command and posthog's
   terminal path all do it. Say exactly what `init` writes, and that nothing leaves the machine.
3. **Real output as the demo:** terminal text plus the visual result (tailwind's code→render, resend's fake send).
4. **Verifiable proof a new project can honestly have:**
   - a numbers row under the install command (turbo);
   - live badges (knip);
   - reproducible benchmarks with methodology and a "reproduce" link (bun);
   - "% compatible with / replaces X" (biome, ruff);
   - quotes from maintainers (ruff);
   - release cadence, changelog and open-issue count (mise, linear, turbo).
5. **One command per entry point** (playwright): local, CI and agent.
6. **Honest labels and self-aware copy** (posthog). Name the incumbent (Plausible, Lost Pixel, Argos, ruff).

---

## 2. Tells of an AI-generated landing page (avoid)

**Key sources:**
- **Anthropic, "Improving frontend design through Skills" (2025-11-12)**, https://claude.com/blog/improving-frontend-design-through-skills.
  Unsteered output tends to "Inter fonts, purple gradients on white backgrounds, and minimal animations". The skill
  says to avoid "Overused font families (Inter, Roboto, Arial, system fonts)", "Clichéd color schemes (particularly
  purple gradients on white backgrounds)" and "Predictable layouts and component patterns".
- **Adrian Krebs scored 1,590 Show HN sites on deterministic CSS/DOM checks.** 22% hit 4+ patterns and 32% hit 2–3.
  https://adriankrebs.ch/blog/design-slop/. HN thread (333 points): https://news.ycombinator.com/item?id=47864393.
  Detector: https://github.com/AdrianKrebs/ai-design-checker. **Run it on our page before launch.**
- **Adam Wathan** blamed "making every button in Tailwind UI use `bg-indigo-500`", via secondary sources
  https://news.aibase.com/news/20365 and https://dev.to/alanwest/why-every-ai-built-website-looks-the-same-blame-tailwinds-indigo-500-3h2p.
- Lists of tells: https://www.utsubo.com/blog/built-with-ai-trust-signals-2026,
  https://21st.dev/blog/website-not-look-ai-generated, https://www.mindstudio.ai/blog/avoid-vibecoded-landing-pages,
  https://aismells.pages.dev/index.html, and Wikipedia's https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing.

**Visual tells:**
- **Purple, indigo or violet gradients.** Krebs calls it "VibeCode Purple". One HN commenter's newer warning: "it's not
  the Tailwind purple anymore". Beige or brown is the new default (HN 47864393).
- **Inter for everything**, or the newer slop pairings: Space Grotesk, Instrument Serif, Geist, and **a serif italic
  accent word in a sans hero** (Krebs). Anthropic admits Claude still converges on Space Grotesk. HN also flags the
  "console-ish" mono font Claude defaults to, which matters for a CLI site.
- **Glows, glass and gradients:** "Gradient everything", "Large colored glows", "Glassmorphism" (Krebs). Also blobs
  and plastic 3D illustrations (Utsubo).
- **Always-dark pages** with grey body text, all-caps section labels and borderline contrast (Krebs).
- **A centered hero with a badge pill above the H1** (Krebs), and a headline that "fits anyone" (Utsubo).
- **Identical icon-topped feature cards** in a 3-column grid (Krebs, MindStudio, Alan West).
- **Coloured top or left borders on cards, "1, 2, 3" step rows and stat banner rows** (Krebs). Our "numbers row" and
  "4 steps" ideas from §1.3 sit on this list, so make them real data in a plain layout, not decorated cards.
- **Bento grids:** "Cards are compositional training wheels." (aismells.pages.dev/bento-box-sprawl.html).
- **Emoji as icons or section bullets** (🚀 ✨ 💡), per Krebs, Utsubo and Wikipedia.
- **Fake logos** ("companies who are not customers", 21st.dev), stock team photos, and **fake or inflated
  testimonials** (https://dev.to/ankushminda/are-testimonials-losing-their-value-in-the-ai-world-2d6d).
- **Default shadcn look**, with rounded corners on everything (Krebs lists shadcn/ui as a pattern).
- **Motion with no purpose** (Utsubo).
- **No author, no specifics:** "No numbers, no names, no screenshots of the actual product, no dates." (21st.dev).

**Copy tells:**
- **Buzzwords:** Supercharge, Unlock, Unleash, Empower, Elevate, Seamless, Robust, Cutting-edge, Game-changer. Sources:
  https://microcopyexamples.substack.com/p/avoid-landing-page-words, Utsubo, and
  https://styleguide.dynatrace.com/docs/best-practices/remove-ai-writing-patterns-from-content.
- **Dev-tool clichés:** "Lightning-fast", "Blazing-fast", "Built by developers for developers", "Get started in
  minutes", "Next-gen", "Future-proof" (Evil Martians).
- **"It's not X, it's Y" and "no …, no …, just …".** Wikipedia calls these negative parallelisms. Careful: our natural
  line "No hosted service, no account, no per-snapshot pricing" is exactly that shape. Make each item a concrete fact,
  or split them up.
- **Lists of three** ("fast, reliable, and scalable"), em-dash confetti, bold scattered through prose, openers like "In
  today's fast-paced world".
- **A subhead that restates the headline in softer words** (MindStudio).
- **Caveat:** these patterns predate AI (TailwindUI, shadcn). "Density across multiple tells is the signal." (aismells).

**Flag for our brand.** Ink `#15133C` is a deep indigo, paper `#F4F2FF` is a lavender tint, and the fonts are
Bricolage Grotesque and Atkinson Hyperlegible.
- The palette sits near "VibeCode Purple". Keep magenta and cyan as flat, functional colours (the diff), never as a
  magenta→cyan gradient or glow.
- Avoid always-dark with grey text.
- Bricolage isn't on Krebs's slop list, but don't add a serif-italic accent word.

---

## 3. Competitor positioning

### 3.1 Per tool

| Tool | Headline / pitch (quoted) | Model and price | Status | Real pains (quoted, linked) |
|---|---|---|---|---|
| **Chromatic** | "Ship flawless UIs with less work" (chromatic.com). Snippet: "enforces your UI standards, even when AI codes." | Hosted SaaS; the CLI is MIT. **Free: 5,000 snapshots/mo**, Chrome only, and "Review and testing will be paused" at the limit (https://www.chromatic.com/docs/billing). Starter $179/mo for 35k, overage $0.008. Pro $399/mo for 85k. Snapshots = tests × builds × browsers × modes. TurboSnap bills reused snapshots at 0.2. | Active (CLI v18.15.1, 2026-11-19). | "I am trying to reduce rampant costs" https://github.com/chromaui/chromatic-cli/issues/1203 · "TurboSnap dependency detection does not work well in monorepo" https://github.com/chromaui/chromatic-cli/issues/1149 |
| **Storybook Visual Tests addon** (`@chromatic-com/storybook`) | "Visual testing for Storybook" … "Made by Storybook." https://www.chromatic.com/storybook | Requires a Chromatic account and uses the same billed snapshots (https://storybook.js.org/docs/writing-tests/visual-testing). About 7.9M weekly downloads, probably because `storybook init` adds it (unverified). | Active. | "clicking the `Take snapshot` button fails" (Nx) https://github.com/chromaui/addon-visual-tests/issues/318 · (vendor) "If the service goes down, your merge requests wait." https://dev.to/delta-qa/storybook-visual-testing-without-chromatic-alternatives-for-testing-your-components-visually-3pg5 |
| **Percy** (BrowserStack) | "AI powered Visual Testing…"; "Ditch fragile pixel-to-pixel comparisons and open-source tools." https://www.browserstack.com/percy | Hosted. Free 5,000 screenshots/mo. Desktop $199/mo (annual) for 10k, overage $0.036. Desktop & Mobile $599/mo for 25k. | Active. Has an alpha agent plugin (via AGENTS.md). | "Percy PR checks are always red because of the fonts mismatch" https://github.com/percy/cli/issues/394 |
| **Applitools** | "AI writes code fast. Know it works and looks right." https://applitools.com/ | Hosted, closed. No free tier (trial only). Starter $667/mo (annual); higher tiers via sales. | Active. | (vendor) "The problem isn't the unit price. It's the multiplier." https://bugbug.io/blog/test-automation-tools/applitools-alternatives/ |
| **Argos** | "open-source visual testing for Playwright, Storybook and Vitest" https://argos-ci.com/ | MIT platform, but used as hosted SaaS. Hobby: free, 5,000 screenshots/mo, uploads pause at the limit. Pro $100/mo for 35k; Storybook overage $0.0015. | **The strongest active competitor.** Repo pushed 2026-11-23, 666 stars, 3 open issues. Positions itself as a Chromatic replacement and has an `/ai-agents` page (CLI + MCP + API). | Few real complaints; HN is positive (https://news.ycombinator.com/item?id=34336758). Their founder on Playwright-only setups: "Flaky diffs creep in due to platform and rendering inconsistencies" https://news.ycombinator.com/item?id=43653465 |
| **Lost Pixel** | "Ship frontend changes with confidence"; "an open-source alternative to Percy & Chromatic". | Was OSS plus a hosted platform. | **Sunset.** On 2026-04-22 the team announced it is joining Figma: "We're sunsetting Lost Pixel." (https://lost-pixel.com/blog/lost-pixel-team-is-joining-figma). The repo is archived (confirmed via the GitHub API) and the last release was v3.22.0 (2024-11). It still gets about 33k weekly npm downloads. | "started to fail on CI like 90% of the time" https://github.com/lost-pixel/lost-pixel/issues/429 |
| **Happo** | "See every UI change before your users do." https://happo.io/ | Hosted. Pay-as-you-go $4 per 1k snapshots. Team $199/mo for 66k. Enterprise from $1,499/mo. Free for OSS on request. | The client "is no longer updated" in the open (https://github.com/happo/happo). | "spurious image diffs we're seeing in Chrome on linux" https://github.com/happo/chrome-spurious-repro |
| **Loki** (likely what visual-check replaces) | "Loki makes it easy to test your Storybook project for visual regressions." https://loki.js.org/ | MIT, local, Docker-based. | **Effectively unmaintained.** Last release v0.35.1 on 2024-08-27 (GitHub API). 155 open issues. SB10 (#550) and SB11 (#553) support issues have no maintainer reply, and users ship shims. | "right now it doesnt work with storybook version >= 9" https://github.com/oblador/loki/issues/549 · "it made my tests much slower" https://github.com/oblador/loki/issues/528 · Docker-in-Docker and CI failures: #204, #183, #529 |
| **reg-suit + storycap** | "Visual Regression Testing Suite" https://reg-viz.github.io/reg-suit/ | MIT, self-hosted; baselines in S3/GCS. | storycap's last release was 2024-09, with 98 open issues; SB10 support needed a user fork. Its successor, `@storycap-testrun/browser` (Vitest-based), launched in Sep 2025 and gets about 87k downloads a week. | "Roughly half of the screenshot re showing the "No Preview" screen." https://github.com/reg-viz/storycap/issues/839 |
| **BackstopJS** | "Catch CSS curve balls." | MIT, local, Docker option. | README: "BackstopJS needs a new maintainer/owner." Last release 2024-09. 577 open issues. | "Out of our ~1100 tests, 395 fail." https://github.com/garris/BackstopJS/issues/1156 · Docker in CI vs local: https://github.com/garris/BackstopJS/issues/1298 · arm64: https://github.com/garris/BackstopJS/issues/1300 |
| **Playwright `toHaveScreenshot`** | The docs say to "run tests in the same environment where the baseline screenshots were generated" (https://playwright.dev/docs/test-snapshots). | Free, Apache-2.0. Baselines carry platform suffixes (`-chromium-darwin`). | Active. | "there was always about 10% of our screenshots that failed" https://github.com/microsoft/playwright/issues/13873#issuecomment-1252640479 · "when he updates the snapshots the test succeeds for him, but not for me" https://github.com/microsoft/playwright/issues/20097 |
| **Storybook test-runner + jest-image-snapshot** | "turns all of your stories into executable tests" | Free, DIY. | **test-runner is archived**: "Official support … has ended in Storybook 11" (https://github.com/storybookjs/test-runner). jest-image-snapshot is still active. | "passing locally, but not in CI" https://github.com/americanexpress/jest-image-snapshot/issues/177 · "unless i set the pixel tolerance excessively high" (Intel vs Apple Silicon) https://github.com/americanexpress/jest-image-snapshot/issues/302 |
| **Vitest 4 `toMatchScreenshot`**, and addons built on it (`storybook-addon-vis`, `@storycap-testrun/browser`, `storybook-addon-vrt`) | "Vitest 4 adds support for Visual Regression testing in Browser Mode." https://vitest.dev/blog/vitest-4 | Free. | The new default path for Storybook (the Vitest addon). | Its own docs warn: "even seemingly identical environments can occasionally produce subtle rendering differences" (https://vitest.dev/guide/browser/visual-regression-testing). They recommend Docker or a cloud service. **None of these tools pins the rendering environment.** |

### 3.2 Recurring pains, most frequent first

1. **Pixels differ between laptop and CI.** The causes are OS, CPU architecture, fonts and anti-aliasing. Sources:
   - Playwright #13873, #20097 and #24312;
   - jest-image-snapshot #111, #177 and #302;
   - Percy #394, Happo's spurious-diff repro, the Vitest and Playwright docs;
   - HN: https://news.ycombinator.com/item?id=43532584.

   **This is the core hook.**
2. **Captures fire before the story is ready.** The symptoms are a "No Preview" screen, a loading state or a white
   image (storycap #839, lost-pixel #429, BackstopJS #1156 and #1298, loki #528).
3. **The per-snapshot bill multiplies**: tests × builds × browsers × modes. Free tiers pause at 5k. Sources:
   chromatic-cli #1203, Chromatic's billing docs, and HN https://news.ycombinator.com/item?id=32900677 (Lost Pixel's
   founder: "the prices to visual tests are bonkers").
4. **Tools are abandoned or sunset and break on new Storybooks**: Loki, storycap, BackstopJS, Lost Pixel,
   test-runner, and Happo (client gone private).
5. **Docker pain**: the arm64/amd64 mismatch and Docker-in-Docker in CI.
6. **Hosted lock-in or an account requirement.** The SB addon needs a Chromatic account, and builds pause.
7. **Affected-story detection breaks in monorepos** (TurboSnap #1149). Ours will be judged against it.

**Risk to our "same pixels" claim.** A Playwright maintainer: "It is expected that arm docker image vs intel docker
image produce different screenshots" (https://github.com/microsoft/playwright/issues/13873#issuecomment-1116126196).
visual-check defaults to `linux/amd64` everywhere, so an M-series Mac runs it emulated: it matches CI but is slower
(66 baselines took 64.6 s with stability checks, per `product-facts.md`). Say this plainly. It's a strength, not a
footnote.

---

## 4. The AI-coding angle

### 4.1 Evidence that agents ship UI they can't see

- **Chrome DevTools MCP launch** (https://developer.chrome.com/blog/chrome-devtools-mcp): agents "are not able to see
  what the code they generate actually does", and are "programming with a blindfold on". HN, 604 points:
  https://news.ycombinator.com/item?id=47390817.
- **Show HN: ProofShot, "Give AI coding agents eyes"** (161 points, https://news.ycombinator.com/item?id=47499672):
  - "AI agent understands nothing of the UI."
  - "The DOM can be structurally perfect and still look nothing like what was intended."
  - "I am fed up of getting gaslit by coding assistants."
- **Claude Code best practices** (https://code.claude.com/docs/en/best-practices). Without checks, "that makes you the
  test suite". The advice: "Give Claude something it can run that comes back pass or fail." A browser screenshot is in
  the list of checks.
- **Augment** (https://www.augmentcode.com/guides/visual-regression-testing-ai-generated-uis): "Functional tests,
  linter, and type checks all pass." Text-based gates miss rendered output.
- **Argos** blog posts on agents and visual testing (search snippets only, the pages 404'd): an agent's edit to shared
  CSS or tokens breaks pages it never touched.
- **Storybook's AI page** (https://storybook.js.org/ai): "Test output is fed back to agents automatically." Its MCP
  addon runs component and a11y tests (https://storybook.js.org/blog/storybook-mcp-for-react/). Visual testing there
  only links out to paid Chromatic. **That gap is ours.**
- **Stats.** None of these measures visual regressions specifically.
  - DORA 2025: "90%" use AI at work; AI adoption "continue[s] to have a negative relationship with software delivery
    stability"; "30%" have little or no trust in AI code
    (https://cloud.google.com/blog/products/ai-machine-learning/announcing-the-2025-dora-report).
  - Stack Overflow 2025: trust in AI accuracy fell to 29%. The top frustration (45%) is solutions "almost right, but
    not quite"
    (https://stackoverflow.blog/2025/07/29/developers-remain-willing-but-reluctant-to-use-ai-the-2025-developer-survey-results-are-here).
  - METR: experienced developers were 19% slower but believed they were faster
    (https://metr.org/blog/2025-07-10-early-2025-ai-experienced-os-dev-study/).

### 4.2 How dev tools market to agents now

- **The Agent Skills open standard** (https://agentskills.io) was donated to the Agentic AI Foundation
  (https://www.anthropic.com/news/donating-agent-skills-to-the-agentic-ai-foundation).
- **Vercel's `npx skills add`** lists 17 agents (https://vercel.com/blog/introducing-skills).
- **Resend `/agents`** (https://resend.com/agents): "Email for agents"; per-agent install tabs (Claude Code, Cursor,
  Copilot…), llms.txt, a hosted MCP server and skills.
- **Stripe** (https://docs.stripe.com/building-with-ai): one `stripe agent setup` command bundles MCP and skills, plus
  llms.txt and a `.md` version of every docs page.
- **Supabase skills**, with an honest warning: "We strongly discourage connecting the Supabase MCP server to your
  production database." (https://supabase.com/blog/supabase-agent-skills). Candour builds trust.
- **Storybook** (`npx storybook add @storybook/addon-mcp` with a copy button), **shadcn**
  (`npx shadcn@latest mcp init --client claude`), **Better Auth**'s "AI Resources" page, **Neon**'s Agent Skills docs,
  **AGENTS.md** (https://agents.md/), and the Mintlify docs menu ("Copy page / Open in Claude").
- **Competitors are already here:** Argos `/ai-agents` (CLI + MCP + API) and Percy's alpha agent plugin
  (https://www.browserstack.com/docs/percy/ai-agents/visual-testing-plugin).
- **The common pattern:** install tabs per agent, one command that sets the agent up, llms.txt and `.md` docs, and a
  humans/agents toggle (turborepo).

### 4.3 Wording that resonates vs hype

- **The "AI" label alone hurts.** WSU (2024): "products described as using artificial intelligence were less
  popular" (https://www.sciencedaily.com/releases/2024/07/240730134844.htm).
  - HN backlash: "I'm drowning in AI features I never asked for"
    (https://decrypt.co/346170/ai-backlash-sophisticated-users-getting-sick-techs-latest-obsession).
  - Mockery: "Uber but for AI-powered false advertising" (https://news.ycombinator.com/item?id=50457640).
- **CLI + skill beats MCP with HN readers.** This matches what visual-check ships.
  - "Yes. CLI. Always CLI. Never MCP. Ever." and "Use agent skills. And say goodbye to MCP." (HN 47390817).
  - Mario Zechner measured Playwright MCP at 13.7k tokens of schema
    (https://mariozechner.at/posts/2025-11-02-what-if-you-dont-need-mcp/).
  - Playwright's own docs: concise CLI output "avoids loading large tool schemas"
    (https://playwright.dev/agent-cli/introduction).
  - Simon Willison: "Skills are Markdown with a tiny bit of YAML metadata"
    (https://simonwillison.net/2025/Oct/16/claude-skills/).
- **What lands:** naming the mechanism and the failure ("blindfold", "you are the test suite", "fed back to agents
  automatically", Resend's "built for humans filling out forms").
- **What reads as hype:** "AI-powered", "agentic", "10x your team", "AI-native", "autonomous QA".
- **Suggested register:** "Your agent changed the CSS. Did the button move?" → "It runs `visual-check test`, reads
  the JSON report and tells you which stories changed, with the visual diffs." Say it's a plain skill file (Markdown +
  a script) and that it **never writes baselines**: approving a change stays with a person (`update` is local and
  run by a human). That pre-empts the "agent rubber-stamps its own diff" worry.

---

## 5. Recommendations for visual-check

### 5.1 Candidate hooks, ranked

| Rank | Hook (draft wording, to edit) | Why it should work |
|---|---|---|
| 1 | **"The same pixels on your laptop and in CI."** A pinned Chromium image (by digest), `linux/amd64` everywhere by default. | Pain #1 in every source (§3.2), and Playwright, Vitest and Percy users hit it daily. The Vitest docs themselves recommend Docker. No OSS Storybook tool pins the environment (§3.1, the Vitest-based tools). Back it with a public CI run on Linux plus Windows/Docker Desktop. |
| 2 | **"Free. No account. No snapshot quota."** It runs on CI minutes you already pay for, and baselines are PNGs in your repo. | Chromatic, Percy and Argos all pause at 5k a month, and Chromatic overage is $0.008/snapshot × builds × modes (§3.1). "rampant costs" (chromatic-cli #1203). Plausible and PostHog say to name the incumbent: "Free alternative to Chromatic". Avoid the bare "no lock-in" cliché (Evil Martians) and state the mechanism. |
| 3 | **"Your coding agent can't see the UI. This lets it check."** `init` writes an agent skill: the agent runs `visual-check test` and reports which stories changed, with diffs. A person approves. | Chrome's "blindfold" (604-point HN thread); Claude Code docs say to give agents a pass/fail check; Storybook's AI page leaves visual testing to paid Chromatic; HN prefers CLI + skill to MCP (§4.3). Keep it to section 2 or 3, not the H1, so it doesn't read as AI-hype (WSU study). |
| 4 | **Real terminal output as the hero**: `init` → `test` (`108 passed · 10.8s`) → a failing story with the magenta/cyan diff. | Evil Martians puts code as the hero for tools without UI; bun, mise and turbo show output; tailwind animates code → result. The diff in logo colours is the "memorable product output" that ghostty's ghost is for them. |
| 5 | **"Only the stories your change can reach."** Affected stories through a dependency graph, plus sharding. | Speed and cost (TurboSnap is Chromatic's paid answer). Back it with real numbers: 108 snapshots in 10.8 s, 76 in 9.1 s, a 36-snapshot shard in 5.6 s (`product-facts.md`, public CI). Expect scepticism from monorepo users (TurboSnap #1149): show `--base` and the "None of the 3 changed files affects a story" message. |
| 6 | **"Waits for the story to be ready."** Broken-story detection, flaky snapshots retried and labelled. | Pain #2 (white or "No Preview" captures). Show a real `! broken` line with its hint ("Await the new page before clicking"): honest, specific output. |
| 7 | **"Coming from Loki, Lost Pixel or the test-runner?"** Migration pages. | Loki has had no release since Aug 2024 and breaks on SB9+ (#549). Lost Pixel is sunset (2026-04-22) but still gets about 33k weekly downloads. test-runner support ended in SB11. Supported: Storybook 9.1, 10 and 11. This is the ruff/biome "replaces X" play. |
| 8 | **"Check the story you're looking at."** The Storybook addon: Check / Update inside `storybook dev`, with a before/after slider. | A fast local feedback loop; it's the visible counterpart to Chromatic's addon, without the account. **SB10 only** (`product-facts.md`), so label it that way. |
| 9 | **A verifiable numbers row under the install command** (turbo, knip): Storybook versions tested, snapshots/s in public CI, open issues, MIT, plus a link to the test-apps CI log. | Social proof for a new project must be verifiable (knip's code-search links, bun's "reproduce"). Never invent logos or quotes (§2). |
| 10 | **Origin story**: it replaces a ~2,000-line Playwright harness and Loki in a real codebase. | Lee Robinson: teach how it's built. Ruff-style "built by someone who had this problem". Publish the 4:45 → X comparison **only after #97 lands**. |
| 11 | **Grid stories**: one snapshot for every prop combination and forced state (hover, focus). | It cuts snapshot count, a direct answer to per-snapshot pricing. **Not implemented yet. Hold it.** |
| 12 | **"One config file. Three commands."** (`init`, `update`, `test`) | Small surface reassures; it echoes mise's 4-step first run. Low emotional pull, so use it in "How it works", not the hero. |

**Hero draft direction**, not final copy:
- H1 about the outcome: *Visual tests for Storybook that pass on your laptop and in CI.*
- Subhead naming mechanism and price: *Chromium in a pinned Docker image, only the stories your change reaches, free
  and open source with no account.*
- Copyable command: `pnpm dlx @visual-check/cli init`.
- Secondary link: "See a real CI run". No badge pill, no gradient.

### 5.2 Objections before installing, and how to pre-empt each

| Objection | Pre-empt with (FAQ, comparison row or inline note) |
|---|---|
| **"Do I need Docker?"** | Yes by default; that's how the pixels match. `host` mode exists for no-Docker setups, at the cost of cross-machine identity. Windows works through Docker Desktop (public CI: 108 snapshots in 16.9 s). |
| **"I'm on an M-series Mac."** | amd64 is the default on purpose, so your baselines match CI. It runs emulated, so local runs are slower; give the real figure. `linux/arm64` is opt-in if the whole team and CI are arm. Cite Playwright's arm-vs-intel warning to show we know the trap. |
| **"Will it be flaky?"** | Pinned browser and fonts, readiness waits, a retry that labels flaky snapshots, broken-story hints, and a tolerance that counts anti-aliased pixels. Show real output lines rather than claims. |
| **"Is it slow?"** | Public CI numbers (≈10 snapshots/s on a 4-vCPU runner), affected stories, `--shard k/n`. State the fixed cost too: a fresh runner takes about 8 s to pull and start the browser. |
| **"Another bill or vendor?"** | No service: it runs on your existing CI minutes. The only cost is CI time; sharding trades time for runners. |
| **"Lock-in?"** | MIT; baselines are plain PNGs under `.visual-check/baselines/`; the report is JSON. To leave, delete the config and the folder. Say it mechanically, not as "no lock-in" (a cliché). |
| **"Where's the review UI and approvals?"** | Own it (Lee Robinson): there's no hosted review app. You review visual diffs in the report and addon, a person runs `update`, and the PNG changes show up in the PR. Add a comparison-table row: "Need hosted review, cross-browser or comments? Chromatic, Argos and Percy do that." Honesty earns trust (PostHog). |
| **"Only Chromium?"** | Yes, by design (identical pixels beat breadth). Point to hosted tools for Firefox/WebKit. |
| **"Will it be abandoned like Loki?"** | MIT, a public repo with issues and a changelog, Storybook 9.1, 10 and 11 tested in public test apps, and a small surface (3 commands). Show release cadence and open issues (mise, turbo, linear). |
| **"Will it work in my monorepo?"** | `init` detects pnpm, npm, Yarn and Bun workspaces, Nx, Lerna and Rush, and multiple Storybooks (the dnd-kit test app has 5 Storybooks across 5 frameworks). Show the `init` transcript. |
| **"Does the agent approve its own changes?"** | No. The skill runs `test` and reports; `update` is a person's call, run locally. |
| **"Baselines bloat my repo?"** | Unknown. We need a real number (average PNG size × stories). See §5.5. |

### 5.3 Page structure that follows from this

1. Hero: H1, subhead, copyable `init` command, secondary "See a real CI run".
2. Real terminal demo: `test` output, a failing story, the visual diff. Use real CI text and label anything synthetic
   (posthog).
3. Numbers row (verifiable, with links).
4. Three problem→mechanism sections: same pixels, only affected stories, no bill.
5. "For coding agents" section with the skill and the person-approves flow. Mention llms.txt and `.md` docs if the
   docs site has them.
6. Addon (SB10).
7. "Coming from…" (Loki, Lost Pixel, test-runner, Playwright screenshots).
8. Honest comparison table: Chromatic, Argos, Percy, Playwright `toHaveScreenshot`, Loki. Include rows we lose.
9. FAQ (§5.2).
10. Final CTA repeating the command: "Run it on the Storybook you have open."

Use the glossary in `product-facts.md` §9 (snapshot, baseline, visual diff, affected stories).

### 5.4 Claims not to make yet (from `product-facts.md`)

- **Not on npm**: every package is 0.0.0. Don't show download badges, and the install command only works after the
  first release.
- **The browser image isn't published** (placeholder digest).
- **Grid stories aren't implemented.**
- **"Beats 4:45" is unmeasured** (#97).
- **The addon is SB10 only.**
- **No stars, users or quotes yet.** Proof has to be reproducible numbers and public CI, plus migration pages.
- **Run AdrianKrebs/ai-design-checker** on the finished page.

### 5.5 Unresolved questions

- Baseline repo size per 100 stories, needed to answer "bloat". Is Git LFS recommended?
- Local-run time on Apple Silicon with amd64 emulation, for honest FAQ numbers.
- Will the docs site ship llms.txt and `.md` pages? The agent section should link them if so.
- Can we get one quote from a maintainer of a public test-app repo (react-inspector, dnd-kit, freecodecamp-ui)? That's
  the ruff-style proof.
- Should "free alternative to Chromatic" be in the H1 or the subhead? Plausible-style naming works, but Argos already
  owns "open-source alternative to Chromatic and Percy". Differentiate on "no service at all".
