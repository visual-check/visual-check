# WebKit web fonts that never load

Throwaway research for [WebKit web fonts that never load](https://github.com/visual-check/visual-check/issues/32). The desk research, with sources, is in [`docs/research/webkit-fonts.md`](../../docs/research/webkit-fonts.md).

## Result

`document.fonts.ready` never resolves on mealdrop in WebKit r2370 (Playwright 1.64.1). The cause is an upstream WebKit regression, [312933@main](https://commits.webkit.org/312933@main), fixed by [323883@main](https://commits.webkit.org/323883@main) ([bug 326380](https://bugs.webkit.org/show_bug.cgi?id=326380)). It ships in WebKit r2388, which is Playwright 1.65.0. It needs no container: everything below ran on the macOS host.

## Runs

All runs: Playwright's own WebKit build on the macOS host (M4 Pro, macOS 27.2), no container, live network. 2 workers, one fresh context per load, 1280 × 720. Storybook's test path, the no-animation stylesheet, `storyFinished` and image decoding as [Story readiness and page reuse](https://github.com/visual-check/visual-check/issues/21) decided. Then `document.fonts.ready` was watched for 4–6 s more.

### mealdrop

The [Driver interface prototype](https://github.com/visual-check/visual-check/issues/29)'s static build (tar sha256 `3114c459`), 106 stories including its hazard stories.

| WebKit | Arm | Loads rendered | `fonts.ready` never resolved | Wait on a `loading` face's `loaded` timed out (10 s) |
|---|---|---:|---:|---:|
| r2370 (1.64.1) | as built | 103 | 101 | 5 |
| r2370 | `load()` on every face reading `loading` or `error` at ready | 102 | 0 | 0 |
| r2388 (1.65.0) | as built, 2 runs | 205 | 0 | 0 |

- **Loads rendered** leaves out the userflow stories that navigate their own document ([Self-navigating stories under raw CDP](https://github.com/visual-check/visual-check/issues/31)) and the crash story.
- **On r2388,** `fonts.ready` resolved a median of 33 ms after `storyFinished` and images (p90 58 ms, max 797 ms).
- **The `load()` arm** fetched a second copy of a font on 101 of 102 stories. It was measured only to show what a workaround would cost, and isn't proposed.
- **A face reading `error` isn't done in WebKit.** On 85 of 103 loads on r2370 and 168 of 205 on r2388, a face read `error` at ready and `loaded` later: WebKit reports a `swap` face whose download is still running (`TimedOut`) as `error`. A wait limited to faces reading `loading` therefore starts the capture before the font arrives. `document.fonts.ready` counts those faces.

### Ablation on mealdrop, r2370

mealdrop declares each Montserrat and Hind face three times, with identical descriptors and URLs: in `preview-head.html`, in the bundled CSS (`assets/iframe-*.css`) and through styled-components' `createGlobalStyle` (`insertRule`). Its MSW loader registers a service worker that claims the page before the story renders. 9 stories × 2.

| Arm | `fonts.ready` never resolved |
|---|---:|
| All three copies | 18 / 18 |
| Without the `preview-head.html` copy | 18 / 18 |
| Without the bundled CSS copy | 18 / 18 |
| Without the `insertRule` copy | 0 / 18 |
| Only the `insertRule` copy | 0 / 16 |
| Service workers blocked (all 106 stories) | 0 / 106, but every story errors: MSW's loader fails, so this proves nothing |

### Minimal pages

In `pages/`, served under `/min/`. 4 loads each.

| Page | r2370 | r2388 |
|---|---|---|
| `h1.html`: one gstatic weight-900 face, `local()` then `url()`, `unicode-range` the text doesn't use (bug 326380's page) | 4 / 4 never resolve; the URL is never requested | 0 / 4 |
| `h2.html`: `h1` without `local()` | 0 / 4 | |
| `h3.html`: `h1` with `font-display: swap` | 4 / 4; the face reads `error` at once | 0 / 4 |
| `h5.html`: the same face in a `<style>`, then a service worker claims the page, then the same rule through `insertRule` and text that uses it | 4 / 4; the older copy reads `error` for good, one request | 0 / 4 |
| `h5.html?sw=0`: no service worker | 0 / 4 | |
| `h5.html?local=0`: no `local()` | 0 / 4 | |
| `h5.html?src=dead`: unreachable URL | 0 / 4; both copies fail properly | |
| `h5.html?display=swap` | 4 / 4 | 0 / 4 |

Pages without a service worker never hung on r2370: 322 loads of `min.html`, `min3.html` and `min4.html`, with up to three copies of each rule, `insertRule` copies, other rules inserted while fonts loaded, and mealdrop's whole `insertRule` sequence replayed.

### How it breaks, on r2370

From the traces (`probe.mjs` logs every face's status every 20 ms and every `@font-face` insertion):

1. When styled-components inserts its copy, WebKit puts all three copies in one group and fetches the newest one's URL.
2. The regression marks the two older copies `Loading` without fetching anything. Because the service worker took control in between, their cached font entry is a different one from the newest copy's, so the finished download never reaches them.
3. `swap` copies read `error` at once. The weight-900 copy (no `font-display`) reads `loading` for 3 s, then `error`. Neither ever settles its `loaded` promise, and both keep `document.fonts.status` at `loading`.
4. The prototype waited on the `loaded` promise of each face reading `loading` at ready: the 900 copies within 3 s of ready. Those were its 4–6 timeouts per run.

## Files

- `probe.mjs`: loads each story, or each page given with `--pages`, with readiness as above, and records font states, `@font-face` insertions, font requests and when `document.fonts.ready` resolves. Options: `--only`, `--reps`, `--watch`, `--sw block`, `--kick`, `--skip-insert-fonts`.
- `serve.mjs`: static server for the Storybook build and the pages.
- `pages/`: the minimal pages, `sw.js`, and `fonts6.css` (mealdrop's six rules). `min.html?src=loop` expects mealdrop's Montserrat 900 file at `/min/m900.woff2`; fetch it from the gstatic URL in the page.

```sh
npm i playwright-core@1.64.1 && npx playwright-core install webkit   # or 1.65.0
node serve.mjs <storybook-static with pages/ copied to min/> 6400 &
node probe.mjs --browser webkit --out run.json --watch 4000
node probe.mjs --browser webkit --pages "min/h1.html,min/h5.html" --reps 4 --out pages.json
```

## Not verified

- Linux WebKit in the Playwright image wasn't rerun. #29 saw the same symptom there, and Playwright's bot verified the fix on Linux.
- Safari outside Playwright wasn't run. WebKit landed the fix on a Safari branch too.
- Storybooks other than mealdrop.
