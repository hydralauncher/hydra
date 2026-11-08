//! Linux desktop integration that Electron gets from Chromium:
//!
//! - the XDG app id (Wayland `app_id`, X11 `WM_CLASS`), so docks and task
//!   bars match the window to `hydralauncher.desktop` and show its icon;
//! - the window icon (`BrowserWindow({ icon })`, `_NET_WM_ICON` on X11;
//!   Wayland takes the icon from the desktop file);
//! - app.setAsDefaultProtocolClient("hydralauncher"): on Linux Electron runs
//!   `xdg-settings set default-url-scheme-handler` for the desktop file the
//!   package installed. The desktop file itself (with
//!   `MimeType=x-scheme-handler/hydralauncher;`) comes from the package; see
//!   docs/linux.md.

use std::path::PathBuf;
use std::process::{Command, Stdio};

use slint::ComponentHandle;

use crate::AppWindow;

/// The package name, like Electron's (package.json "name").
pub const APP_ID: &str = "hydralauncher";
/// The desktop entry packages install (electron-builder names it the same).
pub const DESKTOP_FILE: &str = "hydralauncher.desktop";

static ICON: &[u8] = include_bytes!("../../../../resources/icon.png");

/// Call after the backend is selected and before the first window shows.
pub fn set_app_id() {
    if let Err(error) = slint::set_xdg_app_id(APP_ID) {
        eprintln!("Failed to set the XDG app id: {error}");
    }
}

/// The window icon, once the native window exists (one event-loop pass after
/// show), retried for a while like the auth webview.
pub fn set_window_icon(ui: &AppWindow) {
    set_window_icon_attempt(ui.as_weak(), 0);
}

fn set_window_icon_attempt(weak: slint::Weak<AppWindow>, attempt: u32) {
    use slint::winit_030::{WinitWindowAccessor, winit};
    let Some(ui) = weak.upgrade() else { return };
    let done = ui
        .window()
        .with_winit_window(|window: &winit::window::Window| {
            let Ok(image) = image::load_from_memory(ICON) else {
                return;
            };
            // 128px is plenty for task bars and keeps the X11 property small.
            let image = image
                .resize_exact(128, 128, image::imageops::FilterType::Lanczos3)
                .into_rgba8();
            let (width, height) = image.dimensions();
            if let Ok(icon) = winit::window::Icon::from_rgba(image.into_raw(), width, height) {
                window.set_window_icon(Some(icon));
            }
        })
        .is_some();
    if !done && attempt < 100 {
        slint::Timer::single_shot(std::time::Duration::from_millis(50), move || {
            set_window_icon_attempt(weak, attempt + 1)
        });
    }
}

/// $XDG_DATA_HOME and $XDG_DATA_DIRS (with their spec defaults).
fn xdg_data_dirs() -> Vec<PathBuf> {
    let home = std::env::var_os("XDG_DATA_HOME")
        .map(PathBuf::from)
        .filter(|p| p.is_absolute())
        .or_else(|| dirs::home_dir().map(|h| h.join(".local/share")));
    let system = std::env::var("XDG_DATA_DIRS")
        .ok()
        .filter(|v| !v.is_empty())
        .unwrap_or_else(|| "/usr/local/share:/usr/share".into());
    home.into_iter()
        .chain(
            system
                .split(':')
                .filter(|p| !p.is_empty())
                .map(PathBuf::from),
        )
        .collect()
}

/// Whether a package installed hydralauncher.desktop.
pub fn desktop_file_installed() -> bool {
    xdg_data_dirs()
        .iter()
        .any(|dir| dir.join("applications").join(DESKTOP_FILE).exists())
}

/// app.setAsDefaultProtocolClient on Linux: make hydralauncher.desktop the
/// handler for `hydralauncher://` (only when a package installed it, and
/// only when it isn't the handler already). Runs off the UI thread.
pub fn register_protocol() {
    std::thread::spawn(|| {
        if !desktop_file_installed() {
            return;
        }
        let scheme = crate::deeplink::PROTOCOL;
        let current = Command::new("xdg-settings")
            .args(["get", "default-url-scheme-handler", scheme])
            .stdin(Stdio::null())
            .stderr(Stdio::null())
            .output()
            .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
            .unwrap_or_default();
        if current == DESKTOP_FILE {
            return;
        }
        let status = Command::new("xdg-settings")
            .args(["set", "default-url-scheme-handler", scheme, DESKTOP_FILE])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
        if !status.is_ok_and(|s| s.success()) {
            eprintln!("Failed to register {scheme}:// with xdg-settings");
        }
    });
}
