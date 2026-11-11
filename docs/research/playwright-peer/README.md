# Playwright peer dependency and Chromium version: desk research

Research for [Playwright peer dependency and Chromium version](https://github.com/visual-check/visual-check/issues/45), 2026-11-11. Docs, source and registry metadata only: no images pulled and no captures.

- [playwright-facts.md](playwright-facts.md): the Chromium each Playwright release bundles, where headless shell comes from (Chrome for Testing since 1.57 on x64, 1.63 on arm64), its path in the image, the loopback-only debugging port, and `playwright-core install`.
- [image-pinning.md](image-pinning.md): how Playwright's images are published and rebuilt, tag plus digest with `--platform`, and how other tools pick their screenshot browser.
- [digest-retention.md](digest-retention.md): whether superseded MCR digests stay pullable, and MCR's stated policy.
- [host-install.md](host-install.md): installing an exact headless shell on the host without Playwright: Chrome for Testing URLs and sizes, `@puppeteer/browsers`, unzipping options, proxies, and Linux libraries.
