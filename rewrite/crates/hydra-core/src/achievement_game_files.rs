//! Achievement files the watcher finds next to a game or in emulator save
//! folders, on top of the shared crack folders in `achievement_files`:
//! game-directory.ts, find-steam-settings-directories.ts,
//! scan-game-directory-achievement-files.ts, scan-nested-achievement-files.ts,
//! find-nested-achievement-files.ts, findAchievementFileInSteamPath and
//! collect-game-achievement-files.ts.

use std::collections::{HashMap, HashSet};
use std::path::{Component, Path, PathBuf};
use std::time::{Duration, Instant};

use crate::achievement_files::{
    AchievementFile, Cracker, Folders, alternative_object_ids, emulator_save_folders, find_for_game,
};

pub const STEAM_SETTINGS_DIR_NAME: &str = "steam_settings";
pub const ACHIEVEMENTS_FILE_NAME: &str = "achievements.json";

const MAX_UPWARD_LEVELS: usize = 3;

const NESTED_EXECUTABLE_DIRS: [&str; 10] = [
    "bin", "bin32", "bin64", "binaries", "win32", "win64", "x64", "x86", "game", "runtime",
];

const GAME_ROOT_MARKER_DIRS: [&str; 4] = ["engine", "binaries", "content", "plugins"];

const GAME_ROOT_MARKER_FILES: [&str; 3] = ["steam_api.dll", "steam_api64.dll", "steam_appid.txt"];

/// find-game-root.ts UNSAFE_ROOTS
const UNSAFE_ROOTS: [&str; 12] = [
    "program files",
    "program files (x86)",
    "users",
    "windows",
    "system32",
    "appdata",
    "programdata",
    "steamapps",
    "common",
    "desktop",
    "documents",
    "downloads",
];

const WINDOWS_BINARY_DIR_NAMES: [&str; 3] = ["Win64", "Win32", "WinGDK"];
const UNITY_PLUGIN_DIR_NAMES: [&str; 2] = ["x86_64", "x86"];

/// find-steam-settings-directories.ts
const MAX_DEPTH: usize = 8;
const MAX_DIRECTORIES_VISITED: usize = 2000;
const COLD_CLIENT_DIR_NAME: &str = "coldclient";
const IGNORED_DIRS: [&str; 20] = [
    ".git",
    "audio",
    "config",
    "configs",
    "content",
    "data",
    "intermediate",
    "localization",
    "logs",
    "movies",
    "music",
    "pak",
    "paks",
    "saved",
    "saves",
    "shaders",
    "sound",
    "sounds",
    "textures",
    "videos",
];

/// find-game-directory-achievement-files.ts LOCATIONS_INTERVAL_IN_MS
const LOCATIONS_INTERVAL: Duration = Duration::from_secs(5 * 60);

struct Entry {
    name: String,
    is_dir: bool,
}

/// readDirectorySafe
fn read_dir(path: &Path) -> Option<Vec<Entry>> {
    let entries = std::fs::read_dir(path).ok()?;
    Some(
        entries
            .flatten()
            .map(|e| Entry {
                name: e.file_name().to_string_lossy().into_owned(),
                is_dir: e.file_type().map(|t| t.is_dir()).unwrap_or(false),
            })
            .collect(),
    )
}

fn is_file(path: &Path) -> bool {
    std::fs::metadata(path)
        .map(|m| m.is_file())
        .unwrap_or(false)
}

fn is_dir(path: &Path) -> bool {
    std::fs::metadata(path).map(|m| m.is_dir()).unwrap_or(false)
}

fn base_name(path: &Path) -> String {
    path.file_name()
        .map(|n| n.to_string_lossy().to_lowercase())
        .unwrap_or_default()
}

/// fs.realpath: canonical, without Windows' `\\?\` prefix.
fn real_path(path: &Path) -> Option<PathBuf> {
    let canonical = std::fs::canonicalize(path).ok()?;
    #[cfg(windows)]
    {
        let text = canonical.to_string_lossy();
        if let Some(rest) = text.strip_prefix(r"\\?\")
            && !rest.starts_with("UNC\\")
        {
            return Some(PathBuf::from(rest));
        }
    }
    Some(canonical)
}

/// path.resolve: absolute, with `.` and `..` folded.
fn resolve(path: &Path) -> PathBuf {
    let absolute = if path.is_absolute() {
        path.to_path_buf()
    } else {
        std::env::current_dir().unwrap_or_default().join(path)
    };
    let mut out = PathBuf::new();
    for component in absolute.components() {
        match component {
            Component::CurDir => {}
            Component::ParentDir => {
                out.pop();
            }
            other => out.push(other.as_os_str()),
        }
    }
    out
}

/// isUnsafePath: system folders, and folders right under a drive root.
pub fn is_unsafe_path(dir: &Path) -> bool {
    if UNSAFE_ROOTS.contains(&base_name(dir).as_str()) {
        return true;
    }
    // path.parse: dir === root (a folder right under the root) or the root itself
    match dir.parent() {
        None => true,
        Some(parent) => parent.parent().is_none(),
    }
}

fn has_game_root_marker(entries: &[Entry]) -> bool {
    entries.iter().any(|entry| {
        let name = entry.name.to_lowercase();
        if entry.is_dir {
            GAME_ROOT_MARKER_DIRS.contains(&name.as_str())
                || name.ends_with("_data")
                || name == STEAM_SETTINGS_DIR_NAME
        } else {
            GAME_ROOT_MARKER_FILES.contains(&name.as_str())
        }
    })
}

/// resolveGameSearchRoot: up to three levels above the executable's folder,
/// while the folder is a nested binaries folder or the parent looks like a game root.
pub fn resolve_game_search_root(executable: &Path) -> PathBuf {
    let mut root = executable
        .parent()
        .map(Path::to_path_buf)
        .unwrap_or_default();
    for _ in 0..MAX_UPWARD_LEVELS {
        let Some(parent) = root.parent().map(Path::to_path_buf) else {
            break;
        };
        if parent == root || is_unsafe_path(&parent) {
            break;
        }
        let Some(entries) = read_dir(&parent) else {
            break;
        };
        let nested = NESTED_EXECUTABLE_DIRS.contains(&base_name(&root).as_str());
        if !nested && !has_game_root_marker(&entries) {
            break;
        }
        root = parent;
    }
    root
}

fn subdirectory_layouts(root: &Path, name: &str) -> Vec<PathBuf> {
    let lower = name.to_lowercase();
    let mut dirs = Vec::new();
    if NESTED_EXECUTABLE_DIRS.contains(&lower.as_str()) {
        dirs.push(root.join(name));
    }
    for arch in WINDOWS_BINARY_DIR_NAMES {
        dirs.push(root.join(name).join("Binaries").join(arch));
    }
    if lower.ends_with("_data") {
        for arch in UNITY_PLUGIN_DIR_NAMES {
            dirs.push(root.join(name).join("Plugins").join(arch));
        }
    }
    dirs
}

fn steamworks_layouts(root: &Path) -> Vec<PathBuf> {
    let steamworks = root
        .join("Engine")
        .join("Binaries")
        .join("ThirdParty")
        .join("Steamworks");
    read_dir(&steamworks)
        .unwrap_or_default()
        .into_iter()
        .filter(|e| e.is_dir)
        .flat_map(|e| {
            let base = steamworks.join(&e.name);
            WINDOWS_BINARY_DIR_NAMES.map(|arch| base.join(arch))
        })
        .collect()
}

fn layout_directories(root: &Path) -> Vec<PathBuf> {
    let mut dirs: Vec<PathBuf> = read_dir(root)
        .unwrap_or_default()
        .into_iter()
        .filter(|e| e.is_dir)
        .flat_map(|e| subdirectory_layouts(root, &e.name))
        .collect();
    dirs.extend(steamworks_layouts(root));
    dirs
}

/// collectEmulatorDirectories: where an emulator DLL may sit for this executable.
pub fn collect_emulator_directories(executable: &Path) -> Vec<PathBuf> {
    let Some(executable_dir) = executable.parent() else {
        return Vec::new();
    };
    if is_unsafe_path(executable_dir) {
        return Vec::new();
    }
    let root = resolve_game_search_root(executable);
    let mut seen = HashSet::new();
    std::iter::once(executable_dir.to_path_buf())
        .chain(std::iter::once(root.clone()))
        .chain(layout_directories(&root))
        .map(|d| resolve(&d))
        .filter(|d| seen.insert(d.clone()))
        .collect()
}

/// resolveContainedDirectory: the real folder, only when it stays inside the root.
fn resolve_contained_directory(root: &Path, candidate: &Path) -> Option<PathBuf> {
    let resolved = real_path(candidate)?;
    (resolved.starts_with(root) && is_dir(&resolved)).then_some(resolved)
}

fn search_breadth_first(root: &Path) -> Vec<PathBuf> {
    let mut found = Vec::new();
    let mut level = vec![root.to_path_buf()];
    let mut visited = 0;
    for _ in 0..MAX_DEPTH {
        if level.is_empty() {
            break;
        }
        let mut next = Vec::new();
        for dir in &level {
            if visited >= MAX_DIRECTORIES_VISITED {
                break;
            }
            visited += 1;
            for entry in read_dir(dir).unwrap_or_default() {
                if !entry.is_dir {
                    continue;
                }
                let name = entry.name.to_lowercase();
                if name == STEAM_SETTINGS_DIR_NAME {
                    found.push(dir.join(&entry.name));
                } else if !IGNORED_DIRS.contains(&name.as_str()) {
                    next.push(dir.join(&entry.name));
                }
            }
        }
        if !found.is_empty() {
            break;
        }
        level = next;
    }
    found
}

/// findSteamSettingsDirectories: Goldberg's steam_settings folders for a game,
/// next to the emulator first, else the nearest ones under the game root.
pub fn find_steam_settings_directories(executable: &Path) -> Vec<PathBuf> {
    let Some(executable_dir) = executable.parent() else {
        return Vec::new();
    };
    if is_unsafe_path(executable_dir) {
        return Vec::new();
    }
    let Some(root) = real_path(&resolve_game_search_root(executable)) else {
        return Vec::new();
    };
    let mut dirs: Vec<PathBuf> = Vec::new();
    let push = |dirs: &mut Vec<PathBuf>, dir: PathBuf| {
        if !dirs.contains(&dir) {
            dirs.push(dir);
        }
    };
    for emulator_dir in collect_emulator_directories(executable) {
        for candidate in [
            emulator_dir.join(STEAM_SETTINGS_DIR_NAME),
            emulator_dir
                .join(COLD_CLIENT_DIR_NAME)
                .join(STEAM_SETTINGS_DIR_NAME),
        ] {
            if let Some(resolved) = resolve_contained_directory(&root, &candidate) {
                push(&mut dirs, resolved);
            }
        }
    }
    if !dirs.is_empty() {
        return dirs;
    }
    for dir in search_breadth_first(&root) {
        if let Some(resolved) = resolve_contained_directory(&root, &dir) {
            push(&mut dirs, resolved);
        }
    }
    dirs
}

/// GameDirectoryLocations
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Locations {
    pub bases: Vec<PathBuf>,
    pub steam_settings: Vec<PathBuf>,
}

/// resolveGameDirectoryLocations
pub fn resolve_locations(executable: &Path) -> Locations {
    Locations {
        bases: collect_emulator_directories(executable),
        steam_settings: find_steam_settings_directories(executable),
    }
}

enum Segment {
    Name(&'static str),
    /// ANY_PROFILE_DIR: every folder at this level
    AnyProfile,
}

/// RELATIVE_FILE_LOCATIONS
fn relative_locations() -> [(Cracker, Vec<Segment>); 3] {
    use Segment::*;
    [
        (
            Cracker::UserStats,
            vec![Name("SteamData"), Name("user_stats.ini")],
        ),
        (
            Cracker::ThreeDm,
            vec![
                Name("3DMGAME"),
                AnyProfile,
                Name("stats"),
                Name("achievements.ini"),
            ],
        ),
        (
            Cracker::Ali213,
            vec![
                Name("Profile"),
                AnyProfile,
                Name("Stats"),
                Name("Achievements.Bin"),
            ],
        ),
    ]
}

fn candidate_paths(base: &Path, segments: &[Segment]) -> Vec<PathBuf> {
    let Some(index) = segments
        .iter()
        .position(|s| matches!(s, Segment::AnyProfile))
    else {
        return vec![segments.iter().fold(base.to_path_buf(), |p, s| match s {
            Segment::Name(n) => p.join(n),
            Segment::AnyProfile => p,
        })];
    };
    let profiles = segments[..index]
        .iter()
        .fold(base.to_path_buf(), |p, s| match s {
            Segment::Name(n) => p.join(n),
            Segment::AnyProfile => p,
        });
    read_dir(&profiles)
        .unwrap_or_default()
        .into_iter()
        .filter(|e| e.is_dir)
        .map(|e| {
            segments[index + 1..]
                .iter()
                .fold(profiles.join(&e.name), |p, s| match s {
                    Segment::Name(n) => p.join(n),
                    Segment::AnyProfile => p,
                })
        })
        .collect()
}

/// findAchievementFilesInLocations
pub fn files_in_locations(locations: &Locations) -> Vec<AchievementFile> {
    let mut files = Vec::new();
    for base in &locations.bases {
        for (cracker, segments) in relative_locations() {
            for path in candidate_paths(base, &segments) {
                if is_file(&path) {
                    files.push(AchievementFile { cracker, path });
                }
            }
        }
    }
    for dir in &locations.steam_settings {
        for entry in read_dir(dir).unwrap_or_default() {
            if !entry.is_dir
                || entry.name.is_empty()
                || !entry.name.bytes().all(|b| b.is_ascii_digit())
            {
                continue;
            }
            let path = dir.join(&entry.name).join(ACHIEVEMENTS_FILE_NAME);
            if is_file(&path) {
                files.push(AchievementFile {
                    cracker: Cracker::Goldberg,
                    path,
                });
            }
        }
    }
    files
}

/// createThrottledCache over resolveGameDirectoryLocations, per executable.
/// Synchronous here: a stale entry is recomputed on the caller's (watcher) thread.
#[derive(Default)]
pub struct LocationsCache {
    entries: HashMap<PathBuf, (Instant, Locations)>,
}

impl LocationsCache {
    pub fn get(&mut self, executable: &Path) -> Locations {
        if let Some((at, locations)) = self.entries.get(executable)
            && at.elapsed() < LOCATIONS_INTERVAL
        {
            return locations.clone();
        }
        let locations = resolve_locations(executable);
        self.entries.insert(
            executable.to_path_buf(),
            (Instant::now(), locations.clone()),
        );
        locations
    }
}

/// findGameDirectoryAchievementFiles
pub fn game_directory_files(
    executable: Option<&Path>,
    cache: &mut LocationsCache,
) -> Vec<AchievementFile> {
    match executable {
        Some(exe) => files_in_locations(&cache.get(exe)),
        None => Vec::new(),
    }
}

/// scanObjectIdFolder: `achievements.json` in the folder and in each subfolder.
fn scan_object_id_folder(path: &Path) -> Vec<PathBuf> {
    let Some(entries) = read_dir(path) else {
        return Vec::new();
    };
    let find = |entries: &[Entry], dir: &Path| {
        entries
            .iter()
            .find(|e| !e.is_dir && e.name.to_lowercase() == ACHIEVEMENTS_FILE_NAME)
            .map(|e| dir.join(&e.name))
    };
    let mut files: Vec<PathBuf> = find(&entries, path).into_iter().collect();
    for entry in entries.iter().filter(|e| e.is_dir) {
        let sub = path.join(&entry.name);
        if let Some(sub_entries) = read_dir(&sub)
            && let Some(file) = find(&sub_entries, &sub)
        {
            files.push(file);
        }
    }
    files
}

/// findNestedAchievementFiles: Goldberg/GSE save folders scanned one level deep.
pub fn find_nested(folders: &Folders) -> HashMap<String, Vec<AchievementFile>> {
    let mut found: HashMap<String, Vec<AchievementFile>> = HashMap::new();
    for save_folder in emulator_save_folders(folders) {
        for entry in read_dir(&save_folder).unwrap_or_default() {
            if !entry.is_dir {
                continue;
            }
            let files = scan_object_id_folder(&save_folder.join(&entry.name));
            if !files.is_empty() {
                found
                    .entry(entry.name.clone())
                    .or_default()
                    .extend(files.into_iter().map(|path| AchievementFile {
                        cracker: Cracker::Goldberg,
                        path,
                    }));
            }
        }
    }
    found
}

/// The Steam client's install and its user folders (getSteamLocation, getSteamUsersIds).
#[derive(Clone, Debug, Default)]
pub struct SteamInstall {
    pub path: Option<PathBuf>,
    pub user_ids: Vec<String>,
}

impl SteamInstall {
    pub fn at(path: Option<PathBuf>) -> Self {
        let user_ids = path
            .as_ref()
            .and_then(|p| read_dir(&p.join("userdata")))
            .unwrap_or_default()
            .into_iter()
            .filter(|e| e.is_dir)
            // Number(dir.name)
            .filter_map(|e| e.name.trim().parse::<u64>().ok().map(|n| n.to_string()))
            .collect();
        Self { path, user_ids }
    }

    /// findAchievementFileInSteamPath: userdata/<id>/config/librarycache/<appid>.json
    pub fn library_cache_files(&self, object_id: &str) -> Vec<AchievementFile> {
        let Some(path) = &self.path else {
            return Vec::new();
        };
        self.user_ids
            .iter()
            .map(|id| {
                path.join("userdata")
                    .join(id)
                    .join("config")
                    .join("librarycache")
                    .join(format!("{object_id}.json"))
            })
            .filter(|p| p.exists())
            .map(|path| AchievementFile {
                cracker: Cracker::Steam,
                path,
            })
            .collect()
    }
}

/// Where a game's files are looked for.
pub struct GameFilesQuery<'a> {
    pub shop: &'a str,
    pub object_id: &'a str,
    /// resolveGameExecutablePath
    pub executable: Option<&'a Path>,
    /// The shared folders for this game (Windows, or its Wine prefix).
    pub folders: &'a Folders,
    /// enableSteamAchievements
    pub steam: Option<&'a SteamInstall>,
    /// findAllAchievementFiles, computed once per tick on Windows.
    pub static_files: Option<&'a HashMap<String, Vec<AchievementFile>>>,
    /// findNestedAchievementFiles, computed once per tick on Windows.
    pub nested_files: Option<&'a HashMap<String, Vec<AchievementFile>>>,
}

/// collectGameAchievementFiles (Steam games only), deduplicated by type and path.
pub fn collect_game_files(
    query: &GameFilesQuery,
    cache: &mut LocationsCache,
) -> Vec<AchievementFile> {
    if query.shop != "steam" {
        return Vec::new();
    }
    let ids = alternative_object_ids(query.object_id);
    let mut files: Vec<AchievementFile> = match query.static_files {
        Some(map) => ids
            .iter()
            .flat_map(|id| map.get(id).cloned().unwrap_or_default())
            .collect(),
        None => find_for_game(query.object_id, query.folders),
    };
    let computed;
    let nested = match query.nested_files {
        Some(map) => map,
        None => {
            computed = find_nested(query.folders);
            &computed
        }
    };
    for id in &ids {
        files.extend(nested.get(id).cloned().unwrap_or_default());
    }
    files.extend(game_directory_files(query.executable, cache));
    if let Some(steam) = query.steam {
        files.extend(steam.library_cache_files(query.object_id));
    }
    // dedupeAchievementFiles: one entry per type:path, in first-seen order
    let mut seen = HashSet::new();
    files.retain(|f| seen.insert((f.cracker, f.path.clone())));
    files
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("hydra-game-files-{name}"));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn touch(path: &Path) {
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, "{}").unwrap();
    }

    #[test]
    fn unsafe_paths() {
        assert!(is_unsafe_path(Path::new("/")));
        assert!(is_unsafe_path(Path::new("/games")));
        assert!(is_unsafe_path(Path::new("/x/Program Files")));
        assert!(is_unsafe_path(Path::new("/x/steamapps/common")));
        assert!(!is_unsafe_path(Path::new("/games/Portal")));
    }

    #[test]
    fn finds_relative_and_steam_settings_files() {
        let root = temp("relative");
        let game = root.join("Portal");
        let exe = game.join("Binaries").join("Win64").join("game.exe");
        touch(&exe);
        touch(&game.join("steam_api64.dll"));
        // a nested executable folder climbs to the game root
        assert_eq!(real_path(&resolve_game_search_root(&exe)), real_path(&game));
        touch(&game.join("SteamData").join("user_stats.ini"));
        touch(
            &game
                .join("3DMGAME")
                .join("player")
                .join("stats")
                .join("achievements.ini"),
        );
        touch(
            &game
                .join("steam_settings")
                .join("480")
                .join("achievements.json"),
        );
        // folders that aren't app ids are skipped
        touch(
            &game
                .join("steam_settings")
                .join("mods")
                .join("achievements.json"),
        );
        let files = files_in_locations(&resolve_locations(&exe));
        let kinds: Vec<Cracker> = files.iter().map(|f| f.cracker).collect();
        assert!(kinds.contains(&Cracker::UserStats));
        assert!(kinds.contains(&Cracker::ThreeDm));
        assert_eq!(
            files
                .iter()
                .filter(|f| f.cracker == Cracker::Goldberg)
                .count(),
            1
        );
    }

    #[test]
    fn breadth_first_search_finds_deep_steam_settings() {
        let root = temp("bfs");
        let game = root.join("Portal");
        let exe = game.join("game.exe");
        touch(&exe);
        touch(&game.join("steam_appid.txt"));
        touch(
            &game
                .join("deep")
                .join("er")
                .join("steam_settings")
                .join("10")
                .join("achievements.json"),
        );
        // ignored folders are not searched
        touch(
            &game
                .join("saves")
                .join("steam_settings")
                .join("11")
                .join("achievements.json"),
        );
        let dirs = find_steam_settings_directories(&exe);
        assert_eq!(dirs.len(), 1);
        assert!(dirs[0].ends_with("steam_settings"));
    }

    #[test]
    fn nested_save_folders_and_dedupe() {
        let root = temp("nested");
        let folders = Folders::wine(&root, "user");
        let gse = folders.app_data.join("GSE Saves").join("440");
        touch(&gse.join("achievements.json"));
        touch(&gse.join("profile").join("Achievements.json"));
        let nested = find_nested(&folders);
        assert_eq!(nested.get("440").map(Vec::len), Some(2));
        let mut cache = LocationsCache::default();
        let files = collect_game_files(
            &GameFilesQuery {
                shop: "steam",
                object_id: "440",
                executable: None,
                folders: &folders,
                steam: None,
                static_files: None,
                nested_files: None,
            },
            &mut cache,
        );
        // the shared-folder file and the nested scan find the same achievements.json once
        assert_eq!(files.len(), 2);
        let epic = collect_game_files(
            &GameFilesQuery {
                shop: "epic",
                object_id: "440",
                executable: None,
                folders: &folders,
                steam: None,
                static_files: None,
                nested_files: None,
            },
            &mut cache,
        );
        assert!(epic.is_empty());
    }

    #[test]
    fn steam_library_cache() {
        let root = temp("steam");
        touch(
            &root
                .join("userdata")
                .join("123")
                .join("config")
                .join("librarycache")
                .join("620.json"),
        );
        std::fs::create_dir_all(root.join("userdata").join("anonymous")).unwrap();
        let steam = SteamInstall::at(Some(root));
        assert_eq!(steam.user_ids, ["123"]);
        assert_eq!(steam.library_cache_files("620").len(), 1);
        assert!(steam.library_cache_files("621").is_empty());
    }
}
