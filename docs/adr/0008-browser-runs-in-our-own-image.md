# The browser runs in visual-check's own image, with Chrome for Testing inside

visual-check publishes the image its browser runs in. `ghcr.io/visual-check/chromium` is built for amd64 and arm64 from `ubuntu:24.04` pinned by digest, with apt pinned to an Ubuntu snapshot. It holds the libraries headless shell links against, fontconfig's config, Playwright's font packages minus the X fonts Chromium can't use, and Chrome for Testing's Stable headless shell, unzipped as Google ships it. The browser package records the image by tag and digest (ADR 0007). Three alternatives lost ([GitHub Action design](https://github.com/visual-check/visual-check/issues/40)):

- **Playwright's image,** as ADRs 0003 and 0007 first had it:
  - About 71% of its 1 GB is Firefox, WebKit, full Chrome, ffmpeg and Node.
  - A fresh runner needed 27 s from pull to a browser reply, against 8 s for ours.
  - Its tags are rebuilt in place.
  - Its headless shell is the same Chrome for Testing zip and its fonts are the same packages, so on 300 real stories both images rendered the same pixels, under Rosetta too.
- **An image without the browser,** with the CLI downloading Chrome for Testing at run time and mounting it:
  - It would avoid redistributing a binary whose `ABOUT` file points to Chrome's terms.
  - But every machine pays a download, an unzip and a mount: 9.5 s instead of 7.9 s, and captures through Docker Desktop on Windows ran 0–4% slower.
  - Microsoft's Playwright image and Google's Puppeteer image both ship Chrome for Testing inside.
- **A plain Chromium build:**
  - Debian's lags stable and builds against Debian's own HarfBuzz and fontconfig.
  - Chromium's snapshots have no arm64 and no release builds.
  - Building it ourselves takes about 15–17 h per release.

## Consequences

- A rebuild can move pixels, so the image is rebuilt only on purpose and ships as a browser package minor. Security fixes in its libraries wait for one.
- If Google objects to redistribution, the fallback is a run-time download or Debian's Chromium, each shipped as a new browser package version.
- `host` downloads the same Chrome for Testing build from Google, so the browser's bytes are the same everywhere.
- The image has no Node. Running the CLI inside it, in a job container or a devcontainer, means adding Node, and an image built `FROM` ours keeps the marker that lets the CLI skip Docker there.
- Moving to another image later changes pixels for every project.
