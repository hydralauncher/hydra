#!/bin/sh
set -eu
runtime=$(CDPATH= cd -- "${0%/*}" && pwd)
if [ -n "${LEGENDARY_CONFIG_PATH:-}" ]; then
  # Keep extracted native dependencies isolated and discard them with auth temps.
  XDG_CACHE_HOME="$LEGENDARY_CONFIG_PATH/.runtime-cache/@CACHE_KEY@"
  export XDG_CACHE_HOME
fi
exec "$runtime/python-runner" "$runtime/legendary.pyz" "$@"
