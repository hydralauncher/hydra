//! Steam library folders and app install directories
//! (services/steam.ts getSteamLibraryFolders,
//! steam-integration/steam-installation-core.ts and
//! steam-library-executable.ts): whether an executable belongs to a Steam
//! install, which makes Steam's own uninstall the "Remove files" target.

use std::path::{Component, Path, PathBuf};

/// `steamapps/libraryfolders.vdf`, then `config/libraryfolders.vdf`.
const LIBRARY_FOLDER_MANIFESTS: [[&str; 2]; 2] = [
    ["steamapps", "libraryfolders.vdf"],
    ["config", "libraryfolders.vdf"],
];

/// STEAM_APP_STATE_FULLY_INSTALLED
const FULLY_INSTALLED: i64 = 4;

/// parseLibraryFolderPaths: `"path" "…"` and the old `"1" "…"` entries.
pub fn parse_library_folders(content: &str) -> Vec<PathBuf> {
    let mut out = Vec::new();
    for line in content.lines() {
        let parts: Vec<&str> = line.split('"').collect();
        // ["\t\t", key, "\t\t", value, ""]
        if parts.len() < 5 {
            continue;
        }
        let (key, value) = (parts[1], parts[3]);
        if key == "path" || (!key.is_empty() && key.chars().all(|c| c.is_ascii_digit())) {
            let value = value.replace("\\\\", "\\");
            let path = PathBuf::from(&value);
            if path.is_absolute() {
                out.push(path);
            }
        }
    }
    out
}

/// getSteamLibraryFolders: the Steam folder plus every library it lists.
pub fn library_folders(steam: &Path) -> Vec<PathBuf> {
    for manifest in LIBRARY_FOLDER_MANIFESTS {
        let Ok(content) = std::fs::read_to_string(steam.join(manifest[0]).join(manifest[1])) else {
            continue;
        };
        let folders = parse_library_folders(&content);
        if !folders.is_empty() {
            let mut all = vec![steam.to_path_buf()];
            for folder in folders {
                if !all.contains(&folder) {
                    all.push(folder);
                }
            }
            return all;
        }
    }
    vec![steam.to_path_buf()]
}

/// readManifestValue: `"key" "value"` (case-insensitive key, escapes undone).
pub fn manifest_value(content: &str, key: &str) -> Option<String> {
    let lower = content.to_lowercase();
    let needle = format!("\"{}\"", key.to_lowercase());
    let mut from = 0;
    while let Some(at) = lower[from..].find(&needle) {
        let start = from + at + needle.len();
        let rest = &content[start..];
        let trimmed = rest.trim_start_matches([' ', '\t']);
        if let Some(value) = trimmed.strip_prefix('"') {
            let mut out = String::new();
            let mut chars = value.chars();
            while let Some(c) = chars.next() {
                match c {
                    '\\' => {
                        if let Some(next) = chars.next() {
                            out.push(next);
                        }
                    }
                    '"' => return Some(out),
                    other => out.push(other),
                }
            }
            return None;
        }
        from = start;
    }
    None
}

/// The install directory of `app_id` across the libraries, when Steam marks it
/// fully installed and it exists (findSteamAppInstallDirectories).
pub fn app_install_directory(app_id: &str, libraries: &[PathBuf]) -> Option<PathBuf> {
    if app_id.is_empty() || !app_id.chars().all(|c| c.is_ascii_digit()) {
        return None;
    }
    for library in libraries {
        let manifest = library
            .join("steamapps")
            .join(format!("appmanifest_{app_id}.acf"));
        let Ok(content) = std::fs::read_to_string(&manifest) else {
            continue;
        };
        if manifest_value(&content, "appid").as_deref() != Some(app_id) {
            continue;
        }
        let flags: i64 = manifest_value(&content, "StateFlags")
            .and_then(|f| f.parse().ok())
            .unwrap_or(0);
        if flags & FULLY_INSTALLED == 0 {
            continue;
        }
        let Some(name) = manifest_value(&content, "installdir") else {
            continue;
        };
        let common = library.join("steamapps").join("common");
        let dir = common.join(&name);
        // resolveInstallDirectory: stays inside steamapps/common
        if Path::new(&name)
            .components()
            .any(|c| !matches!(c, Component::Normal(_)))
        {
            continue;
        }
        if dir.is_dir() {
            return Some(dir);
        }
    }
    None
}

/// isPathInsideSteamInstallDirectory (case-insensitive on Windows).
pub fn is_inside(file: &Path, dir: &Path) -> bool {
    if !file.is_absolute() || !dir.is_absolute() {
        return false;
    }
    let normalize = |p: &Path| {
        let text = p.to_string_lossy().replace('/', "\\");
        let text = text.trim_end_matches('\\').to_string();
        if cfg!(windows) {
            text.to_lowercase()
        } else {
            text
        }
    };
    let (file, dir) = (normalize(file), normalize(dir));
    let separator = if cfg!(windows) { '\\' } else { '/' };
    let dir = if cfg!(windows) {
        dir
    } else {
        dir.replace('\\', "/")
    };
    let file = if cfg!(windows) {
        file
    } else {
        file.replace('\\', "/")
    };
    file.len() > dir.len() + 1 && file.starts_with(&dir) && file[dir.len()..].starts_with(separator)
}

/// isSteamAppExecutable: the executable lives in the app's install directory
/// (also after resolving links).
pub fn is_steam_app_executable(app_id: &str, executable: &Path, libraries: &[PathBuf]) -> bool {
    let Some(dir) = app_install_directory(app_id, libraries) else {
        return false;
    };
    if !is_inside(executable, &dir) {
        return false;
    }
    match (
        std::fs::canonicalize(executable),
        std::fs::canonicalize(&dir),
    ) {
        (Ok(real_file), Ok(real_dir)) => {
            is_inside(&strip_verbatim(&real_file), &strip_verbatim(&real_dir))
        }
        _ => true,
    }
}

/// `\\?\C:\…` from canonicalize back to `C:\…`.
fn strip_verbatim(path: &Path) -> PathBuf {
    let text = path.to_string_lossy();
    match text.strip_prefix("\\\\?\\") {
        Some(rest) if !rest.starts_with("UNC\\") => PathBuf::from(rest),
        _ => path.to_path_buf(),
    }
}

/// isValidSteamAppId
pub fn is_valid_app_id(app_id: &str) -> bool {
    let bytes = app_id.as_bytes();
    !bytes.is_empty()
        && bytes.len() <= 10
        && bytes[0] != b'0'
        && bytes.iter().all(u8::is_ascii_digit)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_library_folders_and_manifests() {
        let vdf =
            "\"libraryfolders\"\n{\n\t\"0\"\n\t{\n\t\t\"path\"\t\t\"D:\\\\SteamLibrary\"\n\t}\n}\n";
        let folders = parse_library_folders(vdf);
        if cfg!(windows) {
            assert_eq!(folders, vec![PathBuf::from("D:\\SteamLibrary")]);
        }
        let acf = "\"AppState\"\n{\n\t\"appid\"\t\t\"2050650\"\n\t\"StateFlags\"\t\t\"4\"\n\t\"installdir\"\t\t\"RESIDENT EVIL 4  BIOHAZARD RE4\"\n}";
        assert_eq!(manifest_value(acf, "appid").as_deref(), Some("2050650"));
        assert_eq!(manifest_value(acf, "stateflags").as_deref(), Some("4"));
        assert_eq!(
            manifest_value(acf, "installdir").as_deref(),
            Some("RESIDENT EVIL 4  BIOHAZARD RE4")
        );
        assert_eq!(manifest_value(acf, "missing"), None);
    }

    #[cfg(windows)]
    #[test]
    fn checks_paths_inside_install_directories() {
        let dir = Path::new("C:\\Steam\\steamapps\\common\\Game");
        assert!(is_inside(
            Path::new("c:\\steam\\steamapps\\common\\game\\bin\\a.exe"),
            dir
        ));
        assert!(!is_inside(
            Path::new("C:\\Steam\\steamapps\\common\\Game2\\a.exe"),
            dir
        ));
        assert!(!is_inside(dir, dir));
    }

    #[test]
    fn validates_app_ids() {
        assert!(is_valid_app_id("2050650"));
        assert!(!is_valid_app_id("0123"));
        assert!(!is_valid_app_id("12345678901"));
        assert!(!is_valid_app_id("abc"));
    }
}
