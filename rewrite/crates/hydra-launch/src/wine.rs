//! services/wine.ts + wine-prefix.ts: where each game's Wine prefix lives on
//! Linux, and whether a folder is a usable prefix.
//!
//! Electron keeps prefixes in `<userData>/wine-prefixes/<objectId>` unless the
//! user picked another root (`defaultWinePrefixPath`) or a prefix per game
//! (`game.winePrefixPath`). The rewrite has its own userData folder, so a game
//! whose prefix only exists in Electron's folder keeps using that one: the
//! prefix holds the game's saves, and the game files themselves are shared by
//! both apps too.

use std::path::{Component, Path, PathBuf};

use serde_json::{Map, Value};

fn text<'a>(map: Option<&'a Map<String, Value>>, key: &str) -> Option<&'a str> {
    map?.get(key)?.as_str().filter(|s| !s.is_empty())
}

/// getBuiltInDefaultPrefixPath: `<userData>/wine-prefixes` (Linux only).
fn built_in_root(user_data: &Path) -> Option<PathBuf> {
    cfg!(target_os = "linux").then(|| user_data.join("wine-prefixes"))
}

/// The folders a prefix may be found in, in order: the rewrite's own
/// userData, then Electron's (read for migration, never created there).
#[derive(Clone, Debug)]
pub struct Roots {
    pub user_data: PathBuf,
    pub electron_user_data: Option<PathBuf>,
}

impl Roots {
    /// The app's folders (HYDRA_USER_DATA / HYDRA_ELECTRON_USER_DATA apply).
    pub fn current() -> Option<Roots> {
        Some(Roots {
            user_data: hydra_db::paths::native_user_data()?,
            electron_user_data: hydra_db::paths::electron_user_data(),
        })
    }
}

/// Wine.getDefaultPrefixPath: the configured root, else the built-in one.
pub fn default_root(roots: &Roots, prefs: Option<&Map<String, Value>>) -> Option<PathBuf> {
    text(prefs, "defaultWinePrefixPath")
        .map(PathBuf::from)
        .or_else(|| built_in_root(&roots.user_data))
}

/// Wine.getDefaultPrefixPathForGame
pub fn default_prefix_for_game(
    roots: &Roots,
    prefs: Option<&Map<String, Value>>,
    object_id: &str,
) -> Option<PathBuf> {
    if let Some(root) = text(prefs, "defaultWinePrefixPath") {
        return Some(Path::new(root).join(object_id));
    }
    let own = built_in_root(&roots.user_data)?.join(object_id);
    if own.exists() {
        return Some(own);
    }
    // A prefix Electron already made for this game (its saves live there).
    let electron = roots
        .electron_user_data
        .as_deref()
        .and_then(built_in_root)
        .map(|root| root.join(object_id))
        .filter(|p| p.exists());
    Some(electron.unwrap_or(own))
}

/// Wine.getLegacyDefaultPrefixPath: `<userData>/wine-prefix` (one shared prefix).
fn legacy_prefix(roots: &Roots) -> Option<PathBuf> {
    if !cfg!(target_os = "linux") {
        return None;
    }
    std::iter::once(roots.user_data.join("wine-prefix"))
        .chain(
            roots
                .electron_user_data
                .as_ref()
                .map(|d| d.join("wine-prefix")),
        )
        .find(|p| p.exists())
}

/// Wine.getEffectivePrefixPath: the game's own prefix, else the default one
/// for its id, else (no id) the legacy shared prefix when it exists.
pub fn effective_prefix(
    roots: &Roots,
    prefs: Option<&Map<String, Value>>,
    game_prefix: Option<&str>,
    object_id: Option<&str>,
) -> Option<PathBuf> {
    if let Some(prefix) = game_prefix.filter(|p| !p.is_empty()) {
        return Some(PathBuf::from(prefix));
    }
    match object_id.filter(|id| !id.is_empty()) {
        Some(id) => default_prefix_for_game(roots, prefs, id),
        None => legacy_prefix(roots),
    }
}

/// path.resolve without touching the disk: absolute, `.` and `..` folded.
fn lexical_absolute(path: &Path) -> PathBuf {
    let absolute = if path.is_absolute() {
        path.to_path_buf()
    } else {
        std::env::current_dir().unwrap_or_default().join(path)
    };
    let mut out = PathBuf::new();
    for component in absolute.components() {
        match component {
            Component::ParentDir => {
                out.pop();
            }
            Component::CurDir => {}
            other => out.push(other.as_os_str()),
        }
    }
    out
}

/// resolveWinePrefixPath: `~` expanded, then the real path; a prefix that
/// doesn't exist yet keeps its missing tail under the real path of the
/// deepest folder that does.
pub fn resolve_prefix_path(prefix: &str, home: &Path) -> PathBuf {
    let expanded = if prefix == "~" {
        home.to_path_buf()
    } else if let Some(rest) = prefix.strip_prefix("~/") {
        home.join(rest)
    } else {
        PathBuf::from(prefix)
    };
    let absolute = lexical_absolute(&expanded);
    if let Ok(real) = absolute.canonicalize() {
        return real;
    }
    let mut missing = Vec::new();
    let mut existing = absolute.clone();
    while !existing.exists() {
        let Some(parent) = existing.parent().map(Path::to_path_buf) else {
            break;
        };
        if let Some(name) = existing.file_name() {
            missing.push(name.to_os_string());
        }
        existing = parent;
    }
    let mut base = existing.canonicalize().unwrap_or(existing);
    for segment in missing.into_iter().rev() {
        base.push(segment);
    }
    base
}

/// Wine.validatePrefix: the files and folders `wineboot` creates (the folders
/// checked with lstat, so a symlink doesn't count).
pub fn validate_prefix(prefix: &Path) -> bool {
    ["system.reg", "user.reg", "userdef.reg"]
        .iter()
        .all(|f| prefix.join(f).exists())
        && ["dosdevices", "drive_c"]
            .iter()
            .all(|d| std::fs::symlink_metadata(prefix.join(d)).is_ok_and(|m| m.is_dir()))
}

/// The user's home folder (SystemPath.getPath("home")).
pub fn home() -> PathBuf {
    std::env::var_os("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("/"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("hydra-wine-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn resolves_home_and_missing_tails() {
        let dir = scratch("resolve");
        let home = dir.join("home");
        std::fs::create_dir_all(&home).unwrap();
        let real_home = home.canonicalize().unwrap();
        assert_eq!(resolve_prefix_path("~", &home), real_home);
        assert_eq!(
            resolve_prefix_path("~/prefixes/123", &home),
            real_home.join("prefixes").join("123")
        );
        let odd = format!("{}/a/../b/./c", dir.display());
        assert_eq!(
            resolve_prefix_path(&odd, &home),
            dir.canonicalize().unwrap().join("b").join("c")
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn validates_prefix_layout() {
        let dir = scratch("validate");
        assert!(!validate_prefix(&dir));
        for f in ["system.reg", "user.reg", "userdef.reg"] {
            std::fs::write(dir.join(f), "").unwrap();
        }
        std::fs::create_dir_all(dir.join("drive_c")).unwrap();
        assert!(!validate_prefix(&dir));
        std::fs::create_dir_all(dir.join("dosdevices")).unwrap();
        assert!(validate_prefix(&dir));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn effective_prefix_order() {
        use serde_json::json;
        let dir = scratch("effective");
        let roots = Roots {
            user_data: dir.join("native"),
            electron_user_data: Some(dir.join("electron")),
        };
        // the game's own prefix wins
        assert_eq!(
            effective_prefix(&roots, None, Some("/custom"), Some("1")),
            Some(PathBuf::from("/custom"))
        );
        // the default for the game: the rewrite's folder...
        assert_eq!(
            effective_prefix(&roots, None, None, Some("1")),
            Some(dir.join("native/wine-prefixes/1"))
        );
        // ...unless only Electron made one
        std::fs::create_dir_all(dir.join("electron/wine-prefixes/1")).unwrap();
        assert_eq!(
            effective_prefix(&roots, None, None, Some("1")),
            Some(dir.join("electron/wine-prefixes/1"))
        );
        std::fs::create_dir_all(dir.join("native/wine-prefixes/1")).unwrap();
        assert_eq!(
            effective_prefix(&roots, None, None, Some("1")),
            Some(dir.join("native/wine-prefixes/1"))
        );
        // a configured root
        let prefs = json!({ "defaultWinePrefixPath": "/root" });
        assert_eq!(
            effective_prefix(&roots, prefs.as_object(), None, Some("1")),
            Some(PathBuf::from("/root/1"))
        );
        // no id: the legacy prefix, only when it exists
        assert_eq!(effective_prefix(&roots, None, None, None), None);
        std::fs::create_dir_all(dir.join("electron/wine-prefix")).unwrap();
        assert_eq!(
            effective_prefix(&roots, None, None, None),
            Some(dir.join("electron/wine-prefix"))
        );
        let _ = std::fs::remove_dir_all(&dir);
    }
}
