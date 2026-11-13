#!/bin/sh
# Installs the packages given as arguments, then removes apt's indexes.
# On amd64 apt is pinned to the Ubuntu snapshot $UBUNTU_SNAPSHOT.
set -eu

if [ "$#" -eq 0 ]; then
  echo "Usage: install-packages.sh <package>…" >&2
  exit 2
fi

export DEBIAN_FRONTEND=noninteractive
sources=/etc/apt/sources.list.d/ubuntu.sources
work_dir=$(mktemp -d)

# apt-get update exits 0 when some indexes fail to download. Error-Mode=any makes that an error,
# so a dropped suite such as noble-security can't quietly leave older versions in the image.
apt_get() {
  apt-get -o Acquire::Retries=5 -o APT::Update::Error-Mode=any "$@"
}

case "$(dpkg --print-architecture)" in
  amd64)
    snapshot_uri="https://snapshot.ubuntu.com/ubuntu/${UBUNTU_SNAPSHOT:?UBUNTU_SNAPSHOT is required}"

    # The snapshot service is https only, and the base image has no CA certificates.
    # The Dockerfile bind-mounts the headless-shell stage's CA bundle here for this step only.
    ca_certificates=/tmp/ca-certificates.crt
    if [ ! -s "$ca_certificates" ]; then
      echo "install-packages.sh: no CA bundle at $ca_certificates" >&2
      exit 1
    fi

    cp -p "$sources" "$work_dir/ubuntu.sources"
    sed -i "s|^URIs: .*|URIs: $snapshot_uri/|" "$sources"
    rm -rf /var/lib/apt/lists/*
    apt_get -o "Acquire::https::CaInfo=$ca_certificates" update

    # apt's own snapshot option still read the live archive on amd64, so check where every index came from.
    indexes=$(apt-cache policy | awk '$1 ~ /^[0-9]+$/ && $2 != "/var/lib/dpkg/status" { print $2 }')
    if [ -z "$indexes" ]; then
      echo "install-packages.sh: apt has no package indexes" >&2
      exit 1
    fi
    for index in $indexes; do
      if [ "$index" != "$snapshot_uri" ] && [ "$index" != "$snapshot_uri/" ]; then
        echo "install-packages.sh: an index came from $index, not from $snapshot_uri" >&2
        exit 1
      fi
    done
    echo "install-packages.sh: all $(echo "$indexes" | wc -l) package indexes come from $snapshot_uri"

    apt_get -o "Acquire::https::CaInfo=$ca_certificates" install -y --no-install-recommends "$@"

    # Images built FROM this one get the live archive back.
    cp -p "$work_dir/ubuntu.sources" "$sources"
    ;;
  arm64)
    # The snapshot service answers 401 for ubuntu-ports, so arm64 uses the live ports.ubuntu.com.
    # The package list in the image is the record of what it got.
    apt_get update
    apt_get install -y --no-install-recommends "$@"
    ;;
  *)
    echo "install-packages.sh: unsupported architecture $(dpkg --print-architecture)" >&2
    exit 1
    ;;
esac

apt_get clean
rm -rf /var/lib/apt/lists/* "$work_dir"
