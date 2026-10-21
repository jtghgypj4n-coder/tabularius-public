#!/bin/sh
# Install Tabularius with one command, on macOS or Linux:
#
#   ./scripts/install.sh                         from a checkout
#   ./scripts/install.sh --service ~/Databases   ...and run it as a service that
#                                                starts at login/boot and hosts that folder
#
# It uses Node 22.20+ if you have it, and otherwise downloads Node into
# ~/.openhbam/node (nothing is installed system-wide). It puts a `tabularius`
# command in ~/.local/bin. Run from outside a checkout, it clones the
# repository into ~/.openhbam/app (set TABULARIUS_REPO to use another URL).
#
#   --from FILE   install (or, when installed, upgrade) from a copy instead of
#                 GitHub: a git bundle, a tarball or a folder. The repository is
#                 private, so a server without a GitHub sign-in uses this. Make
#                 a bundle where you can reach GitHub with
#                 `git -C tabularius bundle create tabularius.bundle HEAD main`.
#
# Service options: --port 8080, --host 0.0.0.0 (default: reachable from the
# network; use 127.0.0.1 for this machine only). Anything after `--` is passed
# to `tabularius serve`, e.g. -- --https files.example.com --sql-port 5432.
#
#   --system      run at boot without anyone logged in, as you (asks for sudo):
#                 a LaunchDaemon on macOS, a system unit on Linux (which may
#                 also use ports below 1024, such as 443 for --https)
#   --print       show the service file instead of installing it
#   --uninstall   stop the service and remove it (hosted files are kept)
#   --upgrade     update to the newest version in place: back up the hosted
#                 folder, restart the service on the new version, and go back
#                 to the old one if it doesn't start (tabularius upgrade); with
#                 --from, the new version comes from that copy
#
# The service refuses a port another program already uses, naming a free one.

set -eu

HOME_DIR="${TABULARIUS_HOME:-${OPENHBAM_HOME:-$HOME/.openhbam}}"
REPO="${TABULARIUS_REPO:-${OPENHBAM_REPO:-https://github.com/sitotisai/tabularius.git}}"
BIN_DIR="${TABULARIUS_BIN:-${OPENHBAM_BIN:-$HOME/.local/bin}}"
NODE_VERSION="22.22.0"
SERVICE_DIR=""
PORT=8080
HOST=0.0.0.0
SYSTEM=""
PRINT=""
UNINSTALL=""
UPGRADE=""
FROM=""

while [ $# -gt 0 ]; do
  case "$1" in
    --service) SERVICE_DIR="$2"; shift 2 ;;
    --port) PORT="$2"; shift 2 ;;
    --host) HOST="$2"; shift 2 ;;
    --system) SYSTEM=1; shift ;;
    --print) PRINT=1; shift ;;
    --uninstall) UNINSTALL=1; shift ;;
    --upgrade) UPGRADE=1; shift ;;
    --from) FROM="$2"; shift 2 ;;
    --) shift; break ;;
    -h|--help) sed -n '2,36p' "$0"; exit 0 ;;
    *) echo "unknown option $1" >&2; exit 1 ;;
  esac
done

say() { printf '==> %s\n' "$*" >&2; }
die() { printf 'error: %s\n' "$*" >&2; exit 1; }

# --- Node ------------------------------------------------------------------

node_ok() {
  "$1" -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=20)?0:1)' 2>/dev/null
}

NODE=""
if command -v node >/dev/null 2>&1 && node_ok node; then
  NODE="$(command -v node)"
elif [ -x "$HOME_DIR/node/bin/node" ] && node_ok "$HOME_DIR/node/bin/node"; then
  NODE="$HOME_DIR/node/bin/node"
else
  (
    case "$(uname -s)" in Darwin) os=darwin ;; Linux) os=linux ;; *) die "unsupported system $(uname -s)" ;; esac
    case "$(uname -m)" in x86_64|amd64) arch=x64 ;; arm64|aarch64) arch=arm64 ;; *) die "unsupported CPU $(uname -m)" ;; esac
    say "Downloading Node $NODE_VERSION into $HOME_DIR/node"
    mkdir -p "$HOME_DIR"
    tmp="$(mktemp -d)"
    trap 'rm -rf -- "$tmp"' 0
    trap 'exit 1' HUP INT TERM
    file="node-v$NODE_VERSION-$os-$arch.tar.gz"
    dist="https://nodejs.org/dist/v$NODE_VERSION"
    curl -fsSL "$dist/$file" -o "$tmp/node.tgz"
    curl -fsSL "$dist/SHASUMS256.txt" -o "$tmp/SHASUMS256.txt"
    if command -v sha256sum >/dev/null 2>&1; then
      actual="$(sha256sum "$tmp/node.tgz")"
    elif command -v shasum >/dev/null 2>&1; then
      actual="$(shasum -a 256 "$tmp/node.tgz")"
    else
      die "sha256sum or shasum is needed to verify $file"
    fi
    actual="${actual%% *}"
    expected="$(awk -v file="$file" '
      {
        sub(/\r$/, "")
        hash = substr($0, 1, 64)
        name = substr($0, 65)
        if (length(hash) != 64 || hash ~ /[^0-9a-fA-F]/ || name !~ /^  ?/) next
        sub(/^  ?\*?/, "", name)
        if (name == file) { print tolower(hash); exit }
      }
    ' "$tmp/SHASUMS256.txt")"
    if [ -z "$expected" ] || [ "$actual" != "$expected" ]; then
      die "SHA256 mismatch for $file: expected ${expected:-<missing>}, actual $actual"
    fi
    rm -rf "$HOME_DIR/node"
    mkdir -p "$HOME_DIR/node"
    tar -xzf "$tmp/node.tgz" -C "$HOME_DIR/node" --strip-components 1
  )
  NODE="$HOME_DIR/node/bin/node"
fi
NPM="$(dirname "$NODE")/npm"
[ -x "$NPM" ] || NPM="$(command -v npm)"
say "Using Node $("$NODE" -v) at $NODE"

# --- the app -----------------------------------------------------------------

here="$(cd "$(dirname "$0")/.." && pwd)"
if [ -f "$here/packages/cli/src/main.ts" ]; then
  APP="$here"
else
  APP="$HOME_DIR/app"
  installed() { [ -f "$APP/packages/cli/src/main.ts" ]; }
  if [ -n "$FROM" ] && installed && [ -z "$PRINT$UNINSTALL" ]; then
    UPGRADE=1 # an install from a copy over an existing one is an upgrade, with its backup and rollback
  fi
  if [ -n "$UPGRADE$UNINSTALL" ]; then
    installed || die "Tabularius isn't installed in $APP"
  elif [ -n "$FROM" ]; then
    [ -e "$FROM" ] || die "$FROM isn't there"
    if [ -d "$FROM" ]; then
      say "Copying $FROM into $APP"
      mkdir -p "$APP" && cp -R "$FROM/." "$APP/"
    elif git bundle list-heads "$FROM" >/dev/null 2>&1; then
      say "Cloning $FROM into $APP"
      git clone "$FROM" "$APP"
    else
      say "Unpacking $FROM into $APP"
      tmp="$(mktemp -d)"
      tar -xf "$FROM" -C "$tmp" || die "could not unpack $FROM"
      # A release tarball holds one folder with the files in it.
      # (Counted with ls: the arguments after -- are still needed for the service.)
      top="$(ls -A "$tmp")"
      if [ "$(ls -A "$tmp" | wc -l)" -eq 1 ] && [ -d "$tmp/$top" ]; then src="$tmp/$top"; else src="$tmp"; fi
      [ -f "$src/packages/cli/src/main.ts" ] || die "$FROM doesn't hold Tabularius"
      mkdir -p "$(dirname "$APP")" && mv "$src" "$APP"
      rm -rf "$tmp"
    fi
  elif [ -d "$APP/.git" ]; then
    say "Updating $APP"
    git -C "$APP" pull --ff-only || die "could not update from GitHub; without a GitHub sign-in, use --from with a bundle or tarball (see ADMIN.md, Upgrading)"
  else
    say "Cloning $REPO into $APP"
    git clone --depth 1 "$REPO" "$APP" || die "could not clone $REPO; without a GitHub sign-in, use --from with a bundle or tarball (see ADMIN.md, Upgrading)"
  fi
fi
export TABULARIUS_HOME="$HOME_DIR"
# Upgrading fetches the new version itself, so it can go back if it doesn't start.
if [ -n "$UPGRADE" ]; then exec "$NODE" --no-warnings "$APP/packages/cli/src/main.ts" upgrade ${FROM:+--from "$FROM"}; fi
if [ -z "$PRINT$UNINSTALL" ]; then
say "Installing dependencies"
(cd "$APP" && PATH="$(dirname "$NODE"):$PATH" "$NPM" ci --omit=dev --ignore-scripts --no-audit --no-fund >/dev/null)

mkdir -p "$BIN_DIR"
cat > "$BIN_DIR/tabularius" <<SH
#!/bin/sh
exec "$NODE" --no-warnings "$APP/packages/cli/src/main.ts" "\$@"
SH
chmod +x "$BIN_DIR/tabularius"
# The command was called openhbam before it was Tabularius; that name keeps working.
cp "$BIN_DIR/tabularius" "$BIN_DIR/openhbam"
say "Installed $BIN_DIR/tabularius (and openhbam, its old name)"
case ":$PATH:" in *":$BIN_DIR:"*) ;; *) say "Add $BIN_DIR to your PATH to run Tabularius from anywhere" ;; esac
fi

# --- service -------------------------------------------------------------------
# The command line program writes and installs the service file (service.ts),
# the same way on every system.

case "${TABULARIUS_OS:-${OPENHBAM_OS:-$(uname -s)}}" in # TABULARIUS_OS=Darwin --print shows the macOS file elsewhere
  Darwin) PLATFORM=darwin ;;
  Linux) PLATFORM=linux ;;
  *) die "unsupported system ${TABULARIUS_OS:-${OPENHBAM_OS:-$(uname -s)}}" ;;
esac
CLI="$APP/packages/cli/src/main.ts"
if [ -n "$UNINSTALL" ]; then exec "$NODE" --no-warnings "$CLI" service uninstall --platform "$PLATFORM"; fi
[ -n "$SERVICE_DIR" ] || { say "Done. Try: tabularius serve <folder of .fmp12 files>"; exit 0; }
if [ -n "$PRINT" ]; then ACTION=print; else ACTION=install; fi
exec "$NODE" --no-warnings "$CLI" service "$ACTION" "$SERVICE_DIR" --platform "$PLATFORM" --port "$PORT" --host "$HOST" ${SYSTEM:+--system} -- "$@"
