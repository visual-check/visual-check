# @visual-check/chromium

Names the one Chromium build visual-check renders with. The package holds data only: no code, no dependencies, no install scripts.

`@visual-check/cli` takes it as a peer dependency with a range of Chromium majors. It follows Chrome for Testing's Stable channel only.

## `chromium.json`

- `chromium`: the exact Chromium version, for example `157.0.8103.78`.
- `image.tag`: visual-check's container image, `ghcr.io/visual-check/chromium:<package version>`.
- `image.digest`: the image's index digest. visual-check pulls `<tag>@<digest>`.
- `headlessShell`: the path of the headless shell inside the image.
- `sha256`: the SHA-256 of each Chrome for Testing headless shell download, by platform: `linux64`, `linux-arm64`, `mac-x64`, `mac-arm64` and `win64`. `platform: 'host'` checks the download against it. The download is `https://storage.googleapis.com/chrome-for-testing-public/<chromium>/<platform>/chrome-headless-shell-<platform>.zip`.

## Versioning

- The major is the Chromium major.
- A minor is anything else that can move pixels: a Chromium point release or a rebuilt image.
- A patch never moves pixels, for example a corrected hash.
