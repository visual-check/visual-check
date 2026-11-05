# Container runtimes on macOS Apple Silicon: linux/amd64 facts (researched 2026-11-04)

Scope: Docker Desktop 4.98.0, Colima 0.10.3 (Lima 2.2.1), Podman 6.1.4, OrbStack 2.2.4, on macOS 27.0.1, M4 Pro. Sources are primary: docs, release notes, and source at the matching tag. "Inference" marks anything not stated outright.

## Summary

| Runtime | amd64 emulation (default) | Rosetta default | VM type default | CPU | Memory | Disk | `/private/tmp` shared by default |
|---|---|---|---|---|---|---|---|
| Docker Desktop 4.98 | Rosetta (via Apple VZ VMM); QEMU bundled in VM otherwise | **On** per settings reference (`true`) and 4.25 note; settings page table says "Disabled" (docs conflict) | Apple Virtualization framework | not stated in settings; 4.24 note: all host cores | 50% of host (24 GiB on 48 GiB); swap 1 GB | physical disk size (4.42+) | **Yes** (`/Users`, `/Volumes`, `/private`, `/tmp`, `/var/folders`), VirtioFS |
| Colima 0.10.3 | **QEMU user-mode** via binfmt (QEMU 7.0.0) | **Off** (`--vz-rosetta=false`) | `vz` (macOS 13+) | 2 | 2 GiB | 100 GiB data + 20 GiB root | **No**: only `~` (writable), virtiofs |
| Podman 6.1.4 | **QEMU user-mode** (Fedora `qemu-user-static-x86`) | **Off** (`rosetta=false`; libkrun has no Rosetta) | `libkrun` (krunkit, Hypervisor.framework) | host CPUs / 2 (6 on 12-core) | 2048 MiB; swap 0 | 100 GiB | **Yes** (`/private:/private`, rw), virtiofs |
| OrbStack 2.2.4 | Rosetta | On (2023 maintainer statement; docs say keep it enabled) | custom "virtualization engine" (since v1.6.0); framework not documented | not documented | "no more than 8 GB by default" | not documented | Not stated for `/private/tmp`; bind mounts work like on Linux; `/tmp` fix in v0.3.1 |

The measuring machine's OrbStack config (`cpu: 12`, `memory_mib: 12288` on a 12-core, 48 GiB host) does **not** match the documented memory default (8 GB cap). `cpu: 12` means 1200%, so all 12 cores, but no default CPU value is documented.

Measured afterwards (see the Answer on the ticket): a factory-reset Docker Desktop 4.98 got 12 CPUs, 8 GiB memory, 1 GiB swap and the full disk, with Rosetta on. So the "50% of host" memory default didn't hold on a 48 GiB host.

---

## Docker Desktop 4.98.0

4.98.0 was released 2026-11-03. Its notes don't change Rosetta, the VMM or resources. https://docs.docker.com/desktop/release-notes/#4980

1. **Emulation**
   - With the Apple Virtualization framework VMM, amd64 binaries run under Rosetta when the setting is on. The setting is "Available with the Apple Virtualization framework VMM". https://github.com/docker/docs/blob/54eff013fe65e235c8c2fb6b57b4607e55d0430b/content/manuals/desktop/settings-and-maintenance/settings.md#L49
   - Otherwise QEMU does the work. Docker Desktop "uses the QEMU that's bundled within the Docker Desktop VM", and emulation is on by default with no configuration. https://github.com/docker/docs/blob/54eff013fe65e235c8c2fb6b57b4607e55d0430b/content/manuals/build/building/multi-platform.md#L131-L133
   - 4.79.0 says "QEMU has been updated to v10.2.3". It doesn't say whether that is the binfmt emulator. https://docs.docker.com/desktop/release-notes/#4790
   - The docs don't name which component registers the binfmt handlers beyond "bundled within the VM".
   - Docker VMM (Beta) "does not currently support Rosetta". https://github.com/docker/docs/blob/54eff013fe65e235c8c2fb6b57b4607e55d0430b/content/manuals/desktop/features/vmm.md#L67
2. **Rosetta default and toggle**
   - Settings reference: `Default: true`, JSON key `useVirtualizationFrameworkRosetta`, UI label "Use Rosetta for x86_64/amd64 emulation on Apple Silicon". https://github.com/docker/docs/blob/54eff013fe65e235c8c2fb6b57b4607e55d0430b/content/manuals/desktop/enterprise/hardened-desktop/settings-management/settings-reference.md#L288-L298
   - 4.25.0: "Rosetta is enabled by default on macOS 14.1 and later." https://docs.docker.com/desktop/release-notes/#4250
   - **Conflict:** the settings page table lists the default as "Disabled". https://docs.docker.com/desktop/settings-and-maintenance/settings/
   - User settings file: `~/Library/Group Containers/group.com.docker/settings-store.json` (settings.md L22-23). Admins can lock the same key. https://github.com/docker/docs/blob/54eff013fe65e235c8c2fb6b57b4607e55d0430b/content/manuals/desktop/enterprise/hardened-desktop/settings-management/configure-json-file.md#L303
   - 4.49.0: if a Rosetta install is cancelled or fails, Rosetta is disabled. https://docs.docker.com/desktop/release-notes/#4490
3. **VMM**
   - 4.44.0: "Apple Virtualization is now the default VMM", and QEMU virtualization was removed. https://docs.docker.com/desktop/release-notes/#4440
   - Docker VMM is optional and in Beta. Since 4.86 it is Docker's own VMM, not libkrun. https://docs.docker.com/desktop/features/vmm/
4. **Resources** (settings.md L65-68)
   - Memory: "Defaults to 50% of your host's memory."
   - Swap: "1 GB default."
   - CPU and disk: no default given on the page.
   - 4.24.0: "Docker containers now use all host CPU cores by default." https://docs.docker.com/desktop/release-notes/#4240
   - 4.42.0: the disk limit is set to the physical disk size on a fresh install. https://docs.docker.com/desktop/release-notes/#4420
   - Docker VMM needs at least 4 GB of memory. (vmm.md)
5. **File sharing**
   - Default shares: `/Users`, `/Volumes`, `/private`, `/tmp`, `/var/folders` (settings.md L88).
   - Default implementation: VirtioFS. gRPC FUSE is the alternative. (settings.md L48)
   - Read/write status of the shares: not documented.
6. **Limits:** "Docker Desktop now uses cgroupv2" since 4.3.0. https://docs.docker.com/desktop/release-notes/#430 Measured: `--cpus=2` set the container's `cpu.max` to `200000 100000`.

## Colima 0.10.3 (Lima 2.2.1)

1. **Emulation**
   - Default is QEMU user-mode through binfmt. `--binfmt` defaults to true. https://github.com/abiosoft/colima/blob/v0.10.3/cmd/start.go#L238
   - The guest runs `binfmt --install 386,amd64`. https://github.com/abiosoft/colima/blob/v0.10.3/core/core.go#L24-L42 and https://github.com/abiosoft/colima/blob/v0.10.3/environment/vm/lima/lima.go#L311-L319
   - The VM image is colima-core v0.10.4 (Ubuntu 24.04). https://github.com/abiosoft/colima/blob/v0.10.3/embedded/images/images.txt
   - That image pins tonistiigi/binfmt `deploy/v7.0.0-28`, which is QEMU 7.0.0. https://github.com/abiosoft/colima-core/blob/v0.10.4/Makefile#L4-L5
2. **Rosetta**
   - Off by default: `--vz-rosetta` is false. https://github.com/abiosoft/colima/blob/v0.10.3/cmd/start.go#L220-L224 and https://github.com/abiosoft/colima/blob/v0.10.3/embedded/defaults/colima.yaml#L174
   - To turn on: `colima start --vm-type=vz --vz-rosetta` (README L199-202), or set `rosetta: true` in `~/.colima/default/colima.yaml` (FAQ L661).
   - It only applies with `vz` and same-arch VMs, and only if `pgrep oahd` succeeds. Otherwise Colima warns "Rosetta2 is not installed". https://github.com/abiosoft/colima/blob/v0.10.3/environment/vm/lima/yaml.go#L33-L45 and https://github.com/abiosoft/colima/blob/v0.10.3/util/macos.go#L133-L141
   - When Rosetta is on, Colima registers a `rosetta` binfmt and writes `0` to `qemu-x86_64`. https://github.com/abiosoft/colima/blob/v0.10.3/environment/vm/lima/lima.go#L321-L336
3. **VM type**
   - `DefaultVMType()` returns `vz` on macOS 13+. https://github.com/abiosoft/colima/blob/v0.10.3/environment/vm.go#L66-L72
   - Note: the embedded template comment still says "Default: qemu" (colima.yaml L162). That template is used only if the user creates one with `colima template`. https://github.com/abiosoft/colima/blob/v0.10.3/cmd/template.go#L70-L82
   - Lima docs: "vz" has been the macOS default since Lima v1.0. https://github.com/lima-vm/lima/blob/v2.2.1/website/content/en/docs/config/vmtype/vz.md#L11
4. **Resources**
   - CPU 2, memory 2 GiB, disk 100 GiB, root disk 20 GiB. https://github.com/abiosoft/colima/blob/v0.10.3/cmd/start.go#L124-L127 and README L176
   - Swap: not documented.
5. **Mounts**
   - Default mount type is `virtiofs` for vz (`sshfs` for qemu). https://github.com/abiosoft/colima/blob/v0.10.3/cmd/start.go#L130-L131
   - Default mount is `~` only, writable. https://github.com/abiosoft/colima/blob/v0.10.3/environment/vm/lima/yaml.go#L380-L383
   - `/private/tmp`, `/tmp` and `/var/folders` are **not** shared.
   - FAQ: bind mounts outside `/Users/$USER` show up empty. https://github.com/abiosoft/colima/blob/v0.10.3/docs/FAQ.md#L659
   - Custom `--mount` entries are read-only unless suffixed `:w`. https://github.com/abiosoft/colima/blob/v0.10.3/cmd/start.go#L246 and L294-L320
   - Lima 2.x itself mounts nothing by default. https://github.com/lima-vm/lima/blob/v2.2.1/templates/default.yaml#L55-L58
6. **Limits:** cgroup v2 and `--cpus`/`--memory` are not documented by Colima.

## Podman 6.1.4 (`podman machine`)

1. **Emulation**
   - The default provider is libkrun, which has no Rosetta (`GetRosetta` returns false). https://github.com/podman-container-tools/podman/blob/v6.1.4/pkg/machine/provider/platform_darwin.go#L28 and https://github.com/podman-container-tools/podman/blob/v6.1.4/pkg/machine/libkrun/stubber.go#L138-L140
   - amd64 therefore runs on QEMU user-mode. The machine-os image installs `qemu-user-static-x86`, and its binfmt.d entries are patched with `PC` flags. https://github.com/podman-container-tools/podman-machine-os/blob/v6.1.4/podman-image/build_common.sh#L100-L104 and L148-L149
   - With Rosetta off, "users will be using QEMU". https://blog.podman.io/2025/08/podman-5-6-released-rosetta-status-update/
2. **Rosetta**
   - Default `rosetta=false`, "Supported on AppleHV(arm64) machines only". https://github.com/podman-container-tools/container-libs/blob/common/v0.69.2/common/docs/containers.conf.5.md and https://github.com/podman-container-tools/container-libs/blob/common/v0.69.2/common/pkg/config/default.go#L296
   - 5.6.0 disabled Rosetta by default because of issues with newer Linux kernels. https://github.com/podman-container-tools/podman/blob/v6.1.4/RELEASE_NOTES.md#L428
   - To turn on: in `~/.config/containers/containers.conf`, set `[machine] rosetta = true` and `provider = "applehv"`, or use `podman machine init --provider applehv`.
   - applehv re-reads `cfg.Machine.Rosetta` on every start. https://github.com/podman-container-tools/podman/blob/v6.1.4/pkg/machine/applehv/stubber.go#L120-L127
   - Inside the guest, `rosetta-activation.service` is enabled only for applehv on arm64. https://github.com/podman-container-tools/podman/blob/v6.1.4/pkg/machine/ignition/ignition.go#L183-L194
   - That service mounts the virtiofs tag `rosetta`, registers the handler and unregisters `qemu-x86_64`. https://github.com/podman-container-tools/podman-machine-os/blob/v6.1.4/podman-image/rosetta-activation.sh
   - At v6.1.4 neither the unit nor the script checks the `/etc/containers/enable-rosetta` trigger file from the 5.6 blog.
3. **VM type**
   - "The default `podman machine` provider on Macs has been changed to `libkrun`" (6.0.0). https://github.com/podman-container-tools/podman/blob/v6.1.4/RELEASE_NOTES.md#L168
   - The alternative is `applehv` (vfkit). https://github.com/podman-container-tools/podman/blob/v6.1.4/docs/source/markdown/podman-machine.1.md
   - libkrun uses HVF (Hypervisor.framework) on macOS/ARM64. https://github.com/containers/libkrun
4. **Resources**
   - CPUs = `runtime.NumCPU()/2`, so 6 on a 12-core host (computed from the host).
   - Memory 2048 MiB, disk 100 GiB. https://github.com/podman-container-tools/container-libs/blob/common/v0.69.2/common/pkg/config/default.go#L271-L297
   - Swap 0. https://github.com/podman-container-tools/podman/blob/v6.1.4/cmd/podman/machine/init.go#L93-L97
   - Docs are stale here: containers.conf(5) still lists `cpus=1` and `disk_size=10`.
5. **Mounts**
   - Mac defaults: `/Users:/Users`, `/private:/private`, `/var/folders:/var/folders`, plus the user config dir mounted at `/etc/containers`. https://github.com/podman-container-tools/container-libs/blob/common/v0.69.2/common/pkg/config/default_darwin.go#L16-L22
   - Mounts are rw by default (`rw (default)`).
   - `/tmp` is a forbidden mount *destination*. https://github.com/podman-container-tools/podman/blob/v6.1.4/docs/source/markdown/podman-machine-init.1.md.in#L161-L176
   - Both providers use virtiofs. https://github.com/podman-container-tools/podman/blob/v6.1.4/pkg/machine/libkrun/stubber.go#L67 and https://github.com/podman-container-tools/podman/blob/v6.1.4/pkg/machine/applehv/stubber.go#L86
   - So `/private/tmp` is shared at the same path. The VM's own `/tmp` is not the host's.
6. **Rootless and limits**
   - Rootless by default: `--rootful` defaults to false. https://github.com/podman-container-tools/podman/blob/v6.1.4/cmd/podman/machine/init.go#L157-L158
   - `--cpus` docs: non-root users may not be allowed to change limits, and it is unsupported on cgroup v1 rootless. https://github.com/podman-container-tools/podman/blob/v6.1.4/docs/source/markdown/options/cpus.container.md

## OrbStack 2.2.4

2.2.4 was released 2026-10-12. Its notes include "Fixed getting stuck at "Starting" on macOS 27" and fixes for x86 crypto/TLS failures in machines. https://docs.orbstack.dev/release-notes

1. **Emulation**
   - "OrbStack uses Rosetta to run images built for Intel CPUs". https://docs.orbstack.dev/docker
   - With Rosetta off, docs only say a "slower fallback" is used and don't name it. https://docs.orbstack.dev/settings
   - In 2023 the maintainer called QEMU on the Linux side the emulator. https://github.com/orbstack/orbstack/issues/530
   - Measured: with Rosetta off, container processes show `[qemu]`.
2. **Rosetta**
   - Key `rosetta`, UI "Use Rosetta to run Intel code". Docs recommend leaving it enabled. https://docs.orbstack.dev/settings
   - Change it with `orb config set` (syntax shown on https://docs.orbstack.dev/machines).
   - Default for 2.2.4 is not stated. The 2023 maintainer comment says "uses Rosetta by default unless you disable it". (#530)
3. **VM type**
   - v1.6.0 introduced a "New virtualization engine". The framework is not documented.
   - A maintainer answered "We make it work :)" when asked how Rosetta works without Virtualization.framework. https://github.com/orbstack/orbstack/issues/2735
4. **Resources**
   - `memory_mib`: "It is set to no more than 8 GB by default."
   - `cpu`: a percentage where an integer means multiples of 100%. Default not stated. https://docs.orbstack.dev/settings
   - Disk: not documented.
5. **Mounts**
   - VirtioFS. "bind mounts work seamlessly as they would on Linux". https://docs.orbstack.dev/docker/file-sharing
   - v0.3.1 "Fixed Docker bind mounts under `/tmp`". v0.7.0 fixed bind mounts in `$TMPDIR`. https://docs.orbstack.dev/release-notes
   - `/private/tmp` and writability are not explicitly documented. Measured: read-only and writable bind mounts from `/private/tmp` worked.
6. **Limits:** cgroup v2 and `--cpus`/`--memory` are not documented.

## Rosetta after macOS 27

- **Apple, macOS apps:** Rosetta "will be available through macOS 27". After that only a gaming subset remains. https://developer.apple.com/documentation/apple-silicon/about-the-rosetta-translation-environment
- **Apple developer news (2026-09-01):** "macOS 27: Final release to support Rosetta". https://developer.apple.com/news/?id=w5ngl9k2
- **macOS 27 release notes**
  - Rosetta "is not automatically restored after upgrading to macOS 27.0".
  - All Intel-based software becomes incompatible with macOS 28.0, excluding legacy games.
  - https://developer.apple.com/documentation/macos-release-notes/macos-27-release-notes
- **Linux VMs (Virtualization framework)**
  - "macOS 27 directly integrates support for Intel binary translation, without needing to install Rosetta". https://developer.apple.com/documentation/virtualization/running-intel-binaries-in-linux-vms
  - On macOS 27, `VZLinuxRosettaDirectoryShare.availability` always returns `installed`. The API carries no deprecation marker. https://developer.apple.com/documentation/virtualization/vzlinuxrosettadirectoryshare
  - No Apple statement found that Linux-VM translation ends after macOS 27. No explicit commitment for macOS 28 either.
- **Runtimes:** none of Docker, Colima/Lima, Podman or OrbStack documents a macOS 27 Rosetta deprecation (code search of their repos found nothing).
  - Podman's Rosetta-off default (5.6) was about Linux kernel 6.13+ compatibility, not Apple's deprecation. (Podman blog above)

## QEMU and Chromium

- **Playwright maintainer:** "QEMU emulation is very slow and not advanced enough to run browser binaries". https://github.com/microsoft/playwright/issues/13873#issuecomment-1264037198
- **Lima docs:** QEMU user mode "often sacrifices compatibility". https://github.com/lima-vm/lima/blob/v2.2.1/website/content/en/docs/config/multi-arch.md#L56
- **QEMU #324**, "chrome based apps can not be run under qemu user mode": Chrome's `/proc/self/exe` re-exec breaks. Closed 2026-10-13; resolution not visible without login. https://gitlab.com/qemu-project/qemu/-/work_items/324
- **QEMU #1637:** x86-64 `ucomiss` crash under QEMU on Apple AArch64 hosts (Firefox crash reports). Closed 2023-05-18, after QEMU 7.0.0. https://gitlab.com/qemu-project/qemu/-/work_items/1637
- **docker/for-mac #5766 (2021):** amd64 Chrome under QEMU crashed with SIGTRAP/SIGSEGV, plus ENOSYS for ptrace and inotify. https://github.com/docker/for-mac/issues/5766
- **colima #1613 (open)**
  - Colima's pinned QEMU 7.0.0 lacks `openat2()`, so tar fails under amd64.
  - A comment reports Go 1.26 GC crashes under it.
  - https://github.com/abiosoft/colima/issues/1613
- **podman #28181:** Rosetta was reported on but not active, which led to QEMU SIGSEGV in rustc (Podman 5.7.1). https://github.com/podman-container-tools/podman/issues/28181
- **Rosetta + Chromium:** docker/desktop-feedback #686 (open).
  - Setup: Playwright `v1.62.1-noble` image as linux/amd64 on Docker Desktop with Rosetta.
  - Result: screenshots are fully white. An OKLCH colour is computed as transparent.
  - A comment reports Chromium evaluating `1/0.75` as `Infinity`.
  - https://github.com/docker/desktop-feedback/issues/686
  - Measured: with `v1.64.1-noble` on Docker Desktop 4.98, no snapshot was blank, and HeroUI's Tailwind 4 colours rendered as on runners.
- **OrbStack #2744 (open):** amd64 under Rosetta appears slower after macOS 27.0.1. https://github.com/orbstack/orbstack/issues/2744

## Not documented / open

- Docker Desktop: the Rosetta default conflicts between the settings page ("Disabled") and the settings reference and 4.25 notes (`true` / on). Measured: on. Also undocumented: CPU default on the settings page, whether shares are writable, and which QEMU build handles binfmt.
- Colima: `--vz-rosetta` depends on `pgrep oahd`. On macOS 27.0.x, host Rosetta isn't restored after upgrade, so Colima may refuse to enable Rosetta even though VZ no longer needs a Rosetta install. This is an inference and untested. On the measuring machine `oahd` wasn't running.
- Colima: swap, cgroup v2 and container limits are not documented.
- Podman: whether the remote client resolves `/tmp/...` paths to `/private/tmp` for `-v` is not documented.
- Podman: the `containers.conf(5)` defaults for cpus and disk size disagree with the code.
- OrbStack: Rosetta default for 2.2.4, CPU default, disk size, hypervisor framework, fallback emulator name, `/private/tmp` sharing and cgroup behaviour are not documented.
- OrbStack: `memory_mib: 12288` exceeds the documented 8 GB default, so it was presumably changed on the measuring machine. This is an inference.
- Apple: no explicit statement on Linux-VM Intel translation in macOS 28+.
