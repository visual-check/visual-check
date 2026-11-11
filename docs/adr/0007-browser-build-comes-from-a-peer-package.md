# The project picks its browser build through a browser package of ours

v1 captures Chromium only, on visual-check's own raw CDP driver, so nothing in visual-check calls Playwright. The browser build comes from `@visual-check/chromium`, a data-only package that the CLI takes as a peer dependency with a range. Each version names one exact Chromium build from Chrome for Testing's Stable channel: visual-check's own image by tag and digest (ADR 0008), and the matching Chrome for Testing download with its SHA-256 for `host`. The version the project installs picks the build, so the project decides when its browser changes. Two alternatives lost ([Playwright peer dependency and Chromium version](https://github.com/visual-check/visual-check/issues/45)):

- **The project's `playwright-core` as the peer,** as [Capture engine and host Playwright reuse](https://github.com/visual-check/visual-check/issues/11) had it. A project that bumps Playwright for its end-to-end tests would change the browser behind its baselines. The `<2` range lets in Chromium builds no release was tested on. The image could only be pinned by tag, and Playwright rebuilds tags in place: `v1.64.1-noble` has three builds.
- **One build pinned by each CLI release,** as Puppeteer and Lost Pixel do. Every CLI fix would then come with a browser bump, and a project couldn't take one without the other.

## Consequences

- The CLI's peer range lists only the Chromium majors it was tested on. Raising its floor forces projects onto a new browser, so that waits for a CLI major.
- A browser package's major is the Chromium major. A minor may move pixels and a patch never does.
- The driver exits 2 when the browser it connects to isn't the package's build, so a custom image or a job container can't drift from it.
- Moving the choice anywhere else later changes every project's dependencies.
