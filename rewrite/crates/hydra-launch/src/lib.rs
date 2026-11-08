//! Launching games (helpers/launch-game.ts), closing them
//! (events/library/close-game.ts) and the process watcher that tracks
//! playtime (services/process-watcher.ts).
//!
//! Not ported yet: Wine/UMU/Proton on Linux, Steam protocol launches, Epic,
//! the common redist preflight, cloud save gates, the game launcher window,
//! emulators and recompilations.

pub mod args;
pub mod processes;
pub mod watcher;

use std::path::Path;
use std::process::{Command, Stdio};

use hydra_core::library_actions;
use hydra_db::Db;
use serde_json::{Value, json};

/// removeAppImageLibraryPath: an AppImage runtime puts `$APPDIR/usr/lib` on
/// LD_LIBRARY_PATH, and games, Wine and umu-run started from the app must not
/// inherit Hydra's bundled libraries. Call it first thing in `main`, before
/// any thread starts (it edits the process environment).
pub fn remove_appimage_library_path() {
    if !cfg!(target_os = "linux") {
        return;
    }
    let (Some(_), Some(app_dir), Some(paths)) = (
        std::env::var_os("APPIMAGE"),
        std::env::var("APPDIR").ok(),
        std::env::var("LD_LIBRARY_PATH").ok(),
    ) else {
        return;
    };
    let bundled = format!("{app_dir}/usr/lib");
    let remaining: Vec<&str> = paths
        .split(':')
        .filter(|entry| !entry.is_empty() && *entry != bundled)
        .collect();
    // SAFETY: called from main() before any other thread exists.
    unsafe {
        if remaining.is_empty() {
            std::env::remove_var("LD_LIBRARY_PATH");
        } else {
            std::env::set_var("LD_LIBRARY_PATH", remaining.join(":"));
        }
    }
}

/// hasLaunchableExecutable
pub fn has_launchable_executable(executable: &str) -> bool {
    !executable.is_empty() && Path::new(executable).exists()
}

/// updateGameExecutablePath + launchOptions, before the launch.
fn remember_launch(db: &Db, key: &str, executable: &str, launch_options: Option<&str>) {
    let _ = library_actions::update_game_record(db, key, |game| {
        if game.get("executablePath").and_then(Value::as_str) != Some(executable) {
            game.insert("executablePath".into(), json!(executable));
            game.insert(
                "executablePathUpdatedAt".into(),
                json!(library_actions::now_iso()),
            );
        }
        game.insert(
            "launchOptions".into(),
            launch_options.map_or(Value::Null, |o| json!(o)),
        );
    });
}

/// shell.openPath (the tray's recently played games).
#[cfg(windows)]
pub fn open_path(path: &str) -> bool {
    shell_open(path)
}

/// shell.openPath: the desktop's default handler (xdg-open on Linux, open on
/// macOS), detached so the app never waits on it.
#[cfg(not(windows))]
pub fn open_path(path: &str) -> bool {
    let opener = if cfg!(target_os = "macos") {
        "open"
    } else {
        "xdg-open"
    };
    let mut command = Command::new(opener);
    command
        .arg(path)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    detach(&mut command);
    match command.spawn() {
        // reap it so it never lingers as a zombie
        Ok(mut child) => {
            std::thread::spawn(move || child.wait());
            true
        }
        Err(_) => false,
    }
}

/// spawn(..., { detached: true }): its own session, so closing Hydra (or a
/// signal to Hydra's process group) doesn't take the child with it.
#[cfg(unix)]
pub(crate) fn detach(command: &mut Command) {
    use std::os::unix::process::CommandExt;
    // SAFETY: setsid is async-signal-safe and touches no Rust state.
    unsafe {
        command.pre_exec(|| {
            if libc::setsid() == -1 {
                return Err(std::io::Error::last_os_error());
            }
            Ok(())
        });
    }
}

#[cfg(windows)]
fn shell_open(path: &str) -> bool {
    // shell.openPath: ShellExecute "open", like double-clicking the file.
    Command::new("cmd")
        .args(["/C", "start", "", path])
        .current_dir(Path::new(path).parent().unwrap_or(Path::new(".")))
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .is_ok()
}

/// launchNatively: the pid of the spawned process, None when the shell opened it.
fn launch_natively(executable: &str, launch_options: Option<&str>) -> Result<Option<u32>, String> {
    let working_directory = Path::new(executable)
        .parent()
        .map(Path::to_path_buf)
        .unwrap_or_default();
    let resolved = args::resolve_launch_command(executable, &[], launch_options, &[]);
    #[cfg(windows)]
    if resolved.command == executable && resolved.args.is_empty() && resolved.env.is_empty() {
        return if shell_open(executable) {
            Ok(None)
        } else {
            Err("Failed to open the game".into())
        };
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if let Ok(meta) = std::fs::metadata(executable) {
            let mode = meta.permissions().mode();
            if mode & 0o100 == 0 {
                let _ = std::fs::set_permissions(
                    executable,
                    std::fs::Permissions::from_mode(mode | 0o100),
                );
            }
        }
    }
    let mut command = Command::new(&resolved.command);
    command
        .args(&resolved.args)
        .envs(&resolved.env)
        .current_dir(working_directory)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const DETACHED_PROCESS: u32 = 0x0000_0008;
        const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
        command.creation_flags(DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP);
    }
    let child = command
        .spawn()
        .map_err(|e| format!("Failed to launch game: {e}"))?;
    Ok(Some(child.id()))
}

/// The outcome of `launch_game`.
#[derive(Debug, PartialEq, Eq)]
pub enum Launch {
    /// on-game-executable-not-found
    ExecutableNotFound,
    Started(Option<u32>),
}

/// launchGame: remember the executable and options, then start it.
pub fn launch_game(
    db: &Db,
    shop: &str,
    object_id: &str,
    executable: &str,
    launch_options: Option<&str>,
) -> Result<Launch, String> {
    if !has_launchable_executable(executable) {
        eprintln!("Game executable not found: {shop}:{object_id} {executable}");
        return Ok(Launch::ExecutableNotFound);
    }
    let key = format!("{shop}:{object_id}");
    remember_launch(db, &key, executable, launch_options);
    let pid = launch_natively(executable, launch_options.filter(|o| !o.trim().is_empty()))?;
    if let Some(pid) = pid {
        watcher::remember_launched_pid(&key, pid);
    }
    Ok(Launch::Started(pid))
}

/// closeGame: kill the processes running the game's executable(s).
pub fn close_game(db: &Db, shop: &str, object_id: &str) {
    let key = format!("{shop}:{object_id}");
    let Some(game) = db.get_in::<Value>(hydra_db::keys::GAMES, &key) else {
        return;
    };
    let mut targets: Vec<String> = game
        .get("trackingExecutablePaths")
        .and_then(Value::as_array)
        .map(|a| {
            a.iter()
                .filter_map(|v| v.as_str().filter(|s| !s.is_empty()).map(str::to_string))
                .collect()
        })
        .unwrap_or_default();
    if let Some(executable) = game.get("executablePath").and_then(Value::as_str)
        && !executable.to_lowercase().ends_with(".bat")
        && !executable.to_lowercase().ends_with(".cmd")
    {
        targets.insert(0, executable.to_string());
    }
    for process in processes::list() {
        let matches = targets
            .iter()
            .any(|t| process.exe.as_deref().is_some_and(|exe| same_path(exe, t)));
        if matches {
            processes::kill(process.pid);
        }
    }
}

/// Paths compare case-insensitively on Windows.
pub fn same_path(a: &str, b: &str) -> bool {
    if cfg!(windows) {
        a.eq_ignore_ascii_case(b)
    } else {
        a == b
    }
}
