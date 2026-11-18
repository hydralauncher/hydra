//! Adding games from disk: the installed-games scan
//! (events/library/scan-installed-games.ts, add-scanned-game.ts,
//! services/clear-missing-executables.ts) and custom games
//! (events/library/add-custom-game-to-library.ts).
//!
//! The scan walks the default game folders (or the picked ones), matches
//! file names against the API's executable catalogue, links library games
//! without an executable, and adds the games it finds outside the library.
//! Executables that could belong to several games come back as choices.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use hydra_db::{Db, keys};
use serde_json::{Map, Value, json};

use crate::api::{HydraApi, Options};
use crate::executables::{self, Known, Scope};
use crate::library_actions::{self, now_iso};
use crate::steam_apps;

type Obj = Map<String, Value>;

const SHOP: &str = "steam";
const UNNAMED_PATH_CANDIDATE_LIMIT: usize = 40;
const ASSET_LOOKUP_CONCURRENCY: usize = 8;
const LOCAL_CACHE_EXPIRATION_MS: i64 = 1000 * 60 * 60 * 8;

/// WINDOWS_GAME_DIRECTORIES
pub const WINDOWS_GAME_DIRECTORIES: [&str; 2] = [r"C:\Games", r"D:\Games"];

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct FoundGame {
    pub title: String,
    pub executable_path: String,
    pub icon_url: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Choice {
    pub object_id: String,
    pub title: String,
    pub icon_url: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Ambiguous {
    pub executable_path: String,
    pub choices: Vec<Choice>,
}

#[derive(Clone, Debug, Default)]
pub struct ScanResult {
    pub linked: Vec<FoundGame>,
    pub added: Vec<FoundGame>,
    pub ambiguous: Vec<Ambiguous>,
    pub total: usize,
}

#[derive(Debug)]
pub enum ScanError {
    /// game-executable-catalogue-unavailable
    CatalogueUnavailable,
}

impl std::fmt::Display for ScanError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("game-executable-catalogue-unavailable")
    }
}

struct Scanned {
    directory: PathBuf,
    relative: Vec<String>,
    /// lowercased file name -> relative paths (catalogue names only)
    by_name: HashMap<String, Vec<String>>,
}

/// normalizePath
fn normalize(value: &str) -> String {
    value.replace('\\', "/").to_lowercase()
}

fn display(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

/// fs.realpath without Windows' `\\?\` prefix.
fn real_path(path: &Path) -> Option<PathBuf> {
    let resolved = std::fs::canonicalize(path).ok()?;
    let text = display(&resolved);
    Some(match text.strip_prefix(r"\\?\") {
        Some(rest) if !rest.starts_with("UNC\\") => PathBuf::from(rest),
        Some(rest) => PathBuf::from(format!(r"\\{}", &rest[4..])),
        None => resolved,
    })
}

/// path.relative(parent, child) is inside (not equal, no `..`).
fn is_within(child: &Path, parent: &Path) -> bool {
    steam_apps::is_inside(child, parent)
}

fn list_files(root: &Path, cancel: &AtomicBool) -> Vec<String> {
    fn walk(root: &Path, dir: &Path, cancel: &AtomicBool, out: &mut Vec<String>) {
        if cancel.load(Ordering::Relaxed) {
            return;
        }
        let entries = match std::fs::read_dir(dir) {
            Ok(entries) => entries,
            Err(error) => {
                eprintln!(
                    "[ScanInstalledGames] Error reading folder {}: {error}",
                    dir.display()
                );
                return;
            }
        };
        for entry in entries.flatten() {
            let Ok(kind) = entry.file_type() else {
                continue;
            };
            let path = entry.path();
            if kind.is_dir() {
                if !executables::is_redistributable_directory(&entry.file_name().to_string_lossy())
                {
                    walk(root, &path, cancel, out);
                }
                continue;
            }
            if !kind.is_file() {
                continue;
            }
            if let Ok(relative) = path.strip_prefix(root) {
                let relative = display(relative);
                if !executables::is_redistributable_path(&relative) {
                    out.push(relative);
                }
            }
        }
    }
    let mut out = Vec::new();
    walk(root, root, cancel, &mut out);
    out
}

fn file_name_lower(relative: &str) -> String {
    relative
        .rsplit(['\\', '/'])
        .next()
        .unwrap_or(relative)
        .to_lowercase()
}

fn scan_directory(directory: PathBuf, names: &HashSet<String>, cancel: &AtomicBool) -> Scanned {
    let relative = list_files(&directory, cancel);
    let mut by_name: HashMap<String, Vec<String>> = HashMap::new();
    for path in &relative {
        let name = file_name_lower(path);
        if names.contains(&name) {
            by_name.entry(name).or_default().push(path.clone());
        }
    }
    Scanned {
        directory,
        relative,
        by_name,
    }
}

/// resolveScanRoots: real paths, no duplicates, none inside another.
fn resolve_roots(directories: &[PathBuf]) -> Vec<PathBuf> {
    let mut resolved: Vec<PathBuf> = Vec::new();
    for directory in directories {
        if let Some(real) = real_path(directory)
            && !resolved.contains(&real)
        {
            resolved.push(real);
        }
    }
    resolved
        .iter()
        .filter(|d| !resolved.iter().any(|o| is_within(d, o)))
        .cloned()
        .collect()
}

/// resolveWithinDirectory
fn resolve_within(executables: &[Known], scanned: &Scanned) -> Option<String> {
    let mut candidates: Vec<&String> = Vec::new();
    for executable in executables {
        if let Some(paths) = scanned.by_name.get(&executable.exe.to_lowercase()) {
            for path in paths {
                if !candidates.contains(&path) {
                    candidates.push(path);
                }
            }
        }
    }
    match candidates.len() {
        0 => None,
        1 => Some(display(&scanned.directory.join(candidates[0]))),
        _ => executables::rank(&scanned.relative, executables, Scope::Library)
            .map(|m| display(&scanned.directory.join(m))),
    }
}

fn resolve_path(executables: &[Known], scanned: &[Scanned]) -> Option<String> {
    scanned.iter().find_map(|s| resolve_within(executables, s))
}

/// toComparableSegments
fn comparable_segments(value: &str) -> Vec<String> {
    value
        .to_lowercase()
        .split(['\\', '/'])
        .map(|s| {
            s.chars()
                .filter(|c| c.is_ascii_alphanumeric())
                .collect::<String>()
        })
        .filter(|s| !s.is_empty())
        .collect()
}

/// endsWithKnownFolder
fn ends_with_known_folder(path: &str, name: &str) -> bool {
    let path = comparable_segments(path);
    let name = comparable_segments(name);
    if name.len() < 2 || name.len() > path.len() {
        return false;
    }
    path[path.len() - name.len()..] == name[..]
}

/// toComparableName
fn comparable_name(value: &str) -> String {
    value
        .to_lowercase()
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .collect()
}

/// namesTheFolder: a folder on the path is named after the title.
fn names_the_folder(path: &str, title: &str) -> bool {
    let wanted = comparable_name(title);
    if wanted.is_empty() {
        return false;
    }
    let segments = comparable_segments(path);
    segments[..segments.len().saturating_sub(1)]
        .iter()
        .any(|s| *s == wanted)
}

/// installationFolderOf: `<root>/<first folder>` of a normalized path.
fn installation_folder(normalized: &str, roots: &[String]) -> Option<String> {
    for root in roots {
        let Some(rest) = normalized.strip_prefix(&format!("{root}/")) else {
            continue;
        };
        let folder = rest.split('/').next().unwrap_or_default();
        return (!folder.is_empty()).then(|| format!("{root}/{folder}"));
    }
    None
}

#[derive(Clone)]
enum Lookup {
    Found(Choice),
    Missing,
    Failed,
}

fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

/// getGameAssets(objectId, "steam"): the 8h local cache, else the API (the
/// cached title wins over a renamed one, like the renderer's cache).
pub fn game_assets(db: &Db, api: &HydraApi, object_id: &str) -> Result<Option<Obj>, String> {
    let key = format!("{SHOP}:{object_id}");
    let cached: Option<Obj> = db.get_in(keys::GAME_SHOP_ASSETS, &key);
    if let Some(cached) = &cached
        && cached
            .get("updatedAt")
            .and_then(Value::as_i64)
            .is_some_and(|t| t + LOCAL_CACHE_EXPIRATION_MS > now_ms())
    {
        return Ok(Some(cached.clone()));
    }
    let assets = api
        .get(
            &format!("/games/{SHOP}/{object_id}/assets"),
            &[],
            Options::public(),
        )
        .map_err(|e| e.to_string())?;
    let Value::Object(mut assets) = assets else {
        return Ok(None);
    };
    let cached_title = cached
        .as_ref()
        .and_then(|c| c.get("title"))
        .and_then(Value::as_str)
        .filter(|t| !t.is_empty())
        .map(str::to_string);
    if let Some(title) = cached_title
        && assets.get("title").and_then(Value::as_str) != Some(title.as_str())
    {
        assets.insert("title".into(), json!(title));
    }
    assets.insert("updatedAt".into(), json!(now_ms()));
    let _ = db.put_in(keys::GAME_SHOP_ASSETS, &key, &assets);
    Ok(Some(assets))
}

fn str_of(obj: &Obj, key: &str) -> Option<String> {
    obj.get(key)
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
}

/// createChoiceResolver: cached lookups, 8 at a time, each retried once.
struct Choices {
    cache: Mutex<HashMap<String, Lookup>>,
}

impl Choices {
    fn new() -> Self {
        Choices {
            cache: Mutex::new(HashMap::new()),
        }
    }

    fn prefetch(&self, db: &Arc<Db>, api: &Arc<HydraApi>, ids: Vec<String>) {
        let missing: Vec<String> = {
            let cache = self.cache.lock().unwrap();
            let mut seen = HashSet::new();
            ids.into_iter()
                .filter(|id| !cache.contains_key(id) && seen.insert(id.clone()))
                .collect()
        };
        if missing.is_empty() {
            return;
        }
        let queue = Mutex::new(missing.into_iter());
        std::thread::scope(|scope| {
            for _ in 0..ASSET_LOOKUP_CONCURRENCY {
                scope.spawn(|| {
                    loop {
                        let Some(id) = queue.lock().unwrap().next() else {
                            break;
                        };
                        let result =
                            game_assets(db, api, &id).or_else(|_| game_assets(db, api, &id));
                        let lookup = match result {
                            Ok(Some(assets)) => match str_of(&assets, "title") {
                                Some(title) => Lookup::Found(Choice {
                                    object_id: id.clone(),
                                    title,
                                    icon_url: str_of(&assets, "iconUrl"),
                                }),
                                None => Lookup::Missing,
                            },
                            Ok(None) => Lookup::Missing,
                            Err(error) => {
                                eprintln!(
                                    "[ScanInstalledGames] Failed to fetch assets for {id}: {error}"
                                );
                                Lookup::Failed
                            }
                        };
                        self.cache.lock().unwrap().insert(id, lookup);
                    }
                });
            }
        });
    }

    /// readLookups
    fn read(&self, ids: &[String]) -> (Vec<Choice>, bool) {
        let cache = self.cache.lock().unwrap();
        let mut choices = Vec::new();
        let mut failed = false;
        for id in ids {
            match cache.get(id) {
                Some(Lookup::Found(choice)) => choices.push(choice.clone()),
                Some(Lookup::Failed) | None => failed = true,
                Some(Lookup::Missing) => {}
            }
        }
        (choices, failed)
    }
}

fn sorted_ids<'a>(ids: impl Iterator<Item = &'a String>) -> Vec<String> {
    let mut ids: Vec<String> = ids.cloned().collect();
    ids.sort_by(|a, b| {
        let (x, y) = (
            a.parse::<f64>().unwrap_or(f64::NAN),
            b.parse::<f64>().unwrap_or(f64::NAN),
        );
        x.partial_cmp(&y)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| a.cmp(b))
    });
    ids
}

/// Ordered map helpers (JS Map keeps insertion order).
#[derive(Default)]
struct PathMap {
    order: Vec<(String, String)>,
}

impl PathMap {
    fn has(&self, id: &str) -> bool {
        self.order.iter().any(|(k, _)| k == id)
    }
    fn set(&mut self, id: String, path: String) {
        if let Some(entry) = self.order.iter_mut().find(|(k, _)| *k == id) {
            entry.1 = path;
        } else {
            self.order.push((id, path));
        }
    }
}

fn find_outside_library(
    db: &Arc<Db>,
    api: &Arc<HydraApi>,
    scanned: &[Scanned],
    library_ids: &HashSet<String>,
    claimed: &HashSet<String>,
    cancel: &AtomicBool,
) -> (PathMap, Vec<Ambiguous>) {
    // groupObjectIdsByPath + partitionMatches
    let mut by_path: Vec<(String, Vec<String>)> = Vec::new();
    executables::with_catalog(|catalog| {
        for id in sorted_ids(catalog.keys()) {
            if cancel.load(Ordering::Relaxed) {
                break;
            }
            let Some(known) = catalog.get(&id).filter(|k| !k.is_empty()) else {
                continue;
            };
            let Some(path) = resolve_path(known, scanned) else {
                continue;
            };
            match by_path.iter_mut().find(|(p, _)| *p == path) {
                Some((_, ids)) => ids.push(id),
                None => by_path.push((path, vec![id])),
            }
        }
    });
    let mut paths = PathMap::default();
    let mut undecided: Vec<(String, Vec<String>)> = Vec::new();
    for (path, ids) in by_path {
        if claimed.contains(&normalize(&path)) {
            eprintln!("[ScanInstalledGames] Skipping {path}, another game already uses it");
            continue;
        }
        let owner = if ids.len() == 1 {
            Some(ids[0].clone())
        } else {
            // resolveOwner: the one game whose catalogue folder ends the path
            let matching: Vec<&String> = ids
                .iter()
                .filter(|id| {
                    executables::for_game(id)
                        .is_some_and(|k| k.iter().any(|e| ends_with_known_folder(&path, &e.name)))
                })
                .collect();
            (matching.len() == 1).then(|| matching[0].clone())
        };
        if let Some(id) = owner {
            if library_ids.contains(&id) {
                eprintln!("[ScanInstalledGames] Skipping {path}, {id} is already in the library");
                continue;
            }
            paths.set(id, path);
            continue;
        }
        let candidates = sorted_ids(ids.iter());
        if !candidates.is_empty() {
            undecided.push((path, candidates));
        }
    }

    let choices = Choices::new();
    choices.prefetch(
        db,
        api,
        undecided
            .iter()
            .flat_map(|(_, ids)| ids.iter().cloned())
            .collect(),
    );
    let mut ambiguous: Vec<Ambiguous> = Vec::new();
    for (path, ids) in &undecided {
        let (found, failed) = choices.read(ids);
        if failed {
            eprintln!(
                "[ScanInstalledGames] Skipping {path}, some of its {} candidate lookups failed",
                ids.len()
            );
            continue;
        }
        if found.is_empty() {
            continue;
        }
        let external: Vec<Choice> = found
            .iter()
            .filter(|c| !library_ids.contains(&c.object_id))
            .cloned()
            .collect();
        if external.is_empty() {
            continue;
        }
        if found.len() == 1 {
            let choice = &external[0];
            if !paths.has(&choice.object_id) {
                paths.set(choice.object_id.clone(), path.clone());
            }
            continue;
        }
        ambiguous.push(Ambiguous {
            executable_path: path.clone(),
            choices: external,
        });
    }

    // nameByFolder over the paths no catalogue entry could name alone.
    let mut taken: HashSet<String> = claimed.clone();
    taken.extend(paths.order.iter().map(|(_, p)| normalize(p)));
    taken.extend(ambiguous.iter().map(|a| normalize(&a.executable_path)));
    let mut ids_by_name: HashMap<String, Vec<String>> = HashMap::new();
    executables::with_catalog(|catalog| {
        for id in sorted_ids(catalog.keys()) {
            let mut names: Vec<String> =
                catalog[&id].iter().map(|e| e.exe.to_lowercase()).collect();
            names.dedup();
            let mut seen = HashSet::new();
            for name in names {
                if seen.insert(name.clone()) {
                    ids_by_name.entry(name).or_default().push(id.clone());
                }
            }
        }
    });
    let mut unnamed: Vec<(String, Vec<String>)> = Vec::new();
    let mut skipped: Vec<String> = Vec::new();
    for scanned_dir in scanned {
        let mut names: Vec<&String> = scanned_dir.by_name.keys().collect();
        names.sort();
        for name in names {
            let ids: Vec<String> = ids_by_name
                .get(name)
                .map(|ids| {
                    ids.iter()
                        .filter(|id| !library_ids.contains(*id))
                        .cloned()
                        .collect()
                })
                .unwrap_or_default();
            if ids.is_empty() {
                continue;
            }
            if ids.len() > UNNAMED_PATH_CANDIDATE_LIMIT {
                skipped.push(name.clone());
                continue;
            }
            for relative in &scanned_dir.by_name[name] {
                let path = display(&scanned_dir.directory.join(relative));
                if !taken.contains(&normalize(&path)) {
                    unnamed.push((path, ids.clone()));
                }
            }
        }
    }
    if !skipped.is_empty() {
        eprintln!(
            "[ScanInstalledGames] Not naming {} executable names claimed by more than {UNNAMED_PATH_CANDIDATE_LIMIT} games: {}",
            skipped.len(),
            skipped.join(", ")
        );
    }
    choices.prefetch(
        db,
        api,
        unnamed
            .iter()
            .flat_map(|(_, ids)| ids.iter().cloned())
            .collect(),
    );
    for (path, ids) in &unnamed {
        let (named, failed) = choices.read(ids);
        if failed {
            continue;
        }
        let matching: Vec<Choice> = named
            .into_iter()
            .filter(|c| names_the_folder(path, &c.title))
            .collect();
        match matching.len() {
            0 => {}
            1 => {
                if !paths.has(&matching[0].object_id) {
                    eprintln!(
                        "[ScanInstalledGames] {path} sits in a folder named after {}",
                        matching[0].title
                    );
                    paths.set(matching[0].object_id.clone(), path.clone());
                }
            }
            n => {
                eprintln!("[ScanInstalledGames] {path} sits in a folder naming {n} games");
                ambiguous.push(Ambiguous {
                    executable_path: path.clone(),
                    choices: matching,
                });
            }
        }
    }

    // Don't ask about a folder that already holds a game.
    let roots: Vec<String> = scanned
        .iter()
        .map(|s| normalize(&display(&s.directory)))
        .collect();
    let occupied: HashSet<String> = claimed
        .iter()
        .cloned()
        .chain(paths.order.iter().map(|(_, p)| normalize(p)))
        .filter_map(|c| installation_folder(&c, &roots))
        .collect();
    let mut unoccupied: Vec<Ambiguous> = ambiguous
        .into_iter()
        .filter(|m| {
            installation_folder(&normalize(&m.executable_path), &roots)
                .is_none_or(|f| !occupied.contains(&f))
        })
        .collect();
    unoccupied.sort_by(|a, b| a.executable_path.cmp(&b.executable_path));
    (paths, unoccupied)
}

/// updateGameExecutablePath
fn with_executable(mut game: Obj, path: &str) -> Obj {
    if game.get("executablePath").and_then(Value::as_str) != Some(path) {
        game.insert("executablePath".into(), json!(path));
        game.insert("executablePathUpdatedAt".into(), json!(now_iso()));
    }
    game
}

/// addGameOutsideLibrary: the game from its shop assets, with the found
/// executable, registered with the API.
pub fn add_outside_library(
    db: &Db,
    api: &HydraApi,
    object_id: &str,
    executable_path: &str,
) -> Option<FoundGame> {
    let assets = match game_assets(db, api, object_id) {
        Ok(assets) => assets,
        Err(error) => {
            eprintln!("[ScanInstalledGames] Failed to fetch assets for {object_id}: {error}");
            None
        }
    }?;
    let title = str_of(&assets, "title")?;
    let key = format!("{SHOP}:{object_id}");
    let existing: Option<Obj> = db.get_in(keys::GAMES, &key);
    let mut game = existing.clone().unwrap_or_default();
    let keep = |field: &str, fallback: Value| {
        existing
            .as_ref()
            .and_then(|e| e.get(field))
            .filter(|v| !v.is_null())
            .cloned()
            .unwrap_or(fallback)
    };
    game.insert("title".into(), keep("title", json!(title)));
    for field in ["iconUrl", "libraryHeroImageUrl", "logoImageUrl"] {
        game.insert(
            field.into(),
            assets.get(field).cloned().unwrap_or(Value::Null),
        );
    }
    game.insert("objectId".into(), json!(object_id));
    game.insert("shop".into(), json!(SHOP));
    game.insert("remoteId".into(), keep("remoteId", Value::Null));
    game.insert("isDeleted".into(), json!(false));
    game.insert(
        "playTimeInMilliseconds".into(),
        keep("playTimeInMilliseconds", json!(0)),
    );
    game.insert("lastTimePlayed".into(), keep("lastTimePlayed", Value::Null));
    game.insert(
        "addedToLibraryAt".into(),
        keep("addedToLibraryAt", json!(now_iso())),
    );
    game.insert("platform".into(), keep("platform", Value::Null));
    let game = with_executable(game, executable_path);
    db.put_in(keys::GAMES, &key, &game).ok()?;
    let _ = library_actions::create_game(db, api, &game);
    // TODO(achievements): AchievementWatcherManager.firstSyncWithRemoteIfNeeded
    eprintln!("[ScanInstalledGames] Added {object_id} to the library: {executable_path}");
    Some(FoundGame {
        title: str_of(&game, "title").unwrap_or(title),
        executable_path: executable_path.to_string(),
        icon_url: str_of(&game, "iconUrl"),
    })
}

/// addScannedGames: the picked choices.
pub fn add_picks(db: &Db, api: &HydraApi, picks: &[(String, String)]) -> Vec<FoundGame> {
    picks
        .iter()
        .filter_map(|(object_id, path)| add_outside_library(db, api, object_id, path))
        .collect()
}

/// isExecutableMissingFromAvailableStorage / isStaleSteamLibraryExecutable
fn executable_gone(path: &str, steam_libraries: &[PathBuf]) -> bool {
    let file = Path::new(path);
    if !file.is_absolute() || file.exists() {
        return false;
    }
    if let Some(library) = steam_libraries
        .iter()
        .find(|l| steam_apps::is_inside(file, &l.join("steamapps").join("common")))
    {
        return library.join("steamapps").exists();
    }
    if cfg!(windows) {
        return file.ancestors().last().is_some_and(Path::exists);
    }
    // The nearest existing folder, unless it is a mount container or empty
    // (an unplugged drive).
    let Some(ancestor) = file.ancestors().skip(1).find(|a| a.exists()) else {
        return false;
    };
    let text = display(ancestor);
    let container = text == "/"
        || ["/media", "/mnt", "/Volumes", "/run/media"].contains(&text.as_str())
        || (text.starts_with("/media/") && text[7..].split('/').count() == 1)
        || (text.starts_with("/run/media/") && text[11..].split('/').count() == 1);
    if container {
        return false;
    }
    std::fs::read_dir(ancestor).is_ok_and(|mut e| e.next().is_some())
}

/// clearMissingExecutables over the library (not custom or classics games).
fn clear_missing(db: &Db, games: &mut [(String, Obj)]) {
    let libraries = steam_apps::steam_location()
        .map(|s| steam_apps::library_folders(&s))
        .unwrap_or_default();
    let mut cleared = 0;
    for (key, game) in games.iter_mut() {
        let shop = game.get("shop").and_then(Value::as_str).unwrap_or_default();
        if shop == "custom" || shop == "launchbox" {
            continue;
        }
        let Some(path) = str_of(game, "executablePath") else {
            continue;
        };
        if !executable_gone(&path, &libraries) {
            continue;
        }
        let updated = library_actions::update_game_record(db, key, |current| {
            if current.get("executablePath").and_then(Value::as_str) == Some(path.as_str()) {
                current.insert("executablePath".into(), Value::Null);
                current.insert("executablePathUpdatedAt".into(), Value::Null);
                current.insert("installedSizeInBytes".into(), Value::Null);
            }
        });
        if let Ok(Some(updated)) = updated
            && updated.get("executablePath").is_none_or(Value::is_null)
        {
            eprintln!("[ClearMissingExecutables] Cleared missing executable for {key}: {path}");
            *game = updated;
            cleared += 1;
        }
    }
    if cleared > 0 {
        eprintln!("[ScanInstalledGames] Cleared {cleared} missing executables");
    }
}

/// runScan
pub fn run(
    db: &Arc<Db>,
    api: &Arc<HydraApi>,
    additional: &[PathBuf],
    include_defaults: bool,
    add_to_library: bool,
    downloads_path: Option<PathBuf>,
    cancel: &AtomicBool,
) -> Result<ScanResult, ScanError> {
    if !executables::ensure_loaded(api, true) {
        return Err(ScanError::CatalogueUnavailable);
    }
    let steam = if include_defaults {
        steam_apps::installed_games()
    } else {
        steam_apps::InstalledGames {
            executables: HashMap::new(),
            unresolved_directories: Vec::new(),
        }
    };
    let mut directories: Vec<PathBuf> = Vec::new();
    if include_defaults {
        directories.extend(WINDOWS_GAME_DIRECTORIES.iter().map(PathBuf::from));
        directories.extend(steam.unresolved_directories.iter().cloned());
        directories.extend(downloads_path);
    }
    directories.extend(additional.iter().cloned());

    // loadLibraryGames: stored, not deleted, not custom; missing executables cleared.
    let mut games: Vec<(String, Obj)> = db
        .entries::<Obj>(keys::GAMES)
        .unwrap_or_default()
        .into_iter()
        .filter(|(_, g)| {
            g.get("isDeleted").and_then(Value::as_bool) == Some(false)
                && g.get("shop").and_then(Value::as_str) != Some("custom")
        })
        .collect();
    clear_missing(db, &mut games);

    let names: HashSet<String> = executables::with_catalog(|catalog| {
        catalog
            .values()
            .flat_map(|list| list.iter().map(|e| e.exe.to_lowercase()))
            .collect()
    })
    .unwrap_or_default();
    let mut scanned: Vec<Scanned> = Vec::new();
    for root in resolve_roots(&directories) {
        if cancel.load(Ordering::Relaxed) {
            break;
        }
        scanned.push(scan_directory(root, &names, cancel));
    }
    for s in &scanned {
        eprintln!(
            "[ScanInstalledGames] Scanned {}: {} files, {} known executable names",
            s.directory.display(),
            s.relative.len(),
            s.by_name.len()
        );
    }

    let mut claimed: HashSet<String> = games
        .iter()
        .filter_map(|(_, g)| str_of(g, "executablePath"))
        .map(|p| normalize(&p))
        .collect();
    // linkLibraryGames
    let to_scan: Vec<&(String, Obj)> = games
        .iter()
        .filter(|(_, g)| str_of(g, "executablePath").is_none())
        .collect();
    let mut linked = Vec::new();
    for (key, game) in &to_scan {
        if cancel.load(Ordering::Relaxed) {
            break;
        }
        let shop = game.get("shop").and_then(Value::as_str).unwrap_or_default();
        let object_id = game
            .get("objectId")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let steam_path = (shop == SHOP)
            .then(|| steam.executables.get(object_id))
            .flatten()
            .filter(|p| !claimed.contains(&normalize(p)))
            .cloned();
        let found = steam_path.or_else(|| {
            executables::for_game(object_id).and_then(|known| resolve_path(&known, &scanned))
        });
        let Some(found) = found else {
            continue;
        };
        let _ = library_actions::update_game_record(db, key, |current| {
            if current.get("executablePath").and_then(Value::as_str) != Some(found.as_str()) {
                current.insert("executablePath".into(), json!(found));
                current.insert("executablePathUpdatedAt".into(), json!(now_iso()));
            }
        });
        // TODO(cloud save): runAutomaticCloudSaveSync(…, "environment-changed");
        // TODO(achievements): trackAchievementBatchGame
        eprintln!("[ScanInstalledGames] Found executable for {object_id}: {found}");
        linked.push(FoundGame {
            title: str_of(game, "title").unwrap_or_default(),
            executable_path: found.clone(),
            icon_url: str_of(game, "iconUrl"),
        });
        claimed.insert(normalize(&found));
    }

    let mut library_ids: HashSet<String> = games
        .iter()
        .filter(|(_, g)| g.get("shop").and_then(Value::as_str) == Some(SHOP))
        .filter_map(|(_, g)| str_of(g, "objectId"))
        .collect();
    // collectSteamGamesToAdd
    let mut to_add = PathMap::default();
    if add_to_library {
        let mut steam_ids: Vec<&String> = steam.executables.keys().collect();
        steam_ids.sort();
        for id in steam_ids {
            let path = &steam.executables[id];
            if library_ids.contains(id) || claimed.contains(&normalize(path)) {
                continue;
            }
            to_add.set(id.clone(), path.clone());
            library_ids.insert(id.clone());
            claimed.insert(normalize(path));
        }
    }
    let (outside, ambiguous) = if add_to_library && !cancel.load(Ordering::Relaxed) {
        find_outside_library(db, api, &scanned, &library_ids, &claimed, cancel)
    } else {
        (PathMap::default(), Vec::new())
    };
    for (id, path) in outside.order {
        to_add.set(id, path);
    }
    let added = if cancel.load(Ordering::Relaxed) {
        Vec::new()
    } else {
        to_add
            .order
            .iter()
            .filter_map(|(id, path)| add_outside_library(db, api, id, path))
            .collect()
    };
    eprintln!(
        "[ScanInstalledGames] Linked {} of {} games in the library, added {} new ones, {} need a choice",
        linked.len(),
        to_scan.len(),
        added.len(),
        ambiguous.len()
    );
    Ok(ScanResult {
        linked,
        added,
        ambiguous,
        total: to_scan.len(),
    })
}

/// getScanNotificationKeys: (title, description) keys in `notifications`.
pub fn notification_keys(
    added: usize,
    linked: usize,
    pending: usize,
) -> (&'static str, &'static str) {
    if added + linked > 0 {
        let description = if added > 0 && linked > 0 {
            "scan_games_complete_added_and_linked_description"
        } else if added > 0 {
            "scan_games_complete_added_description"
        } else {
            "scan_games_complete_linked_description"
        };
        return ("scan_games_complete_title", description);
    }
    if pending > 0 {
        return (
            "scan_games_complete_title",
            "scan_games_complete_pending_description",
        );
    }
    (
        "scan_games_no_results_title",
        "scan_games_no_results_description",
    )
}

#[derive(Debug, PartialEq, Eq)]
pub enum CustomGameError {
    /// "A game with this executable path already exists in your library"
    Duplicate,
    Db(String),
}

impl std::fmt::Display for CustomGameError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            CustomGameError::Duplicate => {
                f.write_str("A game with this executable path already exists in your library")
            }
            CustomGameError::Db(e) => f.write_str(e),
        }
    }
}

/// addCustomGameToLibrary (no artwork: the modal sends empty icon/logo/hero).
/// Returns (objectId, title).
pub fn add_custom_game(
    db: &Db,
    title: &str,
    executable_path: &str,
) -> Result<(String, String), CustomGameError> {
    let duplicate = db
        .entries::<Obj>(keys::GAMES)
        .unwrap_or_default()
        .into_iter()
        .any(|(_, g)| {
            g.get("executablePath").and_then(Value::as_str) == Some(executable_path)
                && g.get("isDeleted").and_then(Value::as_bool) != Some(true)
        });
    if duplicate {
        return Err(CustomGameError::Duplicate);
    }
    let object_id = uuid::Uuid::new_v4().to_string();
    let key = format!("custom:{object_id}");
    let assets = json!({
        "updatedAt": now_ms(),
        "objectId": object_id,
        "shop": "custom",
        "title": title,
        "iconUrl": null,
        "libraryHeroImageUrl": "",
        "libraryImageUrl": "",
        "logoImageUrl": "",
        "logoPosition": null,
        "coverImageUrl": "",
        "downloadSources": [],
    });
    db.put_in(keys::GAME_SHOP_ASSETS, &key, &assets)
        .map_err(|e| CustomGameError::Db(e.to_string()))?;
    let now = now_iso();
    let game = json!({
        "title": title,
        "iconUrl": null,
        "logoImageUrl": null,
        "libraryHeroImageUrl": null,
        "objectId": object_id,
        "shop": "custom",
        "remoteId": null,
        "isDeleted": false,
        "playTimeInMilliseconds": 0,
        "lastTimePlayed": null,
        "addedToLibraryAt": now,
        "executablePath": executable_path,
        "executablePathUpdatedAt": now,
        "launchOptions": null,
        "favorite": false,
        "automaticCloudSync": false,
        "hasManuallyUpdatedPlaytime": false,
    });
    db.put_in(keys::GAMES, &key, &game)
        .map_err(|e| CustomGameError::Db(e.to_string()))?;
    Ok((object_id, title.to_string()))
}

/// getGameTitleFromExecutablePath: the file name without its extension.
pub fn title_from_executable(path: &str) -> String {
    let name = path.rsplit(['\\', '/']).next().unwrap_or(path);
    match name.rfind('.') {
        Some(dot) if dot > 0 || name.len() > 1 => name[..dot].to_string(),
        _ => name.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn titles_from_executables() {
        assert_eq!(title_from_executable(r"C:\Games\Hades\Hades.exe"), "Hades");
        assert_eq!(title_from_executable("/opt/game/run.x86_64"), "run");
        assert_eq!(title_from_executable("/opt/game/start"), "start");
        assert_eq!(title_from_executable("a.b.exe"), "a.b");
    }

    #[test]
    fn folder_names() {
        assert!(names_the_folder(
            r"D:\Games\Hollow Knight\hollow_knight.exe",
            "Hollow Knight"
        ));
        assert!(!names_the_folder(
            r"D:\Games\Other\hollow_knight.exe",
            "Hollow Knight"
        ));
        assert!(!names_the_folder(
            r"D:\Games\hollowknight.exe",
            "hollowknight"
        ));
        assert!(ends_with_known_folder(
            r"D:\Games\Doom\base\doom.exe",
            "base\\doom.exe"
        ));
        assert!(!ends_with_known_folder(
            r"D:\Games\Doom\doom.exe",
            "doom.exe"
        ));
    }

    #[test]
    fn installation_folders() {
        let roots = vec!["d:/games".to_string()];
        assert_eq!(
            installation_folder("d:/games/hades/x/hades.exe", &roots).as_deref(),
            Some("d:/games/hades")
        );
        assert_eq!(installation_folder("e:/other/hades.exe", &roots), None);
    }

    #[test]
    fn notification_keys_follow_the_counts() {
        assert_eq!(
            notification_keys(1, 1, 0).1,
            "scan_games_complete_added_and_linked_description"
        );
        assert_eq!(
            notification_keys(0, 2, 0).1,
            "scan_games_complete_linked_description"
        );
        assert_eq!(
            notification_keys(0, 0, 3).1,
            "scan_games_complete_pending_description"
        );
        assert_eq!(notification_keys(0, 0, 0).0, "scan_games_no_results_title");
    }

    #[test]
    fn custom_games_refuse_duplicates() {
        let dir = tempfile::tempdir().unwrap();
        let db = Db::open(dir.path()).unwrap();
        let (id, title) = add_custom_game(&db, "My Game", r"C:\x\game.exe").unwrap();
        assert_eq!(title, "My Game");
        let stored: Obj = db.get_in(keys::GAMES, &format!("custom:{id}")).unwrap();
        assert_eq!(stored["shop"], "custom");
        assert_eq!(stored["executablePath"], r"C:\x\game.exe");
        assert_eq!(
            add_custom_game(&db, "Again", r"C:\x\game.exe"),
            Err(CustomGameError::Duplicate)
        );
    }

    #[test]
    fn scan_roots_drop_nested_folders() {
        let dir = tempfile::tempdir().unwrap();
        let inner = dir.path().join("inner");
        std::fs::create_dir_all(&inner).unwrap();
        let roots = resolve_roots(&[
            inner.clone(),
            dir.path().to_path_buf(),
            dir.path().join("missing"),
        ]);
        assert_eq!(roots.len(), 1);
        assert_eq!(roots[0], real_path(dir.path()).unwrap());
    }
}
