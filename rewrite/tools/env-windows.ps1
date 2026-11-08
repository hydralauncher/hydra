# Build environment for the rewrite on Windows. Dot-source it: `. tools/env-windows.ps1`
#
# Needs vcpkg with: ffmpeg[core,avcodec,avformat,avfilter,avdevice,swscale,swresample,dav1d]:x64-windows,
# dav1d:x64-windows, pkgconf:x64-windows; and LLVM (libclang, for FFmpeg's bindgen).
if (-not $env:VCPKG_ROOT) { $env:VCPKG_ROOT = Join-Path $env:USERPROFILE "vcpkg" }
$triplet = Join-Path $env:VCPKG_ROOT "installed\x64-windows"
$env:FFMPEG_DIR = $triplet
$env:PKG_CONFIG = Join-Path $triplet "tools\pkgconf\pkgconf.exe"
$env:PKG_CONFIG_PATH = Join-Path $triplet "lib\pkgconfig"
if (-not $env:LIBCLANG_PATH) { $env:LIBCLANG_PATH = "C:\Program Files\LLVM\bin" }
# bindgen asks a `clang` binary for system headers; a MinGW clang earlier on PATH
# would hand it MinGW headers that don't parse for the MSVC target.
$env:CLANG_PATH = Join-Path $env:LIBCLANG_PATH "clang.exe"
# FFmpeg/dav1d DLLs at run time.
$bin = Join-Path $triplet "bin"
if (-not ($env:PATH -split ";" | Where-Object { $_ -eq $bin })) { $env:PATH = "$bin;$env:PATH" }
