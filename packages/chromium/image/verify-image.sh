#!/usr/bin/env bash
# Checks a built browser image against the browser package. Stops at the first failed check.
# Usage: verify-image.sh <image> <amd64|arm64>

# The single-quoted scripts and the dpkg-query format expand inside the image, not here.
# shellcheck disable=SC2016
set -euo pipefail

usage() {
  echo "Usage: verify-image.sh <image> <amd64|arm64>" >&2
  exit 2
}

[[ $# -eq 2 ]] || usage
image=$1
arch=$2
[[ $arch == amd64 || $arch == arm64 ]] || usage

image_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
package_dir=$(dirname "$image_dir")
version=$(jq -er .version "$package_dir/package.json")
chromium=$(jq -er .chromium "$package_dir/chromium.json")
headless_shell=$(jq -er .headlessShell "$package_dir/chromium.json")

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

ok() {
  echo "ok: $*"
}

# Runs a sh script inside the image. Further arguments become the script's $1, $2…
in_image() {
  local script=$1
  shift
  docker run --rm --platform "linux/$arch" --entrypoint sh "$image" -c "$script" sh "$@"
}

user=$(docker image inspect -f '{{.Config.User}}' "$image")
[[ -z $user ]] || fail "the image's default user is $user, not root"
ok "the default user is root"

image_arch=$(docker image inspect -f '{{.Architecture}}' "$image")
[[ $image_arch == "$arch" ]] || fail "the image is for $image_arch, not $arch"
ok "the image is for $arch"

docker image inspect -f '{{json .Config.Env}}' "$image" | jq -e 'any(. == "LANG=C.UTF-8")' > /dev/null \
  || fail "the image's env has no LANG=C.UTF-8"
ok "the image's env sets LANG=C.UTF-8"

expected_version="Google Chrome for Testing $chromium"
printed_version=$(docker run --rm --platform "linux/$arch" --entrypoint "$headless_shell" "$image" --version) \
  || fail "$headless_shell --version failed"
[[ $printed_version == "$expected_version" ]] \
  || fail "the headless shell prints '$printed_version', expected '$expected_version'"
ok "the headless shell prints '$printed_version'"

# --version doesn't load the browser's libraries, so start it once and read its user agent.
# It runs the way visual-check runs it: as ubuntu, with no capabilities and no new privileges.
page=$(
  docker run --rm --platform "linux/$arch" --user ubuntu --cap-drop=ALL --security-opt=no-new-privileges \
    --entrypoint "$headless_shell" "$image" \
    --no-sandbox --dump-dom 'data:text/html,<script>document.write(navigator.userAgent)</script>' 2>&1
) || fail "the headless shell didn't start as ubuntu: $page"
[[ $page == *"HeadlessChrome/$chromium "* ]] || fail "the headless shell's user agent doesn't name $chromium: $page"
ok "the headless shell starts as ubuntu without capabilities, and its user agent names HeadlessChrome/$chromium"

# The libraries beside the binary, such as SwiftShader, are loaded at run time, so they're checked too.
ldd_output=$(in_image 'cd "$(dirname "$1")" && for file in "$1" *.so*; do ldd "$file" || exit 1; done' "$headless_shell") \
  || fail "ldd failed on the headless shell or the libraries beside it"
if grep 'not found' <<< "$ldd_output"; then
  fail "ldd can't find the libraries above"
fi
ok "ldd finds every library the headless shell and the libraries beside it link against"

expected_marker=$(printf '{"version":"%s","arch":"%s"}' "$version" "$arch")
if ! cmp -s <(printf '%s\n' "$expected_marker") <(in_image 'cat /etc/visual-check/chromium.json'); then
  fail "the marker /etc/visual-check/chromium.json isn't exactly $expected_marker and a newline"
fi
ok "the marker is $expected_marker"

in_image 'cd "$(dirname "$1")" && test -s ABOUT && test -s LICENSE.headless_shell' "$headless_shell" \
  || fail "ABOUT or LICENSE.headless_shell is missing beside the headless shell"
ok "ABOUT and LICENSE.headless_shell are beside the headless shell"

package_format='${Package}\t${Version}\t${Architecture}\n'
in_image 'test -s /etc/visual-check/packages.txt && dpkg-query -W -f "$1" | diff /etc/visual-check/packages.txt -' \
  "$package_format" \
  || fail "/etc/visual-check/packages.txt is empty or differs from the installed packages"
packages=$(in_image 'cut -f 1 /etc/visual-check/packages.txt')
ok "/etc/visual-check/packages.txt lists the $(wc -l <<< "$packages" | tr -d ' ') installed packages"

# Images built FROM this one install packages from Ubuntu's archive, not from the snapshot amd64 was built with.
in_image 'test -s "$1" && ! grep -q snapshot.ubuntu.com "$1"' /etc/apt/sources.list.d/ubuntu.sources \
  || fail "/etc/apt/sources.list.d/ubuntu.sources is missing or still names snapshot.ubuntu.com"
apt_lists=$(in_image 'find /var/lib/apt/lists -type f ! -name lock') || fail "/var/lib/apt/lists can't be read"
[[ -z $apt_lists ]] || fail "/var/lib/apt/lists holds index files: $apt_lists"
ok "apt names Ubuntu's archive, not the snapshot, and holds no indexes"

node_on_path=$(in_image 'command -v node; command -v nodejs; true')
[[ -z $node_on_path ]] || fail "Node is on PATH: $node_on_path"
if grep -x nodejs <<< "$packages"; then
  fail "the nodejs package is installed"
fi
ok "the image has no Node"

if grep '^xfonts-' <<< "$packages"; then
  fail "the X font packages above are installed"
fi
x11_fonts=$(in_image 'fc-list : file | grep "^/usr/share/fonts/X11/"; true')
[[ -z $x11_fonts ]] || fail "fontconfig lists fonts under /usr/share/fonts/X11: $x11_fonts"
ok "the image has no X fonts"

# locale prints UTF-8 as the charmap only when the C.UTF-8 locale loads; otherwise it warns on stderr.
locale_output=$(in_image 'echo "$LANG $(locale charmap)"' 2>&1)
[[ $locale_output == "C.UTF-8 UTF-8" ]] || fail "LANG and locale's charmap are '$locale_output', expected 'C.UTF-8 UTF-8'"
ok "LANG is C.UTF-8 and locale uses it"

echo "verify-image.sh: $image passed every check for $arch"
