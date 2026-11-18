#!/usr/bin/env bash
# Headless screenshots of the Rust app on Linux (the shell twin of
# shot-headless.ps1), for comparison with Electron.
#
#   tools/shot-headless.sh --data ~/hydra-native-agent9 --out /tmp/shots/library \
#     --path /library --script "wait 7000; shot top; quit"
#
# --data is a COPY of the test data (never Electron's real data, never the
# user's own Rust data folder). The dev script steps are in
# crates/hydra-desktop/src/devscript.rs (wait, shot, click, rclick, move,
# press, release, wheel, hwheel, type, keydown/keyup/tap, quit, ...).
#
# The first-run import reads HYDRA_ELECTRON_USER_DATA (read-only). It
# defaults to a folder that doesn't exist, so a fresh --data folder starts
# empty instead of importing someone's Electron profile; pass --electron to
# point it at an Electron data COPY.
set -euo pipefail

data=""
out=""
script="wait 6000; shot shell; quit"
app_path="/"
width=1200
height=860
scale=1.0
profile="debug"
timeout_sec=120
electron="/nonexistent/hydra-electron-user-data"

while [ $# -gt 0 ]; do
  case "$1" in
    --data) data="$2"; shift 2 ;;
    --out) out="$2"; shift 2 ;;
    --script) script="$2"; shift 2 ;;
    --path) app_path="$2"; shift 2 ;;
    --width) width="$2"; shift 2 ;;
    --height) height="$2"; shift 2 ;;
    --scale) scale="$2"; shift 2 ;;
    --profile) profile="$2"; shift 2 ;;
    --timeout) timeout_sec="$2"; shift 2 ;;
    --electron) electron="$2"; shift 2 ;;
    *) echo "unknown argument $1" >&2; exit 2 ;;
  esac
done
if [ -z "$data" ] || [ -z "$out" ]; then
  echo "usage: $0 --data <data copy> --out <folder> [--path /route] [--script steps]" >&2
  exit 2
fi

rewrite="$(cd "$(dirname "$0")/.." && pwd)"
mkdir -p "$out"
export HYDRA_HEADLESS=1
export HYDRA_HEADLESS_WIDTH="$width"
export HYDRA_HEADLESS_HEIGHT="$height"
export HYDRA_HEADLESS_SCALE="$scale"
export HYDRA_ELECTRON_USER_DATA="$electron"
export HYDRA_USER_DATA="$data"
export HYDRA_DEV_SHOTS="$out"
export HYDRA_DEV_SCRIPT="$script"
status=0
timeout "$timeout_sec" "$rewrite/target/$profile/hydra" --path "$app_path" \
  >"$out/stdout.txt" 2>"$out/stderr.txt" || status=$?
if [ "$status" -eq 124 ]; then echo "TIMEOUT"; fi
grep -vE '^\s+[0-9]+:|^\s+at ' "$out/stderr.txt" | head -n 25 || true
exit "$status"
