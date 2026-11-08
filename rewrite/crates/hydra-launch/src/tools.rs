//! helpers/is-gamemode-available.ts, is-mangohud-available.ts,
//! is-winetricks-available.ts and events/library/open-game-winetricks.ts:
//! the optional Linux gaming tools Hydra can wrap a launch with.

use std::path::Path;
use std::process::{Command, Stdio};

fn succeeds(program: &str, args: &[&str]) -> bool {
    Command::new(program)
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .is_ok_and(|s| s.success())
}

/// isGamemodeAvailable: gamemoderun on PATH, both libgamemode libraries in
/// the linker cache, and a trial run that succeeds.
pub fn gamemode_available() -> bool {
    if !cfg!(target_os = "linux") {
        return false;
    }
    if !succeeds("/bin/sh", &["-c", "command -v gamemoderun"]) {
        return false;
    }
    let has_libraries = ["/usr/sbin/ldconfig", "/sbin/ldconfig", "ldconfig"]
        .iter()
        .any(|ldconfig| {
            Command::new(ldconfig)
                .arg("-p")
                .stdin(Stdio::null())
                .stderr(Stdio::null())
                .output()
                .is_ok_and(|o| {
                    let text = String::from_utf8_lossy(&o.stdout);
                    o.status.success()
                        && text.contains("libgamemode.so")
                        && text.contains("libgamemodeauto.so")
                })
        });
    has_libraries && succeeds("gamemoderun", &["/bin/sh", "-c", "exit 0"])
}

/// isMangohudAvailable
pub fn mangohud_available() -> bool {
    cfg!(target_os = "linux") && succeeds("mangohud", &["--version"])
}

/// isWinetricksAvailable
pub fn winetricks_available() -> bool {
    cfg!(target_os = "linux") && succeeds("winetricks", &["--version"])
}

/// openGameWinetricks: winetricks' own window on the game's prefix, detached.
#[cfg(unix)]
pub fn open_winetricks(prefix: &Path) -> Result<(), String> {
    let mut command = Command::new("winetricks");
    command
        .env("WINEPREFIX", prefix)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    crate::detach(&mut command);
    let mut child = command
        .spawn()
        .map_err(|e| format!("Failed to launch winetricks: {e}"))?;
    std::thread::spawn(move || child.wait());
    Ok(())
}

#[cfg(not(unix))]
pub fn open_winetricks(_prefix: &Path) -> Result<(), String> {
    Err("winetricks is Linux only".into())
}
