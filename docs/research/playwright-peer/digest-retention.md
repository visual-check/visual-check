# MCR digest retention after an in-place rebuild

Question: if Microsoft rebuilds `mcr.microsoft.com/playwright:v<ver>-noble` in place, does the old digest stay pullable?

All registry checks were run on 2026-11-11 against `https://mcr.microsoft.com/v2/...` anonymously. Only manifest, referrers and config-blob requests were made. No layer blobs were requested, so layer availability is not verified.

## Short answer

- All three builds of `v1.64.1-noble` still resolve by digest. The index, both platform manifests and both config blobs return 200 for each.
- Superseded Playwright digests from 2021 and 2022 also still resolve. So do superseded `dotnet/sdk` digests from 2023 and 2025.
- Microsoft has deleted MCR content at least once: all Azul Zulu `mcr.microsoft.com/java/*` images, on 2025-06-30. A digest from that repo now returns 404.
- No Microsoft document guarantees that MCR tags or digests stay available. MCR has no SLA. The only written statements are per team (.NET), and they are hedged.
- The lifecycle annotation means "unsupported". Playwright sets it to the push day on every image. It does not mean deletion: images marked EOL on 2024-11-18 still resolve.

## 1. The three `v1.64.1-noble` builds

The earlier digests are not quoted in microsoft/playwright#43581 or microsoft/playwright-python#3315. They come from Renovate digest-bump PRs.

| Build | Index digest | amd64 config `created` | arm64 config `created` | HEAD by digest |
| --- | --- | --- | --- | --- |
| 1st (release) | `sha256:7852dc5a7d72f5fe458a597d690f6c42fbc8e9e26ddfa95f8e6ef552558d9bbf` | 2026-10-14T12:46:39Z | 2026-10-14T12:22:06Z | 200, OCI index |
| 2nd (Node CVE rebuild) | `sha256:47b510dd9230bf0b9bfc9b20102241e577ea7a99334ab4c3ca19f19770e9b8ea` | 2026-10-23T00:34:22Z | 2026-10-23T00:10:19Z | 200, OCI index |
| 3rd (current tag) | `sha256:2f05f8a734509a7b3f26a912639488ee08f58a7b292d14d62271bcff9038768f` | 2026-11-01T17:56:25Z | 2026-11-01T17:28:58Z | 200, OCI index |

The config dates match the dates in #43581: built 2026-10-14, then amd64 00:34 and arm64 00:10 on 2026-10-23.

Platform manifests (all return 200, and their config blobs return 200):

| Build | amd64 manifest | arm64 manifest |
| --- | --- | --- |
| 1st | `sha256:bdfda2a8fdf48707c5e50a49bd3e06d8d0c759153dc8ee057d8a81c3450bb3e9` | `sha256:68456172e8d99f42cf391e835f5d566b3ab0a2c6a745decd9590c4d73c54d2fb` |
| 2nd | `sha256:d65108d1a8095d8b0c4a5e32bf1807a40a5ce90ff0c78473e1116b1c243235e8` | `sha256:969a9e3655576186a7f3b3d85502f8c4041f4afce571df7aadba6384d93ee61f` |
| 3rd | `sha256:ee15712262f017b8157421b212b12099146645f44b1bc5c0514cbbe6a229b1d0` | `sha256:f609973e8fd93f38a5ddfd706a65805294247dae8d81b2541c0afe2787746197` |

The old platform manifests are untagged now. `v1.64.1-noble-amd64` and `v1.64.1-amd64` both point to the 3rd build's amd64 manifest (`ee157122…`).

Sources for the digests:
- 1st → 2nd: https://github.com/martin-francois/codebase-knowledge-bench/pull/118 (Renovate, opened 2026-10-30).
- 2nd → 3rd: https://github.com/shields/hoboken/pull/294, https://github.com/pjan/atlas/pull/116, https://github.com/Wikid82/Charon/pull/1800 (Renovate, 2026-11-01/02).

Other facts seen while checking:
- The 3rd build's config history shows `ARG NODE_VERSION=26`. The 1st and 2nd builds show `NODE_VERSION=24`. So the 2026-11-01 rebuild of the same tag changed the Node major version.
- Two third-party PRs say the 2nd → 3rd rebuild also changed Chromium: https://github.com/ferni-ai/voiceai/pull/3753 says `156.0.8078.4` → `156.0.8078.80`, and https://github.com/PhyberApex/kuroshiro/pull/1707 says "a newer Chrome patch" and screenshot drift. I did not verify this, because doing so needs the layers.
- The ferni-ai PR re-pins to the 2nd-build digest and reports that the registry still serves it.

## 2. Other superseded MCR digests

Superseded digests that still resolve (HEAD 200):

| Repo | Digest (short) | Built / superseded | Source of the digest |
| --- | --- | --- | --- |
| playwright | `1700531ce01a` | built 2021-02-10 | https://github.com/mui/material-ui/pull/27066 |
| playwright | `bca4179f0a1a`, `9e5f616b9d1f`, `e910bbb5301a`, `776f868d63ff` | 2021 (`776f868d` built 2021-09-21) | mui/material-ui #27066, #27429, #27536, #28592 |
| playwright | `f08e263c95e8` (list; child built 2021-12-02) | superseded 2022-01 | https://github.com/mui/material-ui/pull/30630 |
| playwright | `8b1110182dc4`, `cd3f2a52eed3` (lists; child built 2022-02-11) | 2022 | mui/material-ui #30630, #31039 |
| dotnet/sdk | `8189c53e1f03` (`6.0.407`, superseded in 2023) | 2023 | https://github.com/microsoft/containerregistry/issues/141 |
| dotnet/sdk | `7f8e8b1514a2`, `6df1177e48b5`, `cab0284cce7b` | superseded 2025 | https://github.com/pulumi/examples/pull/2042, https://github.com/drasi-project/drasi-platform/pull/267 |
| dotnet/aspnet | `6e81022bab60` (lifecycle example, EOL 2024-11-12) | 2024 | dotnet-docker `documentation/vulnerability-reporting.md` |

The 2021–2022 Playwright digests were for floating tags (`mcr.microsoft.com/playwright` with no tag, or `focal`), not version tags. Config blobs for `1700531c`, `776f868d` and two 2022 children also return 200.

Evidence of deletion or failure:

| What | Evidence |
| --- | --- |
| Azul Zulu `mcr.microsoft.com/java/*`, over 1,800 tags, deleted 2025-06-30 | https://devblogs.microsoft.com/java/deletion-of-outdated-azul-zulu-for-azure-container-images-for-better-security/ . Checked today: `java/jdk:11-zulu-ubuntu` returns 404. `java/jdk@sha256:19712872c6dd8ca02a8f727737372477559f2659aa6294c2dcae050096234224` returns 404. That digest was printed by a `docker pull` in https://github.com/azdc-training/trainingdays-cw (day6/challenges/challenge4.md). `/v2/java/jdk/tags/list` still lists 72 tags, but the listed tags I checked return 404. So the tag list cannot be trusted as proof that a tag exists. |
| One report of an old pinned digest failing during pull (2023) | microsoft/containerregistry#141: the manifest resolved, but one layer download failed with HTTP 400 `InvalidUri`. Cause not stated. The digest (`8189c53e…`) resolves today. |
| Tag removed from a nightly repo | https://github.com/aspnet/Benchmarks/issues/1983: `dotnet/nightly/aspnet:9.0-alpine-composite` became "manifest unknown" after a rename. That was a nightly repo, and it was a tag, not a digest. |

The Playwright repo itself has its full tag history. The MCR tag list has 18,636 tags, going back to `v1.3.0`.

## 3. Documented policy

### MCR / MAR

- https://github.com/microsoft/containerregistry (README): "MAR is globally distributed offering and does not have an SLA." There is no retention, deletion or immutability policy in the README or in `docs/`.
- https://github.com/microsoft/containerregistry/issues/141 (2023). This is a Microsoft member from the .NET team answering, not an MCR-wide policy:
  - "Tags are mutable by design."
  - "Referencing images via sha is supported scenario."
  - "To date, we do not cleanup any of the published .NET images. I don't think this will be the case forever." He said any policy change would be announced in dotnet-docker.
- https://github.com/dotnet/dotnet-docker/blob/main/documentation/supported-tags.md: "Unsupported tags and images can still be pulled, but they will no longer receive updates for any reason." It also says digest pinning is how you request a specific OS patch. This covers .NET images only.
- https://devblogs.microsoft.com/dotnet/net-core-2-1-container-images-will-be-deleted-from-docker-hub: the 2.1 images were deleted from Docker Hub but "will remain available on MCR". This also covers .NET only.
- I found no learn.microsoft.com page on MCR retention, untagged-manifest cleanup, or a digest guarantee. Unknown whether MCR runs any untagged-manifest cleanup. The observed behaviour is that it has not, for Playwright since 2021.

### ACR (the publish source, not MCR itself)

Playwright pushes to `playwright.azurecr.io/public/playwright`, and the image is then syndicated to MCR (see `utils/docker/publish_docker.sh`).

- https://learn.microsoft.com/en-us/azure/container-registry/container-registry-retention-policy: "By default, container registries don't have a retention policy for untagged manifests." The policy is opt-in, Premium only, and in preview. It supports Docker media types only, not OCI index or manifest. The Playwright v1.64.1 images are OCI.
- https://learn.microsoft.com/en-us/azure/container-registry/container-registry-delete: pushing over a tag "untags the previously pushed image". Its manifest and layers stay until someone deletes them by digest.
- Unknown whether the source ACR has purge tasks, and whether a deletion there would reach MCR.

### Lifecycle annotation (`vnd.microsoft.artifact.lifecycle.end-of-life.date`)

- Added in microsoft/playwright PR #29847, merged 2024-03-07. It copies playwright-dotnet PR #2879. The script runs `oras attach --artifact-type application/vnd.microsoft.artifact.lifecycle --annotation "vnd.microsoft.artifact.lifecycle.end-of-life.date=$today"` right after each `docker push`. The PR gives only an internal Microsoft link as its rationale.
- It is attached to the arch tags (`…-noble-amd64` etc.), so the referrers sit on the platform manifests, not on the index. `GET /v2/playwright/referrers/<index digest>` returns an empty list. On each platform manifest it returns two lifecycle referrers, one for `vX-noble-ARCH` and one for `vX-ARCH`.
- Observed EOL dates equal the push day: 2026-10-14, 2026-10-23 and 2026-11-01 for the three `v1.64.1` builds, and 2024-11-18 for `v1.49.0`. The current build is also marked EOL on its own push day.
- Meaning per dotnet-docker `documentation/vulnerability-reporting.md`: "if the image has a lifecycle manifest attached and it contains an end-of-life date, the image is unsupported." It is a signal for scanners and consumers, read with `oras discover`. Nothing there says it triggers deletion.
- Azure/acr-cli has a preview `acr annotate` command that writes the same annotation. It annotates only and does not delete.
- The Java devblog recommends ORAS to check this metadata in CI. In that case Microsoft did delete the images, but that was a separate announced action, not a result of the annotation.
- I found no canonical learn.microsoft.com spec for this annotation.
- Inference (not documented): Playwright marks each image EOL at push to say it will not be maintained. The v1.64.1 CVE rebuilds show that it sometimes is.

## 4. `v1.49.0-noble`

| Item | Value |
| --- | --- |
| HEAD on the tag | 200 |
| Index digest | `sha256:0fc07c73230cb7c376a528d7ffc83c4bdcdcd3fc7efbe54a2eed72b1ec118377` |
| Media type | `application/vnd.docker.distribution.manifest.list.v2+json` (Docker list, not OCI) |
| amd64 manifest | `sha256:8d8af91e3f34a33c509022a20f62f53954f49011ad4104edd766138a2edfc567`, config created 2024-11-18T18:47:51Z |
| arm64 manifest | `sha256:43f30f10a45688023730cb6edcc6674bafae11c7bbc111c74c87bf8b2ba9bf15`, config created 2024-11-18T19:06:56Z |
| Lifecycle EOL date | 2024-11-18, two referrers per platform |
| Also tagged | `v1.49.0` (same digest) |
| Playwright v1.49.0 release | 2024-11-18T18:33Z |

The config dates match the release day, so this tag has evidently not been rebuilt since release. `v1.64.1-noble`, by contrast, is an OCI index.

## Unknowns

- Whether the layer blobs of the old digests are still served. They were not checked, by instruction.
- Any MCR-wide written retention guarantee. None was found.
- Whether the Chromium version really changed between the 2nd and 3rd `v1.64.1-noble` builds. Only third-party claims exist.
- Whether the source ACR (`playwright.azurecr.io`) has a retention or purge policy.
