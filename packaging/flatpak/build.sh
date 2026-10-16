#!/usr/bin/env bash
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
flatpak_dir="$repo_root/packaging/flatpak"
output_dir="$flatpak_dir/output"

command -v yarn >/dev/null || { echo "yarn is required" >&2; exit 1; }
command -v flatpak-builder >/dev/null || { echo "flatpak-builder is required" >&2; exit 1; }

cd "$repo_root"
yarn --frozen-lockfile
yarn build:unpack

app_dir="$repo_root/dist/linux-unpacked"
if [[ ! -x "$app_dir/hydralauncher" ]]; then
  echo "Expected Electron's unpacked application at $app_dir" >&2
  exit 1
fi

rm -rf "$output_dir"
mkdir -p "$flatpak_dir/build"
rm -rf "$flatpak_dir/build/hydra-files"
cp -a "$app_dir" "$flatpak_dir/build/hydra-files"

flatpak-builder \
  --force-clean \
  --repo="$output_dir/repo" \
  "$output_dir/build-dir" \
  "$flatpak_dir/gg.hydralauncher.hydra.yml"
