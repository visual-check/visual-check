# @visual-check/chromium

Names the one Chromium build visual-check renders with. The package holds data only: no code, no dependencies, no install scripts.

`@visual-check/cli` takes it as a peer dependency with a range of Chromium majors. It follows Chrome for Testing's Stable channel only.

## `chromium.json`

- `chromium`: the exact Chromium version, for example `157.0.8103.78`.
- `image.tag`: visual-check's container image, `ghcr.io/visual-check/chromium:<package version>`.
- `image.digest`: the image's index digest. visual-check pulls `<tag>@<digest>`. It's zeros until the version is published: the Browser package release workflow writes the index digest into the package it publishes, and records it on main.
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

The Browser package workflow (`.github/workflows/chromium.yml`) builds and verifies the image for both architectures on every pull request that changes this folder.

- A version that isn't published is a candidate. On its pull request, or a run by hand, the workflow pushes both images by digest without a tag and runs the test apps on the amd64 one as pushed. A fork's pull request only builds and verifies.
- Merging the version to `main` publishes it through `.github/workflows/chromium-release.yml`: it tags the candidate's images as `ghcr.io/visual-check/chromium:<version>`, writes the index digest into `image.digest`, then publishes the package. Nothing is built again.
- A published version is only built, verified and checked against its tag: the tag's index digest must be `image.digest`. A tag is never overwritten.

## Bumping

The Browser package bump workflow (`.github/workflows/chromium-bump.yml`) runs on the 1st and the 15th. When Chrome for Testing's Stable build is newer, it opens a pull request with the new version and checksums, and for a new major the CLI's wider browser range. Its checklist covers the image, the launch arguments in `packages/cli/src/capture/driver/cdp/launch-arguments.ts` and the baselines. The whole flow is in [Release process](../../docs/prd/19-release.md#releasing-the-browser-package).

## Versioning

- The major is the Chromium major.
- A minor is anything else that can move pixels: a Chromium point release or a rebuilt image.
- A patch never moves pixels, for example a corrected hash.
