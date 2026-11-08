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

## Linux

Pending: the Electron reference has to be built inside WSL (native
modules) to compare on the same machine. WSL renders through Mesa's D3D12
layer and decodes video in software, so Linux rows will be marked WSL.
