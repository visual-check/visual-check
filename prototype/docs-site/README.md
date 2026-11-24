# Landing page and docs prototypes (#102)

Throwaway prototypes for the landing page and the docs in [#102](https://github.com/visual-check/visual-check/issues/102): static HTML on the visual-check design system. They answer "what should the site look like?" and aren't production code.

Run them:

```sh
python3 -m http.server 4173 --directory prototype/docs-site
```

Then open http://127.0.0.1:4173. The bar at the bottom of every page switches variants (← →), theme, how demos play, the alternative headlines, and each variant's idea toggles. The owner also has a hosted copy: https://claude.ai/artifact/CWsNbFXMtdLpLLEQ4VYpKm (private).

## Verdict

- **Landing page: variant F** (`landing/f.html`).
  - **Sections:** hero from A; problem, demo and commands from D; features from A; agent from D; FAQ and last call from A.
  - **Copy:** about half the words of the source variants.
  - **Bands:** sections alternate `bg-page` and `bg-surface`.
  - **First screen:** says that visual-check is a free, open-source library for visual regression testing of Storybook, and what problem it solves.
- **Header: reveal.** The logo alone while the hero is in view. A 48px bar with the page's sections, GitHub, theme and Get started slides in once the hero's install command has scrolled past. It is now the design system's SiteHeader (design system version 20).
- **Accent button:** a deeper magenta (`#d9006c`, hover `#c7005f`) with a white label, because white on the plate magenta is 3.5:1. Changed in the design system (version 18).
- **Docs: Illustrated** (`docs/3.html`).
  - **Layout:** Fumadocs' Spacious layout with inline figures and the clerk TOC.
  - **Custom MDX components:** `TolerancePlayground`, `DiffViewer`, `CliOutput` and `EndState`.
- **Product demos:** HTML/CSS scenes with real text on a small timeline (`VCProto.scene` in `shared/proto-kit.js`). Animated SVG only for brand motifs. Landing A's "Demo tech" toggle compares the two, and `research/animation.md` has the reasoning.

## Still open

- **Motion:** demos play once when first seen, but the design system says nothing animates on its own. Amend the rule (never loop, always pausable, end state under reduced motion), or make demos click to play?
- **Wording:** the CLI prints `differs`; the design system's badge says `changed`.
- **Missing tokens:** values the prototypes needed that the design system doesn't have yet. Each page lists its own at the top of its `<style>`. The main ones:
  - a 1200px container;
  - a hero size above `display`, and phone heading sizes;
  - docs widths: sidebar 268px, TOC 304px, page 760px;
  - a deeper band (`#eceaf7` light, `#1e1b4d` dark), if the light `bg-surface` bands read too faint;
  - a dialog scrim and a selected-item tint.
- **Hosting:** static export or server build. It decides how search and the per-page Markdown routes work.
- **Demo numbers:** the pixel counts and timings in the demos are illustrative and labelled as such. Before launch, generate each scene from real CLI output in CI.

## What's here

| Path | What |
| --- | --- |
| `index.html` | The hub. It has no doctype because the artifact host wraps it. |
| `landing/a.html` … `e.html` | Five landing concepts: proof sheet, one terminal, page under test, three surfaces, agent speed |
| `landing/mix.html` | Takes each of the eight sections from any of A–E |
| `landing/f.html`, `f-headers.*` | The chosen page, and the five header prototypes (reveal is the default) |
| `docs/1.html` … `3.html` | Three docs layouts: classic, notebook, illustrated |
| `shared/` | Copies of the design system's `tokens.css`, `bundle.css`, fonts and logos (version 20), plus the prototype kit |
| `LANDING-BRIEF.md`, `DOCS-BRIEF.md`, `research/` | The briefs and research the prototypes were built from |

The design system stays the source of truth: https://claude.ai/artifact/9DqMk3oeC9YBTBFYTE8218. Landings A–E and docs 1–2 still use the old header markup, kept working by a small shim in `shared/proto-base.css`.
