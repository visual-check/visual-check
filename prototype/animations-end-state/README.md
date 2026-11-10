# Animations frozen at their end state (throwaway)

Answers the [Animations frozen at their end state](https://github.com/visual-check/visual-check/issues/44) ticket: which way of stopping animations shows them at their end state and keeps a drawer opened in `play` identical between runs? Not production code. It lives only on this branch, and reuses the [Driver interface prototype](https://github.com/visual-check/visual-check/issues/29)'s drivers.

- `capture.ts`: one capture run, as Story readiness and page reuse decided, with one animation arm (`--anim`):
  - `none`: ADR 0002 today, `animation:none` and `transition:none` at document start.
  - `sb`: only Storybook's own pause, which its test path applies after `play`.
  - `zero-noguard`: zero durations and delays at document start, in the document and every shadow root.
  - `zero`: the same, with Storybook's after-play pause neutralised.
  - `zero-tiny`: `zero`, but transitions last 0.01 ms so they fire `transitionend`.
  - `finish`: no stylesheet; at capture, `finish()` on finite and `pause()` at 0 on infinite animations, in every shadow root.
  - `zero-finish`: `zero` and `finish` together.
  - `zero-finish-media`: `zero-finish`, plus video paused at frame 0, inline SVG SMIL paused at 0 and GIFs swapped for their first frame.
  - `settle`: nothing at document start but the neutralised Storybook pause; at capture, `finish()` running finite animations and let a frame pass, until none is left; then infinite ones to their first keyframe (paused at 0, written into the inline style with `commitStyles()`, then cancelled, because Chromium can paint a paused compositor animation from a stale frame), media frozen, images and fonts checked again.
  Fixture cells also record their elements' computed state and events, and a second screenshot 1 s later.
- `stories/Animations.stories.tsx`: 20 fixtures (drawers opened in `play`, fill-mode entrances, delays, infinite, chains, exit on `animationend`, `play` awaiting events, `element.animate()`, open and closed shadow roots, GIF, video, SVG SMIL), added to [storybookjs/mealdrop](https://github.com/storybookjs/mealdrop) before its build.
- `fixtures.ts`: per fixture and arm, what the snapshot showed. `compare.ts`: pixel differences between runs per arm.

```bash
npm ci --ignore-scripts
node serve.mjs <storybook-static> 6400 127.0.0.1 &
EXTRA=--offline ./run-anim.sh http://127.0.0.1:6400 runs/local 3
node fixtures.ts runs/local > runs/local/fixtures.md
node compare.ts runs/local
```

Needs Docker and `mcr.microsoft.com/playwright:v1.65.0-noble` for `linux/amd64`. Node 22.18 or later runs the `.ts` files directly.
