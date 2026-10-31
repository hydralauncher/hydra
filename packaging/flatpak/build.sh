#!/usr/bin/env bash
set -euo pipefail
repo_root="$(git rev-parse --show-toplevel)"
flatpak_dir="$repo_root/packaging/flatpak"
output_dir="$flatpak_dir/output"
for tool in git node yarn cargo rustc flatpak flatpak-builder python3 cc c++ make; do
  command -v "$tool" >/dev/null || {
    echo "Required build tool is missing: $tool" >&2
    exit 1
  }
done

node_major="$(node -p 'Number(process.versions.node.split(".")[0])')"
if (( node_major < 22 )); then
  echo "Node.js 22 or newer is required; found $(node --version)." >&2
  exit 1
fi

if [[ "$(yarn --version)" != 1.* ]]; then
  echo "Yarn Classic 1.x is required; found $(yarn --version)." >&2
  exit 1
fi

windows_target_libdir="$(rustc --print target-libdir --target x86_64-pc-windows-gnu 2>/dev/null || true)"
if [[ -z "$windows_target_libdir" || ! -d "$windows_target_libdir" ]]; then
  echo "Rust target x86_64-pc-windows-gnu is missing; run: rustup target add x86_64-pc-windows-gnu" >&2
  exit 1
fi
command -v x86_64-w64-mingw32-gcc >/dev/null || {
  echo "MinGW x86_64 linker is missing (x86_64-w64-mingw32-gcc)." >&2
  exit 1
}
required_env=(MAIN_VITE_API_URL MAIN_VITE_AUTH_URL MAIN_VITE_CHECKOUT_URL MAIN_VITE_EXTERNAL_RESOURCES_URL RENDERER_VITE_EXTERNAL_RESOURCES_URL)
# Public Hydra API endpoints used by the working local build.
MAIN_VITE_API_URL="${MAIN_VITE_API_URL:-https://hydra-api-us-east-1.losbroxas.org}"
MAIN_VITE_AUTH_URL="${MAIN_VITE_AUTH_URL:-https://auth.hydra.losbroxas.org}"
RENDERER_VITE_EXTERNAL_RESOURCES_URL="${RENDERER_VITE_EXTERNAL_RESOURCES_URL:-https://assets.hydralauncher.gg}"
RENDERER_VITE_EXTERNAL_RESOURCES_URL="${RENDERER_VITE_EXTERNAL_RESOURCES_URL%/}"
export RENDERER_VITE_EXTERNAL_RESOURCES_URL
export MAIN_VITE_API_URL MAIN_VITE_AUTH_URL
for name in "${required_env[@]}"; do
  if [[ -z "${!name:-}" ]]; then
    echo "Set $name before building; see packaging/flatpak/README.md" >&2
    exit 1
  fi
done
patch_file="$flatpak_dir/patches/0001-standalone-umu.patch/0001-standalone-umu.patch"
if ! grep -q 'isHydraFlatpak' "$repo_root/src/main/services/umu.ts"; then
  git -C "$repo_root" apply --unidiff-zero "$patch_file"
fi
rm -rf "$output_dir" "$flatpak_dir/build/hydra-files"
# Preserve mounted rofiles data; an earlier build may leave Electron to package it.
rm -rf "$repo_root/.flatpak-builder/cache" "$repo_root/.flatpak-builder/build"
rmdir "$repo_root/.flatpak-builder/rofiles" "$repo_root/.flatpak-builder" 2>/dev/null || true
mkdir -p "$output_dir" "$flatpak_dir/build"
cd "$repo_root"
yarn --frozen-lockfile
rm -rf "$repo_root/dist/linux-unpacked"
yarn build:unpack
if ! grep -R --fixed-strings --quiet -- "$RENDERER_VITE_EXTERNAL_RESOURCES_URL" "$repo_root/out/renderer" \
  || ! grep -R --fixed-strings --quiet -- 'bundle.js' "$repo_root/out/renderer"; then
  echo "The renderer bundle does not contain the configured external resources URL" >&2
  exit 1
fi
app_dir="$repo_root/dist/linux-unpacked"
if [[ ! -x "$app_dir/hydralauncher" ]]; then
  echo "Expected Electron's unpacked application at $app_dir" >&2
  exit 1
fi
cp -a "$app_dir" "$flatpak_dir/build/hydra-files"
flatpak-builder --disable-rofiles-fuse --force-clean \
  --state-dir="$output_dir/state" \
  --repo="$output_dir/repo" \
  "$output_dir/build-dir" \
  "$flatpak_dir/gg.hydralauncher.hydra.yml"
