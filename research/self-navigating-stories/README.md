# Self-navigating stories under raw CDP (throwaway)

Answers the [Self-navigating stories under raw CDP](https://github.com/visual-check/visual-check/issues/31) ticket: why do mealdrop's userflow stories lose their document more often under raw CDP than under Playwright Chromium on 2-vCPU runners? Not production code. It lives only on this branch.

Built on the [Driver interface prototype](https://github.com/visual-check/visual-check/issues/29)'s drivers and capture run, cut down to the 7 userflow stories, repeated 3 times per run, with up to 5 attempts per story.

- `capture.ts`: one run. A probe in the page logs each click user-event dispatches, whether its target is still in the document, and when the router's transition puts the category list in the DOM. The log lives in `sessionStorage`, so it survives the story's own navigation.
- `raw-cdp.ts`: raw CDP, with `net` (Playwright's `Network.enable`) and `pwSetup` (the rest of what Playwright 1.64.1 sends: Log, lifecycle events, Runtime, its utility world and script, auto-attach paused at start, service workers attached) switches.
- `playwright.ts`: Playwright Chromium through `run-server`, optionally with run-server's `pw:protocol` log.
- `arms.sh`: the arms, in rotated round robin. `analyze.py`: loss rates per arm, permutation tests over runs, and the probe's timings.

```bash
npm ci --ignore-scripts
node serve.mjs <storybook-static> 6400 127.0.0.1 &
./arms.sh http://127.0.0.1:6400 runs 1 0 raw pw
python3 -I analyze.py runs
```
