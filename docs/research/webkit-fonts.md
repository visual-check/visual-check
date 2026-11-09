# WebKit: `document.fonts.ready` never resolves (Playwright 1.64 / WebKit 27.2)

Research date: 2026-11-09. Primary sources only: WebKit source and Bugzilla, Playwright source, issues and PRs, the CSS specs, Chromium source (official GitHub mirror), and the mealdrop and MSW repos where they are the source of the facts.

Pinned revisions used below:

- **WebKit for Playwright r2370.** Built from `microsoft/playwright-browsers@864f82a` ([PR #43084](https://github.com/microsoft/playwright/pull/43084)). That repo is not public. The closest public snapshot of the patches is [`microsoft/playwright@e99c0b1`](https://github.com/microsoft/playwright/blob/e99c0b1d973b546a8ce6d4ccf4e3fa925ce005c2/browser_patches/webkit/UPSTREAM_CONFIG.sh) (2026-10-06). It uses WebKit base `5b391e6d` (2026-08-20). All `WK@base` links point to that commit.
- **WebKit main:** `940a2f2e` (2026-11-09).
- **Playwright:** tag `v1.64.1` (`cfe490d`).
- **mealdrop:** `5ee1b204` (2026-09-30).

---

## Summary of conclusions

| # | Conclusion | Confidence |
|---|---|---|
| 1 | This is a known upstream WebKit regression. [312933@main](https://commits.webkit.org/312933@main) (2026-05-08, [bug 312121](https://bugs.webkit.org/show_bug.cgi?id=312121)) introduced it. [323883@main](https://commits.webkit.org/323883@main) (2026-10-15, [bug 326380](https://bugs.webkit.org/show_bug.cgi?id=326380)) fixed it. Playwright tracked it as [#42986](https://github.com/microsoft/playwright/issues/42986). The bisect there shows WebKit r2293 and later are affected (Playwright 1.61–1.64). Playwright rolled to r2386 in [#43743](https://github.com/microsoft/playwright/pull/43743), and the bot verified the fix there. [Playwright 1.65.0](https://github.com/microsoft/playwright/releases/tag/v1.65.0) (2026-11-05, WebKit r2388) contains that roll. | Established |
| 2 | The trigger is an `@font-face` whose `src` lists `local()` before `url()`. If WebKit checks such a face without permission to download, the face moves to `Loading` even though its `url()` is never fetched. Every mealdrop rule has this shape. | Established |
| 3 | WebKit reports a face in `CSSFontFace::Status::TimedOut` as `FontFace.status === "error"`. The same face still counts as active in the set. So `document.fonts.status` stays `"loading"` even when every face reads `"loaded"` or `"error"`. `FontFace.loaded` never settles for a `TimedOut` face. This explains the prototype comment and the new local evidence. | Established |
| 4 | **Mechanism for mealdrop** (local evidence: three identical copies of each rule): (a) all copies end up in one segmented face; (b) after the first copy returns a placeholder font, WebKit checks the others without permission to download; (c) under the regression, those copies enter `Loading`; (d) they stay stuck because their `CachedFont` is a different object from the one the inserted copy fetched. MSW's service worker takes control of the page between the static rules and the `insertRule`. That makes WebKit reload the font URL into a new `CachedFont`. A registered Playwright route does the same thing after the load event. | Established: a minimal page with a service worker reproduces it, and the same page without one doesn't ([`research/webkit-fonts`](../../research/webkit-fonts/README.md)). The route path was not run |
| 5 | It is not caused by Playwright's WebKit patches. They do not touch font code. The regression reproduces in plain WPE and was also cherry-picked to a Safari branch. It does not need the container network either (the macOS host repro shows that). | Established for the patches and Safari; the container point comes from the caller's evidence |
| 6 | It only happens online because, offline, the inserted copy fails. WebKit then skips it, asks the older copy with permission to download, and that fetch fails. The failure notifies every copy and the set drains. | Likely |
| 7 | Playwright's screenshot waits on `document.fonts.ready` with no timeout of its own, bounded only by the call's timeout. It was added in v1.41 by [#28226](https://github.com/microsoft/playwright/pull/28226). `PW_TEST_SCREENSHOT_NO_FONTS_READY` skips only that wait. It is read by the server process (inside the container with `run-server`). It is not documented. `toHaveScreenshot` uses the same code. | Established |
| 8 | The 10 s timeouts were not faces reading `"loading"` for 10 s. The weight-900 copies read `"loading"` for 3 s and then `"error"`, but their `loaded` promise never settled, and the prototype waited on that promise. Traces in [`research/webkit-fonts`](../../research/webkit-fonts/README.md). | Established locally |

---

## Q1. Is this a known WebKit bug? State machine and bookkeeping

### 1.1 `CSSFontFace` states and how they map to `FontFace.status`

- **States.** `Pending`, `Loading`, `TimedOut`, `Success`, `Failure`. The diagram is in the header ([CSSFontFace.h L95-104](https://github.com/WebKit/WebKit/blob/5b391e6d3b14d549908dad2c6695999291313f30/Source/WebCore/css/CSSFontFace.h#L95-L104)).
- **Mapping to JS** ([FontFace.cpp L375-391](https://github.com/WebKit/WebKit/blob/5b391e6d3b14d549908dad2c6695999291313f30/Source/WebCore/css/FontFace.cpp#L375-L391)):
  - `Pending` → `"unloaded"`
  - `Loading` → `"loading"`
  - **`TimedOut` → `"error"`**
  - `Success` → `"loaded"`
  - `Failure` → `"error"`
  - The mapping is unchanged on current main ([main L382-383](https://github.com/WebKit/WebKit/blob/940a2f2e580c3f82f76e151e874e43b7a1d94dd7/Source/WebCore/css/FontFace.cpp#L382-L383)).
- **Promise.** `FontFace::fontStateChanged` does nothing for `Loading` or `TimedOut`. It resolves or rejects `loaded` only on `Success` or `Failure` ([FontFace.cpp L401-425](https://github.com/WebKit/WebKit/blob/5b391e6d3b14d549908dad2c6695999291313f30/Source/WebCore/css/FontFace.cpp#L401-L425)). So a face that stays in `TimedOut` reads `"error"` and its `loaded` promise never settles.
- **Timers.** Block and swap periods come from `font-display` ([CSSFontFace.cpp L608-632](https://github.com/WebKit/WebKit/blob/5b391e6d3b14d549908dad2c6695999291313f30/Source/WebCore/css/CSSFontFace.cpp#L608-L632)):

  | `font-display` | Block period | Swap period |
  |---|---|---|
  | `auto`, `block` | 3 s | ∞ |
  | `swap` | 0 s | ∞ |
  | `fallback` | 0.1 s | 3 s |
  | `optional` | 0.1 s | 0 s |

- **Transitions** ([`setStatus` L634-691](https://github.com/WebKit/WebKit/blob/5b391e6d3b14d549908dad2c6695999291313f30/Source/WebCore/css/CSSFontFace.cpp#L634-L691)):
  - Entering `Loading` starts the block timer. With a 0 s block it goes to `TimedOut` at once, in the same call.
  - Entering `TimedOut` starts the swap timer. An infinite swap period means no timer, so the face stays in `TimedOut` until the load finishes.
- **No cancellation.** `timeoutFired` moves `TimedOut` to `Failure` only when the swap period is finite. A comment there explains that WebKit deliberately does not cancel the network request ([L505-525](https://github.com/WebKit/WebKit/blob/5b391e6d3b14d549908dad2c6695999291313f30/Source/WebCore/css/CSSFontFace.cpp#L505-L525)).
- **Consequence.**
  - With `auto` or `block`, a face whose load never completes shows `"loading"` for 3 s, then `"error"` forever. The set stays `"loading"`.
  - With `swap`, the face shows `"error"` at once.
  - This matches the local evidence: the 900 rule has no `font-display` and switched from `"loading"` to `"error"` at about 3.0 s; the `swap` rules showed `"error"` immediately.

### 1.2 Set bookkeeping: what keeps `document.fonts` in `"loading"`

- **Active count.** `CSSFontFaceSet` keeps `m_activeCount`. When it goes from 0 to 1 the set becomes `Loading` and clients get `startedLoading`. When it goes back to 0 the set becomes `Loaded` and clients get `completedLoading` ([CSSFontFaceSet.cpp L77-97](https://github.com/WebKit/WebKit/blob/5b391e6d3b14d549908dad2c6695999291313f30/Source/WebCore/css/CSSFontFaceSet.cpp#L77-L97)).
- **What counts as active.** A face counts while it is in `Loading` **or `TimedOut`**:
  - `add` increments for such faces ([L221-222](https://github.com/WebKit/WebKit/blob/5b391e6d3b14d549908dad2c6695999291313f30/Source/WebCore/css/CSSFontFaceSet.cpp#L203-L228)).
  - `remove` decrements for such faces ([L280-281](https://github.com/WebKit/WebKit/blob/5b391e6d3b14d549908dad2c6695999291313f30/Source/WebCore/css/CSSFontFaceSet.cpp#L256-L291)).
  - `fontStateChanged` increments on `Pending → Loading` and decrements only on `Success` or `Failure` ([L559-573](https://github.com/WebKit/WebKit/blob/5b391e6d3b14d549908dad2c6695999291313f30/Source/WebCore/css/CSSFontFaceSet.cpp#L559-L573)).
- **`ready`.** `FontFaceSet::completedLoading` and `documentDidFinishLoading` resolve `ready` only when the count is 0 **and** the window load event has finished ([FontFaceSet.cpp L262-280](https://github.com/WebKit/WebKit/blob/5b391e6d3b14d549908dad2c6695999291313f30/Source/WebCore/css/FontFaceSet.cpp#L262-L280)). `documentDidFinishLoading` is called from `Document::implicitClose` ([Document.cpp L4403-4406](https://github.com/WebKit/WebKit/blob/5b391e6d3b14d549908dad2c6695999291313f30/Source/WebCore/dom/Document.cpp#L4403-L4406)).
- **Status.** `document.fonts.status` is just the set status ([FontFaceSet.cpp L227-239](https://github.com/WebKit/WebKit/blob/5b391e6d3b14d549908dad2c6695999291313f30/Source/WebCore/css/FontFaceSet.cpp#L227-L239)).
- **`document.fonts.load()`.** Its pending promises settle in `faceFinished`, which runs only on `Success` or `Failure` ([L241-260](https://github.com/WebKit/WebKit/blob/5b391e6d3b14d549908dad2c6695999291313f30/Source/WebCore/css/FontFaceSet.cpp#L241-L260)).
- **Result.** One face stuck in `TimedOut` keeps `status === "loading"` and `ready` pending forever. Meanwhile every face reads `"loaded"` or `"error"`. Bug 326380 shows this exact pair: set `loading`, face `error` ([comment 0](https://bugs.webkit.org/show_bug.cgi?id=326380)).
- **Telling the two cases apart.** If `status === "loaded"` but `ready` is still pending, the window load event has not fired. That is a different cause. See [bug 228909](https://bugs.webkit.org/show_bug.cgi?id=228909) for an old report of this kind.

### 1.3 The regression and the fix

- **Download policy.** `CSSFontFace::pump(policy)` walks the `src` list. `ExternalResourceDownloadPolicy::Forbid` means "do not start network loads". Layout uses it when it only probes a face.
  - [312933@main](https://github.com/WebKit/WebKit/commit/d8412a5c254e327317b095389fba0eaaaa6664c5) let a face go from `Pending` to `Loading` under `Forbid` as soon as a `local()` source is tried.
  - The `local()` lookup fails. The next source is `url()`, and `pump` stops there without loading it, because the policy forbids downloads.
  - At base this is [CSSFontFace.cpp L728-731, L752-753](https://github.com/WebKit/WebKit/blob/5b391e6d3b14d549908dad2c6695999291313f30/Source/WebCore/css/CSSFontFace.cpp#L707-L762).
  - The face is now `Loading` with nothing in flight. It moves to `TimedOut` and stays there, because the swap period is infinite.
- **Fix.** [323883@main](https://github.com/WebKit/WebKit/commit/477d471323c22e42c55efbd07172746649168cb6) brings back the `policy == Allow` guard. Under `Forbid` the face stays `Pending` until its outcome is known.
  - Current main has the guard ([main L732, L755, L761](https://github.com/WebKit/WebKit/blob/940a2f2e580c3f82f76e151e874e43b7a1d94dd7/Source/WebCore/css/CSSFontFace.cpp#L707-L766)).
  - It came with a WPT test: an unused face with `local()` then `url()` and a Cyrillic `unicode-range`.
  - It was also landed as [321067.594@safari-7626-branch](https://commits.webkit.org/321067.594@safari-7626-branch) (see bug 326380). That means shipping Safari had the regression too.
- **Bug 326380 itself.** Filed by a Playwright maintainer. It states the regression range in WPE builds and links Playwright #42986 ([bug](https://bugs.webkit.org/show_bug.cgi?id=326380)).
- **History.** [Bug 202548](https://bugs.webkit.org/show_bug.cgi?id=202548) (2019) describes the same class of bug. A fallback lookup with `Forbid` marked a face `Loading`, so `ready` never fired. The `Allow` guard was the fix then, and 312933 removed it for `local()` sources.

### 1.4 Other checks from the question list

- **Font already in the memory cache.** `CSSFontFaceSource`'s constructor handles a `CachedFont` that is already loaded by setting its own status in the same call ([CSSFontFaceSource.cpp L78-95](https://github.com/WebKit/WebKit/blob/5b391e6d3b14d549908dad2c6695999291313f30/Source/WebCore/css/CSSFontFaceSource.cpp#L78-L95)). The face moves when it is next pumped. No bug was found here.
- **Several `@font-face` rules with the same URL.**
  - Each source has its own `CachedFontLoadRequest` ([CSSFontFaceSrcValue.cpp L90-120](https://github.com/WebKit/WebKit/blob/5b391e6d3b14d549908dad2c6695999291313f30/Source/WebCore/css/CSSFontFaceSrcValue.cpp#L90-L120)).
  - Each request registers as a client of the `CachedFont` ([CachedFontLoadRequest.h](https://github.com/WebKit/WebKit/blob/5b391e6d3b14d549908dad2c6695999291313f30/Source/WebCore/loader/cache/CachedFontLoadRequest.h)).
  - When the `CachedFont` finishes, all clients are notified ([CachedFont.cpp L241-249](https://github.com/WebKit/WebKit/blob/5b391e6d3b14d549908dad2c6695999291313f30/Source/WebCore/loader/cache/CachedFont.cpp#L241-L249)).
  - Each source then pumps its face ([CSSFontFaceSource.cpp L138-160](https://github.com/WebKit/WebKit/blob/5b391e6d3b14d549908dad2c6695999291313f30/Source/WebCore/css/CSSFontFaceSource.cpp#L138-L160), [CSSFontFace.cpp L492-503](https://github.com/WebKit/WebKit/blob/5b391e6d3b14d549908dad2c6695999291313f30/Source/WebCore/css/CSSFontFace.cpp#L492-L503)).
  - So a stuck face is rescued if *another* face fetches **the same `CachedFont` object**. It is not rescued if the URL was reloaded into a new `CachedFont` (see §1.5).
- **Fonts are fetched lazily.** `CachedFont::load` only marks the resource as loading. The fetch starts in `beginLoadIfNeeded`, which `DocumentFontLoader` calls ([CachedFont.cpp L62-66, L121-127](https://github.com/WebKit/WebKit/blob/5b391e6d3b14d549908dad2c6695999291313f30/Source/WebCore/loader/cache/CachedFont.cpp#L62-L127), [DocumentFontLoader.cpp L80-127](https://github.com/WebKit/WebKit/blob/5b391e6d3b14d549908dad2c6695999291313f30/Source/WebCore/dom/DocumentFontLoader.cpp#L80-L127)). A `CachedFont` that no face loads with `Allow` is never fetched.
- **Related open bug.** [Bug 251892](https://bugs.webkit.org/show_bug.cgi?id=251892) (NEW): a `CachedFont` is created for every `src`, even if it is never loaded.
- **Other font-loading commits since mid-2024** (files: `FontFace.cpp`, `CSSFontFace.cpp`, `CSSFontFaceSet.cpp`, `FontFaceSet.cpp`; listed with `gh api repos/WebKit/WebKit/commits?path=…`):
  - Use-after-free and reentrancy fixes: [5f0480f](https://github.com/WebKit/WebKit/commit/5f0480f771) (2026-05) and [3230087](https://github.com/WebKit/WebKit/commit/3230087f18) (2026-11).
  - `loading` event support: [bug 280954](https://bugs.webkit.org/show_bug.cgi?id=280954) (2024-10).
  - Font-loading events change reverted: [19e24b1](https://github.com/WebKit/WebKit/commit/19e24b1ecd) reverted 305367@main (2026-01).
  - None of these changes `ready` or the active count, apart from 312933 and 323883.
- **Bugzilla searches.** No bug was found for duplicate `@font-face` rules, `insertRule`, or styled-components. Searches covered summary terms and quicksearch for "insertRule @font-face", "styled-components", "duplicate @font-face", "font-face same URL" and "fonts.ready".

### 1.5 Duplicate faces + `insertRule` (the local mealdrop evidence)

**mealdrop's rules.**

- [`.storybook/preview-head.html` L61-73](https://github.com/storybookjs/mealdrop/blob/5ee1b204675b2d9eaf64fb33424384477946f369/.storybook/preview-head.html#L61-L73) declares Montserrat 900 as `local('Montserrat Black'), local('Montserrat-Black'), url(…/JTURjIg1_i6t8kCHKm45_epG3gnD_vx3rCs.woff2)` with **no `font-display`**.
- The other weights use `font-display: swap`.
- [`src/styles/GlobalStyle.tsx` L54-66](https://github.com/storybookjs/mealdrop/blob/5ee1b204675b2d9eaf64fb33424384477946f369/src/styles/GlobalStyle.tsx#L54-L66) repeats the same rules through `createGlobalStyle`. That is the CSSOM `insertRule` copy.
- The Playwright noble image installs no Montserrat or Hind font packages ([nativeDeps.ts](https://github.com/microsoft/playwright/blob/v1.64.1/packages/playwright-core/src/server/registry/nativeDeps.ts)), so the `local()` lookups fail. macOS does not ship them either; that is an assumption, not checked.

**Code path, step by step** (all links `WK@base`):

1. **Rebuild on `insertRule`.** A new style resolver calls `buildStarted()` and then `buildCompleted()` ([StyleDocumentScope.cpp L80-96](https://github.com/WebKit/WebKit/blob/5b391e6d3b14d549908dad2c6695999291313f30/Source/WebCore/style/StyleDocumentScope.cpp#L80-L96)).
   - `buildStarted` purges faces that have no wrapper and records the CSS-connected ones ([CSSFontSelector.cpp L133-149](https://github.com/WebKit/WebKit/blob/5b391e6d3b14d549908dad2c6695999291313f30/Source/WebCore/css/CSSFontSelector.cpp#L133-L149)).
   - `buildCompleted` re-adds the staged rules ([L151-171](https://github.com/WebKit/WebKit/blob/5b391e6d3b14d549908dad2c6695999291313f30/Source/WebCore/css/CSSFontSelector.cpp#L151-L171)).
   - For each existing rule, `addFontFaceRule` builds a **new** `CSSFontFace`. It removes the old face from the set, and the old JS wrapper `adopt`s the new face ([L228-244](https://github.com/WebKit/WebKit/blob/5b391e6d3b14d549908dad2c6695999291313f30/Source/WebCore/css/CSSFontSelector.cpp#L228-L244), [FontFace::adopt L393-399](https://github.com/WebKit/WebKit/blob/5b391e6d3b14d549908dad2c6695999291313f30/Source/WebCore/css/FontFace.cpp#L393-L399)).
   - The new face starts `Pending`. A wrapper that read `"loaded"` now reads `"unloaded"`. This matches the Nunito flip in the local evidence.
2. **All copies go into one segmented face.** `CSSFontFaceSet::fontFace` keeps every face that is not in `Failure` and ties on width, style and weight. It orders them from newest to oldest ([CSSFontFaceSet.cpp L476-557](https://github.com/WebKit/WebKit/blob/5b391e6d3b14d549908dad2c6695999291313f30/Source/WebCore/css/CSSFontFaceSet.cpp#L476-L557)). Three identical copies give `[inserted, static-2, static-1]`.
3. **Fallback lookup uses `Forbid`.**
   - `fontRanges` probes the first face with `Forbid` and appends a range for every face ([CSSSegmentedFontFace.cpp L114-143](https://github.com/WebKit/WebKit/blob/5b391e6d3b14d549908dad2c6695999291313f30/Source/WebCore/css/CSSSegmentedFontFace.cpp#L114-L143)).
   - In `FontRanges::glyphDataForCharacter`, the first matching range is asked with `Allow`. That is the inserted copy, so its URL is fetched. Its font comes back as a placeholder while it loads.
   - The policy then switches to `Forbid` for the remaining ranges ([FontRanges.cpp L89-95](https://github.com/WebKit/WebKit/blob/5b391e6d3b14d549908dad2c6695999291313f30/Source/WebCore/platform/graphics/FontRanges.cpp#L83-L118)).
   - The older copies are therefore asked with `Forbid` ([CSSFontAccessor::font L67-76](https://github.com/WebKit/WebKit/blob/5b391e6d3b14d549908dad2c6695999291313f30/Source/WebCore/css/CSSSegmentedFontFace.cpp#L67-L76)).
4. **The regression moves the older copies to `Loading`.** Under 312933, `pump(Forbid)` moves each older copy to `Loading` when it tries `local()`. Their `url()` is never loaded ([CSSFontFace.cpp L728-731](https://github.com/WebKit/WebKit/blob/5b391e6d3b14d549908dad2c6695999291313f30/Source/WebCore/css/CSSFontFace.cpp#L707-L762)). This is "all three copies start loading".
5. **Timers.** `swap` copies go to `TimedOut` at once and read `"error"`. The 900 copy (`auto`) reads `"loading"` for 3 s and then `"error"` (§1.1). Neither settles `loaded`, and both keep the set active (§1.2).
6. **Why the older copies are never rescued.** They would complete if their `CachedFont` were the object the inserted copy fetched (§1.4). The local evidence says they never complete. So their `CachedFont` must be a different object. Two source-backed ways this happens:
   - **MSW service worker (no route needed).**
     - mealdrop's preview has an MSW loader that runs `setupWorker().start({serviceWorker: {url: './mockServiceWorker.js'}})` before each story renders ([preview.tsx L23-42](https://github.com/storybookjs/mealdrop/blob/5ee1b204675b2d9eaf64fb33424384477946f369/.storybook/preview.tsx#L23-L42), [L210](https://github.com/storybookjs/mealdrop/blob/5ee1b204675b2d9eaf64fb33424384477946f369/.storybook/preview.tsx#L210)).
     - The worker calls `skipWaiting()` and `clients.claim()` ([public/mockServiceWorker.js L16, L20](https://github.com/storybookjs/mealdrop/blob/5ee1b204675b2d9eaf64fb33424384477946f369/public/mockServiceWorker.js#L16-L20)).
     - WebKit then sets the document's active service worker ([SWClientConnection.cpp L269-277](https://github.com/WebKit/WebKit/blob/5b391e6d3b14d549908dad2c6695999291313f30/Source/WebCore/workers/service/SWClientConnection.cpp#L269-L277)).
     - Later subresource requests carry its registration id ([CachedResourceLoader.cpp L995-996](https://github.com/WebKit/WebKit/blob/5b391e6d3b14d549908dad2c6695999291313f30/Source/WebCore/loader/cache/CachedResourceLoader.cpp#L995-L996)).
     - `determineRevalidationPolicy` returns **Reload** when the registration id differs from the cached resource's ([L1488-1501](https://github.com/WebKit/WebKit/blob/5b391e6d3b14d549908dad2c6695999291313f30/Source/WebCore/loader/cache/CachedResourceLoader.cpp#L1488-L1501), [L1515-1518](https://github.com/WebKit/WebKit/blob/5b391e6d3b14d549908dad2c6695999291313f30/Source/WebCore/loader/cache/CachedResourceLoader.cpp#L1503-L1520)). Reload creates a new resource ([L1311-1321](https://github.com/WebKit/WebKit/blob/5b391e6d3b14d549908dad2c6695999291313f30/Source/WebCore/loader/cache/CachedResourceLoader.cpp#L1311-L1321)).
     - The static rules requested their font at first style resolution, before the worker took control. Each story uses a fresh context, so there is no prior registration.
     - The inserted rule requests the same URL after `worker.start()` resolved. It gets a new `CachedFont`, which it fetches.
     - The static copies keep the old, never-started `CachedFont`. Nobody ever loads it with `Allow`.
   - **Any Playwright route.**
     - A route makes Playwright send `Network.setResourceCachingDisabled {disabled: true}` ([wkPage.ts L184-187, L749-753](https://github.com/microsoft/playwright/blob/v1.64.1/packages/playwright-core/src/server/webkit/wkPage.ts#L184-L187)).
     - In WebKit that makes `subresourceCachePolicy` return `Reload` ([FrameLoader.cpp L2928-2933](https://github.com/WebKit/WebKit/blob/5b391e6d3b14d549908dad2c6695999291313f30/Source/WebCore/loader/FrameLoader.cpp#L2928-L2933)).
     - After the window load event, the request is reloaded instead of reused ([CachedResourceLoader.cpp L1611-1618](https://github.com/WebKit/WebKit/blob/5b391e6d3b14d549908dad2c6695999291313f30/Source/WebCore/loader/cache/CachedResourceLoader.cpp#L1611-L1618)). Before the load event, the "validated URLs" rule reuses it.
   - **Without a service worker or a route,** an in-flight or deferred `CachedFont` is reused ([L1626-1635](https://github.com/WebKit/WebKit/blob/5b391e6d3b14d549908dad2c6695999291313f30/Source/WebCore/loader/cache/CachedResourceLoader.cpp#L1626-L1635)). The older copies would then be rescued about 150 ms later.
7. **Why it does not happen offline.**
   - The inserted copy's fetch fails, so that face becomes `Failure`.
   - `fontRanges` skips failed faces ([L124-126](https://github.com/WebKit/WebKit/blob/5b391e6d3b14d549908dad2c6695999291313f30/Source/WebCore/css/CSSSegmentedFontFace.cpp#L114-L143)), so an older copy becomes first and is asked with `Allow`.
   - It starts the old `CachedFont`, which fails fast. The failure notifies both older copies, they become `Failure`, and the count reaches 0. Confidence: likely.
8. **Why 323883 fixes this too.** Under `Forbid` the older copies now stay `Pending` (`"unloaded"`) and are not counted ([main L732, L761](https://github.com/WebKit/WebKit/blob/940a2f2e580c3f82f76e151e874e43b7a1d94dd7/Source/WebCore/css/CSSFontFace.cpp#L707-L766)). The split `CachedFont` stops mattering. This is inferred from the diff. Playwright's bot only verified the unused-face test on r2386.

**Answers to the coordinator's specific questions:**

- *Is the `loaded` promise settled only while the wrapper is connected?*
  - Yes. A wrapper is a client of its **current** backing only. `adopt` removes it from the old face and adds it to the new one ([FontFace.cpp L393-399](https://github.com/WebKit/WebKit/blob/5b391e6d3b14d549908dad2c6695999291313f30/Source/WebCore/css/FontFace.cpp#L393-L399)).
  - The promise settles only on the current backing's `Success` or `Failure` (L401-425). The stuck copies *are* the current backings, and they sit in `TimedOut`.
- *Why does `"error"` appear without the promise rejecting?* Because `"error"` here means `TimedOut`, not `Failure`. See the mapping and promise rules in §1.1.
- *Why does the set stay `"loading"` with no face `"loading"`?* Because `TimedOut` faces count as active (§1.2).

---

## Q2. Is it Playwright's WebKit build?

- **Version mapping.**
  - Playwright 1.64.1 ships `webkit` revision **2370**, `browserVersion` **"27.2"** ([browsers.json@v1.64.1](https://github.com/microsoft/playwright/blob/v1.64.1/packages/playwright-core/browsers.json)).
  - The "27.2" label was set by [#43122](https://github.com/microsoft/playwright/pull/43122), which points at the Safari 27.2 release notes. It is a marketing label, not a WebKit commit.
  - r2370 came from [#43084](https://github.com/microsoft/playwright/pull/43084), built 2026-10-02. Its WebKit base is not public; the public snapshot gives `5b391e6d` (2026-08-20). That base is after 312933 (2026-05-08) and before 323883 (2026-10-15).
  - The bot bisect in [#42986](https://github.com/microsoft/playwright/issues/42986) puts the boundary between r2291 (passes) and r2293 (fails); r2293 came from [#40846](https://github.com/microsoft/playwright/pull/40846).
- **Fixed in.**
  - r2386 ([#43743](https://github.com/microsoft/playwright/pull/43743), merged 2026-10-29). The bot ran the reduced test there and it passed on Linux and Windows.
  - [v1.65.0](https://github.com/microsoft/playwright/blob/v1.65.0/packages/playwright-core/browsers.json) (released 2026-11-05) ships r2388, still labelled "27.2", and contains #43743.
  - The regression test `SS-096` was added in [#43652](https://github.com/microsoft/playwright/pull/43652). It is still `fixme` on WebKit in v1.65.0 ([page-screenshot.spec.ts L553-570](https://github.com/microsoft/playwright/blob/v1.65.0/tests/page/page-screenshot.spec.ts#L553-L570)).
- **Patches.** The WebKit patch ([bootstrap.diff](https://github.com/microsoft/playwright/blob/e99c0b1d973b546a8ce6d4ccf4e3fa925ce005c2/browser_patches/webkit/patches/bootstrap.diff)) touches no font file. Its loader changes:
  - `CachedResourceLoader`: keeps caching on for intercepted requests ([#19158](https://github.com/microsoft/playwright/issues/19158)) and lets `<link rel=preload>` be intercepted ([#16745](https://github.com/microsoft/playwright/issues/16745)).
  - `WebLoaderStrategy`: offline emulation, and skipping re-interception of a resumed main-frame navigation.
  - `WebResourceLoader`: ordering of the response-interception callbacks.
  - `NetworkDataTaskSoup`: request headers kept for the inspector.
  - All of these are gated on interception or offline emulation. None explains a font face stuck with no request in flight.
  - Separately, Playwright itself turns off WebKit resource caching whenever a route exists (§1.5 step 6). That matters here.
- **Related issues.**
  - [#42986](https://github.com/microsoft/playwright/issues/42986): Linux WebKit screenshot hangs on `document.fonts.ready` in 1.63. This is the main match. It was triaged to WebKit 312933. A maintainer filed bug 326380 and posted a minimal page. The issue is closed and labelled v1.65.
  - [#12839](https://github.com/microsoft/playwright/issues/12839) (2022): `document.fonts.ready` behaved oddly on WebKit/Ubuntu. It led to [#14004](https://github.com/microsoft/playwright/pull/14004) removing an unreleased `fonts` screenshot option.
  - [#28995](https://github.com/microsoft/playwright/issues/28995): screenshot hang in Chromium, worked around by [#31295](https://github.com/microsoft/playwright/pull/31295).
  - [#35200](https://github.com/microsoft/playwright/issues/35200) and [#35972](https://github.com/microsoft/playwright/issues/35972): maintainers point users to `PW_TEST_SCREENSHOT_NO_FONTS_READY`.
  - No Google Fonts-specific WebKit issue was found.

## Q3. How `page.screenshot` waits for fonts

- **Code.**
  - `Screenshotter._preparePageForScreenshot` first runs the in-page preparation in all frames.
  - Then, unless `process.env.PW_TEST_SCREENSHOT_NO_FONTS_READY` is set, it logs `waiting for fonts to load...` and evaluates `document.fonts.ready` in the utility world of **one frame**: the page's main frame, or the locator's frame for element screenshots ([screenshotter.ts L251-266](https://github.com/microsoft/playwright/blob/v1.64.1/packages/playwright-core/src/server/screenshotter.ts#L251-L266)).
  - The call is wrapped in `progress.race(...)`. Evaluation errors are swallowed by `.catch(() => {})`.
- **Timeout.** There is no separate font timeout. The wait is bounded only by the screenshot call's timeout.
- **History.**
  - Introduced by [#28226](https://github.com/microsoft/playwright/pull/28226) ("bring back wait for font loading", merged 2023-11-18). Its commit is in v1.41.0 and not in v1.40.x (checked with the GitHub compare API).
  - The earlier `fonts` option ([#12661](https://github.com/microsoft/playwright/pull/12661)) was removed before release ([#14004](https://github.com/microsoft/playwright/pull/14004)) because it did not work on WebKit WPE.
  - [#31295](https://github.com/microsoft/playwright/pull/31295) (2024-06) narrowed the wait from all frames to one frame.
- **Environment variable.**
  - It is a plain truthiness check, so any non-empty value skips the wait, even `0`.
  - It is read in `server/screenshotter.ts`, which runs in the process that drives the browser. With `run-server`, set it in the **container**, not on the client.
  - It skips only the wait. It does not change font state; the reporter in #42986 observed the same.
  - It is not mentioned in `docs/src`. The only code reference is screenshotter.ts. Maintainers mention it in issues (above).
- **`toHaveScreenshot`.**
  - `Page.expectScreenshot` calls `screenshotter.screenshotPage` (or the element variant) in its retry loop ([page.ts L717-724](https://github.com/microsoft/playwright/blob/v1.64.1/packages/playwright-core/src/server/page.ts#L717-L724)).
  - So it runs the same font wait on every attempt, bounded by the assertion timeout. The same environment variable applies.

## Q4. Container network

- **What `exposeNetwork` does.**
  - The server starts a SOCKS5 proxy ([playwrightServer.ts L285-295](https://github.com/microsoft/playwright/blob/v1.64.1/packages/playwright-core/src/remote/playwrightServer.ts#L285-L295)).
  - It launches the browser with `socks5://127.0.0.1:<port>` ([browserType.ts L308-309](https://github.com/microsoft/playwright/blob/v1.64.1/packages/playwright-core/src/server/browserType.ts#L308-L309)). On Linux WebKit this becomes `--proxy=…` ([webkit.ts L130-139](https://github.com/microsoft/playwright/blob/v1.64.1/packages/playwright-core/src/server/webkit/webkit.ts#L130-L139)).
  - Hosts that do not match the pattern, such as `fonts.gstatic.com` with `<loopback>`, are connected directly by the server process ([socksProxy.ts L346-355, L417-466](https://github.com/microsoft/playwright/blob/v1.64.1/packages/utils/socksProxy.ts#L417-L466)).
- **Evidence against a network cause.**
  - No primary source links libsoup, HTTP/2, `Alt-Svc` or this proxy to stuck font loads.
  - In the mechanism above, the stuck faces' `CachedFont` is never fetched, so transport details are irrelevant.
  - The caller's macOS host repro, with no container, confirms the network path is not required.
- **What network state does change.** Whether the inserted copy fails, and so whether an older copy is ever loaded with `Allow` (§1.5 step 7).
- **Speculation, unverified.** Timing differences in the container (a slower or faster worker claim relative to style resolution) may explain why only 4–6 stories failed there versus 101/106 on macOS. The harness checks may also differ between the two setups.

## Q5. Spec and Chromium

- **CSS Font Loading** ([ED, 22 Oct 2026](https://drafts.csswg.org/css-font-loading/)):
  - A CSS-connected face starts loading only when the UA decides it is needed, by running `load()` ([§3.5 #font-face-set-css](https://drafts.csswg.org/css-font-loading/#font-face-set-css)).
  - `load()` sets `"loading"` and, when the attempt finishes, `"loaded"` or `"error"`. On finishing it removes the face from `[[LoadingFonts]]` and switches the set to loaded when that list is empty ([#font-face-load](https://drafts.csswg.org/css-font-loading/#font-face-load)).
  - The switch is blocked while the set is pending on the environment: document still loading, pending stylesheets, or pending layout that may request fonts ([#switch-the-fontfaceset-to-loaded](https://drafts.csswg.org/css-font-loading/#switch-the-fontfaceset-to-loaded), [#fontfaceset-pending-on-the-environment](https://drafts.csswg.org/css-font-loading/#fontfaceset-pending-on-the-environment)).
  - `ready` resolves at that switch ([#font-face-set-ready](https://drafts.csswg.org/css-font-loading/#font-face-set-ready)).
  - The spec defines **no timeout**. A face whose load truly never completes may stay `"loading"`, and the set with it.
  - But a face nobody asked to load must not be loading at all. WebKit's stuck faces have no load in flight, so they violate §3.5. WebKit's `"error"` for the swap period (`TimedOut`) also has no basis in the spec, because status follows the load attempt.
- **CSS Fonts 4** ([§3.2 font display timeline](https://drafts.csswg.org/css-fonts-4/#font-display-timeline), [§4.9 font-display](https://drafts.csswg.org/css-fonts-4/#font-display-desc)):
  - A face counts as a failed load only if the *failure period* starts before it loads.
  - `block` (and `auto`, in practice) and `swap` have an infinite swap period, so they have no failure period. There is nothing that would time them out.
- **Chromium** (official mirror, pinned):
  - A CSS-connected face becomes `kLoading` only when its active remote source is actually loading or loaded, or when it is really loaded ([css_font_face.cc L193-213](https://github.com/chromium/chromium/blob/d9278f43ae14fc8ba85312e1823687800c6439d9/third_party/blink/renderer/core/css/css_font_face.cc#L150-L215), `Load` L251-276).
  - A face only probed during fallback stays `kUnloaded` and is not added to `loading_fonts_` ([font_face_set.cc L160-178, L296-301](https://github.com/chromium/chromium/blob/42dbfc5a83b7adc66df76902e8ff4e1f77b4fe18/third_party/blink/renderer/core/css/font_face_set.cc#L160-L301)).
  - Chromium also waits for the load event before signalling ready ([font_face_set_document.cc L237-247](https://github.com/chromium/chromium/blob/cdf6d516c2c45e5efd44d8d1a9daf5bdcd5662da/third_party/blink/renderer/core/css/font_face_set_document.cc#L237-L247)).
  - Bug 326380 records Chrome and Firefox giving `loaded` and `unloaded` on the reduced page.
  - This is from reading the code, not from running it.

---

## Hypotheses to test with a minimal page

H1–H3, H5 (with and without the service worker, `local()` and a reachable URL), H7, H8, H9 and H12 were run afterwards; results are in [`research/webkit-fonts`](../../research/webkit-fonts/README.md). All matched the expectations below, except H8, which proved nothing because blocking service workers makes every mealdrop story fail in MSW's loader.

Run each on Playwright 1.64.1 (r2370) and on 1.65.0 (r2388). Log `document.fonts.status`, every face's `status` with `performance.now()`, the network requests, and whether `ready` resolves.

| # | Page | Expected on r2370 | What it would mean |
|---|---|---|---|
| H1 | One rule `src: local("NoSuch"), url(<gstatic 900 woff2>)`, `unicode-range: U+0400-04FF`, element with Latin text (bug 326380 page) | Set stays `loading`. Face is `loading` for 3 s, then `error`. No request for the URL. | The regression is present in your build. |
| H2 | H1 without `local()` | Set reaches `loaded`. Face stays `unloaded`. | The `local()`-then-`url()` shape is the trigger. |
| H3 | H1 with `font-display: swap` | Face is `error` at once. Set stays `loading`. | Confirms that `TimedOut` maps to `"error"` while still counted. |
| H4 | Two identical rules (`local()` then the same `url()`), Latin text, no service worker, no route | The older copy may be briefly `loading`/`error`. It becomes `loaded` when the shared fetch completes. Set reaches `loaded`. | A shared `CachedFont` rescues the duplicates. If it stays stuck, the rescue assumption in §1.4 is wrong. |
| H5 | H4, but the second rule is added with `insertRule` *after* a service worker (`skipWaiting` + `clients.claim`) controls the page, then the text renders | Inserted copy is `loaded`. Older copy is stuck `error`. Set is `loading` forever. Exactly one request for the URL. | Confirms the MSW split (§1.5 step 6). |
| H6 | H4 with a Playwright `page.route('**/*', r => r.continue())`. Do the `insertRule` after the `load` event, then before it. | After load: stuck. Before load: settles. | Confirms the route split via the cache-disabled reload. |
| H7 | H5 with an unreachable font URL | All copies end in `error` through `Failure`. Set reaches `loaded`. | Confirms the online-only explanation. |
| H8 | mealdrop with context option `serviceWorkers: 'block'` | `ready` resolves (MSW-driven stories may render without mocks). | MSW is the splitter in mealdrop. |
| H9 | Before the screenshot, run `for (const f of document.fonts) if (f.status !== 'loaded' && f.status !== 'unloaded') f.load().catch(() => {})` | `ready` resolves. A second request appears for each stuck URL. | `FontFace.load()` runs `pump(Allow)` ([FontFace.cpp L427-432](https://github.com/WebKit/WebKit/blob/5b391e6d3b14d549908dad2c6695999291313f30/Source/WebCore/css/FontFace.cpp#L427-L432)), which starts the old `CachedFont`. This would be a workaround for 1.64. |
| H10 | Set `PW_TEST_SCREENSHOT_NO_FONTS_READY=1` on the client only, then in the container's environment | Client only: still hangs. Container: no hang. | Confirms the variable is read by the server. |
| H11 | In mealdrop, wrap `CSSStyleSheet.prototype.insertRule` with `addInitScript` and log calls next to face status changes | If `"loading"` after 3 s always follows a recent rebuild, rebuilds explain the >10 s readings. | Otherwise the >10 s `"loading"` faces remain unexplained. |
| H12 | All of the above on 1.65.0 | Everything settles. | The fix covers both the unused-face and the duplicate cases. |

## Open questions

- Whether the visual-check harness registers any route. If it does, that is a second splitter even without MSW.
- The exact WebKit base of r2370 is in the private `playwright-browsers` repo; `5b391e6d` is inferred from the public snapshot.
