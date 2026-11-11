# Playwright / headless-shell facts for the Chromium driver

Researched 2026-11-11. Latest stable: `playwright-core@1.65.0` (npm `latest`); `next` = `1.66.0-alpha-2026-11-11`; `main` still pins Chromium 158.0.8127.18 / r1254 ([npm](https://registry.npmjs.org/playwright-core), [main browsers.json](https://github.com/microsoft/playwright/blob/main/packages/playwright-core/browsers.json)).
Abbreviations: PW = Playwright, CfT = Chrome for Testing, HS = `chromium-headless-shell`, `reg@vX` = `packages/playwright-core/src/server/registry/index.ts` at tag vX.

## 1. Bundled Chromium per release, and where Linux HS comes from

Version and revision come from `packages/playwright-core/browsers.json` at each tag (`https://github.com/microsoft/playwright/blob/<tag>/packages/playwright-core/browsers.json`). The HS revision is always the same as the `chromium` revision. Patch releases not listed have the same values as their `.0`.

| PW | Chromium | rev | linux x64 HS source | linux arm64 HS source |
|---|---|---|---|---|
| 1.49.0 / .1 | 131.0.6778.33 | 1148 | PW build | PW build |
| 1.50.0 / .1 | 133.0.6943.16 | 1155 ¹ | PW build | PW build |
| 1.51.0 / .1 | 134.0.6998.35 | 1161 | PW build | PW build |
| 1.52.0 | 136.0.7103.25 | 1169 | PW build | PW build |
| 1.53.0 | 138.0.7204.15 | 1178 | PW build | PW build |
| 1.53.1 / .2 | 138.0.7204.23 | 1179 | PW build | PW build |
| 1.54.0–.2 | 139.0.7258.5 | 1181 | PW build | PW build |
| 1.55.0 | 140.0.7339.16 | 1187 | PW build | PW build |
| 1.55.1 | 140.0.7339.186 | 1193 | PW build | PW build |
| 1.56.0 / .1 | 141.0.7390.37 | 1194 | PW build | PW build |
| 1.57.0 | 143.0.7499.4 | 1200 | **CfT**, served through PW's `builds/chromium/` URL ² | PW build |
| 1.58.0–.2 | 145.0.7632.6 | 1208 | CfT (`cftUrl`) ³ | PW build |
| 1.59.0 / .1 | 147.0.7727.15 | 1217 | CfT | PW build |
| 1.60.0 | 148.0.7778.96 | 1223 | CfT | PW build |
| 1.61.0 / .1 | 149.0.7827.55 | 1228 | CfT | PW build |
| 1.62.0 / .1 | 151.0.7922.34 | 1234 | CfT | PW build |
| 1.63.0 | 153.0.8010.12 | 1243 | CfT | **CfT** |
| 1.64.0 / .1 | 156.0.8078.4 | 1248 | CfT | CfT |
| 1.65.0 | 158.0.8127.18 | 1254 | CfT | CfT |

- **"PW build"** means the URL is `builds/chromium/<rev>/chromium-headless-shell-linux[-arm64].zip` on PW's CDN mirrors ([reg@v1.49.0 L112-125](https://github.com/microsoft/playwright/blob/v1.49.0/packages/playwright-core/src/server/registry/index.ts#L112-L125)). On 2026-11-11, a HEAD request for r1194 x64 and for r1234 arm64 returned a 307 redirect to `playwright.download.prss.microsoft.com/...`, which is Microsoft's ESRP CDN and not Google.
- **"CfT"** in 1.58.0: `cftUrl()` builds `https://cdn.playwright.dev/chrome-for-testing-public/<browserVersion>/linux64/chrome-headless-shell-linux64.zip` ([reg@v1.58.0 L130-139, L174-187](https://github.com/microsoft/playwright/blob/v1.58.0/packages/playwright-core/src/server/registry/index.ts#L130-L139)). From 1.58.1 on it builds `https://cdn.playwright.dev/builds/cft/<browserVersion>/...` (commit [a9a8cbb, #39037](https://github.com/microsoft/playwright/commit/a9a8cbbe22), cherry-picked into 1.58.1). On 2026-11-11, HEAD on `.../builds/cft/158.0.8127.18/linux64/...` and `.../linux-arm64/...` returned a 307 to `storage.googleapis.com/chrome-for-testing-public/158.0.8127.18/...`. That is Google's own CfT bucket.
- ¹ 1.50.x `browsers.json` has no `chromium-headless-shell` entry. The registry adds one by copying the `chromium` entry ([reg@v1.50.0 L447-454](https://github.com/microsoft/playwright/blob/v1.50.0/packages/playwright-core/src/server/registry/index.ts#L447-L454)).
- ² In 1.57.0 the download URL still has the PW form `builds/chromium/1200/chromium-headless-shell-linux.zip`, but the expected layout is CfT's: `chrome-headless-shell-linux64/chrome-headless-shell` ([reg@v1.57.0 L70-77, L161-174](https://github.com/microsoft/playwright/blob/v1.57.0/packages/playwright-core/src/server/registry/index.ts#L70-L77)). On 2026-11-11, HEAD on that URL returned a 307 to `storage.googleapis.com/chrome-for-testing-public/143.0.7499.4/linux64/chrome-headless-shell-linux64.zip`.

**When PW switched to CfT**
- **linux x64 (and mac/win): 1.57.0.** Release notes: "Playwright now runs on Chrome for Testing builds rather than Chromium… headless mode uses `chrome-headless-shell`… On Arm64 Linux, Playwright continues to use Chromium" ([release-notes-js.md@v1.65.0 L1065-1075](https://github.com/microsoft/playwright/blob/v1.65.0/docs/src/release-notes-js.md#L1065-L1075)). Commits: [a96c870 #38128](https://github.com/microsoft/playwright/commit/a96c8700a2) "roll chromium to 1200, update for CfT paths" and the arm64 path fix [0b7307d #38164](https://github.com/microsoft/playwright/commit/0b7307de2b). ³ From 1.58.0 the URLs point at CfT directly ([3b5fe87 #38573](https://github.com/microsoft/playwright/commit/3b5fe8705d)).
- **linux arm64: 1.63.0.** Release notes: "On Linux arm64, Playwright now downloads the Chrome for Testing build" ([release-notes-js.md@v1.65.0 L407](https://github.com/microsoft/playwright/blob/v1.65.0/docs/src/release-notes-js.md#L407)). Commit: [fab1c04 #42440](https://github.com/microsoft/playwright/commit/fab1c044c8), fixes [#42386](https://github.com/microsoft/playwright/issues/42386). Google's CfT JSON first lists `linux-arm64` for `chrome-headless-shell` at 153.0.8001.0 ([known-good-versions-with-downloads.json](https://googlechromelabs.github.io/chrome-for-testing/known-good-versions-with-downloads.json)).

## 2. HS executable path in the Docker image

- The image sets `PLAYWRIGHT_BROWSERS_PATH=/ms-playwright` and installs browsers with `playwright-core install` ([Dockerfile.noble@v1.49.0 L30-49](https://github.com/microsoft/playwright/blob/v1.49.0/utils/docker/Dockerfile.noble#L30-L49); [@v1.65.0 L38-57](https://github.com/microsoft/playwright/blob/v1.65.0/utils/docker/Dockerfile.noble#L38-L57), which notes "installing chromium also installs chromium-headless-shell").
- The directory name has not changed: `<registryDir>/chromium_headless_shell-<rev>`, because `-` is replaced with `_` ([reg@v1.65.0 L457-480](https://github.com/microsoft/playwright/blob/v1.65.0/packages/playwright-core/src/server/registry/index.ts#L457-L480)).
- The subpath inside that directory did change. It comes from `EXECUTABLE_PATHS['chromium-headless-shell']`:

| PW | amd64 image | arm64 image | source |
|---|---|---|---|
| 1.49–1.56 | `chrome-linux/headless_shell` | `chrome-linux/headless_shell` | [reg@v1.49.0 L59-63](https://github.com/microsoft/playwright/blob/v1.49.0/packages/playwright-core/src/server/registry/index.ts#L59-L63) |
| 1.57–1.62 | `chrome-headless-shell-linux64/chrome-headless-shell` | `chrome-linux/headless_shell` | [reg@v1.57.0 L70-77](https://github.com/microsoft/playwright/blob/v1.57.0/packages/playwright-core/src/server/registry/index.ts#L70-L77) |
| 1.63–1.65 | `chrome-headless-shell-linux64/chrome-headless-shell` | `chrome-headless-shell-linux-arm64/chrome-headless-shell` | [reg@v1.63.0 L73-80](https://github.com/microsoft/playwright/blob/v1.63.0/packages/playwright-core/src/server/registry/index.ts#L73-L80), [reg@v1.65.0 L73-80](https://github.com/microsoft/playwright/blob/v1.65.0/packages/playwright-core/src/server/registry/index.ts#L73-L80) |

Example for v1.65.0 amd64: `/ms-playwright/chromium_headless_shell-1254/chrome-headless-shell-linux64/chrome-headless-shell`. These paths come from the source code. No image was pulled to check them.

MCR has these noble tags: `v1.63.0`, `v1.64.0`, `v1.64.1` and `v1.65.0` ([tags/list](https://mcr.microsoft.com/v2/playwright/tags/list)).

## 3. Does `chrome-headless-shell` honour `--remote-debugging-address`?

**No. It always binds to 127.0.0.1, falling back to ::1. This has been true since Chromium M126.**
- At [158.0.8127.18 `headless/lib/browser/command_line_handler.cc` L57-72, L217-224](https://github.com/chromium/chromium/blob/158.0.8127.18/headless/lib/browser/command_line_handler.cc#L57-L72), only the port is read into `options.devtools_port`. No address switch is parsed.
- At [158.0.8127.18 `headless/lib/browser/headless_devtools.cc` L40-52](https://github.com/chromium/chromium/blob/158.0.8127.18/headless/lib/browser/headless_devtools.cc#L40-L52), `CreateLocalHostServerSocket` calls `ListenWithAddressAndPort("127.0.0.1", …)` and falls back to `"::1"`. The file is identical at 156.0.8078.4. A `TCPAdoptServerSocketFactory` class is defined there but is not used in `StartLocalDevToolsHttpHandler`.
- Removal commit: [6fee475 "[headless] Remove --remote-debugging-address support from old headless"](https://github.com/chromium/chromium/commit/6fee475feb9bc9aaded8f9b6443d18edb22de86b) (2024-05-03, main@{#1296157}). It gives the reason as "Unprotected remote access to Chrome DevTools Protocol was deemed to be too dangerous". Bug: [crbug.com/327558594](https://crbug.com/327558594); CL [5512634](https://chromium-review.googlesource.com/c/chromium/src/+/5512634). The M126 branch point is #1300313 ([chromiumdash](https://chromiumdash.appspot.com/fetch_milestones?mstone=126)). Checked: `command_line_handler.cc` still reads `kRemoteDebuggingAddress` at 125.0.6422.141 and no longer does at 126.0.6478.126.
- Full Chrome is also loopback-only at 158 ([`chrome/browser/devtools/remote_debugging_server.cc` L89-92, L133-151](https://github.com/chromium/chromium/blob/158.0.8127.18/chrome/browser/devtools/remote_debugging_server.cc#L89-L92)).

## 4. `chromium.connectOverCDP`: transports, pipes, sharing

**What the public API accepts in 1.65.0** ([types.d.ts@v1.65.0 L17486, L17520, L18393-18399](https://github.com/microsoft/playwright/blob/v1.65.0/packages/playwright-core/types/types.d.ts#L17486)):
1. `endpointURL: string`, either `http(s)://…` (Playwright resolves it through `/json/version`) or `ws(s)://…`.
   - Since 1.65.0 it can also be a channel name such as `chrome` or `msedge`. Playwright then reads `DevToolsActivePort` from that channel's default user-data-dir and connects to `ws://localhost:<port>…` ([server chromium.ts@v1.65.0 L90-116, L475-498](https://github.com/microsoft/playwright/blob/v1.65.0/packages/playwright-core/src/server/chromium/chromium.ts#L90-L116)).
2. **Since 1.61.0 (JS/TS only): `connectOverCDP(transport: ConnectOverCDPTransport)`.** The transport is `{ open?(); send(message: object); close(); onmessage?; onclose? }` and is detected by duck-typing `send`/`close` ([client browserType.ts@v1.65.0 L135-170, L191](https://github.com/microsoft/playwright/blob/v1.65.0/packages/playwright-core/src/client/browserType.ts#L135-L170)).
   - It works **in-process only**. It throws "not supported when connecting remotely" ([#40997](https://github.com/microsoft/playwright/pull/40997)).
   - The type is defined only in `utils/generate_types/overrides.d.ts` and is not in the API docs ([#40972](https://github.com/microsoft/playwright/pull/40972)).
   - The server treats it as `isLocal: true` ([chromium.ts@v1.65.0 L84-87](https://github.com/microsoft/playwright/blob/v1.65.0/packages/playwright-core/src/server/chromium/chromium.ts#L84-L87)).
   - A private `_connectOverCDPTransport` existed only in 1.59.x. It was removed by [#40195](https://github.com/microsoft/playwright/pull/40195), so it is not in 1.60.0.
- `ConnectOverCDPOptions` has: `artifactsDir`, `endpointURL`, `headers`, `isLocal`, `noDefaults`, `slowMo`, `timeout`. There is **no `pipe` option** ([types.d.ts@v1.65.0 L26043](https://github.com/microsoft/playwright/blob/v1.65.0/packages/playwright-core/types/types.d.ts#L26043)).
- `launch()` adds `--remote-debugging-pipe` itself and rejects a user-supplied one: "Playwright manages remote debugging connection itself" ([chromium.ts@v1.65.0 L355-372](https://github.com/microsoft/playwright/blob/v1.65.0/packages/playwright-core/src/server/chromium/chromium.ts#L355-L372)).

**Attaching to a browser that another process launched with `--remote-debugging-pipe`**
- With a URL: impossible. A pipe has no URL.
- With PW ≥1.61 in JS: possible only if the same Node process has the pipe streams, for example the stdio of `docker run -i`, and wraps them in a `ConnectOverCDPTransport`. In the default pipe mode, messages are NUL-terminated JSON ([devtools_pipe_handler.cc@158 L296, L407-418](https://github.com/chromium/chromium/blob/158.0.8127.18/content/browser/devtools/devtools_pipe_handler.cc#L407-L418)). This is inferred from the API shape. It has not been tested.

**Two clients on one pipe**
- Chromium creates one `DevToolsPipeHandler`, attached as a **single client** of the browser target ([devtools_pipe_handler.cc@158 L397-405](https://github.com/chromium/chromium/blob/158.0.8127.18/content/browser/devtools/devtools_pipe_handler.cc#L397-L405)). It uses fixed fds 3 and 4 ([devtools_agent_host.h@158 L73-74](https://github.com/chromium/chromium/blob/158.0.8127.18/content/public/browser/devtools_agent_host.h#L73-L74)).
- So two clients sharing one pipe look like one CDP client to Chromium. A relay must rewrite `id`s and send events to the right client by `sessionId`.
- Not verified, inferred: state that belongs to the connection, such as `Target.setAutoAttach` or `setDiscoverTargets`, would also be shared between the two clients.

**Known relay/multiplexer projects** (none is widely used)

| project | what it does | status |
|---|---|---|
| [mimkorn/chrome-pipe-proxy](https://github.com/mimkorn/chrome-pipe-proxy) | Owns Chrome over `--remote-debugging-pipe` and exposes a WebSocket plus `/json/version`. README describes rewriting request ids and routing events per session. | MIT, 1★, last push 2026-05-04 |
| [bayandin/devtools-proxy](https://github.com/bayandin/devtools-proxy) | WebSocket multiplexer, Python. Its README says native multi-client support exists since Chrome 63. | MIT, archived, last push 2019 |
| [cdpai/gate](https://github.com/cdpai/gate) | Launches a browser over a pipe and re-exposes it. Description only; not reviewed. | 0★, last push 2026-11-10 |

`chromedp/chromedp-proxy` and `wendigo/chrome-protocol-proxy` are logging proxies, not multiplexers.

## 5. `playwright-core install` for the headless shell

- **Since 1.49.0**, both `install --only-shell` (alongside `--no-shell`) and `install chromium-headless-shell` work ([program.ts@v1.49.0 L99-148](https://github.com/microsoft/playwright/blob/v1.49.0/packages/playwright-core/src/cli/program.ts#L99-L148)). The 1.48.0 registry has no headless-shell entry. Docs at 1.49 recommend `install --with-deps --only-shell` ([browsers.md@v1.49.0 L343-350](https://github.com/microsoft/playwright/blob/v1.49.0/docs/src/browsers.md#L343-L350)). They are still present in 1.65.0 ([program.ts@v1.65.0 L74-99](https://github.com/microsoft/playwright/blob/v1.65.0/packages/playwright-core/src/cli/program.ts#L74-L99); `resolveBrowsers` [reg@v1.65.0 L1292-1317](https://github.com/microsoft/playwright/blob/v1.65.0/packages/playwright-core/src/server/registry/index.ts#L1292-L1317)). `--no-remove` was added in 1.63.0.
- **Running it from a nested copy works.**
  - The bin is `cli.js` at the package root (`"bin": {"playwright-core": "cli.js"}`).
  - `./package.json` is exported (checked in the npm metadata for 1.49.0 and 1.65.0). So `path.dirname(require.resolve('playwright-core/package.json'))` from the depending package finds its own copy, and you run `node <that>/cli.js install chromium-headless-shell` directly.
  - Running `npx playwright-core` instead may pick up a different, hoisted copy. This is general npm behaviour and was not checked here.
  - The registry uses that copy's own `browsers.json` ([reg@v1.65.0 L1408](https://github.com/microsoft/playwright/blob/v1.65.0/packages/playwright-core/src/server/registry/index.ts#L1408)).
  - Install writes `.links/<sha1(packageRoot)>` to protect its browsers. It then removes browsers that no linked install references, unless you pass `--no-remove` or set `PLAYWRIGHT_SKIP_BROWSER_GC` ([reg@v1.65.0 L934-961](https://github.com/microsoft/playwright/blob/v1.65.0/packages/playwright-core/src/server/registry/index.ts#L934-L961)).
- **Default cache location:** `$XDG_CACHE_HOME` or `~/.cache` + `/ms-playwright` on Linux, `~/Library/Caches/ms-playwright` on macOS, `%LOCALAPPDATA%\ms-playwright` on Windows (reg@v1.49.0 L323-335; reg@v1.65.0 L377-395).
- **`PLAYWRIGHT_BROWSERS_PATH` applies to install too:**
  - set → that directory;
  - `0` → `<packageRoot>/.local-browsers`;
  - a relative path is resolved against `INIT_CWD` or the cwd.

  The same `registryDirectory` is used for install and for lookups at run time, so the variable must have the same value in both ([reg@v1.65.0 L397-417](https://github.com/microsoft/playwright/blob/v1.65.0/packages/playwright-core/src/server/registry/index.ts#L397-L417)).

## 6. npm size and release cadence

`playwright-core@1.65.0` ([registry JSON](https://registry.npmjs.org/playwright-core/1.65.0)):
- `dist.unpackedSize` **13,969,978 B (≈14.0 MB)**, `fileCount` 116
- **0 dependencies**: no `dependencies`, `optionalDependencies` or `peerDependencies`, and no install scripts
- `engines.node >=20`

For comparison: 1.49.0 was 7.96 MB with 337 files, 1.55.0 was 8.03 MB, 1.60.0 was 12.47 MB, and 1.64.0 was 13.66 MB.

Release dates are npm `time` values ([registry](https://registry.npmjs.org/playwright-core)):

| ver | date | days since prev minor | patches |
|---|---|---|---|
| 1.55.0 | 2025-08-20 | – | .1 2025-09-23 |
| 1.56.0 | 2025-10-06 | 47 | .1 2025-10-17 |
| 1.57.0 | 2025-11-25 | 50 | – |
| 1.58.0 | 2026-01-23 | 59 | .1 01-30, .2 02-06 |
| 1.59.0 | 2026-04-01 | 68 | .1 04-01 |
| 1.60.0 | 2026-05-11 | 40 | – |
| 1.61.0 | 2026-06-15 | 35 | .1 06-23 |
| 1.62.0 | 2026-07-24 | 39 | .1 07-30 |
| 1.63.0 | 2026-09-04 | 42 | – |
| 1.64.0 | 2026-10-07 | 33 | .1 10-14 |
| 1.65.0 | 2026-11-05 | 29 | – |

On average a new minor shipped every **≈44 days** from 1.55 to 1.65. The last five came every 29–42 days. Each minor moves Chromium up 1–3 majors (151 → 153 → 156 → 158).

## Unknown or not verified
- The Docker paths were not checked inside real images, because no images were pulled.
- How PW behaves over a custom transport when another client shares the same pipe connection.
- The quality and maintenance of the relay projects beyond their READMEs.
