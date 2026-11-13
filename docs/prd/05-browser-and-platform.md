# Browser and platform

Part of the [v1 PRD](README.md). Terms come from the [glossary](../../GLOSSARY.md).

By default the browser runs in visual-check's own container image, forced to `linux/amd64`, locally and in CI. That gives a local run and CI the same pixels. This file covers the platform setting, Docker, how the browser reaches a Storybook, `host`, the image and the sandbox. The driver itself is in [Capture engine](04-capture-engine.md).

## The `platform` key

| Value                     | Browser runs                                               | Parity between machines                                         |
| ------------------------- | ---------------------------------------------------------- | --------------------------------------------------------------- |
| `'linux/amd64'` (default) | In the container, as amd64. Under Rosetta on Apple Silicon | Exact                                                           |
| `'linux/arm64'`           | In the container, as arm64                                 | Within the default tolerance, which absorbs arm64's differences |
| `'host'`                  | Directly on the machine, no Docker                         | None                                                            |

- It's one committed value for the whole project. It can't take `{ local, ci }` and has no CLI flag, because a mismatch makes every story a visual diff.
- `host` is a choice for the whole project, never a fallback.
- Nothing records which platform or browser wrote a baseline. A change of either shows as visual diffs, not as missing baselines ([ADR 0001](../adr/0001-baseline-key-excludes-platform.md)).
- Chromium always launches with `--disable-skia-runtime-opts`, on every platform, with no option. Without it Rosetta differs from real amd64 runners on gradients.

## Docker

- visual-check uses whatever `docker` CLI is on `PATH`, with its current context, on every OS. It refuses no runtime by name.
- `docker info` is the one probe. It tells Docker Desktop (`OperatingSystem: Docker Desktop`) from other engines and Linux containers from Windows containers (`OSType`), and gives the CPUs and memory behind `workers: 'auto'`.
- With a container platform, the run exits 2 at once when:
  - there's no `docker` CLI;
  - the daemon isn't running, or the user can't reach its socket;
  - Docker runs Windows containers;
  - the pull fails;
  - the machine can't run the platform, for example amd64 under QEMU;
  - the container can't reach the machine.
- Unless a bullet below gives its own, the message names what failed and both fixes: start or install Docker, or set `platform: 'host'`. Inside a container it also names visual-check's image as the job container to use.
- **Windows containers:** when `docker info` reports `OSType: windows`, the message says to switch Docker to Linux containers. visual-check checks the OS type and never matches pull errors.
- There's no fallback to `host`. Host snapshots against container baselines would fail every story, and `update` would write wrong baselines.
- **A machine that can't run the platform** is recognised from the launch, with no probe before it. When the browser exits before its first capture and its output says the graphics process can't start, the run exits 2 with "this machine can't run linux/amd64" and both fixes: turn on Rosetta in the runtime, or set `linux/arm64`.
- **A runtime that gives the container no name for the machine:** on the proxy paths, visual-check checks before capturing that the browser can reach the proxy. If it can't, the run exits 2, says the runtime doesn't provide `host.docker.internal`, and lists the tested runtimes.

### The container

- The driver starts the browser with `docker run -i --rm`, and CDP travels over the container's stdin and stdout.
- The command also carries:
  - `--platform <platform>`;
  - the image as `tag@digest` from the browser package, or the config's `image`;
  - `--user ubuntu --cap-drop=ALL --security-opt=no-new-privileges`;
  - the network option from the table below.
- A missing image is pulled first, with progress on stderr. An image that's already present isn't pulled again.
- A run has one browser container. When visual-check exits, fails or is killed, the pipe closes, Chromium quits and `--rm` removes the container. No container is left detached and there's no watchdog.
- The only long-lived container is the addon's. It starts on the first Check or Update and runs until Storybook stops ([Storybook addon](15-storybook-addon.md)).
- visual-check sets no CPU or memory limit on the container.

## How the browser reaches a Storybook

The first rule that matches wins.

| #   | Where the CLI runs                                 | The browser                                                 |
| --- | -------------------------------------------------- | ----------------------------------------------------------- |
| 1   | Inside visual-check's image                        | Starts directly, with no Docker                             |
| 2   | Inside a container the Docker daemon knows         | Joins that container's network (`--network container:<id>`) |
| 3   | With Docker Desktop, on any OS                     | Goes through a SOCKS proxy in the CLI                       |
| 4   | With any other Linux engine                        | Uses host networking (`--network host`)                     |
| 5   | Anywhere else, such as OrbStack or Colima on macOS | Goes through the SOCKS proxy                                |

- On every path the Storybook's `url` works exactly as written: loopback, hosts-file names, VPN and LAN names. Remote content is fetched the same way.
- **Rule 2** reads the container's ID from `/proc/self/mountinfo`, and `docker inspect <id>` must succeed. A container the daemon doesn't know falls through to the later rules.
- **Rule 3** exists because Docker Desktop's engine has its own network, so host networking there doesn't reach the machine. Node inside a WSL distro with Docker Desktop also lands here.
- **The proxy** runs in visual-check's own process. It listens on 127.0.0.1 on a random port, only while the run lasts. The browser reaches it through `host.docker.internal`, the name the runtime gives the machine. visual-check relies on the runtime's own name and never adds it with `--add-host`.
- The proxy carries all the browser's traffic, loopback included, and costs under 1%.
- A remote Docker context runs the browser on the remote machine, which only reaches URLs that machine can open. visual-check doesn't handle that case.

## Inside visual-check's image

A CI job container or a devcontainer can be built on visual-check's image.

- The image holds a marker file, `/etc/visual-check/chromium.json`. It's a JSON object with two fields: `version`, the image's browser package version, and `arch`, its CPU architecture.
- When the marker matches the installed browser package and the configured platform, the CLI skips Docker and starts the headless shell directly.
- A mismatch exits 2, naming both values and the fix. An arm64 devcontainer with the default `linux/amd64` is one such case.
- With `platform: 'host'`, only the version has to match. The CLI then uses the image's browser and downloads nothing.
- An image built `FROM` visual-check's keeps the marker.
- The image has no Node. A job container adds it with `actions/setup-node`, a devcontainer with its Node feature.
- A job container on any other image works through rule 2. It needs the `docker` CLI, and a user that is root or in the socket's group.

## Runtimes by OS

| OS                   | Supported                   | Notes                                                                                                        |
| -------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Linux                | Docker Engine               | Docker Desktop for Linux, rootless Docker and Podman take the same paths but aren't tested                   |
| macOS, Apple Silicon | OrbStack and Docker Desktop | Both run amd64 under Rosetta by default. Colima and Podman default to QEMU, which can't run amd64 Chromium   |
| macOS, Intel         | Colima                      | No emulation needed                                                                                          |
| Windows x64          | Docker Desktop              | It renders like a Linux runner. CI tests it on Windows Server 2025. Windows 10 and 11 desktops aren't tested |
| Node inside WSL      | As Linux                    | With Docker Engine in the distro: host networking. With Docker Desktop: the proxy                            |

Not supported in v1:

- Docker Engine inside WSL2 driven from Node on Windows. The fix is to run visual-check inside WSL.
- `wslc`, Windows on Arm, and tests of Rancher Desktop or Podman.
- amd64 under QEMU. The way out is `linux/arm64`.

## `platform: 'host'`

- The first `test` or `update` downloads the headless shell from Chrome for Testing: the same build the image holds.
  - The URL is `https://storage.googleapis.com/chrome-for-testing-public/<version>/<platform>/chrome-headless-shell-<platform>.zip`.
  - It's unzipped with `yauzl`, never with a system `unzip` or `tar`.
  - The download goes into the OS's user cache folder (`~/.cache` on Linux, `~/Library/Caches` on macOS, `%LOCALAPPDATA%` on Windows), under `visual-check/chromium/<version>/`. `VISUAL_CHECK_CACHE_DIR` moves it.
  - A lock guards it, and a completion marker is written last.
  - Old builds are never deleted automatically.
  - `HTTPS_PROXY` is honoured. `VISUAL_CHECK_CHROMIUM_MIRROR` is a base URL of a mirror with the same folder layout.
  - Progress goes to stderr.
- The download's SHA-256 comes from the browser package. A mismatch exits 2.
- Missing Linux libraries exit 2, naming the library and both fixes: a container platform, or installing the libraries. visual-check never installs system packages.
- Each OS uses its own font list, so `host` baselines only match on the same OS. The launch arguments are the same on every OS.
- A Linux machine with no fonts installed renders with whatever it has. That isn't an error. The docs list a font package beside the libraries `host` needs.
- Windows on Arm has no Chrome for Testing build. `host` there exits 2 and points to `linux/arm64`.
- `init` never writes `platform: 'host'`.

## The image

`ghcr.io/visual-check/chromium:<browser package version>`, for amd64 and arm64, always used by digest.

- It's built from `ubuntu:24.04` pinned by digest, with apt pinned to an Ubuntu snapshot where that works.
- It holds:
  - the libraries the headless shell links against;
  - fontconfig's config and Playwright's font packages, without the X fonts Chromium can't use;
  - the `C.UTF-8` locale;
  - Chrome for Testing's Stable headless shell, unzipped as Google ships it, with its notices;
  - the marker file;
  - a list of its installed packages.
- It has no Node.
- Its default user stays root, so job containers and devcontainers work. visual-check's own `docker run` uses the non-root `ubuntu` user.
- Layers are gzip. The image is about 281 MB compressed and 716 MB unpacked, and a fresh CI runner has a browser answering about 8 s after the pull starts. So CI caches nothing.
- It's rebuilt only on purpose, never on a schedule, because a rebuild can move pixels. A rebuild ships as a browser package minor ([Release process](19-release.md)).

## The sandbox

| Where the browser runs                               | Chromium's sandbox        | The boundary                                                       |
| ---------------------------------------------------- | ------------------------- | ------------------------------------------------------------------ |
| visual-check's container                             | Off                       | The container: a non-root user, no capabilities, no new privileges |
| Inside the image, as a job container or devcontainer | Off, and never tried      | That container alone                                               |
| `host`                                               | On where the OS allows it | Chromium's sandbox                                                 |

- On `host` the browser launches with the sandbox. If Chromium exits at launch, visual-check relaunches without it, silently. The run then keeps that choice.
- In the container and inside the image, the launch arguments include `--no-sandbox`. On `host` they're Playwright's arguments without it, and the relaunch adds it back.
- If the launch without the sandbox fails too, it's an ordinary failed launch, such as missing Linux libraries.
- The fallback isn't the one relaunch a run gets after a browser exit ([Capture engine](04-capture-engine.md)). That relaunch still exists and keeps the settled choice.
- The sandbox ends up on for macOS, Windows and Linux that allows unprivileged user namespaces. It ends up off on Ubuntu 23.10 and later, and as root.
- There's no setup step, no notice and no config key for any of this.
- visual-check trusts the stories' code. It doesn't trust remote content, and a pinned browser gets old, so projects should take browser package bumps.

## A custom image

- The config's `image` defaults to the browser package's image.
- A custom image, for extra system fonts or a mirror registry, must be built `FROM` it. The version check at launch exits 2 when the browser inside isn't the browser package's build, and says to rebuild from the new reference.

## Sources

- [Docker's role][13], [Render determinism and Docker][7], [Render parity measurement][18], [Render parity on real stories][23], [Container runtimes and cost][26], [Raw CDP for Chromium][28], [Proxy scope on macOS][30], [Windows and macOS on GitHub Actions][33], [Container runtimes on Windows][36], [GitHub Action design][40], [Playwright peer dependency and Chromium version][45], [Combined snapshots and network paths in v1][47], [Chromium sandbox in the browser image][51], [Config file shape and init wizard][38], [Storybook addon][41].
- [ADR 0001](../adr/0001-baseline-key-excludes-platform.md), [ADR 0003](../adr/0003-render-in-container-on-amd64.md), [ADR 0007](../adr/0007-browser-build-comes-from-a-peer-package.md), [ADR 0008](../adr/0008-browser-runs-in-our-own-image.md).
- Decided while writing this PRD: how a machine that can't run the platform is recognised, the reachability check, `host` inside the image and on Windows on Arm, each OS's own font list on `host`, and the names of the two env vars and the marker file.

[7]: https://github.com/visual-check/visual-check/issues/7
[13]: https://github.com/visual-check/visual-check/issues/13
[18]: https://github.com/visual-check/visual-check/issues/18
[23]: https://github.com/visual-check/visual-check/issues/23
[26]: https://github.com/visual-check/visual-check/issues/26
[28]: https://github.com/visual-check/visual-check/issues/28
[30]: https://github.com/visual-check/visual-check/issues/30
[33]: https://github.com/visual-check/visual-check/issues/33
[36]: https://github.com/visual-check/visual-check/issues/36
[38]: https://github.com/visual-check/visual-check/issues/38
[40]: https://github.com/visual-check/visual-check/issues/40
[41]: https://github.com/visual-check/visual-check/issues/41
[45]: https://github.com/visual-check/visual-check/issues/45
[47]: https://github.com/visual-check/visual-check/issues/47
[51]: https://github.com/visual-check/visual-check/issues/51
