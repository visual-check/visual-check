# Proxy scope and host networking for headless Chromium on macOS runtimes: sources

Read on 2026-11-06 from primary sources. Chromium is tag `156.0.8078.80` (`CR156 = https://chromium.googlesource.com/chromium/src/+/refs/tags/156.0.8078.80`), checked against main `17d7b17a` (`CRMAIN`) where they differ. Playwright `v1.64.1`. Docker docs `docker/docs@16e452c8` (Docker Desktop 4.98). OrbStack docs at v2.2.5. Colima `v0.10.3`, Lima `v2.3.0`, Podman `v6.1.4`, gvisor-tap-vsock `eb087214`, Rancher Desktop `799dc062`.

Measured on this branch, not only read: headless shell 156 ignores `--proxy-pac-url` (a PAC naming a dead proxy still loads `https://example.com` directly), and `--proxy-bypass-list=*;<-loopback>` sends only loopback through the proxy (`probe.ts`).

## 1. Bypass list and PAC

### Bypass list

- headless shell parses `--proxy-bypass-list` itself, only together with `--proxy-server` (`CR156/headless/lib/browser/command_line_handler.cc#73`, L73-88, L208-210).
- Rule forms (`CR156/net/docs/proxy.md#336`, L336-466; `CR156/net/base/scheme_host_port_matcher_rule.cc#31`):
  - host pattern with `*`, optional scheme and port; `.suffix`; IP literal; CIDR, which matches only URLs that are IP literals (proxy.md L468-491);
  - `<local>`: hostnames without a dot, unrelated to localhost (proxy.md L432-448);
  - `<-loopback>`: removes the implicit bypasses (proxy.md L450-466).
- Implicit bypass: `localhost`, `*.localhost`, `[::1]`, `127.0.0.1/8`, `169.254/16`, `[fe80::]/10` go direct when no rule matches (`CR156/net/proxy_resolution/proxy_host_matching_rules.cc#235`, L235-270; proxy.md L493-532).
- Rules are evaluated last to first, first match wins, and `<-loopback>` evaluates to *exclude* (`proxy_host_matching_rules.cc#90`, L90-105; `CR156/net/base/scheme_host_port_matcher.cc#71`). So `*;<-loopback>` means: loopback through the proxy, everything else direct.
- No negation for other hosts. "Proxy only these hosts" exists in the net stack as `ProxyRules::reverse_bypass` (`CR156/net/proxy_resolution/proxy_config.h#133`), but neither the command line nor CDP sets it. Only the KDE `kioslaverc` reader does (`proxy_config_service_linux.cc#794`), and headless only uses system proxy config without `--proxy-server` (`headless_request_context_manager.cc#199`). Untested.

### PAC

- 156: headless handles only `--proxy-server`, `--proxy-bypass-list` and `--no-system-proxy-config-service`, and never sets a `proxy_resolver_factory` (`headless_request_context_manager.cc#296`). Without it, Linux gets `ProxyResolverNull`, so a PAC config silently falls back to DIRECT (`CR156/services/network/url_request_context_builder_mojo.cc#103`; `configured_proxy_resolution_service.cc#243`, L1353-1368).
- `--proxy-pac-url` arrived in headless in M158, first tag `158.0.8127.0` (`CRMAIN/headless/lib/browser/command_line_handler.cc#91`), evaluated in the out-of-process `proxy_resolver` V8 service (`CRMAIN/headless/lib/browser/headless_request_context_manager.cc#66`). `data:` PAC URLs are decoded inline (`pac_file_fetcher_impl.cc#156`). Not run.
- PAC can never route localhost or loopback URLs: the implicit bypass can't be removed for PAC, `<-loopback>` is for manual settings only (proxy.md L546-549). https URLs reach the script stripped to `scheme://host:port/` (proxy.md L652-697).
- CDP `Target.createBrowserContext` takes `proxyServer` and `proxyBypassList` per context, with the same parsers as the command line, and no PAC option (`CR156/third_party/blink/public/devtools_protocol/domains/Target.pdl#121`; `CR156/content/browser/devtools/protocol/target_handler.cc#1549`).

### SOCKS name resolution

- SOCKS5 always sends the hostname to the proxy, with no switch (proxy.md L180-193; `CR156/net/socket/socks5_client_socket.cc#337`). SOCKS4 resolves locally, IPv4 only (`socks_client_socket.cc#284`).
- So today a Mac `/etc/hosts` name resolves on the Mac, in the proxy.

## 2. Connection limits

- `CR156/net/socket/client_socket_pool_manager.cc#37` (L37-66), unchanged on main: 6 sockets per group (destination scheme, host and port), 256 per direct pool, **128 per proxy chain**, shared by every destination behind that proxy (`client_socket_pool_manager_impl.cc#63`).
- `TcpSocketPoolLimitRandomization` is on by default and lets a pool exceed its cap up to about 2× (`CR156/net/base/features.cc#751`; `client_socket_pool.cc#185`).
- Idle sockets count toward group and pool limits; a capped pool closes idle sockets in other groups (`transport_client_socket_pool.h#356`; `transport_client_socket_pool.cc#799`, L432-476).
- Pools belong to each `HttpNetworkSession` (`http_network_session.cc#197`), and each CDP browser context in headless is its own incognito context with its own network context (`headless_devtools_manager_delegate.cc#103`; `storage_partition_impl.cc#3495`). So each worker gets its own 128.
- `MaxConnectionsPerProxy` policy: default 128, range 6-256 (`components/policy/resources/templates/policy_definitions/Miscellaneous/MaxConnectionsPerProxy.yaml`). headless shell reads no enterprise policy (no policy provider in `headless/`; the setter is only called from `chrome/browser/net/system_network_context_manager.cc#866`). No switch raises it.

## 3. QUIC and HTTP/2 through SOCKS5

- No QUIC through SOCKS5: QUIC is only proxied over QUIC proxies (`CR156/net/http/http_stream_factory_job.cc#737`), the HTTP/3 jobs need `proxy_info_.is_direct()` (`http_stream_factory_job_controller.cc#921`), and SOCKS5 can't relay UDP (proxy.md L201-202).
- HTTP/2 works end to end: TLS with ALPN runs over the SOCKS tunnel (`connect_job_params_factory.cc#263`).
- QUIC is on by default for direct traffic (`http_network_session.h#141`), and Playwright 1.64.1 doesn't disable it (`packages/playwright-core/src/server/chromium/chromiumSwitches.ts#L59-L104`).
- Playwright's `exposeNetwork` launches Chromium with `--proxy-server=socks5://127.0.0.1:<port>` and `<-loopback>`, a SOCKS server inside the container that connects non-matching hosts directly (`chromium.ts#L391-L408`; read in `playwright-core` 1.64.1's bundle). So Playwright Chromium also sends every request through SOCKS5, with the same 128 limit and no QUIC.

## 4. macOS runtimes

| Runtime | `--network host`: `localhost` is the Mac's | Host alias reaches a server bound to the Mac's 127.0.0.1 | DNS through the macOS resolver | Follows the Mac's VPN |
|---|---|---|---|---|
| OrbStack 2.2 | Yes, out of the box, both ways ([host networking](https://docs.orbstack.dev/docker/host-networking); since v0.7.0) | `host.docker.internal` exists; loopback-only not documented, worked here | Forwards DNS "to macOS" ([architecture](https://docs.orbstack.dev/architecture)); `/etc/hosts` not stated | Yes ([network](https://docs.orbstack.dev/docker/network)) |
| Docker Desktop 4.34+ | Yes, behind Settings > Resources > Network > Enable host networking (beta 4.29, GA 4.34; sign-in dropped in 4.35, `release-notes.md` L2966; `engine/network/drivers/host.md` L56-115) | `host.docker.internal`; loopback-only not documented, worked in the Driver interface prototype | A 2016 note says `/etc/hosts` resolves (`previous-versions/archive-mac.md` L504) | Yes, traffic leaves from `com.docker.backend` (`desktop/features/networking/_index.md` L38-49) |
| Colima 0.10 (Lima) | No, `localhost` is the VM | Yes, `host.lima.internal` 192.168.5.2 "includes services that listen only on the host's 127.0.0.1" (lima `docs/config/network/user.md` L20-35) | Yes, native resolver incl. `/etc/hosts`, VPN and split DNS (`user.md` L37-41) | DNS yes; TCP implied |
| Podman machine 6 | No, the VM's namespace (inferred) | Yes, `host.containers.internal` 192.168.127.254, NATed to 127.0.0.1 by gvproxy (`cmd/gvproxy/config.go#L236-L265`) | System resolver (`pkg/services/dns/dns.go#L315-L319`) | Yes (`user-mode-networking.md`) |
| Rancher Desktop (Lima) | Not documented | Aliases map to `host.lima.internal` (`lima.ts#L682-L690`) | Lima resolver on by default | Not documented for macOS |

- Without host networking, a name that resolves to 127.0.0.1 is the container's own loopback when the container connects directly (`engine/network/_index.md` L286). With host networking on Colima, Podman and Rancher Desktop it's the VM's.

## Unconfirmed

- Whether OrbStack and current Docker Desktop resolve the Mac's `/etc/hosts` in containers.
- Whether `host.docker.internal` reaching a loopback-only Mac server is a supported behaviour on OrbStack and Docker Desktop. It works on both, measured.
- Headless 158's `--proxy-pac-url`, and the KDE `ReversedException` trick, both untested.
- Whether direct CDN traffic from the container actually used QUIC.
- Colima's and Lima's outbound TCP following VPN routes; Rancher Desktop's VPN behaviour on macOS.
