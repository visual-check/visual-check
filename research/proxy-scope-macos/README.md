# Proxy scope on macOS (throwaway research)

Answers the [Proxy scope on macOS](https://github.com/visual-check/visual-check/issues/30) ticket: should the SOCKS proxy on macOS carry only the Storybook's hosts, with everything else fetched straight from the container? Not production code. It lives only on this branch.

The harness is the [Driver interface prototype](https://github.com/visual-check/visual-check/tree/prototype/driver-interface/prototype/driver-interface)'s, with these changes:

- `raw-cdp.ts`: network modes `proxy` (all traffic through the SOCKS proxy, loopback included), `bypass` (`--proxy-bypass-list=<list>;<-loopback>`, so `*` sends only loopback through the proxy), `pac` (`--proxy-pac-url`, which headless shell ignores) and `host`.
- `socks.ts`: logs each proxied connection's DNS lookup, connect and close times and bytes.
- `capture.ts`: records the external resources each page had loaded by screenshot time, from Resource Timing. `--settle <ms>` waits that much more before the screenshot.
- `arms.sh`: arms `proxy`, `scoped` (bypass `*`), `hostnet`, `pw` (Playwright Chromium with `exposeNetwork`) and `settle` (`proxy` plus 100 ms), in round robin.
- `analyze.mjs`: run deviations per arm with permutation tests, and per run the cells that differ in content from the runners' most common snapshot.
- `timing.py`: resource and proxy timing per arm. `dedupe.py`: each distinct snapshot once, with a manifest.
- `probe.ts`: one page through one network mode, printing what went through the proxy.
- `decode.ts`: fetches `cdn-urls.txt` with Chromium's image `Accept` header, records bytes and CDN edges, and renders each image alone.
- `findings.md`: what Chromium's source and the runtimes' docs say, with citations.

Results are in the ticket's Answer.

```bash
npm ci --ignore-scripts
node serve.mjs <storybook-static> 6400 127.0.0.1 &
./arms.sh http://127.0.0.1:6400 runs/local 15 proxy scoped hostnet pw
node analyze.mjs --local runs/local --runner <dedupe.py output>...
python3 -I timing.py runs/local
```

Needs Docker and `mcr.microsoft.com/playwright:v1.64.1-noble` for `linux/amd64`. Node 22.18 or later runs the `.ts` files directly. The Storybook is the prototype's mealdrop build (tar sha256 `3114c459`).
