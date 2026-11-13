# @visual-check/chromium

Names the one Chromium build visual-check renders with. The package holds data only: no code, no dependencies, no install scripts.

`@visual-check/cli` takes it as a peer dependency with a range of Chromium majors. It follows Chrome for Testing's Stable channel only.

## `chromium.json`

- `chromium`: the exact Chromium version, for example `157.0.8103.78`.
- `image.tag`: visual-check's container image, `ghcr.io/visual-check/chromium:<package version>`.
- `image.digest`: the image's index digest. visual-check pulls `<tag>@<digest>`.
- `headlessShell`: the path of the headless shell inside the image.
- `sha256`: the SHA-256 of each Chrome for Testing headless shell download, by platform: `linux64`, `linux-arm64`, `mac-x64`, `mac-arm64` and `win64`. `platform: 'host'` checks the download against it. The download is `https://storage.googleapis.com/chrome-for-testing-public/<chromium>/<platform>/chrome-headless-shell-<platform>.zip`.

## Image

`ghcr.io/visual-check/chromium:<package version>` is the image the browser runs in, for amd64 and arm64. It holds Chrome for Testing's headless shell as Google ships it, the libraries it links against, fontconfig and Playwright's fonts without the X fonts, the `C.UTF-8` locale, the marker `/etc/visual-check/chromium.json` and a list of its packages. It has no Node.

On amd64, apt is pinned to the Ubuntu snapshot the Dockerfile names. On arm64 it isn't, because the snapshot service doesn't serve ubuntu-ports. There, the package list in the image is the record.

Its Dockerfile is in `image/`. Building it locally needs `docker buildx` and `jq`. To build it and check it, from this folder:

```sh
image/build.sh arm64 --output type=docker,name=visual-check-chromium:arm64
image/verify-image.sh visual-check-chromium:arm64 arm64
```

The architecture is `amd64` or `arm64`. Options after it go to `docker buildx build`.

## Versioning

- The major is the Chromium major.
- A minor is anything else that can move pixels: a Chromium point release or a rebuilt image.
- A patch never moves pixels, for example a corrected hash.
