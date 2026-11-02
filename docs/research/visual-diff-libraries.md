# Visual diff libraries

Research for [#8](https://github.com/visual-check/visual-check/issues/8), part of the [v1 spec map](https://github.com/visual-check/visual-check/issues/1). Checked 2026-11-02.

## Recommendation

**Compute visual diffs with `pixelmatch` v8, run in a `worker_threads` pool, with PNG decoding kept as a separate, swappable step.** Compare the snapshot and baseline bytes first, and skip decoding when they are equal.

- **Features:** it is the only candidate with per-pixel masks (`ignoreMask`) and a noise-tolerant count (`windowSize`). It also has anti-aliasing detection on by default and marks those pixels in the diff image.
- **Install:** the diff step adds no native binary.
- **Speed:** at about 3.8 MP, the native tools have no meaningful lead once decoding is counted. At 18 MP and above `core-native` leads clearly, while `odiff` is mixed.
- **Main risk:** v8 is under a month old and its speed is unmeasured by anyone but its author. Run the benchmark under [Open questions](#open-questions) before locking this in.

**Runner-up:** `@blazediff/core`. It has almost the same call signature, so swapping is cheap if v8 turns out to be slow. Masks would then have to be painted onto both decoded images.

**Rejected:**
- `odiff`: no clear speed edge with anti-aliasing detection and diff output on (slower than `core-native` on all but the smallest fixture below), rectangle masks only, and two correctness fixes unreleased.
- `@blazediff/core-native`: fastest, but has no mask support and takes only encoded images, so masks can't be applied before the call. It also blocks the calling thread.

## How far to trust the numbers

- **I ran no benchmark.** All timings below come from committed BlazeDiff results, so a competitor of pixelmatch and odiff ran them.
- They ran on one machine (Apple M1 Max), from a commit flagged `dirty`, with pixelmatch **7.2.0** and odiff **4.3.8**, not the current versions.
- pixelmatch v8 has no published timings. Its release notes say only that it "runs nearly as fast as before".
- I found no independent 2026 benchmark and no independent accuracy comparison.

## Comparison

| | pixelmatch 8.0.0 | odiff-bin 4.5.0 | @blazediff/core 1.10.0 | @blazediff/core-native 6.0.2 |
|---|---|---|---|---|
| Implementation | Pure JS | Zig + SIMD binary | Pure JS | Rust + SIMD, N-API |
| Input | Decoded RGBA | File paths or encoded buffers | Decoded RGBA | File paths or encoded buffers |
| Colour metric | OKLab + HyAB | YIQ | YIQ | YIQ |
| Anti-aliasing detection default | On | Off | On | Off |
| Masks | Per-pixel `ignoreMask` | Rectangles (`ignoreRegions`) | None | None |
| Noise-tolerant count | `windowSize` | None | None | None |
| Different dimensions | Throws | Handled | Throws | Reports `layout-diff` |
| Threading | Blocks caller; needs workers | Separate process | Blocks caller; needs workers | `async` signature, but the N-API call is synchronous |
| Install size | 37 KB, plus pngjs 650 KB | 42 KB, plus 2.4-3.3 MB binary | 33 KB, no dependencies | 36 KB, plus 2.7-3.3 MB binaries |
| Latest release | 2026-10-06 | 2026-07-23 | 2026-08-03 | 2026-10-26 |
| Weekly downloads | 14.4M | 272K | 17.0M | 5.6K |

Sources: [pixelmatch README](https://github.com/mapbox/pixelmatch#api), [odiff README](https://github.com/dmtrKovalenko/odiff#api), [core options](https://github.com/teimurjan/blazediff/blob/main/packages/core/src/index.ts), [core-native source](https://github.com/teimurjan/blazediff/blob/main/packages/core-native/core-native/src/index.ts), npm registry and [npm downloads API](https://api.npmjs.org/downloads/point/last-week/pixelmatch) (2026-10-23 to 2026-10-29).

## Speed at realistic image sizes

Times are mean milliseconds from BlazeDiff's [core.json](https://github.com/teimurjan/blazediff/blob/main/benchmarks/results/core.json) and [core-native.json](https://github.com/teimurjan/blazediff/blob/main/benchmarks/results/core-native.json). Fixture sizes are read from the PNG headers.

The JS columns **exclude** decoding and encoding. The native columns **include** them, so the columns are not directly comparable. The [odiff benchmark](https://github.com/teimurjan/blazediff/blob/main/apps/image-benchmark/src/pixel-by-pixel/blazediff-odiff-benchmark.ts) runs with `antialiasing: true` through `ODiffServer` and writes a diff file.

**Images that differ**

| Fixture | Pixels | pixelmatch 7.2 (with diff buffer) | @blazediff/core (with diff buffer) | odiff 4.3.8 | core-native 6.0.1 |
|---|---|---|---|---|---|
| `blazediff/4` | 1320×2868, 3.8 MP | 25 | 18 | 24 | 26 |
| `4k/1` | 5600×3200, 17.9 MP | 415 | 142 | 1295 | 316 |
| `page/2` | 3000×13904, 41.7 MP | 642 | 270 | 607 | 415 |
| `page/1` | 3598×16384, 58.9 MP | 351 | 267 | 998 | 675 |

**Identical images, no diff buffer for the JS columns**

| Fixture | pixelmatch 7.2 | @blazediff/core | odiff 4.3.8 | core-native 6.0.1 |
|---|---|---|---|---|
| `blazediff/4` | 4.4 | 0.6 | 10.9 | 4.6 |
| `4k/1` | 23 | 2.9 | 271 | 187 |
| `page/2` | 49 | 6.9 | 124 | 42 |
| `page/1` | 69 | 10 | 542 | 249 |

**Rough totals for pixelmatch with a native PNG codec.** This adds libspng timings from [png.json](https://github.com/teimurjan/blazediff/blob/main/benchmarks/results/png.json) (two decodes, one uncompressed encode) to the pixelmatch column. It combines separate runs, so treat it as an estimate:

| Fixture | pixelmatch + libspng (estimate) | odiff | core-native |
|---|---|---|---|
| `blazediff/4` | about 38 | 24 | 26 |
| `4k/1` | about 810 | 1295 | 316 |
| `page/2` | about 800 | 607 | 415 |

What this means (my reading):

- **Most stories are small.** A gap of about 12 ms per changed story at 3.8 MP is small next to capturing it. I did not measure capture time.
- **Unchanged stories are the common case, and decoding is their main cost.** At 3.8 MP, 1000 identical pairs take about 4.4 s of pixelmatch CPU but about 6.9 s of libspng decoding. Comparing bytes first could skip both. This assumes the capture engine produces identical bytes for identical pixels, which I did not verify. When bytes differ, the normal comparison still gives the right answer, so the check can only save time.
- **Large images are where `core-native` wins clearly**, and even there its lead over the pixelmatch estimate is under a second per image.
- **Pure-JS decoding is the unknown.** The [odiff README](https://github.com/dmtrKovalenko/odiff#benchmarks) shows the pixelmatch CLI (which uses pngjs) at 7.7 s against 1.2 s for odiff on a full-page image. Versions and image size are unstated, but pixelmatch's diff step alone costs well under a second on similar images, so most of that gap looks like pngjs.

**odiff's fastest path doesn't apply here.** Its AVX kernel [requires](https://github.com/dmtrKovalenko/odiff/blob/main/src/diff.zig) no anti-aliasing detection, no ignore regions, a 0.1 threshold, equal dimensions and no diff capture. Server mode [always sets](https://github.com/dmtrKovalenko/odiff/blob/main/src/server.zig) `capture_diff = true`, so the Node server never uses that kernel. odiff's headline numbers therefore don't describe this use.

## Anti-aliasing

- **pixelmatch:** on by default, using the Vyšniauskas (2009) detector. v8 made it [more reliable with transparency](https://github.com/mapbox/pixelmatch/releases/tag/v8.0.0). Known weak spots remain open: false positives on thin shapes ([#74](https://github.com/mapbox/pixelmatch/issues/74), since 2019) and inconsistent Chrome font rendering ([#107](https://github.com/mapbox/pixelmatch/issues/107)). `windowSize` helps with the scattered kind of noise, because such pixels rarely fill one small square.
- **@blazediff/core and core-native:** the [same detector](https://www.npmjs.com/package/@blazediff/core-native). Off by default in core-native, so it must be enabled.
- **odiff:** off by default (`antialiasing: false` in [the CLI](https://github.com/dmtrKovalenko/odiff/blob/main/src/cli.zig)). [#164](https://github.com/dmtrKovalenko/odiff/issues/164) is an open report of flaky results.

**Colour metric:** pixelmatch v8 [replaced YIQ with OKLab + HyAB](https://github.com/mapbox/pixelmatch/releases/tag/v8.0.0), claiming fewer false positives and fewer missed changes. That is the maintainer's claim; I found no independent test. The other three still use YIQ.

## Diff image output

- **pixelmatch:** writes RGBA into a buffer you supply, so any encoder works and the PNG is only encoded when needed. Unchanged pixels are grey, differences red, anti-aliased pixels yellow. `diffColorAlt` separates added from removed, and `diffMask` gives a transparent overlay. These suit a failure report.
- **odiff:** writes a PNG to a path, only when images differ. Options are `diffColor`, `outputDiffMask` and `diffOverlay`. `captureDiffLines` and `captureDiffCols` return the changed rows and columns, enough for a bounding box. Anti-aliased pixels are not marked.
- **@blazediff/core:** same drawing options as pixelmatch.
- **core-native:** writes PNG, JPEG or QOI to a path. Options are `diffMask`, `diffColorAlt`, compression and quality only.

pixelmatch also [runs in browsers](https://github.com/mapbox/pixelmatch#browsers), which keeps an in-browser option open for the Storybook addon. That is an option, not a decision.

## Native install burden

- **pixelmatch and @blazediff/core:** none for the diff step. pixelmatch is [ESM-only](https://github.com/mapbox/pixelmatch/blob/main/package.json). It depends on `pngjs` for its CLI, and pngjs was last published in 2023.
- **odiff-bin:** prebuilt binaries through `optionalDependencies` for 7 platforms, with [no install script](https://github.com/dmtrKovalenko/odiff/blob/main/npm_packages/odiff-bin/package.json) (the README's post-install text is out of date). Alpine issues [#5](https://github.com/dmtrKovalenko/odiff/issues/5) and [#55](https://github.com/dmtrKovalenko/odiff/issues/55) are still open, though old; current status unverified.
- **core-native:** prebuilt through `optionalDependencies` for 6 platforms. Linux packages are [built from glibc targets](https://github.com/teimurjan/blazediff/blob/main/crates/scripts/_targets.sh), and there is no musl package.
- **PNG decoding (needed with pixelmatch):** this is where a native dependency may come back.
  - `sharp` has [prebuilt binaries](https://github.com/lovell/sharp/blob/main/docs/src/content/docs/install.md) for glibc and musl, but adds about 19 MB, and its libvips package is LGPL-3.0-or-later. It uses [libpng](https://github.com/lovell/sharp-libvips/blob/main/versions.properties), not libspng, so the estimate above doesn't transfer directly.
  - `pngjs` needs no native code but is probably much slower on large images.

## Maintenance

- **pixelmatch:** active, with [a major release on 2026-10-06](https://github.com/mapbox/pixelmatch/releases/tag/v8.0.0) that changed how differences are counted. Nearly all commits come from one author (mourner, 142 commits), under the Mapbox organisation. [Playwright](https://github.com/microsoft/playwright/blob/main/packages/utils/comparators.ts) still vendors a copy as its default comparator.
- **odiff:** active, mostly one author (284 commits), 30 commits so far in 2026. [Two fixes on main are unreleased](https://github.com/dmtrKovalenko/odiff/compare/v4.5.0...main), including one for systematic under-counting of differences (#185).
- **BlazeDiff:** the most active (100+ commits in 2026) but has one human contributor and a lot of churn: a [package rename in March 2026](https://www.npmjs.com/package/@blazediff/core-native) and majors 5 and 6 between May and August. Downloads of `@blazediff/core` probably come mainly from [Vitest, which switched to it](https://github.com/vitest-dev/vitest/pull/9514) and [pins it](https://github.com/vitest-dev/vitest/blob/main/packages/browser/package.json). `core-native` has only 5.6K weekly downloads.

## Others ruled out

- **Resemble.js:** last release 2023, last commit 2023, depends on native `canvas`.
- **ssim.js:** repository archived. SSIM also gives a similarity score rather than a pixel count.
- **looks-same:** last release August 2025. Not evaluated further.
- **reg-cli:** a whole tool rather than a library, and its current line is a release candidate.
- **dify:** Rust CLI. Its [npm wrapper](https://www.npmjs.com/package/dify-bin), `dify-bin`, was last published in 2022.
- **Playwright's `ssim-cie94` comparator:** [internal to Playwright](https://github.com/microsoft/playwright/blob/main/packages/utils/comparators.ts), not a published library.
- **honeydiff:** appears in BlazeDiff's benchmarks. Not investigated.

## What the choice means for the engine

- **Size mismatches:** pixelmatch throws, so the engine must check dimensions first. It can either report a size change or pad both images, as [Playwright does](https://github.com/microsoft/playwright/blob/main/packages/utils/comparators.ts).
- **Pin the major version:** v8 [changed diff counts](https://github.com/mapbox/pixelmatch/releases/tag/v8.0.0) without changing the API. A future metric change could fail users' stories, so upgrades should be deliberate.
- **Threshold wording:** `threshold` is a per-pixel colour distance, [not a share of the image](https://github.com/mapbox/pixelmatch#api). The per-story options design should keep the two apart.

## Open questions

1. **Benchmark before committing.** Time pixelmatch 8 and `@blazediff/core` on real snapshots at the chosen viewports, on a GitHub Actions x64 runner, including decoding. Switch to `@blazediff/core` if v8 is materially slower.
2. **sharp or pngjs for decoding?** My lean is sharp for speed, but it adds 19 MB. The same benchmark should settle it.
3. **Are capture bytes stable?** Check that identical pixels give identical bytes from the chosen capture engine. This depends on the capture engine decision.
