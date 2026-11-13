//! Launching games (helpers/launch-game.ts), closing them
//! (events/library/close-game.ts) and the process watcher that tracks
//! playtime (services/process-watcher.ts).
//!
//! Linux follows Electron's rules: native games and AppImages run directly
//! (made executable, wrapped by gamemoderun/mangohud when enabled); Windows
//! executables run through umu-run in the game's Proton prefix, then plain
//! Wine, then directly as a last resort.
//!
//! Not ported yet: Steam protocol launches, Epic, the common redist
//! preflight, cloud save gates (and the prefix preparation they need), the
//! game launcher window, emulators and recompilations.

pub mod args;
pub mod linux_match;
pub mod processes;
pub mod tools;
pub mod umu;
pub mod umu_updater;
pub mod watcher;
pub mod wine;

use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use hydra_core::library_actions;
use hydra_db::{Db, keys};
use serde_json::{Map, Value, json};

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

/// isWindowsExecutable
pub fn is_windows_executable(path: &str) -> bool {
    Path::new(path)
        .extension()
        .is_some_and(|e| e.eq_ignore_ascii_case("exe"))
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
    spawn_detached(command).is_ok()
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
pub(crate) fn detach(command: &mut Command) {
    use std::os::windows::process::CommandExt;
    const DETACHED_PROCESS: u32 = 0x0000_0008;
    const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
    command.creation_flags(DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP);
}

/// Spawn detached and reap the child on a thread (Node's `unref()`), so it
/// never lingers as a zombie. Returns its pid.
fn spawn_detached(mut command: Command) -> std::io::Result<u32> {
    detach(&mut command);
    let mut child = command.spawn()?;
    let pid = child.id();
    std::thread::spawn(move || child.wait());
    Ok(pid)
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

fn working_directory(executable: &str) -> PathBuf {
    Path::new(executable)
        .parent()
        .map(Path::to_path_buf)
        .unwrap_or_default()
}

/// The command wrappers Electron puts in front of a launch on Linux.
fn wrappers(use_gamemode: bool, use_mangohud: bool) -> Vec<String> {
    let mut wrappers = Vec::new();
    if use_gamemode {
        wrappers.push("gamemoderun".to_string());
    }
    if use_mangohud {
        wrappers.push("mangohud".to_string());
    }
    wrappers
}

/// launchNatively: the pid of the spawned process, None when the shell opened it.
fn launch_natively(
    executable: &str,
    launch_options: Option<&str>,
    wrappers: &[String],
) -> Result<Option<u32>, String> {
    let resolved = args::resolve_launch_command(executable, &[], launch_options, wrappers);
    let simple =
        resolved.command == executable && resolved.args.is_empty() && resolved.env.is_empty();
    if cfg!(target_os = "linux") {
        ensure_owner_execute(executable);
    } else if simple {
        // shell.openPath(executablePath)
        #[cfg(windows)]
        let opened = shell_open(executable);
        #[cfg(not(windows))]
        let opened = open_path(executable);
        return if opened {
            Ok(None)
        } else {
            Err("Failed to open the game".into())
        };
    }
    let mut command = Command::new(&resolved.command);
    command
        .args(&resolved.args)
        .envs(&resolved.env)
        .current_dir(working_directory(executable))
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    spawn_detached(command)
        .map(Some)
        .map_err(|e| format!("Failed to launch game: {e}"))
}

/// ensureExecutablePermission: add the owner execute bit when it is missing.
fn ensure_owner_execute(executable: &str) {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if let Ok(meta) = std::fs::metadata(executable) {
            let mode = meta.permissions().mode();
            if mode & 0o100 == 0
                && let Err(error) = std::fs::set_permissions(
                    executable,
                    std::fs::Permissions::from_mode(mode | 0o100),
                )
            {
                eprintln!("Failed to ensure executable permission for {executable}: {error}");
            }
        }
    }
    #[cfg(not(unix))]
    let _ = executable;
}

/// LinuxCompatibilityLaunchContext: the Proton and the prefix a Windows
/// executable runs with on Linux.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Compatibility {
    pub proton_path: Option<PathBuf>,
    pub wine_prefix: Option<PathBuf>,
}

fn text<'a>(map: Option<&'a Map<String, Value>>, key: &str) -> Option<&'a str> {
    map?.get(key)?.as_str().filter(|s| !s.is_empty())
}

fn flag(map: Option<&Map<String, Value>>, key: &str) -> bool {
    map.and_then(|m| m.get(key)).and_then(Value::as_bool) == Some(true)
}

/// resolveProtonPathForLaunch + Wine.resolvePrefixPath(getEffectivePrefixPath)
pub fn compatibility_context(
    game: Option<&Map<String, Value>>,
    prefs: Option<&Map<String, Value>>,
    object_id: &str,
) -> Compatibility {
    let proton_path = [text(game, "protonPath"), text(prefs, "defaultProtonPath")]
        .into_iter()
        .flatten()
        .map(PathBuf::from)
        .find(|p| umu::is_valid_proton_path(p));
    let wine_prefix = wine::Roots::current()
        .and_then(|roots| {
            wine::effective_prefix(&roots, prefs, text(game, "winePrefixPath"), Some(object_id))
        })
        .map(|p| wine::resolve_prefix_path(&p.to_string_lossy(), &wine::home()));
    Compatibility {
        proton_path,
        wine_prefix,
    }
}

/// cleanupStaleCompatibilityProcesses: Wine processes left in the game's
/// default prefix by an earlier run are killed before a new launch.
fn cleanup_stale_compatibility_processes(
    object_id: &str,
    prefix: Option<&Path>,
    prefs: Option<&Map<String, Value>>,
) {
    if !cfg!(target_os = "linux") {
        return;
    }
    let Some(prefix) = prefix else { return };
    let default = wine::Roots::current()
        .and_then(|roots| wine::default_prefix_for_game(&roots, prefs, object_id))
        .map(|p| wine::resolve_prefix_path(&p.to_string_lossy(), &wine::home()));
    if default.as_deref() != Some(prefix) {
        return;
    }
    let prefix_text = prefix.to_string_lossy();
    let stale: Vec<u32> = processes::list()
        .into_iter()
        .filter(|p| p.env("STEAM_COMPAT_DATA_PATH") == Some(prefix_text.as_ref()))
        .filter(|p| {
            let exe = p.exe.as_deref().unwrap_or_default().to_lowercase();
            let name = p.name.to_lowercase();
            exe.contains("wine") || name.ends_with(".exe") || name == "wineserver"
        })
        .map(|p| p.pid)
        .collect();
    if stale.is_empty() {
        return;
    }
    eprintln!(
        "Killing stale compatibility processes before game launch: {object_id} {} {stale:?}",
        prefix.display()
    );
    #[cfg(unix)]
    for pid in stale {
        processes::kill_hard(pid);
    }
}

/// launchWithWine: `wine <exe>` with the prefix, the fallback when umu-run fails.
fn launch_with_wine(
    executable: &str,
    launch_options: Option<&str>,
    wrappers: &[String],
    prefix: Option<&Path>,
) -> bool {
    let resolved =
        args::resolve_launch_command("wine", &[executable.to_string()], launch_options, wrappers);
    let mut command = Command::new(&resolved.command);
    command
        .args(&resolved.args)
        .current_dir(working_directory(executable))
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    if let Some(prefix) = prefix {
        command.env("WINEPREFIX", prefix);
    }
    command.envs(&resolved.env);
    match spawn_detached(command) {
        Ok(_) => true,
        Err(error) => {
            eprintln!("Failed to launch game with Wine: {error}");
            false
        }
    }
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
    let launch_options = launch_options.filter(|o| !o.trim().is_empty());
    let game: Option<Value> = db.get_in(keys::GAMES, &key);
    let game = game.as_ref().and_then(Value::as_object);
    let prefs: Option<Value> = db.get(keys::USER_PREFERENCES);
    let prefs = prefs.as_ref().and_then(Value::as_object);

    // autoRunMangohud / autoRunGamemode, globally or for this game, when installed
    let use_mangohud = (flag(prefs, "autoRunMangohud") || flag(game, "autoRunMangohud"))
        && tools::mangohud_available();
    let use_gamemode = (flag(prefs, "autoRunGamemode") || flag(game, "autoRunGamemode"))
        && tools::gamemode_available();

    if cfg!(target_os = "linux") && is_windows_executable(executable) {
        let context = compatibility_context(game, prefs, object_id);
        eprintln!(
            "Launching {key} under Proton: prefix {:?}, proton {:?}",
            context.wine_prefix, context.proton_path
        );
        cleanup_stale_compatibility_processes(object_id, context.wine_prefix.as_deref(), prefs);
        if let Some(pid) = launch_windows_binary_on_linux(
            object_id,
            executable,
            &context,
            launch_options,
            use_mangohud,
            use_gamemode,
        ) {
            if let Some(pid) = pid {
                watcher::remember_launched_pid(&key, pid);
            }
            return Ok(Launch::Started(pid));
        }
        // Electron falls through to a direct launch when umu-run and Wine fail.
    }

    let pid = launch_natively(
        executable,
        launch_options,
        &wrappers(use_gamemode, use_mangohud),
    )?;
    if let Some(pid) = pid {
        watcher::remember_launched_pid(&key, pid);
    }
    Ok(Launch::Started(pid))
}

/// launchWindowsBinaryOnLinux: umu-run first, then plain Wine. Some(pid) when
/// one of them started (the pid only for umu-run), None when both failed.
#[allow(clippy::option_option)]
fn launch_windows_binary_on_linux(
    object_id: &str,
    executable: &str,
    context: &Compatibility,
    launch_options: Option<&str>,
    use_mangohud: bool,
    use_gamemode: bool,
) -> Option<Option<u32>> {
    umu_updater::check_for_updates();
    #[cfg(unix)]
    {
        let options = umu::LaunchOptions {
            wine_prefix: context.wine_prefix.clone(),
            proton_path: context.proton_path.clone(),
            game_id: Some(object_id.to_string()),
            launch_options: launch_options.map(str::to_string),
            use_mangohud,
            use_gamemode,
        };
        match umu::launch_executable(executable, &options) {
            Ok(pid) => return Some(Some(pid)),
            Err(error) => eprintln!("Failed to launch game with umu-run, falling back: {error}"),
        }
    }
    #[cfg(not(unix))]
    let _ = object_id;
    if launch_with_wine(
        executable,
        launch_options,
        &wrappers(use_gamemode, use_mangohud),
        context.wine_prefix.as_deref(),
    ) {
        return Some(None);
    }
    None
}

/// openGameWinetricks: winetricks on the game's effective prefix (Linux).
pub fn open_game_winetricks(db: &Db, shop: &str, object_id: &str) -> bool {
    if !cfg!(target_os = "linux") {
        return false;
    }
    let key = format!("{shop}:{object_id}");
    let Some(game) = db.get_in::<Value>(keys::GAMES, &key) else {
        return false;
    };
    // TODO(epic): openManagedEpicWinetricks for managed Epic installs.
    let prefs: Option<Value> = db.get(keys::USER_PREFERENCES);
    let prefix = wine::Roots::current().and_then(|roots| {
        wine::effective_prefix(
            &roots,
            prefs.as_ref().and_then(Value::as_object),
            text(game.as_object(), "winePrefixPath"),
            Some(object_id),
        )
    });
    let Some(prefix) = prefix else { return false };
    match tools::open_winetricks(&prefix) {
        Ok(()) => true,
        Err(error) => {
            eprintln!("{error}");
            false
        }
    }
}

/// closeGame: stop the processes running the game. Windows matches the
/// executable paths; Linux also takes processes in the game's folder, the
/// AppImage, the launched pid, and (for Windows executables) the Wine
/// process in the game's folder and prefix.
pub fn close_game(db: &Db, shop: &str, object_id: &str) {
    let key = format!("{shop}:{object_id}");
    let Some(game) = db.get_in::<Value>(keys::GAMES, &key) else {
        return;
    };
    let executable = game
        .get("executablePath")
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty());
    let mut targets: Vec<String> = game
        .get("trackingExecutablePaths")
        .and_then(Value::as_array)
        .map(|a| {
            a.iter()
                .filter_map(|v| v.as_str().filter(|s| !s.is_empty()).map(str::to_string))
                .collect()
        })
        .unwrap_or_default();
    if let Some(executable) = executable
        && !executable.to_lowercase().ends_with(".bat")
        && !executable.to_lowercase().ends_with(".cmd")
    {
        targets.insert(0, executable.to_string());
    }
    let launched_pid = watcher::launched_pid(&key);
    let linux = cfg!(target_os = "linux");
    let list = processes::list();
    let references = |p: &processes::ProcessInfo, target: &str| {
        linux_match::process_references_executable(
            p.cwd.as_deref(),
            p.exe.as_deref(),
            p.env("APPIMAGE"),
            target,
        )
    };
    let mut to_close: Vec<u32> = list
        .iter()
        .filter(|p| {
            let matches_target = targets.iter().any(|t| {
                if linux {
                    references(p, t)
                } else {
                    p.exe.as_deref().is_some_and(|exe| same_path(exe, t))
                }
            });
            matches_target
                || (linux
                    && Some(p.pid) == launched_pid
                    && references(p, executable.unwrap_or_default()))
        })
        .map(|p| p.pid)
        .collect();
    if to_close.is_empty() && linux {
        let prefs: Option<Value> = db.get(keys::USER_PREFERENCES);
        let expected = wine::Roots::current()
            .and_then(|roots| {
                wine::effective_prefix(
                    &roots,
                    prefs.as_ref().and_then(Value::as_object),
                    text(game.as_object(), "winePrefixPath"),
                    Some(object_id),
                )
            })
            .map(|p| p.to_string_lossy().to_string());
        let linux_processes = processes::linux_processes(&list);
        if let Some(fallback) = linux_match::close_fallback(
            executable.unwrap_or_default(),
            expected.as_deref(),
            &linux_processes,
        ) {
            to_close.push(fallback.pid);
        }
    }
    for pid in to_close {
        processes::kill(pid);
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn windows_executables() {
        assert!(is_windows_executable("/games/a/Game.EXE"));
        assert!(!is_windows_executable("/games/a/game.x86_64"));
        assert!(!is_windows_executable("/games/a/start.sh"));
    }

    #[test]
    fn wrapper_order() {
        // gamemoderun wraps mangohud, which wraps the game
        let r = args::resolve_launch_command("/g/game", &[], None, &wrappers(true, true));
        assert_eq!(r.command, "gamemoderun");
        assert_eq!(r.args, vec!["mangohud", "/g/game"]);
        assert!(wrappers(false, false).is_empty());
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn proton_from_game_then_preferences() {
        let dir = std::env::temp_dir().join(format!("hydra-ctx-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let proton = dir.join("GE-Proton");
        std::fs::create_dir_all(&proton).unwrap();
        std::fs::write(proton.join("proton"), "").unwrap();
        std::fs::write(proton.join("toolmanifest.vdf"), "").unwrap();
        let game = json!({ "protonPath": "/missing/proton", "winePrefixPath": dir.join("pfx") });
        let prefs = json!({ "defaultProtonPath": proton });
        let context = compatibility_context(game.as_object(), prefs.as_object(), "1");
        assert_eq!(context.proton_path.as_deref(), Some(proton.as_path()));
        assert_eq!(
            context.wine_prefix,
            Some(dir.canonicalize().unwrap().join("pfx"))
        );
        let context = compatibility_context(game.as_object(), None, "1");
        assert_eq!(context.proton_path, None);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
