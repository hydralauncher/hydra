# Hydra rewrite (Rust + Slint)

A native rewrite of the Electron app: Rust backend, [Slint](https://slint.dev)
UI, one codebase for macOS, Windows and Linux. The goal is **feature parity**
with the Electron app in this repository, at a fraction of its memory.

This folder is independent of the Electron build. It doesn't touch `src/`,
`native/` or `package.json`, and Prettier and ESLint ignore it.

## Status

Started from a spike that rebuilt the game details page. What's here is the
part of that spike worth keeping, now fed by real data instead of fixtures.

| Done | Where |
|---|---|
| Game details page: hero, gallery, viewer, description, sidebar, reviews UI, modals, with Hydra's animations and timings | `crates/hydra-desktop/ui` |
| Live Steam store data (`appdetails`, same call and locale mapping as `steam.ts`) | `crates/hydra-store/src/steam.rs` |
| Artwork from the Hydra API (`/games/{shop}/{id}/assets`) when `HYDRA_API_URL` is set, otherwise Steam's CDN | `crates/hydra-store/src/steam.rs` |
| Steam HTML → native blocks / markdown | `crates/hydra-store/src/html.rs` |
| Trailer playback: FFmpeg + hardware decode + cpal audio, HLS, seeking, quality | `crates/hydra-media/src/video.rs` |
| Image pipeline: off-thread fetch + decode (incl. AVIF), display-size decode, blur, grayscale | `crates/hydra-media/src/images.rs` |
| Chromium-like scrolling (trackpad 1:1, 40px wheel lines, keyboard) | `crates/hydra-desktop/src/main.rs`, `ui/app.slint` |
| Headless platform + scripted input/screenshots for validation | `crates/hydra-desktop/src/{headless,devscript}.rs` |

Everything else is in [`docs/parity-plan.md`](docs/parity-plan.md), which is
the checklist to work through. Buttons whose backend doesn't exist yet print
a `TODO(area)` line to stderr instead of doing nothing silently.

## Requirements

- Rust 1.85+ (edition 2024).
- FFmpeg 7 or 8 and dav1d, found through `pkg-config`.
  - macOS: `brew install ffmpeg pkg-config`
  - Linux: the distro's `libav*-dev`, `libdav1d-dev`, `libasound2-dev`,
    `libwebkit2gtk-4.1-dev`, `libgtk-3-dev` (full list, WSL workflow and
    packaging in [`docs/linux.md`](docs/linux.md))
  - Windows: vcpkg `ffmpeg[core,avcodec,avformat,swscale,swresample]` + `dav1d`

  Only macOS has been built and run so far. The code has no macOS-only
  paths except the hardware decoder list, but Windows and Linux are untested.
- `node` + `yarn install` at the repo root, only to re-export icons.

## Run

```sh
cd rewrite
cargo run -p hydra-desktop -- --steam-app 1030300            # any Steam app id
cargo run -p hydra-desktop -- --steam-app 1030300 --locale pt-BR
cargo test
tools/bundle.sh                                              # macOS .app (dev build)
```

Optional environment:

| Variable | Effect |
|---|---|
| `HYDRA_API_URL` | Hydra API base URL (the value of `MAIN_VITE_API_URL` in the Electron `.env`). Never commit it. |
| `SLINT_BACKEND` | Override the renderer, e.g. `winit-software`. Default: winit + Skia. |
| `HYDRA_HEADLESS=1` | No OS window. Software rendering into memory at 1440×900 @2x. |
| `HYDRA_DEV_SCRIPT` | Scripted input and screenshots; see below. |
| `HYDRA_DEV_SHOTS` | Where screenshots go (default `$TMPDIR/hydra-shots`). |
| `HYDRA_VIDEO_STATS=1` | Print decode/network CPU and timing for video playback. |

Keys on the game page: `F` opens the viewer in fullscreen. In the viewer:
`←`/`→`, `PageUp`/`PageDown`, `Home`/`End`, `F`, `Esc`. Video: `Space`/`K`,
`M`, `←`/`→`, `↑`/`↓`.

## Validating work (read this before changing UI)

1. **Never drive a visible window with real input.** It steals the focus and
   keystrokes of whoever is using the machine. Use the headless mode:

   ```sh
   HYDRA_HEADLESS=1 HYDRA_DEV_SHOTS=/tmp/shots \
   HYDRA_DEV_SCRIPT="wait 6000; shot top; wheel 700 500 -700; wait 800; shot description; quit" \
   cargo run -p hydra-desktop -- --steam-app 1030300
   ```

   Steps: `wait ms`, `shot name`, `move|press|release x y`,
   `wheel x y dy`, `hwheel x y dx`, `type text`, `keydown|keyup|tap key [n]`,
   `quit`. Coordinates are logical pixels (window is 1440×900).
   The software renderer ignores some transforms (scale/rotation of
   rectangles), so judge those in a real window.

2. **Compare against the Electron app** at the same window size and the same
   game (`yarn dev` at the repo root). The source of truth for sizes,
   colors, durations and easings is the SCSS/TSX, and each `.slint` file
   names the files it reproduces in its first line.

3. **Write a headless test** for interactions with state (focus, modals,
   editors). See `crates/hydra-desktop/tests`: they use Slint's testing
   backend with mock time and no window.

4. **Watch memory.** macOS: `footprint <pid>`; compare with the numbers in
   [`docs/decisions.md`](docs/decisions.md). Images should be decoded at
   display size and dropped when off-screen, like the gallery does.

## Layout

```
Cargo.toml                    workspace (shared dependency versions)
crates/hydra-store/           Steam store client, Hydra API artwork, Steam HTML conversion
crates/hydra-media/           video engine, image loader
crates/hydra-desktop/         the app (binary `hydra`)
  src/main.rs                 data loading, models, callbacks
  src/format.rs               review editor markdown marks (unit tested)
  src/headless.rs             window-less platform
  src/devscript.rs            scripted input + screenshots
  ui/theme.slint              tokens from globals.scss, icons, tooltip/id globals
  ui/components/              widgets, modal, video player
  ui/pages/game-details/      the game page sections
  ui/app.slint                window: scrolling, breakpoints, page composition
  ui/fonts/                   Noto Sans (OFL)
  ui/icons/                   SVGs exported from Hydra's own icon packages
  tests/                      headless UI tests
docs/
  parity-plan.md              what to build next, and how to validate it
  decisions.md                why Slint, renderer and memory numbers, architecture notes
  slint-capabilities.md       every kind of Hydra animation/effect vs. what Slint can do
tools/
  export-icons.mjs            React SSR of octicons/phosphor/lucide → SVG
  bundle.sh                   macOS .app bundle for local testing
```

## Conventions

- Port behavior from the Electron source, not from memory: name the source
  files at the top of each `.slint` file, and copy durations/easings.
- UI thread only touches Slint. Network, disk and decoding run on workers;
  results come back with `slint::invoke_from_event_loop`.
- Same HTTP/TLS stack as `native/hydra-native` (reqwest 0.13 + rustls/ring).
  Logic that already exists in Rust there (cloud save, torrent FFI, archive
  extraction, window/process helpers) should move into a shared crate rather
  than be rewritten.
