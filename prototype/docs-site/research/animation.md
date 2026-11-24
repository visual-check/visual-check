# Animated product demos for the landing page

Research for the question "can we animate SVGs for that?" (the CLI run, the addon GUI, a CI run, an agent using visual-check). Sites inspected live on 2026-11-23 in a real browser (DOM, `document.getAnimations()`, Resource Timing).

## TL;DR

- **Mostly no SVG for the four product demos.** Build them as **HTML+CSS scenes driven by a tiny framework-free timeline** (~60 lines, no library). Text stays real and selectable, the scenes follow `[data-theme]` tokens instantly, they're crisp at any zoom, and the server-rendered end frame paints at LCP speed. This is what Warp, Linear, Raycast, Railway, Bun, Ghostty and PostHog do today. None of the 13 sites inspected uses SMIL, Lottie or Rive for product demos.
- **Generate scene scripts from real CLI output in CI** (`--reporter log` / `--reporter json` against a `test-storybooks` fixture). Commit them, and fail on drift so the demos can't lie.
- **Play policy: play once when ≥50% in view, never loop, settle on the end frame, always show Pause/Replay, and never autoplay under `prefers-reduced-motion`.** This needs a one-line amendment to the motion rule, or a single prop flip to run click-to-play instead.
- **Animated SVG still has a role:** brand/explainer motifs (the cyan/magenta plates registering into a diff), and READMEs, npm and the Marketplace, where JS can't run. Keep these to CSS keyframes, short (<5 s) and play-once.
- **Video (VHS / Screen Studio)** belongs only in a secondary, click-to-play "watch the full run" slot, plus README GIFs. **asciinema-player** fits the docs, not the hero.

## 1. Options compared

| | (a) Animated SVG | (b) DOM scene + JS timeline | (c) Recorded video | (d) Lottie / dotLottie / Rive | (e) asciinema-player |
|---|---|---|---|---|---|
| Fidelity | Terminal OK (`<text>` glyphs). GUI must be redrawn by hand, and real screenshots only fit as base64 raster | Real design-system CSS and tokens, real snapshot PNGs, real (interactive) slider | Highest: real pixels | Motion graphics, not real UI | Exact recorded terminal session |
| Size | svg-term example ≈80 KB raw for 6 s / 93 frames (compresses well) | ~2 KB JS shared + 1–3 KB JSON per scene + images | GIF 3.7 MB vs MP4 551 KB vs WebM 341 KB (web.dev). charm.land's `vhs.webm` is 3.7 MB | Rive runtime 222–648 KB brotli (WASM), dotLottie WASM, plus the file | player JS 73 KB gz + CSS 6 KB + cast (12 KB gz) |
| Crispness | Vector | Native text | Raster: blurs on zoom or non-integer DPR | Vector on canvas | Native text |
| Theme-aware | `<img>`: **no page CSS vars**, and `prefers-color-scheme` inside follows OS/browser, not our `[data-theme]` toggle. Inline: yes | Yes: plain `var(--code-bg)` etc. | Baked in. `<source media="(prefers-color-scheme: dark)">` follows OS only | dotLottie `setTheme`/slots, Rive data binding, all via JS glue | Yes: themes are CSS classes using `--term-color-*` custom props, so they can be mapped to tokens |
| Text / SR | `<img alt>` only, not selectable | Real text, plus a transcript | None (captions via `<track>`) | Canvas: none | Real DOM text (`pre.ap-terminal` spans) |
| WCAG 2.2.2 / reduced motion | `<img>` has no JS and no interaction, so it **can't be paused**: a loop >5 s fails. CSS anims can be gated by `@media` inside, **SMIL can't** | Pause/Replay button. `matchMedia` gives the end frame | Native controls. Autoplay needs JS gating | Player API pause. JS gating | Control bar, `pauseOnMarkers`. JS gating |
| Perf / LCP | Cheap if small. Frame-strip output is a big DOM if inlined | SSR text paints immediately. rAF only while playing | `<video>` without a poster isn't an LCP candidate. Decode cost | WASM download + compile + canvas | Client-only: nothing to paint until JS runs |
| Stays honest? | svg-term regenerates from a `.cast` file. termtosvg archived (2020). svg-term has no releases (2017-era) | **Generated from a real transcript** in CI | VHS tapes re-render in CI, and `Output x.txt/.ascii` gives golden files. Screen Studio is manual, so it goes stale | Designer-authored. Can't be generated from CLI output | Re-record the cast headless in CI |
| Next.js fit | Plain `<img>` (next/image doesn't optimize SVG) or inline/SVGR | Server Component + tiny client island | Plain `<video>`. CDN/HLS for long clips | `@lottiefiles/dotlottie-react`, `@rive-app/react-*`, client-only | Client component, dynamic import |

Notes:
- **(a)** svg-term-cli animates a horizontal strip of frames with one CSS `@keyframes` (`steps`, `translateX`, `infinite`), using `<symbol>`/`<use>` + `<text>` (inspected `examples/parrot.svg`). SVG in `<img>`/CSS `background` runs in *secure animated mode*: SMIL and CSS animations run, but scripts are off, user input has no effect, and external resources aren't loaded (so fonts must be inlined).
- **(b)** Libraries are optional. The Web Animations API (`el.animate()`, `getAnimations()`, `currentTime`) covers property tweens. Typing text isn't an animatable property, so a ~60-line clock is simpler than any library. If one is wanted later: Motion `animate()` mini is 3.2 KB (WAAPI) and hybrid is 22 KB (adds `sequence` timelines with `at`, plus pause/play/time/speed). GSAP has been free including all plugins since 3.13 (30 Apr 2025), but it's overkill here.
- **(c)** Playwright `recordVideo` defaults to the viewport scaled to fit 800×800. Fine for e2e, too soft for marketing. AV1 is ~96% supported, but Safari's support is only partial (hardware decode), so ship AV1/WebM plus an H.264 fallback. The `media` attribute on `<video><source>` is back (Safari, Firefox 120+, Chrome) for dark or reduced-motion variants, but it's chosen at load time and follows the OS.
- **(d)** Good for illustrative loops. Wrong tool for "show the real product": it can't be generated from our output, its text is canvas, and it costs a 200–650 KB runtime.
- **(e)** Supports `poster: "npt:0:05"` or `data:text/plain,…`, `markers` + `pauseOnMarkers` (chapters), and `idleTimeLimit`. Map the theme with `.asciinema-player-theme-vc { --term-color-background: var(--code-bg); … }`. Generic terminal look, JS before first paint.

## 2. How dev-tool sites actually do it (inspected 2026-11-23)

| Site | Technique observed | Play policy / controls |
|---|---|---|
| warp.dev | 4 `.w-product-demo` blocks: lazily mounted React "lite" app windows (Agent CLI, computer use, factory dashboard) with real text and CSS keyframes (`warp-lite-story-reveal`). Mocks are `inert` + `aria-hidden`. Hero is a live grid of Unicode glyphs in the DOM. 0 `<video>` | Plays on view. **"Restart animation"** button |
| linear.app | `aria-hidden` DOM "stages" (roadmap timeline, agent chat) + CSS keyframes (25 `grid-dot-*` anims). 231 inline SVGs, 0 video, 0 SMIL | Plays on its own |
| raycast.com | DOM-recreated app windows (`aria-hidden`), CSS-module keyframes (`blink` cursor, `slideIn`, `progress`). One WebGL canvas in the hero | Plays on view |
| railway.com | `aria-hidden` DOM dashboard mock + split-flap board. CSS keyframes (`scrollable-train`, `pulse-station`) | Plays on its own |
| bun.sh | Terminal demos are real `<pre class="tl-term">` text. Benchmark race is pure CSS keyframes. Testimonial videos sit behind facades | **"Replay this benchmark in real time"**. Videos are **click-to-play** |
| ghostty.org | Next.js. Hero ASCII ghost = text frames in `<code>`/`<span>` lines swapped by a rAF class. **JS checks `prefers-reduced-motion: reduce` and never starts** | Loops. No pause button |
| posthog.com | DOM carousel + DOM AI demo. Themed illustrations shipped as **light/dark PNG pairs** | **"Pause carousel"** + progress bar |
| resend.com | Hero 3D = Spline WebGL (`cube.splinecode`, 455 KB), with `cube.mp4` + poster for <1024 px via `<source media>`. Feature icons are small `<video preload="none" poster>`. Code is real `<pre>` | Videos load on demand |
| zed.dev | Poster `<img>` + "Play video", which then loads Cloudflare Stream HLS with native controls + audio. Hero CSS keyframes (`hero-drop`, cursor `blink`) | **Click-to-play** |
| charm.land (charm.sh) | 14 VHS-made WebM `<video autoplay loop muted>`, no poster: `vhs.webm` 3.7 MB, `hypercity-4k.webm` 4.7 MB | Autoplay loop, no pause UI |
| vercel.com | Inline SVG illustrations + one canvas. No video, no SMIL | Mostly static |
| tailwindcss.com | Real code blocks + live HTML components | Static (one `ping`) |
| turborepo.dev (turbo.build) | `<pre>` code + inline SVG | Static |

Patterns:
1. **Product UI is recreated in the DOM, not filmed.** 7/13 sites do this (Warp, Linear, Raycast, Railway, Bun, Ghostty, PostHog). The mocks are `aria-hidden`/`inert`, and their text is real.
2. **Video is reserved for people and 3D** (Zed, Bun testimonials, Resend icons). Video is click-to-play or `preload="none"` + poster. Only Charm, whose product *is* terminal recordings (VHS), autoplays loops.
3. **Controls appear when the story is long:** Restart (Warp), Replay (Bun), Pause (PostHog).
4. **0 SMIL elements, 0 Lottie/dotLottie players and 0 Rive canvases** across all 13 home pages.

## 3. Recommendation for visual-check

| Demo | Technique | Source of truth | Ends on |
|---|---|---|---|
| CLI run (hero) | DOM terminal scene on `--code-bg`, `--code-cyan` prompt, `--code-magenta` changed count | `visual-check test --reporter log` on `test-storybooks/storybook-10-react` with a seeded change | `248 passed · 1 differs · 3m 12s` + "changed" badge |
| Addon panel | DOM recreation of the Storybook panel (Check / Update), real baseline + snapshot PNGs. The before/after slider sweeps once, then is a **real `<input type="range">`** the visitor can drag | the same run's report folder | interactive slider |
| CI run | DOM PR-checks list → `visual-check` check goes pending → failing, then the step-summary table + report artifact card | `--reporter json` + `step-summary` output | the summary card |
| Agent | DOM chat/terminal: prompt → tool call `visual-check test` → short report naming the changed story, with a thumbnail. Neutral agent chrome (no third-party branding) | a real headless agent run's JSON transcript, trimmed to ~6 turns (tool calls kept verbatim) | the agent's summary |
| README / npm / Marketplace | VHS GIF of the CLI (or the §4 SVG motif) | the same `.tape` | n/a |
| Optional "Watch the 60 s walkthrough" | Screen Studio or VHS MP4/WebM, poster, `controls`, captions, `preload="none"` | manual, re-cut per major | n/a |

**Play policy.** Each scene plays **once** when ≥50% visible, takes ≤8 s, settles on the end frame and never loops. It pauses off-screen and resumes on return. Scroll-scrubbing is rejected: it ties reading pace to scroll speed, and WCAG counts "scrolled into view" as starting automatically anyway. Auto-advancing a 4-demo carousel is rejected too: if the demos are grouped as tabs, the tabs are chapters the user picks. Without chapter dots inside a scene, each one stays short.

**Motion rule.** "Nothing animates on its own" forbids play-on-view. Proposed amendment: *"Product demos may play once when scrolled into view. They never loop, end on a still frame, always show Pause/Replay, and don't start under reduced motion."* If the owner keeps the strict rule, pass `autoplay: false`. The SSR end frame shows with a **Play** button, and the code is otherwise identical. Scene state changes (badge pops, slider handle) use CSS transitions with `--ease-spring` / `--duration-spring`, so they match the hover springs.

**Controls.** One always-visible button in the frame's top-right (Pause / Play / Replay), not hover-only, with the standard `--focus` ring. It's required, because the scenes run >5 s and start automatically (WCAG 2.2.2, Level A).

**Reduced motion.** Don't autoplay. Render the end frame (it's the SSR default) and show "Replay", since a user-initiated replay is fine. CSS transitions inside the scene go to `none`.

**Accessibility markup.** Use `<figure>` → stage `aria-hidden="true"`, so screen readers don't hear half-typed text. Fake controls inside are `<span>`s, not buttons, so nothing focusable is hidden. Then the real toggle `<button>`, and a `<figcaption>` with one sentence ("visual-check finds 1 changed story out of 249") plus `<details><summary>Transcript</summary><pre>` holding the full real output. Don't use `inert` on the stage: it can block text selection.

**Theme.** Scenes only use tokens (`--code-*`, `--change-*`, `--info-*`, `--bg-raised`), so the `[data-theme]` toggle restyles them live. Never put demo content in `<img>` SVG or in video: neither can see the toggle.

**Next.js.** The Server Component renders the end frame **from the same scene JSON** (it applies all steps at build time), so the static frame can't drift from the animation. A client island calls `mountScene(ref.current, steps)` in `useEffect`. To avoid an end→start flash above the fold, a `<head>` inline script sets `html[data-motion="ok"]` when motion is allowed, and CSS hides `[data-fill]` until `[data-playback]` is set.

### Keeping demos honest (CI)

1. A `site/scripts/record-demos.ts` job runs on release tags and weekly, against a pinned fixture branch (one deliberate change, e.g. `Card` padding 16→24).
2. It runs `visual-check test --reporter log` with each stdout line timestamped, or with `asciinema rec --headless -c …` to get a `.cast`. Use `log`, not `live`: it's line-oriented and is exactly what CI prints.
3. It runs `visual-check test --reporter json`. Counts, story ids, durations and image paths feed the addon, CI and agent scenes. The baseline / snapshot / diff PNGs are copied into `public/demos/`.
4. A converter strips ANSI codes to `tone`s, caps idle gaps at 600 ms (like asciinema `idleTimeLimit`) and caps the total at ~8 s, then writes `scenes/*.json` with a `source` field (CLI version, date). A caption shows "Recorded with visual-check 1.4.0".
5. `git diff --exit-code site/scenes` fails the job, and a bot opens a PR with the new scenes. Output changes become reviewed diffs.
6. Dogfood: put the scenes' start and end frames in the site's Storybook, and let visual-check snapshot them.

### Scene timeline sketch (framework-free, 58 lines, tested in Chromium)

Scene JSON (generated): `[{ "at": 0, "part": "cmd", "type": "type", "text": "npx visual-check test" }, { "at": 900, "part": "out", "type": "line", "text": "✗ web  card--wide  differs", "tone": "change" }, { "at": 1800, "part": "badge", "type": "state", "value": "changed" }]`. Markup: `<figure data-autoplay><div data-stage aria-hidden="true">…<span data-part="cmd" data-fill>…</span><div data-part="out" data-fill>…</div><span data-part="badge" data-state="changed" data-from="running"></span></div><button data-playback-toggle>Replay</button><figcaption>…</figcaption></figure>`.

```js
// The server renders the END frame (real text, themed by tokens); this only animates towards it.
// steps come from scenes/*.json, generated in CI from a real `visual-check --reporter log` run.
export function mountScene(root, steps, { typeMs = 32, autoplay = true } = {}) {
  const stage = root.querySelector('[data-stage]')
  const button = root.querySelector('[data-playback-toggle]')
  const endFrame = stage.innerHTML
  const part = (name) => stage.querySelector(`[data-part="${name}"]`)
  const total = Math.max(...steps.map((s) => s.at + (s.type === 'type' ? s.text.length * typeMs : 0)))
  let t = 0, next = 0, last = 0, frame = 0, typing = [], userPaused = false

  function reset() { // start frame = end frame with scripted parts emptied / set back
    stage.innerHTML = endFrame
    for (const el of stage.querySelectorAll('[data-part]')) {
      if ('fill' in el.dataset) el.replaceChildren()
      if ('from' in el.dataset) el.dataset.state = el.dataset.from
    }
    t = 0; next = 0; typing = []
  }
  function apply(step) {
    const el = part(step.part)
    if (step.type === 'state') el.dataset.state = step.value
    if (step.type === 'type') typing.push(step)
    if (step.type === 'line') {
      const line = document.createElement('div')
      line.textContent = step.text
      if (step.tone) line.dataset.tone = step.tone
      el.append(line)
    }
  }
  function tick(now) {
    t += Math.min(now - last, 64); last = now // clamp: a throttled tab never skips the story
    while (next < steps.length && steps[next].at <= t) apply(steps[next++])
    typing = typing.filter((s) => {
      const n = Math.min(s.text.length, Math.floor((t - s.at) / typeMs))
      part(s.part).textContent = s.text.slice(0, n)
      return n < s.text.length
    })
    if (t >= total) return pause('ended') // play once, settle on the end frame, never loop
    frame = requestAnimationFrame(tick)
  }
  function play() {
    if (root.dataset.playback === 'ended') reset()
    last = performance.now(); frame = requestAnimationFrame(tick); show('playing')
  }
  function pause(state = 'paused') { cancelAnimationFrame(frame); frame = 0; show(state) }
  function show(state) {
    root.dataset.playback = state
    button.textContent = { playing: 'Pause', paused: 'Play', ended: 'Replay' }[state]
  }

  button.addEventListener('click', () => { userPaused = frame !== 0; frame ? pause() : play() })
  if (!autoplay || matchMedia('(prefers-reduced-motion: reduce)').matches) return show('ended')
  reset(); show('paused')
  new IntersectionObserver(([entry]) => {
    if (entry.isIntersecting && !frame && !userPaused && root.dataset.playback === 'paused') play()
    if (!entry.isIntersecting && frame) pause() // off-screen: no CPU; resumes when back in view
  }, { threshold: 0.5 }).observe(root)
}
```

Verified behaviour: it autoplays on intersection and types character by character. Pause holds, Play resumes, and the end frame's HTML is byte-identical to the SSR frame. Replay restarts, and `autoplay: false` (the same branch as reduced motion) keeps the end frame and shows "Replay". Style `[data-tone="change"]` with `--code-magenta`, and `[data-state]` transitions with the spring tokens.

## 4. Animated SVG specifically

**What's possible**
- **SMIL.** `<animate>` interpolates attributes (`x`, `width`, `d`, `fill`). `<set>` does discrete flips, which suits state changes like a badge appearing at 2 s. `<animateTransform>` and `<animateMotion>` move things. Chains need no JS: `begin="wipe.end+0.2s"` and `fill="freeze"` holds the end state.
- **CSS `@keyframes` in an inner `<style>`.** Animates `transform`, `opacity`, `clip-path`, `stroke-dashoffset`. With `animation-fill-mode: backwards`, the static styles *are* the end frame.
- **Reveals.** Draw on with `pathLength="100"` + `stroke-dasharray: 100` + `stroke-dashoffset` 100→0. Wipe with `clip-path: inset(0 100% 0 0)` → `inset(0)`, which is the before/after slider without JS.
- **`mix-blend-mode: multiply`.** The brand's off-register plates become a literal diff overlay. Identical pixels overprint to ink, and changed ones split into cyan (baseline) and magenta (snapshot). On dark grounds use `screen` on ink, which gives a light overlap like the dark logo.
- **Inline only (JS available).** `svg.pauseAnimations()`, `setCurrentTime()`, `beginElement()` with `begin="indefinite"` (start on IntersectionObserver), and `getAnimations()` for CSS anims.

**Limits**
- As `<img>`/CSS background, there's no JS, no input and no external fonts. It **can't be paused** (so a loop >5 s fails WCAG 2.2.2) and can't start on view: it starts at image load, and `loading="lazy"` only approximates. It can't read page CSS variables, and its `prefers-color-scheme` follows the OS/browser, not `[data-theme]` (WebKit also ignores the page's `color-scheme`).
- **SMIL ignores `prefers-reduced-motion`.** Only CSS animations can be gated by `@media`, and in `<img>` there's no JS fallback. Use CSS keyframes for anything users see.
- `<text>` doesn't reflow (bad on phones), isn't selectable in `<img>`, and falls back to system fonts. Real screenshots must be embedded as base64, which bloats the file and blurs. Percent-based keyframe timelines are hard to edit and can't seek.
- **Use for:** the hero motif or "how it works" diagram, and the README/npm/Marketplace. **Not for:** the four product demos.

**Example: baseline vs snapshot diff reveal** (30 lines, tested in Chromium both as `<img>` and inline). The snapshot plate slides into register, wipes in left→right, and overprints the baseline. Only the moved button stays split cyan/magenta, then the outline draws and "1 differs" fades in. It plays once in ~2.4 s (under the 5 s threshold). With reduced motion, the end frame shows immediately.

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 180" width="320" height="180" role="img" aria-labelledby="t">
  <title id="t">Baseline (cyan) and snapshot (magenta) overprinted: the button moved 12px, flagged "1 differs"</title>
  <style>
    .snap { mix-blend-mode: multiply; clip-path: inset(0);
            animation: register .5s cubic-bezier(.2,0,0,1) backwards,
                       wipe 1.1s .5s cubic-bezier(.22,1,.36,1) backwards }
    .hit  { fill: none; stroke: #15133c; stroke-width: 2; stroke-dasharray: 100; stroke-dashoffset: 0;
            animation: draw .6s 1.6s ease-out backwards }
    .tag  { font: 600 13px ui-monospace, Menlo, monospace; fill: #15133c; animation: fade .3s 2.1s backwards }
    @keyframes register { from { transform: translate(6px, 6px) } }  /* off-register → in register */
    @keyframes wipe     { from { clip-path: inset(0 100% 0 0) } }    /* before/after wipe, left → right */
    @keyframes draw     { from { stroke-dashoffset: 100 } }          /* outline draws itself */
    @keyframes fade     { from { opacity: 0 } }
    /* Static styles above ARE the end frame; animations only run *from* a start state (fill: backwards). */
    @media (prefers-reduced-motion: reduce) { * { animation: none !important } }
  </style>
  <rect width="320" height="180" rx="10" fill="#f4f2ff"/>
  <g fill="#00b4d8"><!-- baseline plate -->
    <rect x="24" y="24" width="272" height="16" rx="3"/>
    <rect x="24" y="56" width="200" height="8" rx="2"/><rect x="24" y="72" width="150" height="8" rx="2"/>
    <rect x="24" y="112" width="80" height="28" rx="6"/>
  </g>
  <g class="snap" fill="#ff2d87"><!-- snapshot plate: identical except the button -->
    <rect x="24" y="24" width="272" height="16" rx="3"/>
    <rect x="24" y="56" width="200" height="8" rx="2"/><rect x="24" y="72" width="150" height="8" rx="2"/>
    <rect x="36" y="112" width="80" height="28" rx="6"/>
  </g>
  <rect class="hit" x="16" y="104" width="108" height="44" rx="8" pathLength="100"/>
  <text class="tag" x="136" y="131">1 differs</text>
</svg>
```

Colours are hard-coded because an `<img>` SVG can't see tokens. Inlined, swap them for `var(--brand-cyan)`, `var(--brand-magenta)`, `var(--bg-raised)` and `var(--text-primary)`, and start it on view by toggling `animation-play-state` from a class. Not verified: reduced-motion behaviour inside `<img>` on Safari.

## Open questions

- Amend the motion rule (play-once-on-view), or ship `autoplay: false` (click-to-play)?
- Agent scene chrome: neutral generic agent UI, or a named agent (that needs permission to use their look)?
- Which fixture change best sells the product (a padding shift is subtle; a colour or token change reads instantly)?

## Sources

- svg-term-cli: https://github.com/marionebl/svg-term-cli and example https://raw.githubusercontent.com/marionebl/svg-term-cli/master/examples/parrot.svg
- termtosvg (archived 2020): https://github.com/nbedos/termtosvg
- VHS: https://github.com/charmbracelet/vhs, releases https://github.com/charmbracelet/vhs/releases
- asciinema-player options and themes: https://docs.asciinema.org/manual/player/options/, https://docs.asciinema.org/manual/player/themes/ (bundle sizes measured on https://docs.asciinema.org/manual/player/quick-start/, player 3.9.0)
- SVG Integration, secure animated mode: https://www.w3.org/TR/svg-integration/ ; MDN, SVG as an image: https://developer.mozilla.org/en-US/docs/Web/SVG/Guides/SVG_as_an_image
- `prefers-color-scheme` in SVG images: https://bugs.webkit.org/show_bug.cgi?id=294315 , CSSWG #7213 https://lists.w3.org/Archives/Public/public-css-archive/2023Jul/0355.html ; CSS vars don't reach `<img>` SVGs: https://github.com/RealRaven2000/QuickFolders/issues/553
- WCAG 2.2 SC 2.2.2 Pause, Stop, Hide: https://www.w3.org/WAI/WCAG22/Understanding/pause-stop-hide.html
- GIF→video sizes, LCP and poster: https://web.dev/articles/replace-gifs-with-videos
- `<video><source media>`: https://adrianroselli.com/2023/12/media-queries-in-html-video.html , https://developer.mozilla.org/en-US/Firefox/Releases/120
- AV1 support: https://caniuse.com/av1
- Playwright video: https://playwright.dev/docs/videos
- Motion `animate()` sizes and sequences: https://motion.dev/docs/animate ; GSAP free from 3.13: https://gsap.com/blog/3-13/ , https://webflow.com/blog/gsap-becomes-free
- Rive runtime sizes: https://rive.app/docs/runtimes/runtime-sizes.md ; dotLottie web: https://github.com/LottieFiles/dotlottie-web
- Live sites: https://www.warp.dev https://vercel.com https://linear.app https://resend.com https://www.raycast.com https://bun.sh https://charm.land https://ghostty.org https://zed.dev https://tailwindcss.com https://railway.com https://posthog.com https://turborepo.dev
