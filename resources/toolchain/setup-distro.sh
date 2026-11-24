#!/bin/bash
# Runs as root inside a freshly imported distro. Offline: only dpkg is used, no apt, no network.
# Usage: setup-distro.sh <folder with the .deb files> <file.deb> [<file.deb> ...]
# Only the named files are installed (the app names exactly the files whose
# SHA-256 it has just verified).
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
export LC_ALL=C

DEBS_DIR="${1:-}"
shift || true
USER_NAME="wax"

fail() { echo "ERROR: $*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || fail "must run as root"
[ -n "$DEBS_DIR" ] || fail "usage: setup-distro.sh <folder> <file.deb>..."
[ "$#" -gt 0 ] || fail "no package files named"
[ -d "$DEBS_DIR" ] || fail "folder not found: $DEBS_DIR"

echo "STEP 1/5 Checking packages in $DEBS_DIR"
DEBS=()
for name in "$@"; do
  case "$name" in
    */*|*..*|-*) fail "invalid package file name: $name" ;;
    *.deb) ;;
    *) fail "not a .deb file: $name" ;;
  esac
  [ -f "$DEBS_DIR/$name" ] || fail "missing package: $name"
  DEBS+=("$DEBS_DIR/$name")
done
for f in "${DEBS[@]}"; do
  dpkg-deb --info "$f" >/dev/null || fail "unreadable package: $f"
done
echo "found ${#DEBS[@]} packages"

echo "STEP 2/5 Installing packages (offline, dpkg only)"
dpkg -i --no-triggers "${DEBS[@]}" >/tmp/dpkg-install.log 2>&1 || { cat /tmp/dpkg-install.log >&2; fail "dpkg -i failed"; }
dpkg --configure --pending >>/tmp/dpkg-install.log 2>&1 || { cat /tmp/dpkg-install.log >&2; fail "dpkg --configure failed"; }
tail -n 3 /tmp/dpkg-install.log

echo "STEP 3/5 Verifying tools"
if ! command -v clangd >/dev/null 2>&1; then
  for c in /usr/bin/clangd-[0-9]*; do
    [ -x "$c" ] && ln -sf "$(basename "$c")" /usr/bin/clangd
  done
fi
command -v cdt-cpp >/dev/null 2>&1 || fail "cdt-cpp not found on PATH"
command -v clangd >/dev/null 2>&1 || fail "clangd not found on PATH"
cdt-cpp --version
clangd --version | head -n 1

echo "STEP 4/5 Creating user $USER_NAME"
if ! id "$USER_NAME" >/dev/null 2>&1; then
  useradd --create-home --shell /bin/bash "$USER_NAME"
fi
passwd -l "$USER_NAME" >/dev/null 2>&1 || true

echo "STEP 5/5 Writing /etc/wsl.conf"
cat > /etc/wsl.conf <<CONF
[interop]
enabled=false
appendWindowsPath=false

[user]
default=$USER_NAME
CONF

echo "DONE"
