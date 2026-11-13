//! shared/download-directories.ts: the default downloads path and up to four
//! saved download directories in `userPreferences`
//! (`downloadsPath`, `downloadDirectories`, `optionalDownloadsPaths`).

use serde_json::{Map, Value, json};

pub const MAX_DOWNLOAD_DIRECTORIES: usize = 5;
pub const MAX_OPTIONAL_DOWNLOAD_DIRECTORIES: usize = MAX_DOWNLOAD_DIRECTORIES - 1;
const SYNTHETIC_CREATED_AT_STEP_MS: i64 = 1000;

/// DownloadDirectoryPreference
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Directory {
    pub path: String,
    pub created_at: String,
    /// "auto" | "manual"
    pub source: String,
}

impl Directory {
    fn new(path: &str, created_at: String, source: &str) -> Directory {
        Directory {
            path: path.to_string(),
            created_at,
            source: source.to_string(),
        }
    }

    fn to_value(&self) -> Value {
        json!({ "path": self.path, "createdAt": self.created_at, "source": self.source })
    }
}

/// ResolvedDownloadDirectories
#[derive(Clone, Debug)]
pub struct Resolved {
    pub persisted_default_path: Option<String>,
    pub default_path: String,
    pub directories: Vec<Directory>,
    pub saved_paths: Vec<String>,
    pub all_paths: Vec<String>,
}

fn sanitize(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .map(str::to_string)
}

fn millis(iso: &str) -> Option<i64> {
    crate::library::parse_iso_millis(iso)
}

fn iso(ms: i64) -> String {
    let secs = ms.div_euclid(1000);
    let nanos = (ms.rem_euclid(1000) * 1_000_000) as u32;
    chrono_like(secs, nanos)
}

/// Date#toISOString without pulling a date crate into hydra-core's API.
fn chrono_like(secs: i64, nanos: u32) -> String {
    let days = secs.div_euclid(86_400);
    let rem = secs.rem_euclid(86_400);
    let (h, m, s) = (rem / 3600, (rem % 3600) / 60, rem % 60);
    // civil_from_days (Howard Hinnant)
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let mo = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if mo <= 2 { y + 1 } else { y };
    format!(
        "{y:04}-{mo:02}-{d:02}T{h:02}:{m:02}:{s:02}.{:03}Z",
        nanos / 1_000_000
    )
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.as_millis() as i64)
}

fn now_iso() -> String {
    iso(now_ms())
}

fn records_of(value: Option<&Value>) -> Vec<Option<Directory>> {
    value
        .and_then(Value::as_array)
        .map(|a| {
            a.iter()
                .map(|v| {
                    let path = v.get("path").and_then(Value::as_str)?;
                    Some(Directory {
                        path: path.to_string(),
                        created_at: v
                            .get("createdAt")
                            .and_then(Value::as_str)
                            .unwrap_or_default()
                            .to_string(),
                        source: v
                            .get("source")
                            .and_then(Value::as_str)
                            .unwrap_or_default()
                            .to_string(),
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}

/// normalizeDownloadDirectoryRecords
fn normalize(
    records: Vec<Option<Directory>>,
    fixed: &str,
    preserved: Option<&str>,
) -> Vec<Directory> {
    let mut list: Vec<(Directory, i64, usize)> = records
        .into_iter()
        .enumerate()
        .filter_map(|(index, record)| {
            let record = record?;
            let path = sanitize(Some(&record.path))?;
            if path == fixed {
                return None;
            }
            let created = millis(&record.created_at).map_or_else(|| iso(0), iso);
            let source = if record.source == "auto" {
                "auto"
            } else {
                "manual"
            };
            let ts = millis(&created).unwrap_or(0);
            Some((Directory::new(&path, created, source), ts, index))
        })
        .collect();
    list.sort_by(|a, b| {
        if a.1 == b.1 {
            a.2.cmp(&b.2)
        } else {
            b.1.cmp(&a.1)
        }
    });
    let mut seen = std::collections::HashSet::new();
    let unique: Vec<Directory> = list
        .into_iter()
        .map(|(d, _, _)| d)
        .filter(|d| seen.insert(d.path.clone()))
        .collect();
    let preserved = sanitize(preserved).filter(|p| p != fixed);
    let preserved_index = preserved
        .as_ref()
        .and_then(|p| unique.iter().position(|d| &d.path == p));
    match preserved_index {
        Some(index) if index >= MAX_OPTIONAL_DOWNLOAD_DIRECTORIES => {
            let mut limited: Vec<Directory> =
                unique[..MAX_OPTIONAL_DOWNLOAD_DIRECTORIES - 1].to_vec();
            limited.push(unique[index].clone());
            limited
        }
        _ => unique
            .into_iter()
            .take(MAX_OPTIONAL_DOWNLOAD_DIRECTORIES)
            .collect(),
    }
}

/// buildLegacyDownloadDirectoryRecords
fn legacy_records(preferences: &Map<String, Value>, fallback: &str) -> Vec<Option<Directory>> {
    let persisted = sanitize(preferences.get("downloadsPath").and_then(Value::as_str))
        .filter(|p| p != fallback);
    let mut ordered: Vec<String> = Vec::new();
    for path in preferences
        .get("optionalDownloadsPaths")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        if let Some(path) = sanitize(path.as_str())
            && !ordered.contains(&path)
        {
            ordered.push(path);
        }
    }
    if let Some(persisted) = persisted
        && !ordered.contains(&persisted)
    {
        ordered.insert(0, persisted);
    }
    let base = now_ms();
    ordered
        .into_iter()
        .filter(|p| p != fallback)
        .enumerate()
        .map(|(i, p)| {
            Some(Directory::new(
                &p,
                iso(base - i as i64 * SYNTHETIC_CREATED_AT_STEP_MS),
                "manual",
            ))
        })
        .collect()
}

/// resolveDownloadDirectories
pub fn resolve(preferences: &Map<String, Value>, fallback: &str) -> Resolved {
    let fallback = sanitize(Some(fallback)).unwrap_or_default();
    let raw_persisted = sanitize(preferences.get("downloadsPath").and_then(Value::as_str));
    let preserved = raw_persisted.clone().filter(|p| *p != fallback);
    let records = if preferences
        .get("downloadDirectories")
        .is_some_and(Value::is_array)
    {
        records_of(preferences.get("downloadDirectories"))
    } else {
        legacy_records(preferences, &fallback)
    };
    let directories = normalize(records, &fallback, preserved.as_deref());
    let saved_paths: Vec<String> = directories.iter().map(|d| d.path.clone()).collect();
    let persisted_default_path =
        raw_persisted.filter(|p| *p != fallback && saved_paths.contains(p));
    let default_path = persisted_default_path
        .clone()
        .unwrap_or_else(|| fallback.clone());
    let mut all_paths = saved_paths.clone();
    all_paths.push(fallback);
    Resolved {
        persisted_default_path,
        default_path,
        directories,
        saved_paths,
        all_paths,
    }
}

/// getDownloadDirectoryPreferences: the three keys to write back.
pub fn preferences_for(preferences: &Map<String, Value>, fallback: &str) -> Map<String, Value> {
    let resolved = resolve(preferences, fallback);
    let mut out = Map::new();
    out.insert(
        "downloadsPath".into(),
        resolved
            .persisted_default_path
            .map_or(Value::Null, Value::from),
    );
    out.insert(
        "downloadDirectories".into(),
        Value::Array(
            resolved
                .directories
                .iter()
                .map(Directory::to_value)
                .collect(),
        ),
    );
    out.insert(
        "optionalDownloadsPaths".into(),
        Value::Array(
            resolved
                .directories
                .iter()
                .map(|d| Value::from(d.path.clone()))
                .collect(),
        ),
    );
    out
}

fn with(downloads_path: Option<&str>, directories: &[Directory]) -> Map<String, Value> {
    let mut map = Map::new();
    map.insert(
        "downloadsPath".into(),
        downloads_path.map_or(Value::Null, Value::from),
    );
    map.insert(
        "downloadDirectories".into(),
        Value::Array(directories.iter().map(Directory::to_value).collect()),
    );
    map
}

/// PreparedDefaultDownloadPathSync
#[derive(Debug)]
pub enum Prepared {
    Noop,
    /// set-existing / add-and-set
    Set {
        preferences: Map<String, Value>,
        default_path: String,
    },
    ReplaceRequired {
        next_path: String,
        replaceable: Vec<Directory>,
        recommended: String,
    },
}

/// prepareDefaultDownloadPathSync
pub fn prepare_default_path_sync(
    preferences: &Map<String, Value>,
    next: &str,
    fallback: &str,
) -> Prepared {
    let resolved = resolve(preferences, fallback);
    let next = sanitize(Some(next));
    let fallback_s = sanitize(Some(fallback));
    let raw_persisted = sanitize(preferences.get("downloadsPath").and_then(Value::as_str));
    let current = raw_persisted
        .clone()
        .or_else(|| fallback_s.clone())
        .unwrap_or_default();
    let Some(next) = next.filter(|n| *n != current) else {
        return Prepared::Noop;
    };
    if Some(&next) == fallback_s.as_ref() {
        return Prepared::Set {
            preferences: preferences_for(&with(None, &resolved.directories), fallback),
            default_path: next,
        };
    }
    if resolved.saved_paths.contains(&next) {
        return Prepared::Set {
            preferences: preferences_for(&with(Some(&next), &resolved.directories), fallback),
            default_path: next,
        };
    }
    if let Some(recent) = resolved.directories.first().filter(|d| d.source == "auto") {
        let mut list = vec![Directory::new(&next, now_iso(), "auto")];
        list.extend(
            resolved
                .directories
                .iter()
                .filter(|d| d.path != recent.path && d.path != next)
                .cloned(),
        );
        return Prepared::Set {
            preferences: preferences_for(&with(Some(&next), &list), fallback),
            default_path: next,
        };
    }
    if resolved.saved_paths.len() < MAX_OPTIONAL_DOWNLOAD_DIRECTORIES {
        let mut list = vec![Directory::new(&next, now_iso(), "auto")];
        list.extend(resolved.directories.iter().cloned());
        return Prepared::Set {
            preferences: preferences_for(&with(Some(&next), &list), fallback),
            default_path: next,
        };
    }
    let current_saved = raw_persisted.filter(|p| resolved.saved_paths.contains(p));
    let recommended = current_saved
        .or_else(|| resolved.directories.last().map(|d| d.path.clone()))
        .or_else(|| resolved.directories.first().map(|d| d.path.clone()))
        .unwrap_or_else(|| next.clone());
    Prepared::ReplaceRequired {
        next_path: next,
        replaceable: resolved.directories,
        recommended,
    }
}

/// replaceSavedDownloadDirectoryAndSetDefault: (preferences, new default path)
pub fn replace_and_set_default(
    preferences: &Map<String, Value>,
    next: &str,
    to_replace: &str,
    fallback: &str,
) -> (Map<String, Value>, String) {
    let resolved = resolve(preferences, fallback);
    let (Some(next), Some(to_replace)) = (sanitize(Some(next)), sanitize(Some(to_replace))) else {
        return (
            preferences_for(preferences, fallback),
            resolved.default_path,
        );
    };
    if !resolved.saved_paths.contains(&to_replace) {
        return (
            preferences_for(preferences, fallback),
            resolved.default_path,
        );
    }
    let mut list = vec![Directory::new(&next, now_iso(), "auto")];
    list.extend(
        resolved
            .directories
            .iter()
            .filter(|d| d.path != to_replace && d.path != next)
            .cloned(),
    );
    (preferences_for(&with(Some(&next), &list), fallback), next)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn prefs(v: Value) -> Map<String, Value> {
        v.as_object().cloned().unwrap()
    }

    #[test]
    fn iso_round_trip() {
        assert_eq!(iso(0), "1970-01-01T00:00:00.000Z");
        assert_eq!(iso(1_700_000_000_123), "2023-11-14T22:13:20.123Z");
    }

    #[test]
    fn add_then_replace() {
        let fallback = "C:\\Downloads";
        let p = prefs(json!({}));
        let Prepared::Set {
            preferences,
            default_path,
        } = prepare_default_path_sync(&p, "D:\\Games", fallback)
        else {
            panic!()
        };
        assert_eq!(default_path, "D:\\Games");
        assert_eq!(preferences["downloadsPath"], "D:\\Games");
        assert_eq!(preferences["optionalDownloadsPaths"], json!(["D:\\Games"]));
        // choosing the fallback clears the persisted default but keeps the directory
        let Prepared::Set { preferences, .. } =
            prepare_default_path_sync(&preferences, fallback, fallback)
        else {
            panic!()
        };
        assert!(preferences["downloadsPath"].is_null());
        assert_eq!(preferences["optionalDownloadsPaths"], json!(["D:\\Games"]));
        // the same path is a no-op
        assert!(matches!(
            prepare_default_path_sync(&prefs(json!({})), fallback, fallback),
            Prepared::Noop
        ));
    }

    #[test]
    fn full_list_needs_replacement() {
        let fallback = "C:\\Downloads";
        let dirs: Vec<Value> = (1..=4)
            .map(|i| json!({ "path": format!("D:\\G{i}"), "createdAt": iso(1_000_000 * i), "source": "manual" }))
            .collect();
        let p = prefs(json!({ "downloadDirectories": dirs, "downloadsPath": "D:\\G2" }));
        match prepare_default_path_sync(&p, "E:\\New", fallback) {
            Prepared::ReplaceRequired {
                recommended,
                replaceable,
                ..
            } => {
                assert_eq!(recommended, "D:\\G2");
                assert_eq!(replaceable.len(), 4);
            }
            other => panic!("{other:?}"),
        }
        let (next, default_path) = replace_and_set_default(&p, "E:\\New", "D:\\G1", fallback);
        assert_eq!(default_path, "E:\\New");
        assert_eq!(
            next["optionalDownloadsPaths"],
            json!(["E:\\New", "D:\\G4", "D:\\G3", "D:\\G2"])
        );
    }
}
