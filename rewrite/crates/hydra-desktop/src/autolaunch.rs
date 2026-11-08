//! Run at startup: the `autoLaunch` event (events/user-preferences/auto-launch.ts)
//! with the `auto-launch` package's per-OS login items.
//!
//! - Windows: `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`, value
//!   `Hydra` = `"<exe>"` plus ` --hidden` when "start minimized" is on.
//! - Linux: `~/.config/autostart/Hydra.desktop` (`Exec=<exe> --hidden`).
//! - macOS: a login item through System Events (`hidden` property).
//!
//! Like Electron (`if (!app.isPackaged) return`), dev builds don't touch the
//! OS: a login item pointing at `target\debug` would outlive the checkout.
//! `HYDRA_TEST_AUTO_LAUNCH=1` lifts that for testing.

/// app.getName(): electron-builder's productName.
pub const APP_NAME: &str = "Hydra";

#[cfg(windows)]
const RUN_KEY: &str = "Software\\Microsoft\\Windows\\CurrentVersion\\Run";

/// app.isPackaged: an installed build, not `cargo run`.
fn packaged() -> bool {
    if std::env::var_os("HYDRA_TEST_AUTO_LAUNCH").is_some() {
        return true;
    }
    let Ok(exe) = std::env::current_exe() else {
        return false;
    };
    let text = exe.to_string_lossy().to_lowercase();
    let sep = std::path::MAIN_SEPARATOR;
    !cfg!(debug_assertions) && !text.contains(&format!("{sep}target{sep}"))
}

/// The program the login item starts (an AppImage starts itself, not the
/// mounted binary inside it).
fn app_path() -> Option<String> {
    if cfg!(target_os = "linux")
        && let Some(appimage) = std::env::var_os("APPIMAGE")
    {
        return Some(appimage.to_string_lossy().into_owned());
    }
    std::env::current_exe()
        .ok()
        .map(|p| p.to_string_lossy().into_owned())
}

/// The command line the OS runs at login.
pub fn command_line(exe: &str, hidden: bool) -> String {
    let args = if hidden { " --hidden" } else { "" };
    if cfg!(windows) {
        format!("\"{exe}\"{args}")
    } else {
        format!("{exe}{args}")
    }
}

/// AutoLaunchLinux's desktop entry.
#[cfg(any(target_os = "linux", test))]
pub fn desktop_entry(exe: &str, hidden: bool) -> String {
    format!(
        "[Desktop Entry]\nType=Application\nVersion=1.0\nName={APP_NAME}\nComment={APP_NAME}startup script\nExec={}\nStartupNotify=false\nTerminal=false\n",
        command_line(exe, hidden)
    )
}

/// window.electron.autoLaunch({ enabled, minimized }). Runs off the UI thread
/// (osascript can take a moment); errors are logged like Electron's.
pub fn apply(enabled: bool, minimized: bool) {
    if !packaged() {
        return;
    }
    std::thread::spawn(move || {
        let result = if enabled {
            enable(minimized)
        } else {
            disable()
        };
        if let Err(error) = result {
            eprintln!("autoLaunch: {error}");
        }
    });
}

#[cfg(windows)]
fn enable(hidden: bool) -> std::io::Result<()> {
    use winreg::RegKey;
    use winreg::enums::HKEY_CURRENT_USER;
    let exe = app_path().ok_or_else(|| std::io::Error::other("no executable path"))?;
    let (key, _) = RegKey::predef(HKEY_CURRENT_USER).create_subkey(RUN_KEY)?;
    key.set_value(APP_NAME, &command_line(&exe, hidden))
}

#[cfg(windows)]
fn disable() -> std::io::Result<()> {
    use winreg::RegKey;
    use winreg::enums::{HKEY_CURRENT_USER, KEY_SET_VALUE};
    let key = RegKey::predef(HKEY_CURRENT_USER).open_subkey_with_flags(RUN_KEY, KEY_SET_VALUE)?;
    match key.delete_value(APP_NAME) {
        // "unable to find the specified registry key or value" resolves false
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        other => other,
    }
}

#[cfg(target_os = "linux")]
fn autostart_file() -> Option<std::path::PathBuf> {
    dirs::config_dir().map(|d| d.join("autostart").join(format!("{APP_NAME}.desktop")))
}

#[cfg(target_os = "linux")]
fn enable(hidden: bool) -> std::io::Result<()> {
    let exe = app_path().ok_or_else(|| std::io::Error::other("no executable path"))?;
    let file = autostart_file().ok_or_else(|| std::io::Error::other("no config dir"))?;
    if let Some(parent) = file.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(file, desktop_entry(&exe, hidden))
}

#[cfg(target_os = "linux")]
fn disable() -> std::io::Result<()> {
    let Some(file) = autostart_file() else {
        return Ok(());
    };
    match std::fs::remove_file(file) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        other => other,
    }
}

/// The .app bundle containing the executable, else the executable.
#[cfg(target_os = "macos")]
fn bundle_path() -> Option<String> {
    let exe = app_path()?;
    Some(match exe.find(".app/") {
        Some(end) => exe[..end + 4].to_string(),
        None => exe,
    })
}

#[cfg(target_os = "macos")]
fn osascript(script: &str) -> std::io::Result<()> {
    let status = std::process::Command::new("osascript")
        .arg("-e")
        .arg(script)
        .status()?;
    if status.success() {
        Ok(())
    } else {
        Err(std::io::Error::other(format!(
            "osascript exited with {status}"
        )))
    }
}

#[cfg(target_os = "macos")]
fn enable(hidden: bool) -> std::io::Result<()> {
    let path = bundle_path().ok_or_else(|| std::io::Error::other("no executable path"))?;
    osascript(&format!(
        "tell application \"System Events\" to make login item at end with properties {{path:\"{path}\", hidden:{hidden}, name:\"{APP_NAME}\"}}"
    ))
}

#[cfg(target_os = "macos")]
fn disable() -> std::io::Result<()> {
    osascript(&format!(
        "tell application \"System Events\" to delete login item \"{APP_NAME}\""
    ))
}

#[cfg(not(any(windows, target_os = "linux", target_os = "macos")))]
fn enable(_hidden: bool) -> std::io::Result<()> {
    Ok(())
}

#[cfg(not(any(windows, target_os = "linux", target_os = "macos")))]
fn disable() -> std::io::Result<()> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn command_line_quotes_the_exe_on_windows_and_adds_hidden() {
        if cfg!(windows) {
            assert_eq!(
                command_line("C:\\Program Files\\Hydra\\hydra.exe", true),
                "\"C:\\Program Files\\Hydra\\hydra.exe\" --hidden"
            );
            assert_eq!(command_line("C:\\h.exe", false), "\"C:\\h.exe\"");
        } else {
            assert_eq!(command_line("/opt/hydra", true), "/opt/hydra --hidden");
        }
    }

    #[test]
    fn desktop_entry_matches_auto_launch() {
        let entry = desktop_entry("/opt/Hydra.AppImage", false);
        assert!(entry.starts_with("[Desktop Entry]\nType=Application\nVersion=1.0\nName=Hydra\n"));
        assert!(entry.contains("Comment=Hydrastartup script\n"));
        assert!(entry.contains("StartupNotify=false\nTerminal=false\n"));
    }
}
