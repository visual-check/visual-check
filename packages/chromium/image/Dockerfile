# syntax=docker/dockerfile:1

# visual-check's browser image: Chrome for Testing's headless shell, the libraries it links against,
# fontconfig and Playwright's font packages without the X fonts, and the C.UTF-8 locale.
# It has no Node. build.sh builds it, with the versions from the browser package.

ARG UBUNTU=ubuntu:24.04@sha256:2198e4c65076e9cb0b3d695219df667c0e3b0072da64ca3c2648aca17dcecaf5

# Fetches and unzips the headless shell, and gives the final stage CA certificates for the snapshot.
# Only those files leave this stage, so its apt isn't pinned.
# build.sh passes the build args. ${…:?required} stops a build that lacks one.
FROM ${UBUNTU} AS headless-shell
ARG CHROMIUM
ARG CFT_PLATFORM
ARG CFT_SHA256
ADD --checksum=sha256:${CFT_SHA256:?required} \
  https://storage.googleapis.com/chrome-for-testing-public/${CHROMIUM:?required}/${CFT_PLATFORM:?required}/chrome-headless-shell-${CFT_PLATFORM}.zip \
  /tmp/headless-shell.zip
RUN apt-get -o Acquire::Retries=5 -o APT::Update::Error-Mode=any update \
  && DEBIAN_FRONTEND=noninteractive apt-get -o Acquire::Retries=5 install -y --no-install-recommends \
    ca-certificates unzip \
  && unzip -q /tmp/headless-shell.zip -d /tmp/unzipped \
  && mv "/tmp/unzipped/chrome-headless-shell-$CFT_PLATFORM" /opt/chrome-headless-shell

FROM ${UBUNTU}
ARG UBUNTU_SNAPSHOT=20261113T000000Z
ENV LANG=C.UTF-8

# The headless shell's libraries, then fontconfig and Playwright's font packages for Ubuntu 24.04
# minus xfonts-cyrillic and xfonts-scalable: Chromium can't use X fonts.
# The CA bundle is mounted for this step only, so the image has no CA certificates.
RUN --mount=type=bind,source=install-packages.sh,target=/tmp/install-packages.sh \
  --mount=type=bind,from=headless-shell,source=/etc/ssl/certs/ca-certificates.crt,target=/tmp/ca-certificates.crt \
  sh /tmp/install-packages.sh \
    libglib2.0-0t64 libnss3 libnspr4 libatk1.0-0t64 libatk-bridge2.0-0t64 libatspi2.0-0t64 libdbus-1-3 \
    libx11-6 libxcomposite1 libxdamage1 libxext6 libxfixes3 libxrandr2 libxcb1 libxkbcommon0 libgbm1 \
    libexpat1 libasound2t64 \
    fontconfig fontconfig-config fonts-liberation fonts-noto-color-emoji fonts-wqy-zenhei \
    fonts-ipafont-gothic fonts-tlwg-loma-otf fonts-freefont-ttf fonts-unifont

COPY --from=headless-shell /opt/chrome-headless-shell /opt/chrome-headless-shell

# Declared this late so a version bump keeps the cached apt layer.
ARG VERSION
ARG TARGETARCH
LABEL org.opencontainers.image.source=https://github.com/visual-check/visual-check \
  org.opencontainers.image.description="Chrome for Testing's headless shell with the libraries and fonts visual-check renders with" \
  org.opencontainers.image.version="${VERSION:?required}"

# The marker tells the CLI it runs inside this image. The package list comes last, after every install.
RUN mkdir -p /etc/visual-check \
  && printf '{"version":"%s","arch":"%s"}\n' "$VERSION" "$TARGETARCH" > /etc/visual-check/chromium.json \
  && dpkg-query -W -f '${Package}\t${Version}\t${Architecture}\n' > /etc/visual-check/packages.txt
