//! Finding a game's executable in its folder: the API's executable catalogue
//! (services/game-executables*.ts), the ranking that picks one file among
//! the candidates (helpers/game-executable-ranking.ts), the folder walk
//! (helpers/find-game-executable.ts) and binding the result to the game
//! (GameFilesManager.searchAndBindExecutable).

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use hydra_db::{Db, keys};
use serde_json::{Value, json};

use crate::api::{HydraApi, Options};
use crate::library_actions;

/// KnownGameExecutable: `name` is the lowercased path suffix from the
/// catalogue (backslashes on Windows), `exe` its file name.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Known {
    pub exe: String,
    pub name: String,
}

impl Known {
    pub fn new(name: &str) -> Known {
        let lowered = name.to_lowercase();
        let name = lowered.strip_prefix('>').unwrap_or(&lowered).to_string();
        let exe = name.rsplit('/').next().unwrap_or(&name).to_string();
        let name = if cfg!(windows) {
            name.replace('/', "\\")
        } else {
            name
        };
        Known { exe, name }
    }
}

/// normalizeGameExecutableCatalog: Windows keeps win32 entries, Linux keeps
/// linux and win32 (Wine), other platforms none.
pub fn normalize_catalog(response: &Value) -> HashMap<String, Vec<Known>> {
    let Some(map) = response.as_object() else {
        return HashMap::new();
    };
    map.iter()
        .map(|(object_id, list)| {
            let executables = list
                .as_array()
                .map(|a| {
                    a.iter()
                        .filter(|e| {
                            let os = e.get("os").and_then(Value::as_str).unwrap_or_default();
                            if cfg!(windows) {
                                os == "win32"
                            } else if cfg!(target_os = "linux") {
                                os == "linux" || os == "win32"
                            } else {
                                false
                            }
                        })
                        .filter_map(|e| e.get("name").and_then(Value::as_str).map(Known::new))
                        .collect()
                })
                .unwrap_or_default();
            (object_id.clone(), executables)
        })
        .collect()
}

const RETRY_DELAY: Duration = Duration::from_secs(30);

struct Store {
    catalog: HashMap<String, Vec<Known>>,
    retry_after: Option<Instant>,
}

static STORE: Mutex<Option<Store>> = Mutex::new(None);

fn store() -> std::sync::MutexGuard<'static, Option<Store>> {
    STORE.lock().unwrap_or_else(|e| e.into_inner())
}

/// GameExecutables.ensureLoaded: GET /catalogue/steam/executables once;
/// after a failure, wait 30s before trying again unless forced.
pub fn ensure_loaded(api: &HydraApi, force_retry: bool) -> bool {
    if let Some(store) = store().as_ref() {
        if !store.catalog.is_empty() {
            return true;
        }
        if !force_retry && store.retry_after.is_some_and(|t| Instant::now() < t) {
            return false;
        }
    }
    let catalog = api
        .get("/catalogue/steam/executables", &[], Options::public())
        .map(|response| normalize_catalog(&response))
        .unwrap_or_else(|e| {
            eprintln!("Failed to load game executable catalogue: {e}");
            HashMap::new()
        });
    let loaded = !catalog.is_empty();
    *store() = Some(Store {
        catalog,
        retry_after: (!loaded).then(|| Instant::now() + RETRY_DELAY),
    });
    loaded
}

/// GameExecutables.getExecutablesForGame
pub fn for_game(object_id: &str) -> Option<Vec<Known>> {
    store()
        .as_ref()?
        .catalog
        .get(object_id)
        .filter(|v| !v.is_empty())
        .cloned()
}

/// GameExecutables.getAllObjectIds / getExecutablesForGame over the whole
/// catalogue (the installed-games scan), without copying it.
pub fn with_catalog<R>(f: impl FnOnce(&HashMap<String, Vec<Known>>) -> R) -> Option<R> {
    store().as_ref().map(|s| f(&s.catalog))
}

/// isRedistributableDirectory
pub fn is_redistributable_directory(name: &str) -> bool {
    REDIST_DIRECTORIES.contains(&name.to_lowercase().as_str())
}

// ---- game-executable-ranking.ts

const REDIST_DIRECTORIES: &[&str] = &[
    "_commonredist",
    "commonredist",
    "steamworks shared",
    "redist",
    "redists",
    "_redist",
    "directx",
    "dotnet",
    "dotnetfx",
    "vcredist",
    "openal",
    "physx",
    "prerequisites",
    "prereq",
];
const REDIST_FILE_PREFIXES: &[&str] = &[
    "vcredist",
    "vc_redist",
    "dotnetfx",
    "dxsetup",
    "dxwebsetup",
    "directx",
    "oalinst",
    "xnafx",
    "physx",
    "ue3redist",
];
const SHARED_INSTALLER_PREFIXES: &[&str] = &[
    "uplayinstaller",
    "pbsvc",
    "pbsetup",
    "setup_battleye",
    "beservice",
    "social-club-setup",
    "easyanticheat",
    "dauservicesetup",
];
const SHARED_RUNTIME_FILES: &[&str] = &[
    "unitycrashhandler32.exe",
    "unitycrashhandler64.exe",
    "crashreportclient.exe",
    "crashpad_handler.exe",
    "unrealcefsubprocess.exe",
    "epicwebhelper.exe",
    "start_protected_game.exe",
    "javaw.exe",
    "java.exe",
    "dotnet.exe",
    "setup.exe",
];

fn segments(value: &str) -> Vec<String> {
    value
        .to_lowercase()
        .split(['\\', '/'])
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .collect()
}

fn basename(path: &str) -> Option<String> {
    segments(path).pop()
}

/// REDIST_FILE_PATTERN, including `ue[345]prereqsetup`
fn is_redist_file(name: &str) -> bool {
    REDIST_FILE_PREFIXES.iter().any(|p| name.starts_with(p))
        || (name.len() > 3
            && name.starts_with("ue")
            && matches!(name.as_bytes()[2], b'3' | b'4' | b'5')
            && name[3..].starts_with("prereqsetup"))
}

/// isThirdPartyInstallerPath
pub fn is_third_party_installer_path(path: &str) -> bool {
    let mut segs = segments(path);
    let name = segs.pop().unwrap_or_default();
    is_redist_file(&name)
        || SHARED_INSTALLER_PREFIXES
            .iter()
            .any(|p| name.starts_with(p))
        || segs
            .iter()
            .any(|s| REDIST_DIRECTORIES.contains(&s.as_str()))
}

/// isRedistributablePath
pub fn is_redistributable_path(path: &str) -> bool {
    is_third_party_installer_path(path)
        || basename(path).is_some_and(|b| SHARED_RUNTIME_FILES.contains(&b.as_str()))
}

fn directory_of(path: &str) -> String {
    let mut segs = segments(path);
    segs.pop();
    segs.join("/")
}

fn ends_with_segments(path: &str, suffix: &str) -> bool {
    let p = segments(path);
    let s = segments(suffix);
    s.len() <= p.len() && p[p.len() - s.len()..] == s[..]
}

fn is_nested_copy_of(path: &str, other: &str) -> bool {
    if path == other {
        return false;
    }
    let p = segments(path);
    let o = segments(other);
    o.len() < p.len() && p[p.len() - o.len()..] == o[..]
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Scope {
    Installation,
    Library,
}

/// rankExecutableCandidates: the relative path of the game's executable
/// among `files`, or None when nothing (or a tie) matches.
pub fn rank(files: &[String], executables: &[Known], scope: Scope) -> Option<String> {
    if scope == Scope::Library {
        return rank_across_installations(files, executables);
    }
    let mut indexes: HashMap<String, usize> = HashMap::new();
    for (i, e) in executables.iter().enumerate() {
        indexes.entry(e.exe.to_lowercase()).or_insert(i);
    }
    let candidates: Vec<&String> = files
        .iter()
        .filter(|f| {
            basename(f).is_some_and(|b| indexes.contains_key(&b)) && !is_redistributable_path(f)
        })
        .collect();
    if candidates.len() <= 1 {
        return candidates.first().map(|s| s.to_string());
    }
    let suffixes: Vec<&str> = executables
        .iter()
        .map(|e| e.name.as_str())
        .filter(|n| segments(n).len() > 1)
        .collect();
    let preferred: Vec<&String> = candidates
        .iter()
        .copied()
        .filter(|c| suffixes.iter().any(|s| ends_with_segments(c, s)))
        .collect();
    let pool = if preferred.is_empty() {
        candidates
    } else {
        preferred
    };
    if pool.len() == 1 {
        return Some(pool[0].clone());
    }
    let originals: Vec<&String> = pool
        .iter()
        .copied()
        .filter(|c| !pool.iter().any(|o| is_nested_copy_of(c, o)))
        .collect();
    let remaining = if originals.is_empty() {
        pool
    } else {
        originals
    };
    if remaining.len() == 1 {
        return Some(remaining[0].clone());
    }
    let mut counts: HashMap<String, usize> = HashMap::new();
    for f in files {
        if let Some(b) = basename(f) {
            *counts.entry(b).or_default() += 1;
        }
    }
    let unshared_siblings = |path: &str| {
        let dir = directory_of(path);
        files
            .iter()
            .filter(|f| {
                directory_of(f) == dir && basename(f).is_some_and(|b| counts.get(&b) == Some(&1))
            })
            .count() as i64
    };
    let score = |path: &str| -> [i64; 3] {
        [
            -unshared_siblings(path),
            segments(path).len() as i64,
            basename(path)
                .and_then(|b| indexes.get(&b).copied())
                .map_or(i64::MAX, |i| i as i64),
        ]
    };
    let mut ranked: Vec<(&String, [i64; 3])> = remaining.iter().map(|p| (*p, score(p))).collect();
    ranked.sort_by(|a, b| a.1.cmp(&b.1).then_with(|| a.0.cmp(b.0)));
    if ranked[0].1 == ranked[1].1 {
        return None;
    }
    Some(ranked[0].0.clone())
}

fn installation_of(path: &str) -> String {
    let segs = segments(path);
    if segs.len() > 1 {
        segs[0].clone()
    } else {
        String::new()
    }
}

fn strip_installation(path: &str, installation: &str) -> String {
    if installation.is_empty() {
        return path.to_string();
    }
    match path.find(['\\', '/']) {
        Some(i) => path[i + 1..].to_string(),
        None => path.to_string(),
    }
}

fn rank_across_installations(files: &[String], executables: &[Known]) -> Option<String> {
    let names: HashSet<String> = executables.iter().map(|e| e.exe.to_lowercase()).collect();
    let candidates: Vec<&String> = files
        .iter()
        .filter(|f| basename(f).is_some_and(|b| names.contains(&b)) && !is_redistributable_path(f))
        .collect();
    if candidates.is_empty() {
        return None;
    }
    let suffixes: Vec<&str> = executables
        .iter()
        .map(|e| e.name.as_str())
        .filter(|n| segments(n).len() > 1)
        .collect();
    let named: HashSet<String> = candidates
        .iter()
        .filter(|c| suffixes.iter().any(|s| ends_with_segments(c, s)))
        .map(|c| installation_of(c))
        .collect();
    let installations: HashSet<String> = if named.len() == 1 {
        named
    } else {
        candidates.iter().map(|c| installation_of(c)).collect()
    };
    if installations.len() != 1 {
        return None;
    }
    let installation = installations.into_iter().next().unwrap_or_default();
    let within: Vec<(String, String)> = files
        .iter()
        .filter(|f| installation_of(f) == installation)
        .map(|f| (f.clone(), strip_installation(f, &installation)))
        .collect();
    let scoped: Vec<String> = within.iter().map(|(_, s)| s.clone()).collect();
    let matched = rank(&scoped, executables, Scope::Installation)?;
    within
        .into_iter()
        .find(|(_, s)| *s == matched)
        .map(|(o, _)| o)
}

// ---- find-game-executable.ts

fn walk(root: &Path, dir: &Path, depth_left: Option<usize>, out: &mut Vec<String>) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let Ok(kind) = entry.file_type() else {
            continue;
        };
        let path = entry.path();
        if kind.is_file() {
            if let Ok(relative) = path.strip_prefix(root) {
                out.push(relative.to_string_lossy().into_owned());
            }
        } else if kind.is_dir() && depth_left != Some(0) {
            walk(root, &path, depth_left.map(|d| d - 1), out);
        }
    }
}

/// findGameExecutableInFolder
pub fn find_in_folder(
    folder: &Path,
    executables: &[Known],
    scope: Scope,
    max_depth: Option<usize>,
) -> Option<PathBuf> {
    if executables.is_empty() || !folder.is_dir() {
        return None;
    }
    let mut files = Vec::new();
    walk(folder, folder, max_depth, &mut files);
    rank(&files, executables, scope).map(|relative| folder.join(relative))
}

/// GameFilesManager.searchAndBindExecutable: when the game has no
/// executable yet, look for a known one in `<downloadPath>/<folderName>`
/// and save it. Returns the bound path.
pub fn search_and_bind(db: &Db, api: &HydraApi, shop: &str, object_id: &str) -> Option<String> {
    let key = format!("{shop}:{object_id}");
    let download: Value = db.get_in(keys::DOWNLOADS, &key)?;
    let game: Value = db.get_in(keys::GAMES, &key)?;
    if let Some(existing) = game
        .get("executablePath")
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
    {
        return Some(existing.to_string());
    }
    ensure_loaded(api, false);
    let executables = for_game(object_id)?;
    let folder_name = download
        .get("folderName")
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())?;
    let download_path = download
        .get("downloadPath")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let folder = Path::new(download_path).join(folder_name);
    let found = find_in_folder(&folder, &executables, Scope::Installation, None)?;
    bind(db, &key, &found.to_string_lossy())
}

/// bindExecutable: set executablePath unless one appeared meanwhile.
pub fn bind(db: &Db, key: &str, executable: &str) -> Option<String> {
    let mut bound = None;
    let updated = library_actions::update_game_record(db, key, |game| {
        if game
            .get("executablePath")
            .and_then(Value::as_str)
            .is_some_and(|s| !s.is_empty())
        {
            return;
        }
        game.insert("executablePath".into(), json!(executable));
        game.insert(
            "executablePathUpdatedAt".into(),
            json!(library_actions::now_iso()),
        );
        bound = Some(executable.to_string());
    })
    .ok()
    .flatten()?;
    if bound.is_some() {
        eprintln!("[GameFilesManager] Auto-detected executable for {key}: {executable}");
        // TODO(launch): cloud save sync ("environment-changed"), achievement
        // metadata export, desktop/start menu shortcuts (deep links first).
        return bound;
    }
    updated
        .get("executablePath")
        .and_then(Value::as_str)
        .map(str::to_string)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn files(list: &[&str]) -> Vec<String> {
        list.iter()
            .map(|s| s.replace('/', std::path::MAIN_SEPARATOR_STR))
            .collect()
    }

    #[test]
    fn picks_the_game_over_redists_and_crash_handlers() {
        let known = vec![Known::new("Game.exe"), Known::new("bin/win64/Game.exe")];
        let list = files(&[
            "_CommonRedist/vcredist/Game.exe",
            "Engine/Binaries/UnityCrashHandler64.exe",
            "bin/win64/Game.exe",
            "Game.exe",
        ]);
        assert_eq!(
            rank(&list, &known, Scope::Installation).as_deref(),
            Some(list[2].as_str())
        );
    }

    #[test]
    fn ties_bind_nothing() {
        let known = vec![Known::new("game.exe")];
        let list = files(&["a/game.exe", "b/game.exe"]);
        assert_eq!(rank(&list, &known, Scope::Installation), None);
    }

    #[test]
    fn single_candidate() {
        let known = vec![Known::new(">Game.exe")];
        assert_eq!(known[0].exe, "game.exe");
        let list = files(&["readme.txt", "Game.exe"]);
        assert_eq!(
            rank(&list, &known, Scope::Installation).as_deref(),
            Some("Game.exe")
        );
        assert!(is_redistributable_path("Redist/dxsetup.exe"));
        assert!(is_redistributable_path("UE4PrereqSetup_x64.exe"));
    }
}
