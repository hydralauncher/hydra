//! The achievement watcher's file side: where Steam emulators and cracks keep
//! their achievement files (find-achievement-files.ts) and how each format
//! reads (parse-achievement-file.ts, parse-achievement-formats.ts).

use std::collections::{BTreeMap, HashMap};
use std::path::{Path, PathBuf};

use serde_json::Value;

/// `Cracker` (shared/constants.ts).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Cracker {
    Codex,
    Rune,
    OnlineFix,
    Goldberg,
    UserStats,
    Steam,
    Rld,
    Empress,
    Skidrow,
    CreamApi,
    SmartSteamEmu,
    ThreeDm,
    Flt,
    Rle,
    Razor1911,
    Ali213,
}

/// An unlock read from a file (`UnlockedAchievement`).
#[derive(Clone, Debug, PartialEq)]
pub struct Unlock {
    pub name: String,
    /// Milliseconds since the epoch (0 when the file has no usable time).
    pub unlock_time: i64,
}

#[derive(Clone, Debug, PartialEq)]
pub struct AchievementFile {
    pub cracker: Cracker,
    pub path: PathBuf,
}

/// The crackers whose files live under shared folders, in Electron's order.
const CRACKERS: [Cracker; 12] = [
    Cracker::Codex,
    Cracker::Goldberg,
    Cracker::Rune,
    Cracker::OnlineFix,
    Cracker::UserStats,
    Cracker::Rld,
    Cracker::CreamApi,
    Cracker::Skidrow,
    Cracker::SmartSteamEmu,
    Cracker::Empress,
    Cracker::Flt,
    Cracker::Razor1911,
];

/// The Windows folders the crackers write to (a Wine prefix maps them under drive_c).
pub struct Folders {
    pub app_data: PathBuf,
    pub local_app_data: PathBuf,
    pub documents: PathBuf,
    pub public_documents: PathBuf,
    pub program_data: PathBuf,
}

impl Folders {
    /// This machine's folders (Windows), or a Wine prefix's for `user`.
    pub fn windows() -> Option<Self> {
        let app_data = std::env::var_os("APPDATA").map(PathBuf::from)?;
        let local_app_data = std::env::var_os("LOCALAPPDATA")
            .map(PathBuf::from)
            .unwrap_or_else(|| app_data.join("..").join("Local"));
        let documents =
            std::env::var_os("USERPROFILE").map(|p| PathBuf::from(p).join("Documents"))?;
        Some(Self {
            app_data,
            local_app_data,
            documents,
            public_documents: PathBuf::from("C:\\Users\\Public\\Documents"),
            program_data: std::env::var_os("ProgramData")
                .map(PathBuf::from)
                .unwrap_or_else(|| PathBuf::from("C:\\ProgramData")),
        })
    }

    /// The same folders inside a Wine prefix (`drive_c/users/<user>/…`).
    pub fn wine(prefix: &Path, user: &str) -> Self {
        let users = prefix.join("drive_c").join("users");
        Self {
            app_data: users.join(user).join("AppData").join("Roaming"),
            local_app_data: users.join(user).join("AppData").join("Local"),
            documents: users.join(user).join("Documents"),
            public_documents: users.join("Public").join("Documents"),
            program_data: prefix.join("drive_c").join("ProgramData"),
        }
    }
}

/// getPathFromCracker: (folder, location under it with `<objectId>`).
fn locations(cracker: Cracker, f: &Folders) -> Vec<(PathBuf, &'static [&'static str])> {
    match cracker {
        Cracker::Codex => vec![
            (
                f.public_documents.join("Steam").join("CODEX"),
                &["<objectId>", "achievements.ini"],
            ),
            (
                f.app_data.join("Steam").join("CODEX"),
                &["<objectId>", "achievements.ini"],
            ),
        ],
        Cracker::Rune => vec![(
            f.public_documents.join("Steam").join("RUNE"),
            &["<objectId>", "achievements.ini"],
        )],
        Cracker::OnlineFix => vec![
            (
                f.public_documents.join("OnlineFix"),
                &["<objectId>", "Stats", "Achievements.ini"],
            ),
            (
                f.public_documents.join("OnlineFix"),
                &["<objectId>", "Achievements.ini"],
            ),
        ],
        Cracker::Goldberg => vec![
            (
                f.app_data.join("Goldberg SteamEmu Saves"),
                &["<objectId>", "achievements.json"],
            ),
            (
                f.app_data.join("GSE Saves"),
                &["<objectId>", "achievements.json"],
            ),
        ],
        Cracker::Rld => vec![
            (
                f.program_data.join("RLD!"),
                &["<objectId>", "achievements.ini"],
            ),
            (
                f.program_data.join("Steam").join("Player"),
                &["<objectId>", "stats", "achievements.ini"],
            ),
            (
                f.program_data.join("Steam").join("RLD!"),
                &["<objectId>", "stats", "achievements.ini"],
            ),
            (
                f.program_data.join("Steam").join("dodi"),
                &["<objectId>", "stats", "achievements.ini"],
            ),
        ],
        Cracker::Empress => vec![
            (
                f.app_data.join("EMPRESS").join("remote"),
                &["<objectId>", "achievements.json"],
            ),
            (
                f.public_documents.join("EMPRESS"),
                &["<objectId>", "remote", "<objectId>", "achievements.json"],
            ),
        ],
        Cracker::Skidrow => vec![
            (
                f.documents.join("SKIDROW"),
                &["<objectId>", "SteamEmu", "UserStats", "achiev.ini"],
            ),
            (
                f.documents.join("Player"),
                &["<objectId>", "SteamEmu", "UserStats", "achiev.ini"],
            ),
            (
                f.local_app_data.join("SKIDROW"),
                &["<objectId>", "SteamEmu", "UserStats", "achiev.ini"],
            ),
        ],
        Cracker::CreamApi => vec![(
            f.app_data.join("CreamAPI"),
            &["<objectId>", "stats", "CreamAPI.Achievements.cfg"],
        )],
        Cracker::SmartSteamEmu => vec![(
            f.app_data.join("SmartSteamEmu"),
            &["<objectId>", "User", "Achievements.ini"],
        )],
        Cracker::Rle => vec![
            (f.app_data.join("RLE"), &["<objectId>", "achievements.ini"]),
            (f.app_data.join("RLE"), &["<objectId>", "Achievements.ini"]),
        ],
        Cracker::Razor1911 => vec![(f.app_data.join(".1911"), &["<objectId>", "achievement"])],
        // game-directory-only crackers, FLT (disabled in Electron) and Steam's own cache
        Cracker::UserStats | Cracker::ThreeDm | Cracker::Ali213 | Cracker::Flt | Cracker::Steam => {
            Vec::new()
        }
    }
}

fn resolve(folder: &Path, location: &[&str], object_id: &str) -> PathBuf {
    location.iter().fold(folder.to_path_buf(), |path, part| {
        path.join(part.replace("<objectId>", object_id))
    })
}

/// getAlternativeObjectIds (Dishonored ships under three app ids).
pub fn alternative_object_ids(object_id: &str) -> Vec<String> {
    if object_id == "205100" {
        return vec!["205100".into(), "217980".into(), "31292".into()];
    }
    vec![object_id.to_string()]
}

/// findAchievementFiles: one game's files in the shared folders.
pub fn find_for_game(object_id: &str, folders: &Folders) -> Vec<AchievementFile> {
    let mut files = Vec::new();
    for cracker in CRACKERS {
        for (folder, location) in locations(cracker, folders) {
            for id in alternative_object_ids(object_id) {
                let path = resolve(&folder, location, &id);
                if path.exists() {
                    files.push(AchievementFile { cracker, path });
                }
            }
        }
    }
    files
}

/// findAllAchievementFiles: every object id with files, by scanning the folders.
pub fn find_all(folders: &Folders) -> HashMap<String, Vec<AchievementFile>> {
    let mut found: HashMap<String, Vec<AchievementFile>> = HashMap::new();
    for cracker in CRACKERS {
        for (folder, location) in locations(cracker, folders) {
            let Ok(entries) = std::fs::read_dir(&folder) else {
                continue;
            };
            for entry in entries.flatten() {
                let object_id = entry.file_name().to_string_lossy().to_string();
                let path = resolve(&folder, location, &object_id);
                if path.exists() {
                    found
                        .entry(object_id)
                        .or_default()
                        .push(AchievementFile { cracker, path });
                }
            }
        }
    }
    found
}

/// The emulator save folders (getEmulatorSaveFolders).
pub fn emulator_save_folders(folders: &Folders) -> Vec<PathBuf> {
    locations(Cracker::Goldberg, folders)
        .into_iter()
        .map(|(folder, _)| folder)
        .collect()
}

// ---- parsing ------------------------------------------------------------

type Ini = BTreeMap<String, BTreeMap<String, String>>;

/// readFileLines: UTF-8 without a BOM, split on line breaks.
fn read_lines(path: &Path) -> std::io::Result<Vec<String>> {
    let bytes = std::fs::read(path)?;
    let text = String::from_utf8_lossy(&bytes);
    let text = text.strip_prefix('\u{feff}').unwrap_or(&text);
    Ok(text
        .split(['\r', '\n'])
        .filter(|l| !l.is_empty())
        .map(str::to_string)
        .collect())
}

/// iniParse: sections of key = value (the first `=` splits).
pub fn ini_parse(path: &Path) -> std::io::Result<Ini> {
    let mut ini = Ini::new();
    let mut section = String::new();
    for line in read_lines(path)? {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') || trimmed.starts_with(';') {
            continue;
        }
        if trimmed.starts_with('[') && trimmed.ends_with(']') && trimmed.len() >= 2 {
            section = trimmed[1..trimmed.len() - 1].to_string();
            ini.insert(section.clone(), BTreeMap::new());
            continue;
        }
        let (key, value) = trimmed.split_once('=').unwrap_or((trimmed, ""));
        ini.entry(section.clone())
            .or_default()
            .insert(key.trim().to_string(), value.trim().to_string());
    }
    Ok(ini)
}

/// Number(text) * 1000 (0 when it does not parse, where JS would give NaN).
fn seconds_to_ms(text: &str) -> i64 {
    text.trim()
        .parse::<f64>()
        .map(|s| (s * 1000.0) as i64)
        .unwrap_or(0)
}

/// parseUnlockTime: 7-digit values are read as millions of seconds.
fn parse_unlock_time(text: &str) -> i64 {
    if text.len() == 7 {
        return text
            .trim()
            .parse::<f64>()
            .map(|s| (s * 1_000_000.0) as i64)
            .unwrap_or(0);
    }
    seconds_to_ms(text)
}

/// Little-endian u32 from a hex string (Buffer.from(hex).readUInt32LE(0)).
fn hex_u32_le(text: &str) -> Option<u32> {
    let bytes: Vec<u8> = (0..text.len() / 2)
        .filter_map(|i| u8::from_str_radix(text.get(i * 2..i * 2 + 2)?, 16).ok())
        .collect();
    (bytes.len() >= 4).then(|| u32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]))
}

/// processDefault (CODEX, RUNE; ALI213 with other keys)
fn process_default(ini: &Ini, achieved_key: &str, time_key: &str) -> Vec<Unlock> {
    ini.iter()
        .filter(|(_, values)| values.get(achieved_key).map(String::as_str) == Some("1"))
        .map(|(name, values)| Unlock {
            name: name.clone(),
            unlock_time: values.get(time_key).map(|t| seconds_to_ms(t)).unwrap_or(0),
        })
        .collect()
}

/// processOnlineFix
fn process_online_fix(ini: &Ini) -> Vec<Unlock> {
    ini.iter()
        .filter_map(|(name, values)| {
            if values.get("achieved").map(String::as_str) == Some("true") {
                return Some(Unlock {
                    name: name.clone(),
                    unlock_time: values
                        .get("timestamp")
                        .map(|t| seconds_to_ms(t))
                        .unwrap_or(0),
                });
            }
            if values.get("Achieved").map(String::as_str) == Some("true") {
                return Some(Unlock {
                    name: name.clone(),
                    unlock_time: values
                        .get("TimeUnlocked")
                        .map(|t| parse_unlock_time(t))
                        .unwrap_or(0),
                });
            }
            None
        })
        .collect()
}

/// processCreamAPI
fn process_cream_api(ini: &Ini) -> Vec<Unlock> {
    ini.iter()
        .filter(|(_, values)| values.get("achieved").map(String::as_str) == Some("true"))
        .map(|(name, values)| Unlock {
            name: name.clone(),
            unlock_time: values
                .get("unlocktime")
                .map(|t| parse_unlock_time(t))
                .unwrap_or(0),
        })
        .collect()
}

/// processSkidrow: `1@…@time` in [Achievements]
fn process_skidrow(ini: &Ini) -> Vec<Unlock> {
    let Some(section) = ini.get("Achievements") else {
        return Vec::new();
    };
    section
        .iter()
        .filter_map(|(name, value)| {
            let parts: Vec<&str> = value.split('@').collect();
            (parts.first() == Some(&"1")).then(|| Unlock {
                name: name.clone(),
                unlock_time: seconds_to_ms(parts.last().copied().unwrap_or("0")),
            })
        })
        .collect()
}

/// process3DM: [State] "0101" with [Time] as little-endian hex seconds
fn process_3dm(ini: &Ini) -> Vec<Unlock> {
    let (Some(state), Some(times)) = (ini.get("State"), ini.get("Time")) else {
        return Vec::new();
    };
    state
        .iter()
        .filter(|(_, v)| v.as_str() == "0101")
        .map(|(name, _)| Unlock {
            name: name.clone(),
            unlock_time: times
                .get(name)
                .and_then(|t| hex_u32_le(t))
                .map(|s| s as i64 * 1000)
                .unwrap_or(0),
        })
        .collect()
}

/// processRld: State and Time as little-endian hex; the [Steam] section skipped
fn process_rld(ini: &Ini) -> Vec<Unlock> {
    ini.iter()
        .filter(|(name, _)| name.as_str() != "Steam")
        .filter_map(|(name, values)| {
            let state = hex_u32_le(values.get("State")?)?;
            (state == 1).then(|| Unlock {
                name: name.clone(),
                unlock_time: values
                    .get("Time")
                    .and_then(|t| hex_u32_le(t))
                    .map(|s| s as i64 * 1000)
                    .unwrap_or(0),
            })
        })
        .collect()
}

/// processUserStats: [ACHIEVEMENTS] "name" = {unlocked = true, time = …}
fn process_user_stats(ini: &Ini) -> Vec<Unlock> {
    let Some(section) = ini.get("ACHIEVEMENTS") else {
        return Vec::new();
    };
    section
        .iter()
        .filter_map(|(name, value)| {
            let lower = value.to_lowercase();
            let unlocked = lower
                .split(|c: char| {
                    !(c.is_alphanumeric() || c == '=' || c == '_' || c.is_whitespace())
                })
                .any(|part| {
                    let mut it = part.splitn(2, '=');
                    it.next().map(str::trim) == Some("unlocked")
                        && it.next().map(str::trim) == Some("true")
                });
            if !unlocked {
                return None;
            }
            // (?:^|[{,\s])time\s*=\s*(\d+)
            let time = lower.split(['{', ',', '}']).find_map(|part| {
                let (key, rest) = part.split_once('=')?;
                (key.trim().rsplit(char::is_whitespace).next() == Some("time"))
                    .then(|| {
                        rest.trim()
                            .chars()
                            .take_while(char::is_ascii_digit)
                            .collect::<String>()
                    })
                    .filter(|digits| !digits.is_empty())
            })?;
            Some(Unlock {
                name: name.replace('"', ""),
                unlock_time: seconds_to_ms(&time),
            })
        })
        .collect()
}

/// processGoldberg / EMPRESS: an object or array with earned + earned_time
fn process_goldberg(json: &Value) -> Vec<Unlock> {
    let earned = |v: &Value| match v.get("earned") {
        Some(Value::Bool(b)) => *b,
        Some(Value::Number(n)) => n.as_f64().is_some_and(|n| n != 0.0),
        Some(Value::String(s)) => !s.is_empty(),
        _ => false,
    };
    let time = |v: &Value| {
        v.get("earned_time")
            .and_then(Value::as_f64)
            .map(|t| (t * 1000.0) as i64)
            .unwrap_or(0)
    };
    match json {
        Value::Array(items) => items
            .iter()
            .filter(|v| earned(v))
            .map(|v| Unlock {
                name: v
                    .get("name")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string(),
                unlock_time: time(v),
            })
            .collect(),
        Value::Object(map) => map
            .iter()
            .filter(|(_, v)| earned(v))
            .map(|(name, v)| Unlock {
                name: name.clone(),
                unlock_time: time(v),
            })
            .collect(),
        _ => Vec::new(),
    }
}

/// processSteamCacheAchievement: [["achievements", {data: {vecHighlight}}], …]
fn process_steam_cache(json: &Value) -> Vec<Unlock> {
    let Some(entries) = json.as_array() else {
        return Vec::new();
    };
    let Some(entry) = entries
        .iter()
        .find(|e| e.get(0).and_then(Value::as_str) == Some("achievements"))
    else {
        return Vec::new();
    };
    entry
        .get(1)
        .and_then(|v| v.get("data"))
        .and_then(|v| v.get("vecHighlight"))
        .and_then(Value::as_array)
        .map(|list| {
            list.iter()
                .filter(|a| a.get("bAchieved").and_then(Value::as_bool) == Some(true))
                .map(|a| Unlock {
                    name: a
                        .get("strID")
                        .and_then(Value::as_str)
                        .unwrap_or_default()
                        .to_string(),
                    unlock_time: a
                        .get("rtUnlocked")
                        .and_then(Value::as_f64)
                        .map(|t| (t * 1000.0) as i64)
                        .unwrap_or(0),
                })
                .collect()
        })
        .unwrap_or_default()
}

/// processRazor1911: `name 1 time` per line
fn process_razor1911(path: &Path) -> std::io::Result<Vec<Unlock>> {
    Ok(read_lines(path)?
        .iter()
        .filter_map(|line| {
            let mut parts = line.split(' ');
            let name = parts.next()?;
            (parts.next() == Some("1")).then(|| Unlock {
                name: name.to_string(),
                unlock_time: seconds_to_ms(parts.next().unwrap_or("0")),
            })
        })
        .collect())
}

/// processFltFolder: one file per unlocked achievement, unlocked "now".
fn process_flt(path: &Path) -> std::io::Result<Vec<Unlock>> {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.as_millis() as i64);
    Ok(std::fs::read_dir(path)?
        .flatten()
        .map(|e| Unlock {
            name: e.file_name().to_string_lossy().to_string(),
            unlock_time: now,
        })
        .collect())
}

fn json_parse(path: &Path) -> std::io::Result<Value> {
    let bytes = std::fs::read(path)?;
    serde_json::from_slice(&bytes).map_err(std::io::Error::other)
}

/// parseAchievementFile: never fails; unreadable files give nothing.
pub fn parse(path: &Path, cracker: Cracker) -> Vec<Unlock> {
    if !path.exists() {
        return Vec::new();
    }
    let parsed: std::io::Result<Vec<Unlock>> = (|| {
        Ok(match cracker {
            Cracker::Codex | Cracker::Rune => {
                process_default(&ini_parse(path)?, "Achieved", "UnlockTime")
            }
            Cracker::Ali213 => {
                process_default(&ini_parse(path)?, "HaveAchieved", "HaveAchievedTime")
            }
            Cracker::OnlineFix => process_online_fix(&ini_parse(path)?),
            Cracker::Goldberg | Cracker::Empress => process_goldberg(&json_parse(path)?),
            Cracker::UserStats => process_user_stats(&ini_parse(path)?),
            Cracker::Rld => process_rld(&ini_parse(path)?),
            Cracker::Skidrow => process_skidrow(&ini_parse(path)?),
            Cracker::ThreeDm => process_3dm(&ini_parse(path)?),
            Cracker::CreamApi => process_cream_api(&ini_parse(path)?),
            Cracker::Flt => process_flt(path)?,
            Cracker::Razor1911 => process_razor1911(path)?,
            Cracker::Steam => process_steam_cache(&json_parse(path)?),
            Cracker::SmartSteamEmu | Cracker::Rle => {
                eprintln!(
                    "Unprocessed {cracker:?} achievements found on {}",
                    path.display()
                );
                Vec::new()
            }
        })
    })();
    match parsed {
        Ok(list) => list
            .into_iter()
            .filter(|u| !u.name.trim().is_empty())
            .collect(),
        Err(error) => {
            eprintln!("Error parsing {cracker:?} - {}: {error}", path.display());
            Vec::new()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write(name: &str, content: &str) -> PathBuf {
        let dir = std::env::temp_dir().join("hydra-achievement-files-test");
        let _ = std::fs::create_dir_all(&dir);
        let path = dir.join(name);
        std::fs::write(&path, content).unwrap();
        path
    }

    fn names(list: &[Unlock]) -> Vec<(&str, i64)> {
        list.iter()
            .map(|u| (u.name.as_str(), u.unlock_time))
            .collect()
    }

    #[test]
    fn codex_and_ali213() {
        let path = write(
            "codex.ini",
            "\u{feff}[ACH_A]\nAchieved=1\nUnlockTime=1700000000\n[ACH_B]\nAchieved=0\n",
        );
        assert_eq!(
            names(&parse(&path, Cracker::Codex)),
            [("ACH_A", 1_700_000_000_000)]
        );
        let path = write(
            "ali.ini",
            "[X]\r\nHaveAchieved=1\r\nHaveAchievedTime=10\r\n",
        );
        assert_eq!(names(&parse(&path, Cracker::Ali213)), [("X", 10_000)]);
    }

    #[test]
    fn online_fix_and_cream_api() {
        let path = write(
            "ofix.ini",
            "[A]\nachieved=true\ntimestamp=5\n[B]\nAchieved=true\nTimeUnlocked=1234567\n",
        );
        assert_eq!(
            names(&parse(&path, Cracker::OnlineFix)),
            [("A", 5_000), ("B", 1_234_567_000_000)]
        );
        let path = write("cream.cfg", "[C]\nachieved=true\nunlocktime=7\n");
        assert_eq!(names(&parse(&path, Cracker::CreamApi)), [("C", 7_000)]);
    }

    #[test]
    fn goldberg_object_and_array() {
        let path = write(
            "gold.json",
            r#"{"A":{"earned":true,"earned_time":3},"B":{"earned":false}}"#,
        );
        assert_eq!(names(&parse(&path, Cracker::Goldberg)), [("A", 3_000)]);
        let path = write("gold2.json", r#"[{"name":"Z","earned":1,"earned_time":2}]"#);
        assert_eq!(names(&parse(&path, Cracker::Empress)), [("Z", 2_000)]);
    }

    #[test]
    fn skidrow_rld_3dm() {
        let path = write("skid.ini", "[Achievements]\nA=1@0@0@100\nB=0@0@0@5\n");
        assert_eq!(names(&parse(&path, Cracker::Skidrow)), [("A", 100_000)]);
        // State 01000000 = 1, Time 64000000 = 100
        let path = write(
            "rld.ini",
            "[Steam]\nAppID=1\n[A]\nState=01000000\nTime=64000000\n[B]\nState=00000000\n",
        );
        assert_eq!(names(&parse(&path, Cracker::Rld)), [("A", 100_000)]);
        let path = write("3dm.ini", "[State]\nA=0101\nB=0000\n[Time]\nA=0a000000\n");
        assert_eq!(names(&parse(&path, Cracker::ThreeDm)), [("A", 10_000)]);
    }

    #[test]
    fn user_stats_razor_steam() {
        let path = write(
            "stats.ini",
            "[ACHIEVEMENTS]\n\"A\" = {unlocked = true, time = 42}\n\"B\" = {unlocked = false, time = 1}\n",
        );
        assert_eq!(names(&parse(&path, Cracker::UserStats)), [("A", 42_000)]);
        let path = write("razor", "A 1 9\nB 0 3\n");
        assert_eq!(names(&parse(&path, Cracker::Razor1911)), [("A", 9_000)]);
        let path = write(
            "steam.json",
            r#"[["achievements",{"data":{"vecHighlight":[{"strID":"S","bAchieved":true,"rtUnlocked":4},{"strID":"T","bAchieved":false}]}}]]"#,
        );
        assert_eq!(names(&parse(&path, Cracker::Steam)), [("S", 4_000)]);
    }

    #[test]
    fn finds_files_by_object_id() {
        let root = std::env::temp_dir().join("hydra-achievement-folders-test");
        let _ = std::fs::remove_dir_all(&root);
        let folders = Folders::wine(&root, "steamuser");
        let goldberg = folders.app_data.join("GSE Saves").join("440");
        std::fs::create_dir_all(&goldberg).unwrap();
        std::fs::write(goldberg.join("achievements.json"), "{}").unwrap();
        let found = find_for_game("440", &folders);
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].cracker, Cracker::Goldberg);
        assert!(find_all(&folders).contains_key("440"));
    }
}
