#!/usr/bin/env bash
# Checks a pushed browser image index against the browser package and prints a Markdown summary of it.
# It fails when the index digest differs from image.digest in chromium.json.
# Usage: check-index.sh <image:tag>
set -euo pipefail

usage() {
  echo "Usage: check-index.sh <image:tag>" >&2
  exit 2
}

[[ $# -eq 1 ]] || usage
ref=$1
# It takes a tag, not a digest. The tag is after the last slash, so a registry port isn't read as a tag.
[[ $ref != *@* && ${ref##*/} == *:* ]] || usage
repository=${ref%:*}

image_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
package_dir=$(dirname "$image_dir")
recorded=$(jq -er .image.digest "$package_dir/chromium.json")

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

# --raw prints the index byte for byte as the registry holds it, so its SHA-256 is the index digest.
docker buildx imagetools inspect --raw "$ref" > "$work/index.json"
digest=sha256:$(sha256sum "$work/index.json" | cut -d ' ' -f 1)

jq -e '.manifests | type == "array"' "$work/index.json" > /dev/null || fail "$ref is a single image, not an index"
platforms=$(jq -r '.manifests[].platform | "\(.os)/\(.architecture)\(if .variant then "/" + .variant else "" end)"' \
  "$work/index.json" | sort)
[[ $platforms == $'linux/amd64\nlinux/arm64' ]] \
  || fail "$ref lists the platforms $(tr '\n' ' ' <<< "$platforms")rather than exactly linux/amd64 and linux/arm64"

for manifest in $(jq -r '.manifests[].digest' "$work/index.json"); do
  docker buildx imagetools inspect --raw "$repository@$manifest" > "$work/manifest.json"
  jq -e '.layers | length > 0 and all(.mediaType == "application/vnd.oci.image.layer.v1.tar+gzip")' \
    "$work/manifest.json" > /dev/null \
    || fail "$repository@$manifest has a layer that isn't application/vnd.oci.image.layer.v1.tar+gzip"
done

echo "### Browser image"
echo
echo "- Tag: \`$ref\`"
echo "- Index digest: \`$digest\`"
echo "- Platforms: $(jq -Rrn '[inputs | "`\(.)`"] | join(", ")' <<< "$platforms")"

if [[ $digest != "$recorded" ]]; then
  echo "::error file=packages/chromium/chromium.json::image.digest is $recorded, but $ref has the index digest $digest. Put $digest in image.digest." >&2
  exit 1
fi
