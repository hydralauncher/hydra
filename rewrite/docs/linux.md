# Linux

How the rewrite builds, runs, is tested and is packaged on Linux, and where
it still differs from the Electron app there.

## Building

Ubuntu 26.04 packages (other distributions have the same libraries under
their own names):

```sh
sudo apt install build-essential pkg-config clang libclang-dev cmake ninja-build \
  libavcodec-dev libavformat-dev libavfilter-dev libavdevice-dev libswscale-dev \
  libswresample-dev libdav1d-dev libasound2-dev libfontconfig1-dev libxkbcommon-dev \
  libwebkit2gtk-4.1-dev libgtk-3-dev libsoup-3.0-dev libdbus-1-dev libssl-dev
cd rewrite
cargo build -p hydra-desktop          # target/debug/hydra
cargo test -p hydra-launch            # the Linux launch rules have unit tests
```

- FFmpeg 8 and dav1d come from the system through `pkg-config`.
- The libtorrent bridge is prebuilt
  (`native/torrent-bridge/prebuilt/x64-linux/lib/libhydra_torrent_bridge.so`).
  `hydra-torrent`'s build script links it with an `$ORIGIN` rpath and copies
  it next to the binary, so ship it in the same folder as `hydra`.
- `native/hydra-native/src/linux_process.rs` (process evidence from `/proc`)
  is compiled into `hydra-launch` with `#[path]`, like the torrent and
  extraction modules.

### In WSL

Builds on `/mnt/c` are very slow. Mirror the worktree into a WSL folder
(everything the build reads outside `rewrite/`: `native/`, `resources/`,
`binaries/`, `src/locales/`, `src/renderer/src/assets/`, `package.json` and
the gitignored `.env`) with `rsync -a --exclude target/`, and build there.
A clean debug build takes about 5 minutes.

## Running and testing

- Headless screenshots: `tools/shot-headless.sh --data <data copy> --out <dir>
  --path /library --script "wait 7000; shot top; quit"`. It points
  `HYDRA_ELECTRON_USER_DATA` at a missing folder, so a fresh data folder
  doesn't import an Electron profile (pass `--electron <copy>` to import one).
- A real window under WSLg uses Skia on Mesa's D3D12 driver. Screenshots of
  real windows: `HYDRA_DEV_SCRIPT="...; shot name"` works there too
  (`take_snapshot` reads back what Skia drew). Windows' PrintWindow returns
  black for WSLg windows.
- Windows that aren't Slint (the GTK auth window): run the app on a private
  X server, `Xvfb :93 & DISPLAY=:93 GDK_BACKEND=x11` with `WAYLAND_DISPLAY`
  unset, and capture with `import -window <id>`. `GDK_BACKEND=x11` matters:
  libwayland falls back to `wayland-0` without `WAYLAND_DISPLAY`, so GTK
  would open on the WSLg desktop instead.
- The tray needs a StatusNotifierWatcher on the session bus. WSLg has none;
  a small watcher (owning `org.kde.StatusNotifierWatcher`, answering
  `RegisterStatusNotifierItem`, then calling `Activate` and the dbusmenu
  `GetLayout`/`Event`) is enough to test it end to end.
- Notifications need an `org.freedesktop.Notifications` server.
  `cargo test -p hydra-desktop --bin hydra -- --ignored os_notification` sends
  a real one.
- Launching: `cargo run -p hydra-launch --example launch_probe -- <data
  copy>/hydra-db steam:<id> <executable> [options] [seconds]` runs Play, the
  process watcher and Close without the UI. The first umu-run downloads the
  Steam Linux Runtime and UMU-Proton (several hundred MB) into
  `~/.local/share/umu`.
- WSL clears `/tmp` (a tmpfs) whenever the distro stops between commands.

## Packaging

Electron ships AppImage, deb, rpm and snap (`electron-builder.yml`). Whatever
the rewrite ships needs:

| File | Where | Why |
|---|---|---|
| `hydra` | `/opt/hydra/` (any folder) | the app |
| `libhydra_torrent_bridge.so` | next to `hydra` | libtorrent (`$ORIGIN` rpath) |
| `umu-run` | next to `hydra` | `binaries/umu/umu-run`, found beside the executable first |
| `7zzs` | next to `hydra` | archive extraction |
| `packaging/linux/hydralauncher.desktop` | `share/applications/` | launcher entry and the `hydralauncher://` handler |
| `resources/icon.png` | `share/icons/hicolor/512x512/apps/hydralauncher.png` | the desktop file's `Icon=` |

- The `hydralauncher://` protocol: the desktop file declares
  `MimeType=x-scheme-handler/hydralauncher;` (run `update-desktop-database`
  after installing it). At startup an installed build (not a debug build, not
  under `target/`) also runs `xdg-settings set default-url-scheme-handler
  hydralauncher hydralauncher.desktop` when that file is installed and isn't
  the handler yet, which is what Electron's `setAsDefaultProtocolClient` does
  on Linux. Links arrive as the first argument; a running app takes them over
  the single-instance socket.
- The desktop file's name, `StartupWMClass` and the window's XDG app id are
  all `hydralauncher`, so docks show the right icon. The auth window (GTK)
  uses the same program name.
- An AppImage puts `$APPDIR/usr/lib` on `LD_LIBRARY_PATH`; the app removes it
  at startup so games and Wine don't inherit it (Electron does the same).
- Runtime libraries: GTK 3, WebKitGTK 4.1 (the auth window), libsoup 3,
  FFmpeg 8 (libavcodec, libavformat, libswscale, libswresample), dav1d,
  ALSA (cpal; PipeWire/PulseAudio through the ALSA plugin), fontconfig, D-Bus.
  Vulkan or OpenGL for Skia (EGL/GLX); it falls back to the software
  renderer with `SLINT_BACKEND=winit-software`.
- Optional tools the app looks for on `PATH`: `gamemoderun`, `mangohud`,
  `winetricks`, `wine` (the fallback when umu-run fails), `python3` 3.10+
  (to run the umu-run zipapp), `xdg-open`, `xdg-settings`.

## Paths

| What | Linux path | Electron |
|---|---|---|
| userData | `$XDG_CONFIG_HOME/hydralauncher-native` (else `~/.config/…`), `HYDRA_USER_DATA` overrides | `~/.config/hydralauncher` |
| Electron data read on first run | `~/.config/hydralauncher`, `HYDRA_ELECTRON_USER_DATA` overrides | |
| Default downloads folder | XDG `DOWNLOAD` dir, else `~/Downloads` (Chromium's fallback) | same |
| Wine prefixes | `<userData>/wine-prefixes/<objectId>`; `defaultWinePrefixPath` or `game.winePrefixPath` override; a prefix only Electron made is used where it is | `<userData>/wine-prefixes/<objectId>` |
| umu logs | `<userData>/logs/umu-<objectId>.log` and `umu.log` (`logs-staging` on staging) | same under Electron's userData |
| Updated umu-run | `<userData>/umu/<version>/umu-run`, `state.json` | same |
| Notification icons | `$TMPDIR/hydra-native-notifications` | `$TMPDIR/hydra-notifications` |

## Linux differences from Electron that remain

- **No tray without a StatusNotifierWatcher.** The tray is a
  StatusNotifierItem (what Chromium uses). Electron falls back to an XEmbed
  icon (GtkStatusIcon) on X11 when there is no watcher, and on GNOME without
  the AppIndicator extension its icon is invisible but closing still hides
  the window. The rewrite has no XEmbed fallback (it would need GTK on the
  UI thread for the app's lifetime), and closes the app instead of hiding it
  when no watcher is registered, so the window can't disappear with no way
  back. The item registers as soon as a watcher appears.
- **Frameless window corners.** On Wayland Electron makes the frameless
  window transparent and rounds `#root` to 8px (`body.window-rounded`). The
  rewrite's corners are square: rounding means wrapping all of `app.slint`'s
  content in a clipped Rectangle, a large edit to a file every page touches.
- **The auth window is not modal.** Electron's is a modal child of the main
  window. The GTK window lives on its own connection to the display server
  (Wayland has no cross-client parenting), the same as the Windows port's
  separate auth window. Its title uses the system's sans-serif font unless
  Noto Sans is installed (Electron bundles Noto Sans).
- **WM_CLASS instance.** Slint's `set_xdg_app_id` sets the X11 class to
  `hydralauncher` but leaves the instance empty; Electron sets both.
- **Close game without permission.** Electron retries a failed
  `process.kill` with an elevated `kill -9` through sudo-prompt (pkexec);
  the rewrite logs the failure.
- **The game launcher window**, which shows umu's setup progress, isn't
  ported (no platform has it yet); umu's progress lines are parsed but only
  failures are reported. The cloud save prefix preparation (`umu-run
  createprefix`) waits for cloud saves.
- **Linux process matching is name based where Electron's is**, including
  its quirks: `findGamePathByProcess` matches a running process by bare name,
  so a catalogue executable named like a common tool (seen with `cc`) can
  bind the wrong path; and a process whose working directory is the game's
  folder counts as the game (umu-run's own setup time counts as playtime,
  as in Electron).
- **Mouse wheel on Wayland** uses the 120px per notch measured on X11
  (Electron under Xvfb with XTEST wheel clicks); WSL can't inject Wayland
  wheel events to measure it there.
- **Audio in WSL**: cpal opens ALSA's default device, which WSLg doesn't
  route to PulseAudio unless `libasound2-plugins` is configured. Desktop
  distributions route ALSA to PipeWire/PulseAudio by default.
