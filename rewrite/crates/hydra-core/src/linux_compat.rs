//! What the game options' Compatibility tab needs on Linux
//! (services/wine.ts validatePrefix, services/umu.ts
//! getInstalledProtonVersions / isValidProtonPath, and the PATH checks of
//! is-gamemode-available.ts / is-mangohud-available.ts /
//! is-winetricks-available.ts). Launching through Wine/umu is not here.

use std::path::{Path, PathBuf};

/// One installed Proton (`ProtonVersion`).
#[derive(Clone, Debug, PartialEq)]
pub struct ProtonVersion {
    pub name: String,
    pub path: String,
    /// "steam" | "compatibility_tools"
    pub source: &'static str,
}

/// Wine.validatePrefix: the registry files and the two folders a prefix has.
pub fn validate_prefix(prefix: &Path) -> bool {
    ["system.reg", "user.reg", "userdef.reg"]
        .iter()
        .all(|f| prefix.join(f).is_file())
        && ["dosdevices", "drive_c"]
            .iter()
            .all(|d| prefix.join(d).is_dir())
}

/// isValidProtonDirectory: a `proton` script and a `toolmanifest.vdf`.
pub fn is_valid_proton_dir(dir: &Path) -> bool {
    dir.join("proton").exists() && dir.join("toolmanifest.vdf").exists()
}

/// STEAM_ROOT_SEGMENTS under the home folder.
pub fn steam_roots(home: &Path) -> Vec<PathBuf> {
    [
        &[".steam", "steam"][..],
        &[".local", "share", "Steam"],
        &[
            ".var",
            "app",
            "com.valvesoftware.Steam",
            ".local",
            "share",
            "Steam",
        ],
        &[".var", "app", "com.valvesoftware.Steam", "data", "Steam"],
        &["snap", "steam", "common", ".local", "share", "Steam"],
    ]
    .iter()
    .map(|segments| segments.iter().fold(home.to_path_buf(), |p, s| p.join(s)))
    .collect()
}

/// Umu.getInstalledProtonVersions without the Flatpak extensions: `Proton*`
/// in every steamapps/common, then each compatibilitytools.d entry.
pub fn installed_proton_versions(home: &Path, libraries: &[PathBuf]) -> Vec<ProtonVersion> {
    let roots = steam_roots(home);
    let mut commons: Vec<PathBuf> = Vec::new();
    for root in roots.iter().chain(libraries) {
        let common = root.join("steamapps").join("common");
        if !commons.contains(&common) {
            commons.push(common);
        }
    }
    let mut tools: Vec<PathBuf> = roots
        .iter()
        .map(|r| r.join("compatibilitytools.d"))
        .collect();
    tools.push(PathBuf::from("/usr/share/steam/compatibilitytools.d"));

    let mut versions: Vec<ProtonVersion> = Vec::new();
    let mut add = |dir: PathBuf, source: &'static str| {
        if !is_valid_proton_dir(&dir) {
            return;
        }
        let real = std::fs::canonicalize(&dir).unwrap_or(dir);
        let path = real.to_string_lossy().to_string();
        if versions.iter().any(|v| v.path == path) {
            return;
        }
        versions.push(ProtonVersion {
            name: real
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_default(),
            path,
            source,
        });
    };
    for common in &commons {
        let Ok(entries) = std::fs::read_dir(common) else {
            continue;
        };
        let mut dirs: Vec<PathBuf> = entries
            .flatten()
            .filter(|e| e.file_type().is_ok_and(|t| t.is_dir()))
            .filter(|e| e.file_name().to_string_lossy().starts_with("Proton"))
            .map(|e| e.path())
            .collect();
        dirs.sort();
        for dir in dirs {
            add(dir, "steam");
        }
    }
    for folder in &tools {
        let Ok(entries) = std::fs::read_dir(folder) else {
            continue;
        };
        let mut dirs: Vec<PathBuf> = entries
            .flatten()
            .filter(|e| e.file_type().is_ok_and(|t| t.is_dir()))
            .map(|e| e.path())
            .collect();
        dirs.sort();
        for dir in dirs {
            add(dir, "compatibility_tools");
        }
    }
    versions
}

/// `command -v <name>`: the first match on PATH.
pub fn which(name: &str) -> Option<PathBuf> {
    let path = std::env::var_os("PATH")?;
    std::env::split_paths(&path)
        .map(|dir| dir.join(name))
        .find(|candidate| candidate.is_file())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_prefixes_and_proton_folders() {
        let dir = std::env::temp_dir().join(format!("hydra-compat-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("drive_c")).unwrap();
        std::fs::create_dir_all(dir.join("dosdevices")).unwrap();
        for f in ["system.reg", "user.reg"] {
            std::fs::write(dir.join(f), "").unwrap();
        }
        assert!(!validate_prefix(&dir));
        std::fs::write(dir.join("userdef.reg"), "").unwrap();
        assert!(validate_prefix(&dir));

        let home = dir.join("home");
        let proton = home.join(".steam/steam/steamapps/common/Proton 9.0");
        std::fs::create_dir_all(&proton).unwrap();
        std::fs::write(proton.join("proton"), "").unwrap();
        assert!(installed_proton_versions(&home, &[]).is_empty());
        std::fs::write(proton.join("toolmanifest.vdf"), "").unwrap();
        let found = installed_proton_versions(&home, &[]);
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].name, "Proton 9.0");
        assert_eq!(found[0].source, "steam");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
