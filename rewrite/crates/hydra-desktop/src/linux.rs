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

/// resources/icon.png (the window icons)
pub(crate) static ICON: &[u8] = include_bytes!("../../../../resources/icon.png");

/// The Skia surface for Linux, like Chromium chooses its compositor: OpenGL
/// on a GPU, the CPU raster when the only GL would be a software rasterizer
/// (Chromium composites in software then). Emulating a GPU with llvmpipe or
/// lavapipe costs about ten times more: measured in WSL without a GPU, a
/// playing trailer took 333% of a core on lavapipe and 30% on Skia's raster.
pub fn renderer() -> &'static str {
    if has_hardware_gl() {
        "skia-opengl"
    } else {
        eprintln!("No hardware OpenGL device: drawing with Skia's CPU raster");
        "skia-software"
    }
}

/// Whether EGL lists a device that isn't Mesa's software one
/// (EGL_EXT_device_enumeration, EGL_MESA_device_software). libEGL is loaded
/// on demand; without it there's no hardware GL either.
fn has_hardware_gl() -> bool {
    use std::ffi::{CStr, c_char, c_int, c_void};
    type GetProcAddress = unsafe extern "C" fn(*const c_char) -> *mut c_void;
    type QueryDevices = unsafe extern "C" fn(c_int, *mut *mut c_void, *mut c_int) -> u32;
    type QueryDeviceString = unsafe extern "C" fn(*mut c_void, c_int) -> *const c_char;
    const EGL_EXTENSIONS: c_int = 0x3055;
    // SAFETY: dlopen/dlsym with constant C strings; the function pointers are
    // the EGL entry points with the signatures the EGL spec gives them.
    unsafe {
        let lib = libc::dlopen(c"libEGL.so.1".as_ptr(), libc::RTLD_NOW | libc::RTLD_LOCAL);
        if lib.is_null() {
            return false;
        }
        let get_proc = libc::dlsym(lib, c"eglGetProcAddress".as_ptr());
        if get_proc.is_null() {
            return false;
        }
        let get_proc: GetProcAddress = std::mem::transmute(get_proc);
        let query_devices = get_proc(c"eglQueryDevicesEXT".as_ptr());
        let query_string = get_proc(c"eglQueryDeviceStringEXT".as_ptr());
        if query_devices.is_null() || query_string.is_null() {
            // no device enumeration: can't tell, trust the GPU path
            return true;
        }
        let query_devices: QueryDevices = std::mem::transmute(query_devices);
        let query_string: QueryDeviceString = std::mem::transmute(query_string);
        let mut devices = [std::ptr::null_mut::<c_void>(); 16];
        let mut count: c_int = 0;
        if query_devices(16, devices.as_mut_ptr(), &mut count) == 0 {
            return true;
        }
        devices[..count.clamp(0, 16) as usize].iter().any(|device| {
            let extensions = query_string(*device, EGL_EXTENSIONS);
            extensions.is_null()
                || !CStr::from_ptr(extensions)
                    .to_string_lossy()
                    .contains("EGL_MESA_device_software")
        })
    }
}

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
