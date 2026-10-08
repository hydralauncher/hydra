#!/bin/sh
set -eu
runtime=$(CDPATH= cd -- "${0%/*}" && pwd)
# Use only Hydra's interpreter and libc. No PATH lookup or system installation.
exec "$runtime/glibc/@LOADER@" --inhibit-cache \
  --library-path "$runtime/glibc:$runtime/python/lib" \
  "$runtime/python/bin/python3.13" -I -B "$@"
