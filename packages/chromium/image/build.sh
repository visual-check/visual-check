#!/usr/bin/env bash
# Builds the browser image for one CPU architecture, with the versions and checksum from the browser package.
# Usage: build.sh <amd64|arm64> [docker buildx build options…]
set -euo pipefail

usage() {
  echo "Usage: build.sh <amd64|arm64> [docker buildx build options…]" >&2
  exit 2
}

[[ $# -ge 1 ]] || usage
arch=$1
shift
case $arch in
  amd64) cft_platform=linux64 ;;
  arm64) cft_platform=linux-arm64 ;;
  *) usage ;;
esac

image_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
package_dir=$(dirname "$image_dir")
version=$(jq -er .version "$package_dir/package.json")
chromium=$(jq -er .chromium "$package_dir/chromium.json")
cft_sha256=$(jq -er --arg platform "$cft_platform" '.sha256[$platform]' "$package_dir/chromium.json")

# Attestations would wrap each single-arch image in an index of its own.
docker buildx build \
  --platform "linux/$arch" \
  --provenance=false \
  --sbom=false \
  --build-arg "VERSION=$version" \
  --build-arg "CHROMIUM=$chromium" \
  --build-arg "CFT_PLATFORM=$cft_platform" \
  --build-arg "CFT_SHA256=$cft_sha256" \
  "$@" \
  "$image_dir"
