# Host install of a pinned chrome-headless-shell: facts

Research date: 2026-11-11. Facts only, no decisions.
Target build: CfT `158.0.8127.18` (Playwright 1.65.0 ships it).
"Measured" means I checked it myself (npm install into a scratch dir, HEAD and Range requests, Docker images already on this machine with `--network none`).
No whole zip was downloaded. Zip contents were read from the central directory with HTTP Range requests.

## 0. Context facts

- Playwright 1.65.0 `browsers.json`: `chromium-headless-shell` revision `1254`, `browserVersion` `158.0.8127.18`. [source](https://github.com/microsoft/playwright/blob/v1.65.0/packages/playwright-core/browsers.json)
- On 2026-11-10, `158.0.8127.18` is the CfT **Beta** channel build. Stable is `157.0.8103.50`. [last-known-good-versions.json](https://googlechromelabs.github.io/chrome-for-testing/last-known-good-versions.json) (measured)

## 1. `@puppeteer/browsers`

### Package facts (latest = 3.2.7, published 2026-11-10)

| Item | Value |
|---|---|
| License | Apache-2.0 |
| `engines.node` | `>=22.12.0` |
| Module format | ESM only (`"type": "module"`, `main: ./lib/main.js`) |
| Direct deps | `yargs ^18.0.0`, `modern-tar ^0.8.6` |
| Optional peer deps | `proxy-agent >=8.0.1`, `yauzl ^2.10.0 \|\| ^3.4.0` (both optional, not installed by default) |
| Installed packages (measured) | 17 (itself + 16 transitive; 15 unique names, `string-width` twice) |
| Sum of `dist.unpackedSize` (measured) | ~1.09 MB. `du` on disk: ~1.76 MB |
| Own unpacked size | 457 KB (ships `lib` + `src`) |
| `yargs` | Loaded only by the CLI, via dynamic `import('yargs')`. Library use does not load it |
| `modern-tar` | Used only for `.tar.*` (Firefox). Not used for Chrome zips |

Sources: [registry JSON 3.2.7](https://registry.npmjs.org/@puppeteer/browsers/3.2.7), [package.json at tag](https://github.com/puppeteer/puppeteer/blob/browsers-v3.2.7/packages/browsers/package.json), [CHANGELOG at tag](https://github.com/puppeteer/puppeteer/blob/browsers-v3.2.7/packages/browsers/CHANGELOG.md).

For contrast, 2.13.2 had 7 direct deps (`debug, yargs 17, semver, tar-fs, progress, extract-zip, proxy-agent`) and `node >=18`.
3.0.0 (2026-05-12) replaced `extract-zip` with OS tools and made `proxy-agent` an optional peer.
3.0.5 added optional SHA-256 checking. 3.2.0 added CfT `linux-arm64`.

Optional `proxy-agent@8.0.2`, if a user installs it: 28 packages, ~7.3 MB on disk (measured).

### Platform coverage at an exact version (measured, HEAD 200 for all)

| `BrowserPlatform` | URL folder | Executable relative path |
|---|---|---|
| `linux` | `linux64` | `chrome-headless-shell-linux64/chrome-headless-shell` |
| `linux_arm` | `linux-arm64` (`linux64` for builds < 153.0.8001.0) | `chrome-headless-shell-linux-arm64/chrome-headless-shell` |
| `mac` | `mac-x64` | `chrome-headless-shell-mac-x64/chrome-headless-shell` |
| `mac_arm` | `mac-arm64` | `chrome-headless-shell-mac-arm64/chrome-headless-shell` |
| `win64` | `win64` | `chrome-headless-shell-win64/chrome-headless-shell.exe` |
| `win32` | `win32` | `chrome-headless-shell-win32/chrome-headless-shell.exe` |

`detectBrowserPlatform()` maps `darwin/arm64` to `mac_arm`, `linux/arm64` to `linux_arm`, and Windows 11 on ARM to `win64` (x64 emulation). [detectPlatform.ts](https://github.com/puppeteer/puppeteer/blob/browsers-v3.2.7/packages/browsers/src/detectPlatform.ts), [chrome-headless-shell.ts](https://github.com/puppeteer/puppeteer/blob/browsers-v3.2.7/packages/browsers/src/browser-data/chrome-headless-shell.ts)

### API

```ts
import { install, computeExecutablePath, Browser, BrowserPlatform, detectBrowserPlatform } from '@puppeteer/browsers';

await install({
  browser: Browser.CHROMEHEADLESSSHELL,   // 'chrome-headless-shell'
  buildId: '158.0.8127.18',               // exact version; no resolution needed
  cacheDir: '/abs/cache',                 // required, no default in the library
  platform?: BrowserPlatform,             // default: detectBrowserPlatform()
  baseUrl?: string,                       // mirror root, default https://storage.googleapis.com/chrome-for-testing-public
  expectedHash?: string,                  // SHA-256 hex of the zip; omitted = no check
  downloadProgressCallback?: 'default' | ((done, total) => void),
  unpack?: boolean,                       // false = download only, returns archive path
  installDeps?: boolean,                  // Linux: apt-get satisfy from deb.deps, needs root
  buildIdAlias?: string,
  providers?: BrowserProvider[],          // custom download sources, tried in order
  logger?: Logger,
}): Promise<InstalledBrowser>             // .executablePath, .path, .buildId, .platform

computeExecutablePath({ browser, buildId, cacheDir, platform? }): string
// cacheDir: null returns only the relative path
```

Other exports: `canDownload` (HEAD check), `getDownloadUrl`, `getInstalledBrowsers`, `uninstall`, `launch`, `Cache`.
[install.ts](https://github.com/puppeteer/puppeteer/blob/browsers-v3.2.7/packages/browsers/src/install.ts), [launch.ts](https://github.com/puppeteer/puppeteer/blob/browsers-v3.2.7/packages/browsers/src/launch.ts), [API docs](https://pptr.dev/browsers-api)

### Cache layout (measured with `computeExecutablePath`)

```
<cacheDir>/chrome-headless-shell/.metadata                       # JSON: aliases, custom exe paths
<cacheDir>/chrome-headless-shell/<platform>-<buildId>/chrome-headless-shell-<folder>/chrome-headless-shell
e.g. <cacheDir>/chrome-headless-shell/mac_arm-158.0.8127.18/chrome-headless-shell-mac-arm64/chrome-headless-shell
```

- The zip is downloaded to `<cacheDir>/chrome-headless-shell/<buildId>-<zipname>`, then deleted after unpack.
- "Installed" = install folder exists. If the folder exists but the executable is missing, it throws `IncompleteInstallationError` ("Delete ... and install again"). There is no completion marker file.
- No file lock in `install.js` (grep found none). Two concurrent installs of the same build share the same archive path.
[Cache.ts](https://github.com/puppeteer/puppeteer/blob/browsers-v3.2.7/packages/browsers/src/Cache.ts)

### Mirror, proxy, HTTP

- Mirror: `baseUrl` option. URL = `${baseUrl}/${buildId}/${folder}/chrome-headless-shell-${folder}.zip` (same layout as the CfT bucket). When `baseUrl` is set, the Google default is not used as fallback. The library reads no env var for it; the `puppeteer` package and the CLI (`--base-url`) do.
- Proxy: `HTTP_PROXY`, `HTTPS_PROXY`, `NO_PROXY` work only if `proxy-agent` is installed. Otherwise plain Node agents are used. [README](https://github.com/puppeteer/puppeteer/blob/browsers-v3.2.7/packages/browsers/README.md), [configuration guide](https://github.com/puppeteer/puppeteer/blob/puppeteer-v25.17.0/docs/guides/configuration.md)
- HTTP: `node:https` with manual redirect following. Fails on non-200. Rejects truncated downloads (compares to `content-length`, since 3.2.4). No retries.
[httpUtil.ts](https://github.com/puppeteer/puppeteer/blob/browsers-v3.2.7/packages/browsers/src/httpUtil.ts)

### Zip extraction (3.2.7)

Order: system CLI first, then optional `yauzl`. [fileUtil.ts L206](https://github.com/puppeteer/puppeteer/blob/browsers-v3.2.7/packages/browsers/src/fileUtil.ts#L206)

| OS | Tried in order |
|---|---|
| Linux, macOS | `unzip -o <zip> -d <dir>` |
| Windows | `%SystemRoot%\System32\tar.exe -xf`, then `powershell.exe Expand-Archive`, then `pwsh.exe Expand-Archive` |
| Any, if CLI missing (ENOENT) | `yauzl` if installed. It restores Unix modes from external attributes, creates symlinks, and rejects symlinks that point outside the target |
| Nothing available | Error: "no zip archiver is available. Install `unzip` (or `tar.exe`/Powershell on Windows), or add the optional `yauzl` dependency." |

Note: the 3.0.6 changelog says "extract zip archives with yauzl instead of CLI tools", but the 3.2.7 source still tries the CLI first.

### Verification

- Only if the caller passes `expectedHash` (SHA-256). Otherwise: "the download proceeds without integrity verification". On mismatch it deletes the file and throws.
- Google publishes no SHA-256 for CfT (see section 2), so the caller must supply it.
- No quarantine or xattr handling (grep found none).

## 2. Chrome for Testing (CfT)

### URL pattern

```
https://storage.googleapis.com/chrome-for-testing-public/<version>/<platform>/chrome-headless-shell-<platform>.zip
<platform> ∈ linux64 | linux-arm64 | mac-x64 | mac-arm64 | win32 | win64
```

The zip holds one top folder, `chrome-headless-shell-<platform>/`.
Support starts at: `chrome-headless-shell` 120.0.6098.0; `linux-arm64` 153.0.8001.0. [CfT README](https://github.com/GoogleChromeLabs/chrome-for-testing#readme)

### JSON endpoints (base `https://googlechromelabs.github.io/chrome-for-testing/`)

| Endpoint | Content |
|---|---|
| `known-good-versions.json` | All versions with every asset available |
| `known-good-versions-with-downloads.json` | Same, with download URLs per asset and platform (2626 versions on 2026-11-10) |
| `last-known-good-versions[-with-downloads].json` | Latest per channel (Stable/Beta/Dev/Canary) |
| `latest-patch-versions-per-build[-with-downloads].json` | Latest per `MAJOR.MINOR.BUILD` |
| `latest-versions-per-milestone[-with-downloads].json` | Latest per milestone |
| `<version>.json` (e.g. `158.0.8127.18.json`) | Download URLs for one version |
| `LATEST_RELEASE_<milestone>`, `LATEST_RELEASE_<channel>` | Plain-text version strings |

For an exact pinned version, no JSON lookup is needed. The URL is deterministic.

### Sizes for 158.0.8127.18 (measured; HEAD plus central directory)

| Platform | Zip bytes | Zip MB | Unpacked MB | Entries | Main binary MB | GCS md5 (base64) |
|---|---|---|---|---|---|---|
| linux64 | 131,998,580 | 132.0 | 295.4 | 287 | 216.6 | `gfw3cKBYhEVZUf2X14DAug==` |
| linux-arm64 | 129,936,972 | 129.9 | 296.5 | 287 | 204.7 | `dXKa7nImzMEmBCmVN8DKVQ==` |
| mac-x64 | 112,215,846 | 112.2 | 220.6 | 16 | 196.2 | `VErPX5xKFeqdWE/1ivM6rg==` |
| mac-arm64 | 104,957,869 | 105.0 | 215.1 | 16 | 178.8 | `nNeispblTbxdGOtEKWmlvw==` |
| win64 | 129,186,142 | 129.2 | 299.7 | 288 | 225.0 | `TRg389TMAD+tjcC9cmx3ew==` |
| win32 | 122,451,231 | 122.5 | 272.4 | 288 | 198.5 | `FvtF5GJeupZrLS2aRNHdfQ==` |

Uploaded 2026-11-04 (`last-modified`). `cache-control: public, max-age=3600`.

### Integrity data

- Google publishes no SHA-256 or signature file for CfT zips. Not in the README, not in the JSON, and the [blog](https://developer.chrome.com/blog/chrome-for-testing) and [docs](https://developer.chrome.com/docs/automation-and-testing/chrome-for-testing) don't mention it.
- GCS does expose MD5 and CRC32C, both in `x-goog-hash` response headers and in the public object metadata API (measured):
  `https://storage.googleapis.com/storage/v1/b/chrome-for-testing-public/o/158.0.8127.18%2Flinux64%2Fchrome-headless-shell-linux64.zip` returns `md5Hash`, `crc32c`, `size`, `generation`.

### Retention

- No retention policy is stated anywhere I found: not in the README, the blog, or the docs page. **Unknown.**
- In practice, the oldest builds are still served (measured): `113.0.5672.0/linux64/chrome-linux64.zip` and `120.0.6098.0/*/chrome-headless-shell-*.zip` return 200. Their `last-modified` of 2024-02-16 matches the bucket move to `chrome-for-testing-public`.
- The old host `edgedl.me.gvt1.com/edgedl/chrome/chrome-for-testing/...` still answers with a 302.
- Blog wording: CfT is "made available for every Chrome release". That is about publishing, not keeping old builds.

## 3. Own minimal downloader

### Zip format facts for these archives (measured, all 5 target platforms)

- Compression methods: 0 (stored) and 8 (deflate) only.
- No ZIP64, no data descriptors. Largest entry is 225 MB, under 4 GB.
- So a central-directory parser plus `node:zlib` `createInflateRaw` is enough. Node has no built-in zip reader.
- Unix zips (linux, mac): "made by" = Unix. Mode `0755` on `chrome-headless-shell` and 4 libs (`libEGL`, `libGLESv2`, `libvk_swiftshader`, `libvulkan`). Others `0644`.
- **No symlinks** in any headless-shell zip, mac included. (The full Chrome mac zip has 5 framework symlinks, for contrast.)
- Windows zips: "made by" = DOS. Modes are irrelevant there.
- Linux zips also hold `deb.deps` and `rpm.deps`.

### Options

| Option | Deps / weight | License | Keeps exec bit | Symlinks | Where it works |
|---|---|---|---|---|---|
| System `unzip` | 0 npm | n/a | Yes (measured, macOS) | Yes | macOS (`/usr/bin/unzip`, Info-ZIP 6.00). GitHub `ubuntu-24.04` and `ubuntu-26.04` runners (unzip 6.0). `node:22` full image (buildpack-deps:bookworm installs it). **Missing** on `ubuntu:24.04` (measured), `debian:*-slim`, `node:22-slim`. Alpine busybox has it, but CfT can't run on musl |
| System `tar -xf` | 0 npm | n/a | Yes (measured, macOS bsdtar 3.5.3) | Yes | macOS (bsdtar). Windows 10 build 17063+ ships bsdtar `tar.exe`. **GNU tar fails** on zip (measured on ubuntu:24.04: "This does not look like a tar archive", exit 2) |
| `ditto -x -k` | 0 npm | n/a | Yes (measured) | Yes | macOS only |
| PowerShell `Expand-Archive` | 0 npm | n/a | n/a | n/a | Windows (Puppeteer's fallback) |
| `fflate@0.8.3` | 0 deps; 797 KB unpacked (6 builds); `esm/index.mjs` 91.8 KB, 22.7 KB gzip | MIT | **No.** The unzip API gives only `name`, `size`, `originalSize`, `compression`; `attrs` exists only for writing zips. You must `chmod 0755` yourself | No | Any. `unzipSync` holds the whole zip and all output in memory (~130 MB in, ~300 MB out); a streaming `Unzip` class also exists |
| `yauzl@3.4.0` | 1 dep (`pend@1.2.0`, MIT); 110 KB + ~20 KB; `node >=12` | MIT | Yes, via `externalFileAttributes` (you write the loop, ~60 lines in Puppeteer) | Yes, if you handle it | Any. Random access through the central directory, streams per entry |
| Hand-rolled with `node:zlib` | 0 | own | Yes (read the attributes yourself) | Not needed for these zips | Any. You must add path-traversal checks yourself |
| `extract-zip@2.0.1` (old Puppeteer choice) | `debug`, `get-stream`, `yauzl@2`, `@types/yauzl` | BSD-2-Clause | Yes | Yes | Any |

Sources: [fflate](https://github.com/101arrowz/fflate) ([registry](https://registry.npmjs.org/fflate/0.8.3)), [yauzl](https://github.com/thejoshwolfe/yauzl) ([registry](https://registry.npmjs.org/yauzl/3.4.0)), [runner Ubuntu 24.04 readme](https://github.com/actions/runner-images/blob/main/images/ubuntu/Ubuntu2404-Readme.md), [Ubuntu 26.04 readme](https://github.com/actions/runner-images/blob/main/images/ubuntu/Ubuntu2604-Readme.md), [buildpack-deps bookworm](https://github.com/docker-library/buildpack-deps/blob/master/debian/bookworm/Dockerfile), [node 22 bookworm-slim](https://github.com/nodejs/docker-node/blob/main/22/bookworm-slim/Dockerfile), [Windows tar/curl post](https://devblogs.microsoft.com/commandline/tar-and-curl-come-to-windows/) (build 17063, bsdtar from libarchive; it doesn't mention zip or the path; Puppeteer uses `%SystemRoot%\System32\tar.exe`).

Note: `ubuntu-latest` moves to Ubuntu 26.04 in November 2026 (runner-images announcement).

### Proxy for an own downloader

- Node `>=22.21.0` has built-in env proxy support. It is opt-in via `NODE_USE_ENV_PROXY=1` or `--use-env-proxy`, at Stability 1.1. An `http.Agent({ proxyEnv })` option also exists. [http docs](https://nodejs.org/docs/latest-v22.x/api/http.html#built-in-proxy-support), [cli.md v22.21.0](https://github.com/nodejs/node/blob/v22.21.0/doc/api/cli.md)
- Below 22.21.0 there is no built-in proxy. You need an agent package.

### macOS quarantine / Gatekeeper (measured)

- Files written by Node (`fetch` then `writeFile`), and by `curl`, get **no** `com.apple.quarantine`. They get only `com.apple.provenance`. A Node-written `0755` script ran directly.
- CfT README: only downloads made **with a browser** get the "damaged" Gatekeeper error. Downloads via `@puppeteer/browsers`, `curl` or `wget` don't. Fix if needed: `xattr -cr <dir>`.
- The mac-arm64 headless shell binary (checked on 156.0.8078.4 from the local Playwright cache, not 158) has an `adhoc,linker-signed` signature: no Team ID, not notarized.
  - `spctl -a -t exec` says "rejected", yet it runs (`--version` OK) because it has no quarantine attribute.
  - `minos 13.0` (macOS 13+).
- Neither Puppeteer nor Playwright touches xattrs.

## 4. Playwright 1.65 (comparison)

| Item | Fact |
|---|---|
| Package | `playwright-core@1.65.0`: 0 npm deps (everything bundled), 13.97 MB unpacked, `node >=20` |
| Download URL | `${mirror}/builds/cft/158.0.8127.18/<cft-platform>/chrome-headless-shell-<cft-platform>.zip`. For CfT builds the only mirror is `https://cdn.playwright.dev` ([index.ts L117](https://github.com/microsoft/playwright/blob/v1.65.0/packages/playwright-core/src/server/registry/index.ts#L117), [L165](https://github.com/microsoft/playwright/blob/v1.65.0/packages/playwright-core/src/server/registry/index.ts#L165)) |
| What that host does | Measured: **307 redirect** to the same path on `storage.googleapis.com/chrome-for-testing-public`. So bytes come from Google's bucket |
| Non-CfT builds | 3 mirrors: `cdn.playwright.dev/dbazure/download/playwright`, `playwright.download.prss.microsoft.com/dbazure/download/playwright`, `cdn.playwright.dev` ([L47](https://github.com/microsoft/playwright/blob/v1.65.0/packages/playwright-core/src/server/registry/index.ts#L47)) |
| Host override | `PLAYWRIGHT_CHROMIUM_DOWNLOAD_HOST`, else `PLAYWRIGHT_DOWNLOAD_HOST`. It replaces the mirror list and keeps the path `builds/cft/<ver>/...`, so a mirror must copy Playwright's layout, not CfT's ([L1078](https://github.com/microsoft/playwright/blob/v1.65.0/packages/playwright-core/src/server/registry/index.ts#L1078)) |
| Platforms for headless shell | ubuntu 22.04/24.04/26.04 x64 and arm64, debian 12/13 x64 and arm64, mac14/15/26 x64 and arm64, win64 |
| Download | Runs in a forked child process (works around a Node exit-code bug). 5 attempts, cycling mirrors. Socket idle timeout `PLAYWRIGHT_DOWNLOAD_CONNECTION_TIMEOUT`. Proxy via `HTTPS_PROXY`/`HTTP_PROXY` (`proxy-from-env` + `https-proxy-agent`, SOCKS supported) ([browserFetcher.ts](https://github.com/microsoft/playwright/blob/v1.65.0/packages/playwright-core/src/server/registry/browserFetcher.ts), [oopDownloadBrowserMain.ts](https://github.com/microsoft/playwright/blob/v1.65.0/packages/playwright-core/src/server/registry/oopDownloadBrowserMain.ts), [network.ts](https://github.com/microsoft/playwright/blob/v1.65.0/packages/utils/network.ts)) |
| Verification | Byte count vs `content-length` only. **No hash** |
| Extraction | Vendored `extract-zip` on bundled `yauzl` ([extractZip.ts](https://github.com/microsoft/playwright/blob/v1.65.0/packages/utils/third_party/extractZip.ts)). Restores modes from external attributes, creates symlinks, checks paths stay in bounds with `realpath`, then `chmod 0755` on the executable (L126) |
| Completion / locking | Writes an `INSTALLATION_COMPLETE` marker. `DEPENDENCIES_VALIDATED` is written after the host deps check. Registry dir lock is `__dirlock` |
| Cache dir | `$PLAYWRIGHT_BROWSERS_PATH`, else `$XDG_CACHE_HOME` or `~/.cache` (Linux), `~/Library/Caches` (mac), `%LOCALAPPDATA%` (Windows), plus `/ms-playwright/chromium_headless_shell-1254/chrome-headless-shell-<plat>/chrome-headless-shell` |

## 5. Linux shared libraries

### What the binary needs (158.0.8127.18 linux64)

Measured with `ldd` in `mcr.microsoft.com/playwright:v1.65.0-noble`. The same 27 names appear in the binary's `.dynstr`, read by partially inflating the remote zip.
Interpreter: `/lib64/ld-linux-x86-64.so.2`. Needs glibc `>= 2.25` (highest `GLIBC_` version referenced). So it does not run on musl or Alpine.

| Direct NEEDED soname | Ubuntu 24.04 package (Playwright `lib2package`) | On bare `ubuntu:24.04`? |
|---|---|---|
| libc.so.6, libm.so.6, libdl.so.2, libpthread.so.0 | libc6 | present |
| libgcc_s.so.1 | libgcc-s1 | present |
| libudev.so.1 | libudev1 | present |
| libglib-2.0.so.0, libgobject-2.0.so.0, libgio-2.0.so.0 | libglib2.0-0t64 | missing |
| libnss3.so, libnssutil3.so | libnss3 | missing |
| libnspr4.so | libnspr4 | missing |
| libatk-1.0.so.0 | libatk1.0-0t64 | missing |
| libatk-bridge-2.0.so.0 | libatk-bridge2.0-0t64 | missing |
| libatspi.so.0 | libatspi2.0-0t64 | missing |
| libdbus-1.so.3 | libdbus-1-3 | missing |
| libX11.so.6 | libx11-6 | missing |
| libXcomposite.so.1 | libxcomposite1 | missing |
| libXdamage.so.1 | libxdamage1 | missing |
| libXext.so.6 | libxext6 | missing |
| libXfixes.so.3 | libxfixes3 | missing |
| libXrandr.so.2 | libxrandr2 | missing |
| libxcb.so.1 | libxcb1 | missing |
| libxkbcommon.so.0 | libxkbcommon0 | missing |
| libgbm.so.1 | libgbm1 | missing |
| libexpat.so.1 | libexpat1 | missing |
| libasound.so.2 | libasound2t64 | missing |

Bare `ubuntu:24.04` result: 6 present, 21 missing (measured on the arm64 image, with `ldconfig -p`).
The headless shell does **not** link GTK, cairo, pango or cups, unlike full Chrome.
Transitive libraries pulled in by the above (from `ldd`): libpcre2, libffi, libplc4, libplds4, libgmodule, libz, libmount, libselinux, libsystemd, libXrender, libdrm, libXau, libXdmcp, libcap, libXi, libblkid, libgcrypt, liblz4, liblzma, libzstd, libbsd, libgpg-error, libmd.

Playwright's Ubuntu 24.04 `chromium` apt list (used for the regular and the headless shell build): `libasound2t64 libatk-bridge2.0-0t64 libatk1.0-0t64 libatspi2.0-0t64 libcairo2 libcups2t64 libdbus-1-3 libdrm2 libgbm1 libglib2.0-0t64 libnspr4 libnss3 libpango-1.0-0 libx11-6 libxcb1 libxcomposite1 libxdamage1 libxext6 libxfixes3 libxkbcommon0 libxrandr2`. [nativeDeps.ts](https://github.com/microsoft/playwright/blob/v1.65.0/packages/playwright-core/src/server/registry/nativeDeps.ts)
Playwright checks hosts by running `ldd` on every executable and `.so` in the browser dir, looking for `not found`, then mapping names to apt packages. [dependencies.ts](https://github.com/microsoft/playwright/blob/v1.65.0/packages/playwright-core/src/server/registry/dependencies.ts)

### `deb.deps` inside the zip

This is the full Chrome installer list, broader than what the shell links:
`ca-certificates, fonts-liberation, libasound2, libatk-bridge2.0-0, libatk1.0-0, libatspi2.0-0, libc6 (>= 2.25), libcairo2, libcups2, libcurl3-gnutls|libcurl3-nss|libcurl4|libcurl3, libdbus-1-3, libexpat1, libgbm1, libglib2.0-0, libgtk-3-0|libgtk-4-1, libnspr4, libnss3, libpango-1.0-0, libudev1, libvulkan1, libx11-6, libxcb1, libxcomposite1, libxdamage1, libxext6, libxfixes3, libxkbcommon0, libxrandr2, wget, xdg-utils`.
`rpm.deps` is also shipped.
Puppeteer's `installDeps` runs `apt-get satisfy -y <deb.deps> --no-install-recommends`, needs root, and only works on Debian/Ubuntu. The CfT README gives the same loop.

### What a missing library looks like (measured, libnss3 removed)

```
/…/chrome-headless-shell: error while loading shared libraries: libnss3.so: cannot open shared object file: No such file or directory
exit code 127
```

The dynamic loader reports only the **first** missing library. `ldd <bin> | grep 'not found'` lists all of them (Puppeteer [troubleshooting](https://github.com/puppeteer/puppeteer/blob/puppeteer-v25.17.0/docs/troubleshooting.md#chrome-doesnt-launch-on-linux) recommends this).
With `--remote-debugging-pipe`, the parent would see the process exit with 127 and the pipe close. That last part is inferred, not tested.

## Unknowns

- CfT retention policy: none published.
- Signature and `minos` of the **158** mac binaries. I checked only 156 (ad-hoc, macOS 13+).
- Whether the headless shell needs fontconfig or fonts installed on a bare Linux host to render text. `ldd` shows no libfontconfig, so it is probably bundled. Not tested.
- Windows: `tar.exe` on Server editions and on Windows 10 builds before 17063. Puppeteer falls back to PowerShell for this.
- packagephobia numbers: not fetched. Sizes above come from a local install and registry `dist.unpackedSize`.
- `node:22-slim` is said to lack `unzip` based on its Dockerfile. Not run.
