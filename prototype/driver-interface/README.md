# Driver interface prototype (throwaway)

Answers the [Driver interface prototype](https://github.com/visual-check/visual-check/issues/29) ticket: does raw CDP hold up as visual-check's Chromium driver on a real Storybook, with no more flakiness than Playwright? Not production code. It lives only on this branch.

- `driver.ts`: the driver interface visual-check owns, and its errors.
- `raw-cdp.ts`: Chromium headless shell over a CDP pipe through `docker run -i --rm`, with host networking on Linux or the SOCKS proxy (`socks.ts`) elsewhere. Handles dialogs, popups, downloads, page crashes and browser exit.
- `playwright.ts`: the same interface on Playwright through `run-server` in the container with `exposeNetwork`. WebKit for real, Chromium only as the throwaway comparison arm.
- `capture.ts`: one capture run through the interface, as Story readiness and page reuse decided, with broken stories, the lost-document retry, crash recovery and one relaunch.
- `compare.ts`: broken stories per run, and pixel differences between runs, per arm.
- `checks.sh`: whether the container goes when visual-check is killed, and browser-exit handling.
- `stories/Hazards.stories.tsx`: stories that open dialogs, a popup, an iframe, a download, permission requests and a renderer crash, added to [storybookjs/mealdrop](https://github.com/storybookjs/mealdrop) before its build.

```bash
npm ci --ignore-scripts
node serve.mjs <storybook-static> 6400 127.0.0.1 &
./run-arms.sh http://127.0.0.1:6400 runs/local 5
./checks.sh http://127.0.0.1:6400 runs/checks
```

Needs Docker and `mcr.microsoft.com/playwright:v1.64.1-noble` for `linux/amd64`. Node 22.18 or later runs the `.ts` files directly.
