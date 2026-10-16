#!/usr/bin/env bash
set -euo pipefail
repo_root="$(git rev-parse --show-toplevel)"
flatpak_dir="$repo_root/packaging/flatpak"
output_dir="$flatpak_dir/output"
command -v yarn >/dev/null || { echo "yarn is required" >&2; exit 1; }
command -v flatpak-builder >/dev/null || { echo "flatpak-builder is required" >&2; exit 1; }
required_env=(MAIN_VITE_API_URL MAIN_VITE_AUTH_URL MAIN_VITE_CHECKOUT_URL MAIN_VITE_EXTERNAL_RESOURCES_URL RENDERER_VITE_EXTERNAL_RESOURCES_URL)
# Public Hydra API endpoints used by the working local build.
MAIN_VITE_API_URL="${MAIN_VITE_API_URL:-https://hydra-api-us-east-1.losbroxas.org}"
MAIN_VITE_AUTH_URL="${MAIN_VITE_AUTH_URL:-https://auth.hydra.losbroxas.org}"
export MAIN_VITE_API_URL MAIN_VITE_AUTH_URL
for name in "${required_env[@]}"; do
  if [[ -z "${!name:-}" ]]; then
    echo "Set $name before building; see packaging/flatpak/README.md" >&2
    exit 1
  fi
done
rm -rf "$output_dir" "$flatpak_dir/build/hydra-files"
# Preserve mounted rofiles data; an earlier build may leave Electron to package it.
rm -rf "$repo_root/.flatpak-builder/cache" "$repo_root/.flatpak-builder/build"
rmdir "$repo_root/.flatpak-builder/rofiles" "$repo_root/.flatpak-builder" 2>/dev/null || true
mkdir -p "$output_dir" "$flatpak_dir/build"
cd "$repo_root"
yarn --frozen-lockfile
yarn build:unpack
app_dir="$repo_root/dist/linux-unpacked"
if [[ ! -x "$app_dir/hydralauncher" ]]; then
  echo "Expected Electron's unpacked application at $app_dir" >&2
  exit 1
fi
cp -a "$app_dir" "$flatpak_dir/build/hydra-files"
flatpak-builder --disable-rofiles-fuse --install-deps-from=flathub --force-clean --state-dir="$output_dir/state" --repo="$output_dir/repo" "$output_dir/build-dir" "$flatpak_dir/gg.hydralauncher.hydra.yml"
