#!/bin/sh
# Install Tabularius from a GitHub release with one command, on macOS or Linux:
#
#   curl -fsSL https://github.com/sitotisai/tabularius/releases/latest/download/get.sh | sh
#
# It downloads the single-file program for this system (macOS or Linux, arm64 or
# x64), checks it against the release's SHA256SUMS, and puts it in ~/.local/bin as
# `tabularius`. Nothing else is installed and nothing needs sudo or Node. Then:
#
#   tabularius demo
#
# Options (after `sh -s --` when piped: `curl ... | sh -s -- --version 0.1.0`):
#   --version 0.1.0   install that version instead of the latest release
#   --bin-dir DIR     put the program in DIR (default ~/.local/bin)
#   --help            show this
#
# Environment: TABULARIUS_VERSION and TABULARIUS_BIN do the same as the options.
# TABULARIUS_RELEASES is the releases page to download from (default
# https://github.com/sitotisai/tabularius/releases), for a mirror or a test.
#
# The checksum file comes from the same release page as the program, so it catches a
# damaged or cut-off download, not a release replaced by someone who controls the page.
# To run Tabularius as a service, or on a system with no program for it, use
# scripts/install.sh from a checkout (see ADMIN.md).
#
# Everything is inside main(), which runs on the last line: a download that stops
# half-way does nothing instead of running half a script.

set -eu

say() { printf '==> %s\n' "$*"; }
die() { printf 'error: %s\n' "$*" >&2; exit 1; }

usage() {
  cat <<'EOF'
Install Tabularius from a GitHub release (macOS or Linux).

  --version 0.1.0   install that version instead of the latest release
  --bin-dir DIR     put the program in DIR (default ~/.local/bin)
  --help            show this

Environment: TABULARIUS_VERSION, TABULARIUS_BIN, and TABULARIUS_RELEASES (the
releases page to download from, default https://github.com/sitotisai/tabularius/releases).
EOF
}

# fetch URL FILE: download, failing on an HTTP error.
fetch() {
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL --retry 3 --retry-delay 2 -o "$2" "$1" || die "could not download $1"
  elif command -v wget >/dev/null 2>&1; then
    wget -q -O "$2" "$1" || die "could not download $1"
  else
    die "curl or wget is needed to download the program"
  fi
}

# latest_tag: the tag of the newest published release (not a pre-release), read from the
# redirect GitHub answers /releases/latest with, so there is no API rate limit to hit.
latest_tag() {
  if command -v curl >/dev/null 2>&1; then
    final="$(curl -fsSL --retry 3 --retry-delay 2 -o /dev/null -w '%{url_effective}' "$RELEASES/latest")" || die "could not reach $RELEASES/latest"
  elif command -v wget >/dev/null 2>&1; then
    final="$(wget -q --max-redirect=0 -S --spider "$RELEASES/latest" 2>&1 | awk 'tolower($1) == "location:" { print $2 }' | tr -d '\r' | tail -n 1)"
  else
    die "curl or wget is needed to download the program"
  fi
  case "$final" in
    */tag/v*) printf '%s\n' "${final##*/tag/v}" ;;
    *) die "no release of Tabularius has been published yet at $RELEASES; see QUICKSTART.md for installing from a checkout" ;;
  esac
}

sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | awk '{ print $1 }'
  elif command -v shasum >/dev/null 2>&1; then shasum -a 256 "$1" | awk '{ print $1 }'
  else die "sha256sum or shasum is needed to check the download"
  fi
}

main() {
  RELEASES="${TABULARIUS_RELEASES:-https://github.com/sitotisai/tabularius/releases}"
  RELEASES="${RELEASES%/}"
  BIN_DIR="${TABULARIUS_BIN:-$HOME/.local/bin}"
  VERSION="${TABULARIUS_VERSION:-}"

  while [ $# -gt 0 ]; do
    case "$1" in
      --version) [ $# -ge 2 ] || die "--version needs a number, such as --version 0.1.0"; VERSION="$2"; shift 2 ;;
      --bin-dir) [ $# -ge 2 ] || die "--bin-dir needs a folder"; BIN_DIR="$2"; shift 2 ;;
      -h|--help) usage; return 0 ;;
      *) die "unknown option $1 (see --help)" ;;
    esac
  done

  # --- this system -----------------------------------------------------------
  case "$(uname -s)" in
    Darwin) os=macos ;;
    Linux) os=linux ;;
    *) die "there is no program for $(uname -s) here. On Windows, use scripts\\install.ps1 from a checkout (see QUICKSTART.md)" ;;
  esac
  case "$(uname -m)" in
    arm64|aarch64) cpu=arm64 ;;
    x86_64|amd64) cpu=x64 ;;
    *) die "there is no program for the $(uname -m) processor (macOS and Linux on arm64 and x64 have one)" ;;
  esac
  # A shell started under Rosetta says x86_64 on an Apple silicon Mac; the arm64 program is the one to install.
  if [ "$os" = macos ] && [ "$cpu" = x64 ] && [ "$(sysctl -n hw.optional.arm64 2>/dev/null || true)" = 1 ]; then cpu=arm64; fi
  # The program is built on glibc; Alpine and other musl systems can't run it.
  if [ "$os" = linux ] && { ls /lib/ld-musl-* >/dev/null 2>&1 || ldd --version 2>&1 | grep -qi musl; }; then
    die "this Linux uses musl (Alpine); the program needs glibc. Run Tabularius with Docker (docker compose up) or install Node 22.20 or newer and use scripts/install.sh from a checkout"
  fi

  # --- which version -----------------------------------------------------------
  VERSION="${VERSION#v}"
  if [ -z "$VERSION" ]; then
    say "Finding the latest release"
    VERSION="$(latest_tag)"
  fi
  case "$VERSION" in
    ""|*[!0-9A-Za-z._+-]*|.*|-*) die "\"$VERSION\" isn't a version such as 0.1.0" ;;
  esac
  name="tabularius-$VERSION-$os-$cpu"
  base="$RELEASES/download/v$VERSION"

  # --- download and check ------------------------------------------------------
  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' EXIT INT TERM HUP
  say "Downloading Tabularius $VERSION for $os $cpu"
  fetch "$base/$name" "$tmp/$name"
  fetch "$base/SHA256SUMS" "$tmp/SHA256SUMS"
  # The line for exactly this file: "<64 hex digits>  <name>" ("<hash> *<name>" is the same file in binary mode).
  expected="$(awk -v file="$name" '
    { sub(/\r$/, "") }
    length($0) > 66 && substr($0, 1, 64) ~ /^[0-9a-fA-F]+$/ && substr($0, 65, 1) == " " {
      n = substr($0, 67)
      if (n == file) { print tolower(substr($0, 1, 64)); exit }
    }' "$tmp/SHA256SUMS")"
  [ -n "$expected" ] || die "SHA256SUMS in this release has no checksum for $name; there may be no program for $os $cpu in version $VERSION"
  actual="$(sha256_of "$tmp/$name")"
  if [ "$actual" != "$expected" ]; then
    die "the download of $name does not match its checksum (expected $expected, got $actual); nothing was installed"
  fi
  say "Checksum matches"

  # --- install -----------------------------------------------------------------
  mkdir -p "$BIN_DIR"
  chmod 755 "$tmp/$name"
  # macOS marks files from a browser as quarantined; one from curl isn't, but clear it if it is.
  if [ "$os" = macos ]; then xattr -d com.apple.quarantine "$tmp/$name" 2>/dev/null || true; fi
  # Beside the target, then renamed over it, so a program that is running keeps working and a failure leaves the old one.
  cp "$tmp/$name" "$BIN_DIR/.tabularius.$$"
  mv -f "$BIN_DIR/.tabularius.$$" "$BIN_DIR/tabularius"
  # The first run unpacks the program's files (a few seconds), so do it now and see it work.
  if ! shown="$("$BIN_DIR/tabularius" --version 2>&1)"; then
    die "installed $BIN_DIR/tabularius but it does not run: $shown"
  fi
  say "Installed $BIN_DIR/tabularius ($(printf '%s\n' "$shown" | head -n 1))"
  case ":$PATH:" in
    *":$BIN_DIR:"*) say "Try it: tabularius demo" ;;
    *) say "$BIN_DIR is not on your PATH. Run it as $BIN_DIR/tabularius demo, or add it: export PATH=\"$BIN_DIR:\$PATH\"" ;;
  esac
}

main "$@"
