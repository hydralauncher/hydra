//! Installed Steam games on this machine: the Steam folder and its library
//! folders (services/steam.ts getSteamLocation / getSteamLibraryFolders),
//! the app manifests (steam-integration/steam-installation-core.ts) and the
//! launch executables from `appcache/appinfo.vdf`
//! (steam-integration/steam-app-info-core.ts, steam-launch-executables.ts).

use std::collections::{HashMap, HashSet};
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Component, Path, PathBuf};

/// getSteamLocation
pub fn steam_location() -> Option<PathBuf> {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        let output = std::process::Command::new("reg")
            .args(["query", r"HKCU\Software\Valve\Steam", "/v", "SteamPath"])
            .creation_flags(CREATE_NO_WINDOW)
            .output()
            .ok()?;
        let text = String::from_utf8_lossy(&output.stdout);
        // path.join normalizes the registry's forward slashes.
        parse_reg_value(&text, "SteamPath").map(|p| PathBuf::from(p.replace('/', "\\")))
    }
    #[cfg(target_os = "macos")]
    {
        let home = std::env::var_os("HOME")?;
        Some(PathBuf::from(home).join("Library/Application Support/Steam"))
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        let home = PathBuf::from(std::env::var_os("HOME")?);
        let candidates = [
            home.join(".steam/steam"),
            home.join(".local/share/Steam"),
            home.join(".var/app/com.valvesoftware.Steam/.local/share/Steam"),
            home.join("snap/steam/common/.local/share/Steam"),
        ];
        candidates
            .iter()
            .find(|p| p.exists())
            .cloned()
            .or_else(|| candidates.first().cloned())
    }
}

/// The value of `name` in `reg query` output (`    SteamPath    REG_SZ    c:/program files (x86)/steam`).
pub fn parse_reg_value(output: &str, name: &str) -> Option<String> {
    output.lines().find_map(|line| {
        let line = line.trim();
        let rest = line.strip_prefix(name)?;
        let rest = rest.trim_start();
        let rest = rest
            .strip_prefix("REG_SZ")
            .or_else(|| rest.strip_prefix("REG_EXPAND_SZ"))?;
        let value = rest.trim();
        (!value.is_empty()).then(|| value.to_string())
    })
}

/// parseLibraryFolderPaths: every `"path"` value and numbered entry that is
/// an absolute path.
pub fn parse_library_folder_paths(content: &str) -> Vec<String> {
    let mut values = Vec::new();
    let mut paths = Vec::new();
    let mut numbered = Vec::new();
    let tokens = quoted_tokens(content);
    for pair in tokens.windows(2) {
        let (key, value) = (&pair[0], &pair[1]);
        if key == "path" {
            paths.push(value.replace("\\\\", "\\"));
        } else if !key.is_empty() && key.chars().all(|c| c.is_ascii_digit()) {
            numbered.push(value.replace("\\\\", "\\"));
        }
    }
    values.extend(paths);
    values.extend(numbered);
    values.into_iter().filter(|v| is_absolute(v)).collect()
}

/// Every `"…"` token in order (no escapes: libraryfolders.vdf doubles its
/// backslashes, which the caller undoes like the regex version).
fn quoted_tokens(content: &str) -> Vec<String> {
    let mut tokens = Vec::new();
    let mut rest = content;
    while let Some(start) = rest.find('"') {
        let after = &rest[start + 1..];
        let Some(end) = after.find('"') else { break };
        tokens.push(after[..end].to_string());
        rest = &after[end + 1..];
    }
    tokens
}

fn is_absolute(value: &str) -> bool {
    let bytes = value.as_bytes();
    value.starts_with('/')
        || value.starts_with("\\\\")
        || (bytes.len() > 2
            && bytes[0].is_ascii_alphabetic()
            && bytes[1] == b':'
            && (bytes[2] == b'\\' || bytes[2] == b'/'))
}

/// getSteamLibraryFolders: the Steam folder plus its library folders.
pub fn library_folders(steam: &Path) -> Vec<PathBuf> {
    for manifest in [
        ["steamapps", "libraryfolders.vdf"],
        ["config", "libraryfolders.vdf"],
    ] {
        let Ok(content) = std::fs::read_to_string(steam.join(manifest[0]).join(manifest[1])) else {
            continue;
        };
        let folders = parse_library_folder_paths(&content);
        if !folders.is_empty() {
            let mut out = vec![steam.to_path_buf()];
            for folder in folders {
                let folder = PathBuf::from(folder);
                if !out.contains(&folder) {
                    out.push(folder);
                }
            }
            return out;
        }
    }
    vec![steam.to_path_buf()]
}

/// readManifestValue: the first `"key" "value"` pair (key case-insensitive).
pub fn manifest_value(content: &str, key: &str) -> Option<String> {
    let lower = key.to_lowercase();
    let bytes = content.as_bytes();
    let mut i = 0;
    // Tokens with backslash escapes, so `\"` stays inside a value.
    let mut tokens: Vec<String> = Vec::new();
    while i < bytes.len() {
        if bytes[i] == b'"' {
            let mut j = i + 1;
            let mut value = Vec::new();
            while j < bytes.len() && bytes[j] != b'"' {
                if bytes[j] == b'\\' && j + 1 < bytes.len() {
                    value.push(bytes[j]);
                    value.push(bytes[j + 1]);
                    j += 2;
                    continue;
                }
                value.push(bytes[j]);
                j += 1;
            }
            tokens.push(String::from_utf8_lossy(&value).into_owned());
            i = j + 1;
        } else {
            i += 1;
        }
    }
    tokens.windows(2).find_map(|pair| {
        (pair[0].to_lowercase() == lower)
            .then(|| pair[1].replace("\\\\", "\\").replace("\\\"", "\""))
    })
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct InstalledApp {
    pub app_id: String,
    pub name: Option<String>,
    pub install_directory: PathBuf,
}

const STATE_FULLY_INSTALLED: i64 = 4;

/// resolveInstallDirectory: `<library>/steamapps/common/<installdir>`, never outside it.
fn install_directory(library: &Path, name: &str) -> Option<PathBuf> {
    let relative = Path::new(name);
    if relative.is_absolute()
        || relative.components().any(|c| {
            matches!(
                c,
                Component::ParentDir | Component::Prefix(_) | Component::RootDir
            )
        })
        || relative.components().next().is_none()
    {
        return None;
    }
    Some(library.join("steamapps").join("common").join(relative))
}

fn read_installed_app(library: &Path, manifest: &Path, app_id: &str) -> Option<InstalledApp> {
    let content = std::fs::read_to_string(manifest).ok()?;
    if manifest_value(&content, "appid").as_deref() != Some(app_id) {
        return None;
    }
    let flags: i64 = manifest_value(&content, "StateFlags")?
        .trim()
        .parse()
        .ok()?;
    if flags & STATE_FULLY_INSTALLED == 0 {
        return None;
    }
    let directory = install_directory(library, &manifest_value(&content, "installdir")?)?;
    if !directory.is_dir() {
        return None;
    }
    Some(InstalledApp {
        app_id: app_id.to_string(),
        name: manifest_value(&content, "name"),
        install_directory: directory,
    })
}

/// appmanifest_<digits>.acf -> the app id
pub fn app_id_from_manifest(file_name: &str) -> Option<String> {
    let lower = file_name.to_lowercase();
    let digits = lower.strip_prefix("appmanifest_")?.strip_suffix(".acf")?;
    (!digits.is_empty() && digits.chars().all(|c| c.is_ascii_digit())).then(|| digits.to_string())
}

/// listInstalledSteamApps
pub fn installed_apps(libraries: &[PathBuf]) -> Vec<InstalledApp> {
    let mut seen = HashSet::new();
    let mut apps = Vec::new();
    for library in libraries {
        let steamapps = library.join("steamapps");
        let Ok(entries) = std::fs::read_dir(&steamapps) else {
            continue;
        };
        for entry in entries.flatten() {
            if !entry.file_type().is_ok_and(|t| t.is_file()) {
                continue;
            }
            let name = entry.file_name().to_string_lossy().into_owned();
            let Some(app_id) = app_id_from_manifest(&name) else {
                continue;
            };
            if seen.contains(&app_id) {
                continue;
            }
            if let Some(app) = read_installed_app(library, &entry.path(), &app_id) {
                seen.insert(app_id);
                apps.push(app);
            }
        }
    }
    apps
}

// ---- appinfo.vdf

const MAGIC_V39: u32 = 0x0756_4427;
const MAGIC_V40: u32 = 0x0756_4428;
const MAGIC_V41: u32 = 0x0756_4429;

#[derive(Clone, Debug, PartialEq)]
pub enum Kv {
    Map(Vec<(String, Kv)>),
    Str(String),
    Int(i64),
    Float(f32),
}

impl Kv {
    fn child(&self, key: &str) -> Option<&Kv> {
        let Kv::Map(items) = self else { return None };
        let lower = key.to_lowercase();
        items
            .iter()
            .find(|(k, _)| k.to_lowercase() == lower)
            .map(|(_, v)| v)
    }
    fn string(&self, key: &str) -> Option<String> {
        let text = match self.child(key)? {
            Kv::Map(_) => return None,
            Kv::Str(s) => s.clone(),
            Kv::Int(i) => i.to_string(),
            Kv::Float(f) => f.to_string(),
        };
        let text = text.trim().to_string();
        (!text.is_empty()).then_some(text)
    }
}

struct Cursor<'a> {
    buf: &'a [u8],
    pos: usize,
    strings: Option<&'a [String]>,
}

impl Cursor<'_> {
    fn take(&mut self, n: usize) -> Option<&[u8]> {
        let slice = self.buf.get(self.pos..self.pos + n)?;
        self.pos += n;
        Some(slice)
    }
    fn u8(&mut self) -> Option<u8> {
        self.take(1).map(|b| b[0])
    }
    fn u32(&mut self) -> Option<u32> {
        self.take(4)
            .map(|b| u32::from_le_bytes([b[0], b[1], b[2], b[3]]))
    }
    fn cstring(&mut self) -> Option<String> {
        let rest = self.buf.get(self.pos..)?;
        let end = rest.iter().position(|b| *b == 0)?;
        let text = String::from_utf8_lossy(&rest[..end]).into_owned();
        self.pos += end + 1;
        Some(text)
    }
    fn wide(&mut self) -> Option<String> {
        let mut units = Vec::new();
        loop {
            let b = self.take(2)?;
            let unit = u16::from_le_bytes([b[0], b[1]]);
            if unit == 0 {
                break;
            }
            units.push(unit);
        }
        Some(String::from_utf16_lossy(&units))
    }
    fn key(&mut self) -> Option<String> {
        match self.strings {
            Some(table) => {
                let index = self.u32()? as usize;
                table.get(index).cloned()
            }
            None => self.cstring(),
        }
    }
    fn map(&mut self, depth: usize) -> Option<Kv> {
        if depth > 64 {
            return None;
        }
        let mut items = Vec::new();
        loop {
            let kind = self.u8()?;
            if kind == 0x08 || kind == 0x0b {
                return Some(Kv::Map(items));
            }
            let key = self.key()?;
            let value = match kind {
                0x00 => self.map(depth + 1)?,
                0x01 => Kv::Str(self.cstring()?),
                0x05 => Kv::Str(self.wide()?),
                0x02 | 0x04 | 0x06 => {
                    let b = self.take(4)?;
                    Kv::Int(i32::from_le_bytes([b[0], b[1], b[2], b[3]]) as i64)
                }
                0x03 => {
                    let b = self.take(4)?;
                    Kv::Float(f32::from_le_bytes([b[0], b[1], b[2], b[3]]))
                }
                0x07 | 0x0a => {
                    let b = self.take(8)?;
                    let mut a = [0u8; 8];
                    a.copy_from_slice(b);
                    Kv::Int(i64::from_le_bytes(a))
                }
                _ => return None,
            };
            items.push((key, value));
        }
    }
}

/// parseBinaryKeyValues
pub fn parse_binary_kv(buf: &[u8], offset: usize, strings: Option<&[String]>) -> Option<Kv> {
    Cursor {
        buf,
        pos: offset,
        strings,
    }
    .map(0)
}

/// parseSteamStringTable
pub fn parse_string_table(buf: &[u8]) -> Option<Vec<String>> {
    let mut cursor = Cursor {
        buf,
        pos: 0,
        strings: None,
    };
    let count = cursor.u32()? as usize;
    let mut out = Vec::with_capacity(count.min(1 << 20));
    for _ in 0..count {
        out.push(cursor.cstring()?);
    }
    Some(out)
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LaunchEntry {
    pub executable: String,
    pub arguments: Option<String>,
    pub kind: Option<String>,
    pub oslist: Vec<String>,
    pub osarch: Option<String>,
    pub betakey: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AppInfo {
    pub app_id: String,
    pub kind: Option<String>,
    pub name: Option<String>,
    pub launch: Vec<LaunchEntry>,
}

/// toSteamAppInfo
pub fn to_app_info(app_id: &str, kv: &Kv) -> AppInfo {
    let root = kv.child("appinfo").unwrap_or(kv);
    let common = root.child("common");
    let launch = root.child("config").and_then(|c| c.child("launch"));
    let mut entries: Vec<(f64, LaunchEntry)> = Vec::new();
    if let Some(Kv::Map(items)) = launch {
        for (key, value) in items {
            let Some(executable) = value.string("executable") else {
                continue;
            };
            let config = value.child("config");
            let oslist = config.and_then(|c| c.string("oslist"));
            entries.push((
                key.parse::<f64>().unwrap_or(f64::NAN),
                LaunchEntry {
                    executable,
                    arguments: value.string("arguments"),
                    kind: value.string("type").map(|t| t.to_lowercase()),
                    oslist: oslist
                        .map(|o| {
                            o.split(',')
                                .map(|s| s.trim().to_lowercase())
                                .filter(|s| !s.is_empty())
                                .collect()
                        })
                        .unwrap_or_default(),
                    osarch: config.and_then(|c| c.string("osarch")),
                    betakey: config.and_then(|c| c.string("betakey")),
                },
            ));
        }
    }
    // Object.keys(launch).sort((a, b) => Number(a) - Number(b)): stable, NaN compares equal.
    entries.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal));
    AppInfo {
        app_id: app_id.to_string(),
        kind: common
            .and_then(|c| c.string("type"))
            .map(|t| t.to_lowercase()),
        name: common.and_then(|c| c.string("name")),
        launch: entries.into_iter().map(|(_, e)| e).collect(),
    }
}

/// readSteamAppInfo: the entries of `app_ids`, skipping the others with seeks.
pub fn read_app_info(
    path: &Path,
    app_ids: &HashSet<String>,
) -> std::io::Result<HashMap<String, AppInfo>> {
    let wanted: HashSet<&String> = app_ids
        .iter()
        .filter(|a| !a.is_empty() && a.chars().all(|c| c.is_ascii_digit()))
        .collect();
    let mut infos = HashMap::new();
    if wanted.is_empty() {
        return Ok(infos);
    }
    let invalid = |m: &str| std::io::Error::new(std::io::ErrorKind::InvalidData, m.to_string());
    let mut file = File::open(path)?;
    let size = file.metadata()?.len();
    let mut header = [0u8; 16];
    let read = file.read(&mut header)?;
    if read < 8 {
        return Err(invalid("steam-appinfo-truncated"));
    }
    let magic = u32::from_le_bytes([header[0], header[1], header[2], header[3]]);
    let (entries_offset, fixed, table_offset) = match magic {
        MAGIC_V39 => (8u64, 40usize, None),
        MAGIC_V40 => (8, 60, None),
        MAGIC_V41 => {
            if read < 16 {
                return Err(invalid("steam-appinfo-truncated"));
            }
            let mut b = [0u8; 8];
            b.copy_from_slice(&header[8..16]);
            (16, 60, Some(i64::from_le_bytes(b) as u64))
        }
        other => {
            return Err(invalid(&format!(
                "unsupported-steam-appinfo-version:{other:x}"
            )));
        }
    };
    let strings = match table_offset {
        Some(offset) => {
            if offset == 0 || offset >= size {
                return Err(invalid("steam-appinfo-invalid-string-table"));
            }
            file.seek(SeekFrom::Start(offset))?;
            let mut buf = Vec::with_capacity((size - offset) as usize);
            file.read_to_end(&mut buf)?;
            Some(parse_string_table(&buf).ok_or_else(|| invalid("steam-appinfo-string-table"))?)
        }
        None => None,
    };
    let entries_end = table_offset.unwrap_or(size);
    let mut position = entries_offset;
    let mut reader = std::io::BufReader::with_capacity(4 << 20, file);
    reader.seek(SeekFrom::Start(position))?;
    while position + 8 <= entries_end && infos.len() < wanted.len() {
        let mut entry_header = [0u8; 8];
        reader.read_exact(&mut entry_header)?;
        let app_id = u32::from_le_bytes([
            entry_header[0],
            entry_header[1],
            entry_header[2],
            entry_header[3],
        ]);
        let length = u32::from_le_bytes([
            entry_header[4],
            entry_header[5],
            entry_header[6],
            entry_header[7],
        ]) as u64;
        if app_id == 0 {
            break;
        }
        let start = position + 8;
        if start + length > size {
            return Err(invalid("steam-appinfo-truncated"));
        }
        let id = app_id.to_string();
        if wanted.contains(&id) && length as usize > fixed {
            let mut entry = vec![0u8; length as usize];
            reader.read_exact(&mut entry)?;
            if let Some(kv) = parse_binary_kv(&entry, fixed, strings.as_deref()) {
                infos.insert(id.clone(), to_app_info(&id, &kv));
            }
        } else {
            reader.seek_relative(length as i64)?;
        }
        position = start + length;
    }
    Ok(infos)
}

const SKIPPED_LAUNCH_TYPES: [&str; 4] = ["server", "editor", "config", "manual"];

fn launch_type_priority(kind: Option<&str>) -> u64 {
    match kind {
        None | Some("default") => 0,
        Some("none") => 1,
        Some(other) => other
            .strip_prefix("option")
            .and_then(|n| n.parse::<u64>().ok())
            .map_or(10, |n| 1 + n),
    }
}

fn os_tier(oslist: &[String]) -> Option<u8> {
    let native = if cfg!(windows) {
        "windows"
    } else if cfg!(target_os = "macos") {
        "macos"
    } else {
        "linux"
    };
    if oslist.iter().any(|o| o == native) {
        return Some(0);
    }
    if oslist.is_empty() {
        return Some(1);
    }
    if cfg!(target_os = "linux") && oslist.iter().any(|o| o == "windows") {
        return Some(1);
    }
    None
}

fn has_url_scheme(executable: &str) -> bool {
    let Some((scheme, _)) = executable.split_once("://") else {
        return false;
    };
    let mut chars = scheme.chars();
    chars.next().is_some_and(|c| c.is_ascii_alphabetic())
        && chars.all(|c| c.is_ascii_alphanumeric() || matches!(c, '+' | '.' | '-'))
}

/// selectSteamLaunchCandidates (64-bit builds only)
pub fn launch_candidates(info: &AppInfo) -> Vec<&LaunchEntry> {
    let is64 = cfg!(target_pointer_width = "64");
    let mut candidates: Vec<(usize, u8, &LaunchEntry)> = info
        .launch
        .iter()
        .enumerate()
        .filter_map(|(i, e)| os_tier(&e.oslist).map(|tier| (i, tier, e)))
        .filter(|(_, _, e)| {
            !SKIPPED_LAUNCH_TYPES.contains(&e.kind.as_deref().unwrap_or(""))
                && !has_url_scheme(&e.executable)
                && !(e.osarch.as_deref() == Some("64") && !is64)
        })
        .collect();
    candidates.sort_by_key(|(i, tier, e)| {
        (
            e.betakey.is_some(),
            *tier,
            launch_type_priority(e.kind.as_deref()),
            is64 && e.osarch.as_deref() == Some("32"),
            *i,
        )
    });
    candidates.into_iter().map(|(_, _, e)| e).collect()
}

/// toSteamExecutableSegments
pub fn executable_segments(executable: &str) -> Vec<String> {
    let trimmed = executable.trim();
    let unquoted = trimmed
        .strip_prefix('"')
        .and_then(|s| s.strip_suffix('"'))
        .unwrap_or(trimmed);
    unquoted
        .split(['\\', '/'])
        .filter(|s| !s.is_empty() && *s != ".")
        .map(str::to_string)
        .collect()
}

/// resolvePathIgnoringCase
fn resolve_ignoring_case(root: &Path, segments: &[String]) -> Option<PathBuf> {
    let exact = segments.iter().fold(root.to_path_buf(), |p, s| p.join(s));
    if exact.is_file() {
        return Some(exact);
    }
    if cfg!(windows) {
        return None;
    }
    let mut current = root.to_path_buf();
    for segment in segments {
        if segment == ".." {
            return None;
        }
        let lower = segment.to_lowercase();
        let found = std::fs::read_dir(&current).ok()?.flatten().find_map(|e| {
            let name = e.file_name().to_string_lossy().into_owned();
            (name.to_lowercase() == lower).then_some(name)
        })?;
        current = current.join(found);
    }
    current.is_file().then_some(current)
}

/// resolveSteamAppExecutable
pub fn resolve_executable(info: &AppInfo, install_directory: &Path) -> Option<PathBuf> {
    launch_candidates(info).into_iter().find_map(|candidate| {
        let segments = executable_segments(&candidate.executable);
        if segments.is_empty() || segments.iter().any(|s| s == "..") {
            return None;
        }
        resolve_ignoring_case(install_directory, &segments)
    })
}

/// findInstalledSteamGames (scan-installed-games.ts): installed game apps
/// with their launch executable, and the folders of those Steam couldn't
/// name one for (scanned like any other folder).
pub struct InstalledGames {
    pub executables: HashMap<String, String>,
    pub unresolved_directories: Vec<PathBuf>,
}

pub fn installed_games() -> InstalledGames {
    let empty = InstalledGames {
        executables: HashMap::new(),
        unresolved_directories: Vec::new(),
    };
    let Some(steam) = steam_location() else {
        return empty;
    };
    let apps = installed_apps(&library_folders(&steam));
    if apps.is_empty() {
        return empty;
    }
    let ids: HashSet<String> = apps.iter().map(|a| a.app_id.clone()).collect();
    let infos =
        read_app_info(&steam.join("appcache").join("appinfo.vdf"), &ids).unwrap_or_else(|e| {
            eprintln!("[ScanInstalledGames] Failed to read Steam app info: {e}");
            HashMap::new()
        });
    let games: Vec<&InstalledApp> = apps
        .iter()
        .filter(|a| {
            infos
                .get(&a.app_id)
                .and_then(|i| i.kind.as_deref())
                .is_none_or(|k| k == "game")
        })
        .collect();
    let mut executables = HashMap::new();
    let mut unresolved = Vec::new();
    for app in &games {
        match infos
            .get(&app.app_id)
            .and_then(|info| resolve_executable(info, &app.install_directory))
        {
            Some(path) => {
                executables.insert(app.app_id.clone(), path.to_string_lossy().into_owned());
            }
            None => unresolved.push(app.install_directory.clone()),
        }
    }
    eprintln!(
        "[ScanInstalledGames] Resolved {} of {} installed Steam games from Steam's app info",
        executables.len(),
        games.len()
    );
    InstalledGames {
        executables,
        unresolved_directories: unresolved,
    }
}

/// isPathInsideSteamInstallDirectory
pub fn is_inside(file: &Path, directory: &Path) -> bool {
    let normalize = |p: &Path| {
        let text = p.to_string_lossy().replace('\\', "/");
        let text = text.trim_end_matches('/').to_string();
        if cfg!(windows) {
            text.to_lowercase()
        } else {
            text
        }
    };
    let (file, directory) = (normalize(file), normalize(directory));
    file.len() > directory.len() + 1
        && file.starts_with(&directory)
        && file.as_bytes()[directory.len()] == b'/'
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_registry_value() {
        let output = "\r\nHKEY_CURRENT_USER\\Software\\Valve\\Steam\r\n    SteamPath    REG_SZ    c:/program files (x86)/steam\r\n\r\n";
        assert_eq!(
            parse_reg_value(output, "SteamPath").as_deref(),
            Some("c:/program files (x86)/steam")
        );
    }

    #[test]
    fn library_folders_from_the_vdf() {
        let vdf = r#""libraryfolders"
{
    "0"
    {
        "path"      "C:\\Program Files (x86)\\Steam"
        "label"     ""
    }
    "1"
    {
        "path"      "D:\\SteamLibrary"
    }
}"#;
        assert_eq!(
            parse_library_folder_paths(vdf),
            vec!["C:\\Program Files (x86)\\Steam", "D:\\SteamLibrary"]
        );
        // the old format: numbered paths
        assert_eq!(
            parse_library_folder_paths("\"1\"  \"/mnt/games/steam\""),
            vec!["/mnt/games/steam"]
        );
    }

    #[test]
    fn manifest_values() {
        let acf = "\"AppState\"\n{\n\t\"appid\"\t\t\"570\"\n\t\"name\"\t\t\"Dota \\\"2\\\"\"\n\t\"StateFlags\"\t\t\"4\"\n\t\"installdir\"\t\t\"dota 2 beta\"\n}";
        assert_eq!(manifest_value(acf, "appid").as_deref(), Some("570"));
        assert_eq!(manifest_value(acf, "stateflags").as_deref(), Some("4"));
        assert_eq!(manifest_value(acf, "name").as_deref(), Some("Dota \"2\""));
        assert_eq!(
            app_id_from_manifest("appmanifest_570.acf").as_deref(),
            Some("570")
        );
        assert_eq!(app_id_from_manifest("appmanifest_x.acf"), None);
        assert!(install_directory(Path::new("/lib"), "../evil").is_none());
    }

    fn kv_map(items: &[(&str, &[u8])]) -> Vec<u8> {
        let mut out = Vec::new();
        for (key, value) in items {
            out.push(value[0]);
            out.extend_from_slice(key.as_bytes());
            out.push(0);
            out.extend_from_slice(&value[1..]);
        }
        out.push(0x08);
        out
    }

    #[test]
    fn parses_binary_key_values_and_picks_the_launch_entry() {
        // appinfo { common { type "Game" } config { launch { 0 { executable "bin/game.exe" config { oslist "windows" } } 1 { executable "server.exe" type "server" } } } }
        let mut entry0 = vec![0x01];
        entry0.extend_from_slice(b"bin\\game.exe\0");
        let oslist = {
            let mut v = vec![0x01];
            v.extend_from_slice(b"windows,linux\0");
            v
        };
        let config0 = kv_map(&[("oslist", &oslist)]);
        let mut config0_value = vec![0x00];
        config0_value.extend_from_slice(&config0);
        let launch0 = kv_map(&[("executable", &entry0), ("config", &config0_value)]);
        let mut server_exe = vec![0x01];
        server_exe.extend_from_slice(b"server.exe\0");
        let mut server_type = vec![0x01];
        server_type.extend_from_slice(b"server\0");
        let launch1 = kv_map(&[("executable", &server_exe), ("type", &server_type)]);
        let mut l0 = vec![0x00];
        l0.extend_from_slice(&launch0);
        let mut l1 = vec![0x00];
        l1.extend_from_slice(&launch1);
        let launch = kv_map(&[("1", &l1), ("0", &l0)]);
        let mut launch_value = vec![0x00];
        launch_value.extend_from_slice(&launch);
        let config = kv_map(&[("launch", &launch_value)]);
        let mut config_value = vec![0x00];
        config_value.extend_from_slice(&config);
        let mut game_type = vec![0x01];
        game_type.extend_from_slice(b"Game\0");
        let common = kv_map(&[("type", &game_type)]);
        let mut common_value = vec![0x00];
        common_value.extend_from_slice(&common);
        let appinfo = kv_map(&[("common", &common_value), ("config", &config_value)]);
        let mut root_value = vec![0x00];
        root_value.extend_from_slice(&appinfo);
        let root = kv_map(&[("appinfo", &root_value)]);

        let kv = parse_binary_kv(&root, 0, None).unwrap();
        let info = to_app_info("10", &kv);
        assert_eq!(info.kind.as_deref(), Some("game"));
        assert_eq!(info.launch.len(), 2);
        assert_eq!(info.launch[0].executable, "bin\\game.exe");
        let candidates = launch_candidates(&info);
        assert_eq!(candidates.len(), 1);
        assert_eq!(
            executable_segments(&candidates[0].executable),
            vec!["bin", "game.exe"]
        );
    }

    #[test]
    fn inside_checks() {
        assert!(is_inside(Path::new("/a/b/c.exe"), Path::new("/a/b")));
        assert!(!is_inside(Path::new("/a/bc/c.exe"), Path::new("/a/b")));
        assert!(!is_inside(Path::new("/a/b"), Path::new("/a/b")));
    }
}
