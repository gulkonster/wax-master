#!/bin/bash
# Runs as root inside the local chain's distro. Offline: only dpkg is used, no apt, no network.
# Usage: setup-distro.sh <command> [arguments]
#   install <folder with the .deb files> <file.deb> [<file.deb> ...]
#       Installs exactly the named files (the app names the files whose SHA-256 it has just
#       verified), creates the user, /etc/wsl.conf and the chain folders. Prints "NODE <version>".
#   write <genesis.json|config.ini>
#       Writes standard input to that file of the chain's config folder (mode 600, owner wax).
#       Prints nothing of what it writes.
#   set-port <port>      Rewrites the port of http-server-address and http-alias in config.ini.
#   set-cors <0|1>       Removes or adds "access-control-allow-origin = *" in config.ini.
#   read-key             Prints the private part of signature-provider (read by the app into memory only).
#   wipe-data            Deletes the chain's data folder and makes it again, empty.
#   stop-node            Sends SIGINT to a running node; prints "STOPPED <count>".
#   node-running         Prints "RUNNING <count>".
#   data-mb              Prints "DATA <megabytes>" of the data folder.
set -euo pipefail
export LC_ALL=C

USER_NAME="wax"
CHAIN="/home/$USER_NAME/chain"
CONFIG="$CHAIN/config"
DATA="$CHAIN/data"

fail() { echo "ERROR: $*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || fail "must run as root"
CMD="${1:-}"
shift || true

case "$CMD" in
  install)
    export DEBIAN_FRONTEND=noninteractive
    DEBS_DIR="${1:-}"
    shift || true
    [ -n "$DEBS_DIR" ] || fail "usage: setup-distro.sh install <folder> <file.deb>..."
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
    # The node package goes last: its dependencies are the packages before it.
    LAST=$((${#DEBS[@]} - 1))
    if [ "$LAST" -gt 0 ]; then
      dpkg -i --no-triggers "${DEBS[@]:0:$LAST}" >/tmp/dpkg-install.log 2>&1 || { cat /tmp/dpkg-install.log >&2; fail "dpkg -i failed"; }
    fi
    dpkg -i --no-triggers "${DEBS[$LAST]}" >>/tmp/dpkg-install.log 2>&1 || { cat /tmp/dpkg-install.log >&2; fail "dpkg -i failed"; }
    dpkg --configure --pending >>/tmp/dpkg-install.log 2>&1 || { cat /tmp/dpkg-install.log >&2; fail "dpkg --configure failed"; }
    tail -n 2 /tmp/dpkg-install.log
    rm -f /tmp/dpkg-install.log

    echo "STEP 3/5 Verifying the node"
    command -v nodeos >/dev/null 2>&1 || fail "nodeos not found on PATH"
    VERSION="$(nodeos --version 2>/dev/null | head -n 1)"
    [ -n "$VERSION" ] || fail "nodeos did not print its version"

    echo "STEP 4/5 Creating user $USER_NAME and the chain folders"
    if ! id "$USER_NAME" >/dev/null 2>&1; then
      useradd --create-home --shell /bin/bash "$USER_NAME"
    fi
    passwd -l "$USER_NAME" >/dev/null 2>&1 || true
    install -d -m 700 -o "$USER_NAME" -g "$USER_NAME" "$CHAIN" "$CONFIG" "$DATA"

    echo "STEP 5/5 Writing /etc/wsl.conf"
    cat > /etc/wsl.conf <<CONF
[interop]
enabled=false
appendWindowsPath=false

[user]
default=$USER_NAME
CONF
    echo "NODE $VERSION"
    echo "DONE"
    ;;

  write)
    NAME="${1:-}"
    case "$NAME" in
      genesis.json|config.ini) ;;
      *) fail "unknown config file: $NAME" ;;
    esac
    [ -d "$CONFIG" ] || fail "the chain folders are missing"
    umask 077
    cat > "$CONFIG/$NAME.tmp"
    [ -s "$CONFIG/$NAME.tmp" ] || { rm -f "$CONFIG/$NAME.tmp"; fail "nothing to write to $NAME"; }
    chown "$USER_NAME:$USER_NAME" "$CONFIG/$NAME.tmp"
    chmod 600 "$CONFIG/$NAME.tmp"
    mv -f "$CONFIG/$NAME.tmp" "$CONFIG/$NAME"
    echo "WROTE $NAME"
    ;;

  set-port)
    PORT="${1:-}"
    case "$PORT" in ''|*[!0-9]*) fail "invalid port: $PORT" ;; esac
    [ -f "$CONFIG/config.ini" ] || fail "config.ini is missing"
    sed -i -E \
      -e "s/^(http-server-address[[:space:]]*=[[:space:]]*127\.0\.0\.1:)[0-9]+[[:space:]]*$/\1$PORT/" \
      -e "s/^(http-alias[[:space:]]*=[[:space:]]*localhost:)[0-9]+[[:space:]]*$/\1$PORT/" \
      "$CONFIG/config.ini"
    grep -q "^http-server-address[[:space:]]*=[[:space:]]*127\.0\.0\.1:$PORT$" "$CONFIG/config.ini" || fail "config.ini has no http-server-address line"
    echo "PORT $PORT"
    ;;

  set-cors)
    ON="${1:-}"
    [ -f "$CONFIG/config.ini" ] || fail "config.ini is missing"
    sed -i -E '/^access-control-allow-origin[[:space:]]*=/d' "$CONFIG/config.ini"
    case "$ON" in
      1) echo "access-control-allow-origin = *" >> "$CONFIG/config.ini" ;;
      0) ;;
      *) fail "set-cors takes 0 or 1" ;;
    esac
    echo "CORS $ON"
    ;;

  read-key)
    [ -f "$CONFIG/config.ini" ] || fail "config.ini is missing"
    sed -n -E 's/^signature-provider[[:space:]]*=[[:space:]]*[^=[:space:]]+=KEY:([^[:space:]]+)[[:space:]]*$/\1/p' "$CONFIG/config.ini" | head -n 1
    ;;

  wipe-data)
    rm -rf "$DATA"
    install -d -m 700 -o "$USER_NAME" -g "$USER_NAME" "$DATA"
    echo "WIPED"
    ;;

  stop-node)
    COUNT="$( (pgrep -x nodeos || true) | wc -l)"
    [ "$COUNT" -gt 0 ] && pkill -INT -x nodeos || true
    echo "STOPPED $COUNT"
    ;;

  node-running)
    echo "RUNNING $( (pgrep -x nodeos || true) | wc -l)"
    ;;

  data-mb)
    if [ -d "$DATA" ]; then echo "DATA $(du -sm "$DATA" | cut -f1)"; else echo "DATA 0"; fi
    ;;

  *)
    fail "unknown command: $CMD"
    ;;
esac
