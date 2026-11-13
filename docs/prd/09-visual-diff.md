# Visual diff

Part of the [v1 PRD](README.md). Terms come from the [glossary](../../GLOSSARY.md).

A snapshot passes when it differs from its baseline by no more than the story's tolerance. Tolerance has two parts: `color` says when one pixel counts as differing, and `pixels` says how many differing pixels are allowed.

## Pipeline

For each snapshot and its baseline:

1. Compare the two files' bytes. Identical bytes pass at once, with no decoding.
2. Decode both with `sharp`.
3. Compare width and height. A difference fails.
4. Count differing pixels with `pixelmatch` 8.
5. Only for a failing snapshot: draw the visual diff, encode it with `sharp` and write it.

Rules:

- The comparison runs in a pool of worker threads. Its size is half the machine's CPUs, at least 1 and at most 4, with no setting.
- The byte comparison depends on baselines and snapshots being stored exactly as the browser returned them, never re-encoded. On unchanged snapshots it fired 98–99% of the time.
- Masks are painted into both images, so the comparison takes no mask data.

## `tolerance.color`

- A number from 0 to 1: how far a pixel's colour may move and still count as unchanged. It's `pixelmatch`'s threshold.
- The default is `0.01`. At that value a grey shift of up to about 2 of 255 doesn't count.
- A lower `color` isn't stricter in practice. Noise then counts as change, and the pixel budget has to grow to absorb it.

## `tolerance.pixels`

One key, whose type sets its unit ([ADR 0006](../adr/0006-pixel-budget-is-one-key-in-css-pixels.md)):

| Value | Meaning |
|---|---|
| A whole number, 0 or more | A count of differing CSS pixels |
| A string from `'0%'` to `'100%'` | A share of the image's own pixels |
| Anything else, such as `1.5`, `-1` or `'0.1'` | Exit 2 |

- **A count scales with the device scale factor.** At scale s, the snapshot may have ⌊`pixels` × s²⌋ differing image pixels. So `20` allows 20 at scale 1, 45 at scale 1.5 and 80 at scale 2.
- **A share isn't scaled.** It's counted against the image's own pixels and rounded down to a whole pixel.
- A level sets a count or a share, never both. Each level replaces the budget it inherits.

## Defaults

- `tolerance: { color: 0.01, pixels: 20 }`, on every platform.
- It absorbs arm64's differences from amd64, and a dev server's small drift from a static build.
- It still catches 89–100% of small deliberate changes in the measurements behind it.

## Size differences

- A snapshot whose width or height differs from its baseline always fails, whatever `pixels` and the masks say.
- The visual diff is padded to the larger width and height, anchored at the top left.
- The padding counts as differing pixels.
- The report shows "size changed" and both sizes, for example `1280×2400 → 1280×2432`.

## Every pixel counts

- Anti-aliased pixels count like any other. There's no option for this in v1.
- `pixelmatch`'s neighbourhood filter, which drops a lone differing pixel, stays off.
- With anti-aliased pixels ignored, the default budget caught 118 of 260 hidden icons in the measurements. With every pixel counted, it caught 259.

## The visual diff image

- Differing pixels are magenta `#FF2D87`, over a faded copy of the baseline.
- The padding on a size difference is cyan `#00B4D8`.
- These are the logo's two colours. They appear only in report images, never in baselines.

## What a failure says

- **Message:** image pixels against the scaled budget, for example "84 differ, 80 allowed (20 at scale 2)". The scale shows only when it isn't 1, and a share shows as written.
- The JSON fields are in [Report and output](13-report-and-output.md).

## Where the same rules apply

- **Retries:** a snapshot beyond tolerance or of a different size is captured again, up to `retries` more times ([Readiness and stability](06-readiness-and-stability.md)).
- **`update`'s stability checks** use the story's tolerance, and a size difference counts as a disagreement ([Baselines and update](10-baselines-and-update.md)).
- **The remote-content hint** needs equal sizes.

## Sources

- [Visual diff libraries][8], [Visual diff benchmark][19], [Render parity on real stories][23], [Per-story options][37], [Visual diff rules: size, anti-aliasing and pixel budget][43], [Failure report format][39].
- [ADR 0006](../adr/0006-pixel-budget-is-one-key-in-css-pixels.md).
- Decided while writing this PRD: the pool's size, rounding a share down, the filter staying off, and the visual diff's colours.

[8]: https://github.com/visual-check/visual-check/issues/8
[19]: https://github.com/visual-check/visual-check/issues/19
[23]: https://github.com/visual-check/visual-check/issues/23
[37]: https://github.com/visual-check/visual-check/issues/37
[39]: https://github.com/visual-check/visual-check/issues/39
[43]: https://github.com/visual-check/visual-check/issues/43
