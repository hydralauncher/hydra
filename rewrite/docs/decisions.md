# Decisions and measurements

Why the rewrite looks the way it does. Revisit an entry only with new
measurements.

## UI toolkit: Slint

Requirements: Rust backend, the lowest memory use we can get, and one
codebase for macOS, Windows and Linux.

- **Slint** (chosen): declarative UI compiled to Rust, small runtime, GPU
  renderers (Skia) and a software renderer, animations as language features.
  It reproduces about 85–90% of Hydra's animations and transitions directly
  (see `slint-capabilities.md`).
- SwiftUI with a Rust core would be the best fit for macOS alone, but it
  means a second UI for Windows and Linux.
- Qt (via bindings) brings a large runtime and C++ build to the Rust side
  without a memory advantage.
- Web-based shells (Tauri etc.) keep a browser engine, which is the memory
  cost this rewrite exists to remove.

Known Slint gaps and their workarounds (details in `slint-capabilities.md`):

| Gap | Workaround in use |
|---|---|
| No `<video>` | Our own engine (`hydra-media::video`) |
| No `backdrop-filter` / `filter` | Blur/grayscale precomputed in Rust: hero slice behind glass elements (`Frost`), window snapshot behind modals |
| `TextInput` can't style text runs | Review editor stores markdown; B/I/U toggle marks; formatted preview below the input (`format.rs`) |
| Static text can't be selected | Open; Hydra allows selecting the description and reviews |
| `StyledText` has no headings, images or line-height | Separate blocks per heading/paragraph/image |
| No animated GIF/AVIF | Open; first frame only today. Could reuse the video engine for animated images |

## Renderer: Skia

Measured on macOS 27, Apple Silicon, 1440×900 window @2x, release build,
with `footprint <pid>` across the same scripted session (load the page,
browse 10 screenshots in the viewer, scroll the whole page):

| Renderer | Idle | Peak while browsing | After browsing | CPU time |
|---|---|---|---|---|
| Skia (Metal), default | 295 MB* | 329 MB | 351 MB | 0.9 s |
| Software | 134 MB | 171 MB | 171 MB | 5.3 s |
| femtovg (OpenGL) | 335 MB | 945 MB | 783 MB | 2.0 s |

\* About 128 MB is Metal memory marked reclaimable (macOS purges it under
pressure), and 60 MB is the triple-buffered 2880×1800 swapchain any GPU
renderer pays. The app's own heap is about 65 MB.

The software renderer uses the least memory but about 6× the CPU during
animations. femtovg's GPU memory grows while browsing images and isn't
released. The Electron app hasn't been measured on the same machine yet; do
that before quoting a ratio.

## Images

Decoded on a 3-thread pool, at display size (`Op::MaxWidth`), opaque images
kept as RGB. Gallery full-size frames exist only for the carousel slide ±1
and the viewer slide ±1, and are dropped when you move away. New screens
should follow the same rule: decode what's visible, at the size it's shown.

## Video engine

```
Steam HLS master ─► our playlist parser ─► video rendition input ─┐
                                          └► audio rendition input ─┤ demux thread (network, 15 s read-ahead)
                                                                    ▼
                         decode thread: FFmpeg (hardware) ─► NV12 ─► RGB ─► SharedPixelBuffer
                                        AAC ─► resample ─► cpal output (timestamped)
                                                                    ▼
                UI thread presenter (8 ms): shows the frame due at the clock, drives `Playback`
```

- Same code on all platforms; only the hardware decoder list differs
  (VideoToolbox / D3D11VA, DXVA2 / VAAPI, VDPAU), with software fallback.
- Renditions: the master's 1080p/720p/480p/360p. "Auto" is 720p in the
  carousel and 1080p in the viewer. Changing quality reopens the video
  rendition at the current time.
- Sync: a wall clock that runs only while playing and has frames; audio is
  timestamped, late audio is dropped, early audio waits. Measured offset
  within about ±13 ms.
- Seeking: FFmpeg's HLS seek is unreliable on Steam's fMP4 playlists (even
  the CLI returns zero frames for `-ss 91` on a stream where `-ss 93` works).
  We parse the media playlists and reopen at the segment containing the
  target (segments start on keyframes), then drop frames before the target.
  Progressive MP4/WebM use FFmpeg's normal seek.
- Measured (Apple Silicon, VideoToolbox, 60 fps trailer):

  | | 720p60 (carousel) | 1080p60 (viewer) |
  |---|---|---|
  | decode thread | 4.5–6.6% of one core | ~10% of one core |
  | network thread | ≤1.2% | ≤0.8% |
  | hardware frame → RGB | 0.6–1.0 ms/frame | 0.9–1.5 ms/frame |
  | first frame | ~0.9–1.2 s after open | ~1.6 s after a rendition switch |
  | seek | 0.7–1.0 s to first frame | similar |

- Open items: seek-preview thumbnails; the zero-copy path (NV12 into a wgpu
  texture converted by a shader, `slint::Image::try_from(wgpu::Texture)` on
  Skia-wgpu); faster seeks when the target is already buffered; shipping
  FFmpeg inside the app bundle/installer; testing on Windows and Linux.
- Audio has only been verified numerically (sync), not listened to.

## Scrolling

Slint's `Flickable` adds its own inertia on top of the momentum macOS
already applies to trackpad deltas, which made scrolling fly. The page uses
Chromium's rules instead: trackpad/Magic Mouse pixel deltas 1:1, mouse wheel
lines at 40px (Slint uses 60px), no drag-to-pan, ↑/↓ 40px, Space/PageDown
87.5% of the viewport, Home/End, with a 200ms ease. Line vs. pixel deltas are
told apart through the winit event hook (`unstable-winit-030`). Horizontal
strips follow the same 1:1 rule. Trackpad feel still needs a human check on
real hardware.

## HTTP and TLS

reqwest 0.13 with `rustls-no-provider` and rustls' `ring` provider, same as
`native/hydra-native`, so both share one TLS stack. `hydra_store::init_tls()`
installs the provider once at startup. Blocking clients on worker threads
today; move to tokio when the Hydra API client (auth, refresh, SSE) arrives.

## Things that must stay true

- macOS Wine support must stay free: no delegation to paid CrossOver.
- Avatars use a 4px radius, never circles. Status orbs stay round: 12px
  border-box, 2px `#121212` ring. Unread counts are a red `#e11d48` pill
  with white 10px bold text, 16px tall.
