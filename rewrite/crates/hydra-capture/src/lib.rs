//! Game window capture and the screenshot hotkey, shared with the Electron
//! app: native/hydra-native's `desktop_duplication`, `window_*`,
//! `active_window`, `kde_focus`, `linux_process` and `screenshot_input`
//! modules are compiled here without napi (`cfg(hydra_rewrite)`), the way
//! `hydra-torrent` compiles the torrent engine.
//!
//! What the Electron app does in Chromium (window capture through
//! `desktopCapturer`/`getUserMedia`) is native here: Windows Graphics
//! Capture on Windows, XComposite + GetImage on X11 (`window_capture`).

// ---- native/hydra-native, compiled without napi
#[allow(dead_code)]
#[path = "../../../../native/hydra-native/src/window_bounds.rs"]
pub mod window_bounds;

#[allow(dead_code)]
#[path = "../../../../native/hydra-native/src/window_order.rs"]
pub mod window_order;

#[allow(dead_code)]
#[path = "../../../../native/hydra-native/src/window_client.rs"]
pub mod window_client;

#[allow(dead_code)]
#[path = "../../../../native/hydra-native/src/active_window.rs"]
pub mod active_window;

#[allow(dead_code)]
#[path = "../../../../native/hydra-native/src/kde_focus.rs"]
pub mod kde_focus;

#[allow(dead_code)]
#[path = "../../../../native/hydra-native/src/linux_process.rs"]
mod linux_process;

#[allow(dead_code)]
#[path = "../../../../native/hydra-native/src/desktop_duplication.rs"]
pub mod desktop_duplication;

#[allow(dead_code)]
#[path = "../../../../native/hydra-native/src/screenshot_input/mod.rs"]
pub mod screenshot_input;

// ---- rewrite-only
pub mod foreground;
pub mod frame;
pub mod processes;
pub mod window_capture;

pub use desktop_duplication::{encode_bgra_screenshot, DesktopFrame as Frame, EncodedScreenshot};
