# Performance: Electron vs. the rewrite

Measured with `tools/bench-windows.ps1` (same scenario, real windows,
1200×860, release builds, same account and library imported from the same
Electron profile). Memory is what Task Manager shows: private working set
summed over every process of the app, plus dedicated GPU memory
(`GPU Process Memory` counters). CPU is the app's CPU time over the sample,
as % of one core.

Machine: Windows 11 Pro 26300, Ryzen 9 9950X3D, Radeon RX 9070 XT, one
3440×1440 display at 100%. Electron 41 (main at `4d00d98e2`, production
bundles from `electron-vite build`, DevTools closed). Rewrite at the commit
that adds this file, Skia renderer on Direct3D, trailers decoded with D3D11VA.

## 2026-11-08: app shell + game page

| Scenario | Electron RAM | Electron GPU | **Electron total** | Electron CPU | Native RAM | Native GPU | **Native total** | Native CPU | Memory saved |
|---|---|---|---|---|---|---|---|---|---|
| Start → first paint | | | **2.13 s** | | | | **0.31 s** | | 6.9× faster |
| Game page (Cyberpunk 2077), trailer playing | 1,824.8 MB | 441.8 MB | **2,266.7 MB** | 52.7% | 249.8 MB | 231.2 MB | **481.0 MB** | 32.8% | 4.7× less |
| Scrolling the 942-game library list | 1,953.0 MB | 487.4 MB | **2,440.4 MB** | 144.7% | 258.6 MB | 231.2 MB | **489.8 MB** | 55.8% | 5.0× less |
| Idle after scrolling (trailer still playing) | 1,913.4 MB | 466.4 MB | **2,379.8 MB** | 52.5% | 256.4 MB | 231.2 MB | **487.6 MB** | 35.6% | 4.9× less |
| Home page after start (Electron only; not ported yet) | 786.4 MB | 165.9 MB | **952.3 MB** | 28.5% | | | | | |

Electron runs 7–8 processes (browser, GPU, network, utility, renderer, …);
the rewrite runs one.

Caveats, so the numbers aren't read as more than they are:

- The native game page doesn't show everything Electron's does yet:
  achievements (with their icons), the review prompt, library state. Those
  add a few images and requests; they are not where Electron's 1.8 GB goes,
  but the comparison should be re-run once the page is complete.
- Native start is measured to the event loop's first turn after the
  window is created (Skia on Direct3D has no rendering notifier). The
  window paints right after it. Electron's is the renderer's
  first-contentful-paint from the main process's creation time.
- 231 MB of the native total is GPU memory (swapchain, glyph and image
  textures). It is the next thing to look at: images are uploaded at
  decode size, and the hero is decoded at full size.

## 2026-11-08: Linux (WSL)

Measured with `tools/bench-linux.sh` in WSL 2 (Ubuntu 26.04, kernel 6.18,
WSLg on Wayland) on the same machine: the bench-windows scenario, real
windows at 1200×860, release builds, the same account and library (a Linux
copy of the Electron reference data; the rewrite imported it). Each app ran
once to warm its caches, then the measured run. Electron 41 is `main` at
`4d00d98e2` built inside WSL (`yarn install`, `electron-vite build`).

Memory is summed over the app's process tree from `/proc/<pid>/smaps_rollup`:
USS is the private resident memory (the closest thing to Task Manager's
private working set), PSS also counts each process's share of shared pages.
CPU is user + system time over the sample, as % of one core.

**Everything draws in software here.** This machine's WSL GPU path is
broken (the `dxg` ioctls fail with EINVAL, Mesa only offers llvmpipe, WSLg
runs in copy mode): Chromium blocklists the GPU and composites on the CPU,
and the rewrite uses Skia's CPU raster (see decisions.md). Both decode the
trailer in software. There are no per-process GPU memory counters in WSL, so
there is no GPU column.

| Scenario (WSL) | Electron USS | Electron PSS | Electron CPU | Native USS | Native PSS | Native CPU | Memory saved (USS) |
|---|---|---|---|---|---|---|---|
| Start → first paint | | | **3.07 s** | | | **0.21 s** | 15× faster |
| Home page after start (Electron only) | 917.3 MB | 1,097.3 MB | 86.9% | | | | |
| Game page (Cyberpunk 2077), trailer playing | 1,682.1 MB | 1,883.2 MB | 170.6% | **391.9 MB** | 397.1 MB | 34.5% | 4.3× less |
| Scrolling the 942-game library list | 2,037.3 MB | 2,247.3 MB | 193.5% | **419.7 MB** | 424.9 MB | 59.0% | 4.9× less |
| Idle after scrolling (trailer still playing) | 1,983.9 MB | 2,182.9 MB | 113.5% | **435.5 MB** | 440.7 MB | 32.3% | 4.6× less |

Electron runs 10 processes here; the rewrite runs one.

Caveats:

- Native start is to the event loop's first turn after the window exists,
  Electron's is first-contentful-paint, both from the launch, as on Windows.
  The native start includes the forked EGL device check (decisions.md);
  runs ranged 0.13 to 0.45 s.
- Before the Linux renderer choice, the rewrite drew with Slint's default
  Skia surface, wgpu on Vulkan, which got lavapipe (CPU Vulkan) here: 709
  to 731 MB and 333% CPU with the trailer playing. That is the number a
  machine without a hardware Vulkan driver would have seen.
- A real Linux desktop with a GPU runs Skia on OpenGL and Chromium with GPU
  compositing; that comparison still has to be measured on hardware.
