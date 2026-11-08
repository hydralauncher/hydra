//! services/linux-process-match.ts plus the Linux branches of
//! process-watcher.ts (hasLinuxCompatibilityProcessMatch) and close-game.ts:
//! how a running process is tied to a library game on Linux, where games run
//! natively, from AppImages, or under Wine/Proton (umu sets
//! STEAM_COMPAT_DATA_PATH to the prefix).

use std::collections::HashMap;

/// native-addon.ts buildMaps `linuxProcesses`: everything lowercased.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct LinuxProcess {
    pub name: String,
    pub cwd: String,
    pub exe: String,
    pub pid: u32,
    pub app_image_path: Option<String>,
    pub steam_compat_data_path: Option<String>,
}

/// path.dirname for `/` paths
fn dirname(path: &str) -> &str {
    match path.trim_end_matches('/').rfind('/') {
        Some(0) => "/",
        Some(i) => &path[..i],
        None => ".",
    }
}

fn basename(path: &str) -> &str {
    path.rsplit('/').next().unwrap_or(path)
}

/// path.normalize for `/` paths: duplicate slashes, `.` and `..` folded, a
/// trailing slash kept.
pub fn normalize(path: &str) -> String {
    if path.is_empty() {
        return ".".into();
    }
    let absolute = path.starts_with('/');
    let trailing = path.ends_with('/');
    let mut parts: Vec<&str> = Vec::new();
    for part in path.split('/') {
        match part {
            "" | "." => {}
            ".." => {
                if parts.last().is_some_and(|p| *p != "..") {
                    parts.pop();
                } else if !absolute {
                    parts.push("..");
                }
            }
            other => parts.push(other),
        }
    }
    let mut out = parts.join("/");
    if absolute {
        out.insert(0, '/');
    }
    if out.is_empty() {
        out.push('.');
    }
    if trailing && !out.ends_with('/') {
        out.push('/');
    }
    out
}

/// hasLinuxNativeOrAppImageMatch
pub fn has_native_or_appimage_match(executable: &str, processes: &[LinuxProcess]) -> bool {
    let target = executable.to_lowercase();
    processes
        .iter()
        .any(|p| p.exe == target || p.app_image_path.as_deref() == Some(target.as_str()))
}

/// processReferencesExecutable: the process runs in the game's folder, or is
/// its executable / AppImage.
pub fn process_references_executable(
    cwd: Option<&str>,
    exe: Option<&str>,
    app_image_path: Option<&str>,
    executable: &str,
) -> bool {
    let target = executable.to_lowercase();
    let directory = dirname(executable).to_lowercase();
    cwd.unwrap_or_default().to_lowercase() == directory
        || exe.unwrap_or_default().to_lowercase() == target
        || app_image_path.unwrap_or_default().to_lowercase() == target
}

/// hasLaunchedPidMatch
pub fn has_launched_pid_match(
    launched_pid: Option<u32>,
    executable: &str,
    by_pid: &HashMap<u32, &LinuxProcess>,
) -> bool {
    let Some(process) = launched_pid.and_then(|pid| by_pid.get(&pid)) else {
        return false;
    };
    process_references_executable(
        Some(&process.cwd),
        Some(&process.exe),
        process.app_image_path.as_deref(),
        executable,
    )
}

/// doesSteamCompatDataPathMatchWinePrefix: the prefix itself, or Proton's
/// `<compatdata>/pfx`.
pub fn steam_compat_matches_prefix(compat_data: Option<&str>, prefix: Option<&str>) -> bool {
    let (Some(compat_data), Some(prefix)) = (
        compat_data.filter(|s| !s.is_empty()),
        prefix.filter(|s| !s.is_empty()),
    ) else {
        return false;
    };
    let compat_data = normalize(compat_data).to_lowercase();
    let prefix = normalize(prefix).to_lowercase();
    compat_data == prefix || normalize(&format!("{compat_data}/pfx")) == prefix
}

/// hasLinuxCompatibilityProcessMatch: a Windows executable running under
/// Wine in the game's folder (and, when the process says, in its prefix).
pub fn has_compatibility_match(
    executable: &str,
    expected_prefix: Option<&str>,
    processes: &[LinuxProcess],
) -> bool {
    let lower = executable.to_lowercase();
    if !lower.ends_with(".exe") {
        return false;
    }
    let name = basename(&lower).to_string();
    let name_without_extension = name.strip_suffix(".exe").unwrap_or(&name).to_string();
    let directory = dirname(executable).to_lowercase();
    let expected_prefix = expected_prefix.map(str::to_lowercase);
    processes.iter().any(|p| {
        if p.cwd != directory {
            return false;
        }
        if let (Some(expected), Some(compat)) = (&expected_prefix, &p.steam_compat_data_path)
            && !steam_compat_matches_prefix(Some(compat), Some(expected))
        {
            return false;
        }
        if p.name == name || p.name == name_without_extension {
            return true;
        }
        p.exe.contains("wine") && !p.name.is_empty()
    })
}

/// close-game.ts linuxFallbackProcess: for a Windows executable with no
/// direct match, a Wine process in the game's folder (and prefix).
pub fn close_fallback<'a>(
    executable: &str,
    expected_prefix: Option<&str>,
    processes: &'a [LinuxProcess],
) -> Option<&'a LinuxProcess> {
    if !executable.to_lowercase().ends_with(".exe") {
        return None;
    }
    let directory = dirname(executable).to_lowercase();
    let expected = expected_prefix.map(str::to_lowercase);
    processes.iter().find(|p| {
        if p.cwd.is_empty() || p.cwd != directory {
            return false;
        }
        if let (Some(expected), Some(compat)) = (&expected, &p.steam_compat_data_path)
            && compat != expected
        {
            return false;
        }
        p.exe.contains("wine")
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn process(name: &str, cwd: &str, exe: &str) -> LinuxProcess {
        LinuxProcess {
            name: name.to_lowercase(),
            cwd: cwd.to_lowercase(),
            exe: exe.to_lowercase(),
            pid: 1,
            ..Default::default()
        }
    }

    #[test]
    fn normalizes_like_node() {
        assert_eq!(normalize("/a//b/./c/../d"), "/a/b/d");
        assert_eq!(normalize("/a/b/"), "/a/b/");
        assert_eq!(normalize("/.."), "/");
        assert_eq!(normalize("a/../../b"), "../b");
    }

    #[test]
    fn native_and_appimage_matches() {
        let mut p = process("game", "/games/x", "/Games/X/game");
        assert!(has_native_or_appimage_match("/Games/X/game", &[p.clone()]));
        assert!(!has_native_or_appimage_match(
            "/Games/X/other",
            &[p.clone()]
        ));
        p.exe = "/tmp/.mount_abc/usr/bin/game".into();
        p.app_image_path = Some("/home/u/game.appimage".into());
        assert!(has_native_or_appimage_match("/home/u/Game.AppImage", &[p]));
    }

    #[test]
    fn compat_data_and_prefix() {
        assert!(steam_compat_matches_prefix(Some("/p/1"), Some("/p/1")));
        assert!(steam_compat_matches_prefix(Some("/p/1/"), Some("/p/1/pfx")));
        // path.normalize keeps a trailing slash, so Node doesn't match this one either
        assert!(!steam_compat_matches_prefix(
            Some("/p/1"),
            Some("/p/1/pfx/")
        ));
        assert!(steam_compat_matches_prefix(Some("/P/1"), Some("/p/1/pfx")));
        assert!(!steam_compat_matches_prefix(Some("/p/1"), Some("/p/2")));
        assert!(!steam_compat_matches_prefix(None, Some("/p/1")));
    }

    #[test]
    fn wine_processes_in_the_game_folder() {
        let exe = "/Games/Hollow/Hollow Knight.exe";
        let game = process(
            "Hollow Knight.exe",
            "/Games/Hollow",
            "/usr/bin/wine64-preloader",
        );
        assert!(has_compatibility_match(exe, None, &[game.clone()]));
        // a renamed child, still under Wine in the folder
        let child = process(
            "UnityCrashHandler",
            "/Games/Hollow",
            "/opt/proton/files/bin/wine64",
        );
        assert!(has_compatibility_match(exe, None, &[child]));
        // a native helper in the folder that isn't Wine
        let helper = process("helper", "/Games/Hollow", "/usr/bin/bash");
        assert!(!has_compatibility_match(exe, None, &[helper]));
        // another prefix
        let mut other = game.clone();
        other.steam_compat_data_path = Some("/prefixes/other".into());
        assert!(!has_compatibility_match(
            exe,
            Some("/prefixes/hollow"),
            &[other.clone()]
        ));
        other.steam_compat_data_path = Some("/prefixes/hollow".into());
        assert!(has_compatibility_match(
            exe,
            Some("/Prefixes/Hollow"),
            &[other]
        ));
        // not a Windows executable
        assert!(!has_compatibility_match(
            "/Games/Hollow/run.sh",
            None,
            &[game]
        ));
    }

    #[test]
    fn launched_pid_and_close_fallback() {
        let mut p = process("game.x86_64", "/games/a", "/games/a/game.x86_64");
        p.pid = 42;
        let by_pid: HashMap<u32, &LinuxProcess> = [(42, &p)].into_iter().collect();
        assert!(has_launched_pid_match(
            Some(42),
            "/Games/A/start.sh",
            &by_pid
        ));
        assert!(!has_launched_pid_match(
            Some(7),
            "/Games/A/start.sh",
            &by_pid
        ));
        let wine = process("game.exe", "/games/b", "/usr/bin/wine");
        let list = [p.clone(), wine.clone()];
        assert_eq!(
            close_fallback("/Games/B/Game.exe", None, &list).map(|p| p.name.as_str()),
            Some("game.exe")
        );
        assert!(close_fallback("/Games/B/game.sh", None, &list).is_none());
    }
}
