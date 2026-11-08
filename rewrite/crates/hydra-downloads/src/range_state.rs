//! range-download-state.ts: which byte ranges of a partial file are saved,
//! kept next to (not in) the download folder so a restart resumes them. The
//! file names and JSON are Electron's, so its partial downloads carry over.

use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

/// `[start, end)`: only bytes already written.
pub type SavedRange = [u64; 2];

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RangeState {
    pub version: u8,
    pub total: u64,
    pub validator: String,
    pub resource_id: Option<String>,
    pub ranges: Vec<SavedRange>,
}

const MAX_RANGE_STATE_SIZE_BYTES: u64 = 1024 * 1024;
/// Number.MAX_SAFE_INTEGER
const MAX_SAFE_INTEGER: u64 = (1 << 53) - 1;

static DIRECTORY: OnceLock<PathBuf> = OnceLock::new();

/// configureRangeStateDirectory: `<userData>/DownloadRanges`.
pub fn configure_directory(directory: PathBuf) {
    let _ = DIRECTORY.set(std::path::absolute(&directory).unwrap_or(directory));
}

fn sha256_hex(text: &str) -> String {
    Sha256::digest(text.as_bytes())
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

/// rangeStatePath: `<dir>/<sha256(absolute path, lowercased on Windows)>.json`
pub fn state_path(file: &Path) -> Result<PathBuf, String> {
    let dir = DIRECTORY
        .get()
        .ok_or("Range metadata directory is not configured")?;
    let absolute = std::path::absolute(file).unwrap_or_else(|_| file.to_path_buf());
    let mut identity = absolute.to_string_lossy().into_owned();
    if cfg!(windows) {
        identity = identity.to_lowercase();
    }
    Ok(dir.join(format!("{}.json", sha256_hex(&identity))))
}

/// rangeResourceId
pub fn resource_id(resource_id: Option<&str>) -> Option<String> {
    resource_id.filter(|r| !r.is_empty()).map(sha256_hex)
}

fn is_sha256(text: &str) -> bool {
    text.len() == 64
        && text
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

const INVALID: &str = "The saved byte ranges are invalid. Keeping the partial file.";

/// readRangeState
pub fn read(file: &Path) -> Result<Option<RangeState>, String> {
    let path = state_path(file)?;
    match std::fs::symlink_metadata(&path) {
        Ok(meta) if meta.is_file() && meta.len() <= MAX_RANGE_STATE_SIZE_BYTES => {}
        Ok(_) => return Err(INVALID.into()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err(INVALID.into()),
    }
    let text = std::fs::read_to_string(&path).map_err(|_| INVALID.to_string())?;
    let file_meta = match std::fs::symlink_metadata(file) {
        Ok(meta) => meta,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            remove(file);
            return Ok(None);
        }
        Err(_) => return Err(INVALID.into()),
    };
    let state: RangeState = serde_json::from_str(&text).map_err(|_| INVALID.to_string())?;
    let valid_header = state.version == 1
        && state.total > 0
        && state.total <= MAX_SAFE_INTEGER
        && !state.validator.is_empty()
        && state.resource_id.as_deref().is_none_or(is_sha256)
        && file_meta.is_file()
        && file_meta.len() <= state.total;
    if !valid_header {
        return Err(INVALID.into());
    }
    let mut previous_end: Option<u64> = None;
    for [start, end] in &state.ranges {
        let ordered = previous_end.is_none_or(|p| *start > p);
        if !ordered || end <= start || *end > state.total || *end > file_meta.len() {
            return Err(INVALID.into());
        }
        previous_end = Some(*end);
    }
    Ok(Some(state))
}

/// markSavedRange: merge `[start, end)` into the sorted list.
pub fn mark_saved(state: &mut RangeState, mut start: u64, mut end: u64) {
    let ranges = &mut state.ranges;
    let mut index = 0;
    while index < ranges.len() && ranges[index][1] < start {
        index += 1;
    }
    let first = index;
    while index < ranges.len() && ranges[index][0] <= end {
        start = start.min(ranges[index][0]);
        end = end.max(ranges[index][1]);
        index += 1;
    }
    ranges.splice(first..index, [[start, end]]);
}

/// missingRanges
pub fn missing(state: &RangeState) -> Vec<SavedRange> {
    let mut gaps = Vec::new();
    let mut next = 0;
    for [start, end] in &state.ranges {
        if *start > next {
            gaps.push([next, *start]);
        }
        next = *end;
    }
    if next < state.total {
        gaps.push([next, state.total]);
    }
    gaps
}

/// savedRangeBytes
pub fn saved_bytes(state: &RangeState) -> u64 {
    state.ranges.iter().map(|[s, e]| e - s).sum()
}

/// getRangeDownloadedBytes: the saved ranges, else the file's size.
pub fn downloaded_bytes(file: &Path) -> Result<u64, String> {
    if let Some(state) = read(file)? {
        return Ok(saved_bytes(&state));
    }
    match std::fs::metadata(file) {
        Ok(meta) => Ok(meta.len()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(0),
        Err(e) => Err(e.to_string()),
    }
}

/// saveMetadata: write a temporary file, fsync, rename over the target.
fn save_metadata(target: &Path, contents: &str) -> Result<(), String> {
    use std::io::Write;
    if let Some(parent) = target.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let temporary = target.with_file_name(format!(
        "{}.{}.tmp",
        target.file_name().unwrap_or_default().to_string_lossy(),
        uuid::Uuid::new_v4()
    ));
    let result = (|| {
        let mut file = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)?;
        file.write_all(contents.as_bytes())?;
        file.sync_all()?;
        drop(file);
        std::fs::rename(&temporary, target)
    })();
    let _ = std::fs::remove_file(&temporary);
    result.map_err(|e| e.to_string())
}

/// saveRangeState
pub fn save(file: &Path, state: &RangeState) -> Result<(), String> {
    save_metadata(
        &state_path(file)?,
        &serde_json::to_string(state).map_err(|e| e.to_string())?,
    )
}

/// removeRangeState
pub fn remove(file: &Path) {
    if let Ok(path) = state_path(file) {
        let _ = std::fs::remove_file(path);
    }
}

fn identity_path(file: &Path) -> Result<PathBuf, String> {
    let mut path = state_path(file)?.into_os_string();
    path.push(".identity");
    Ok(PathBuf::from(path))
}

/// readResourceIdentity
pub fn read_identity(file: &Path) -> Result<Option<String>, String> {
    const BAD: &str = "The saved download identity is invalid. Keeping the partial file.";
    let path = identity_path(file)?;
    match std::fs::symlink_metadata(&path) {
        Ok(meta) if meta.is_file() && meta.len() <= MAX_RANGE_STATE_SIZE_BYTES => {}
        Ok(_) => return Err(BAD.into()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err(BAD.into()),
    }
    let value: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(&path).map_err(|_| BAD.to_string())?)
            .map_err(|_| BAD.to_string())?;
    let id = value
        .get("resourceId")
        .and_then(|v| v.as_str())
        .filter(|id| is_sha256(id));
    if value.get("version").and_then(|v| v.as_u64()) != Some(1) || id.is_none() {
        return Err(BAD.into());
    }
    Ok(id.map(str::to_string))
}

/// saveResourceIdentity
pub fn save_identity(file: &Path, resource: &str) -> Result<(), String> {
    let contents =
        serde_json::json!({ "version": 1, "resourceId": resource_id(Some(resource)) }).to_string();
    save_metadata(&identity_path(file)?, &contents)
}

/// removeResourceIdentity
pub fn remove_identity(file: &Path) {
    if let Ok(path) = identity_path(file) {
        let _ = std::fs::remove_file(path);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn state(ranges: Vec<SavedRange>) -> RangeState {
        RangeState {
            version: 1,
            total: 100,
            validator: "\"x\"".into(),
            resource_id: None,
            ranges,
        }
    }

    #[test]
    fn merges_and_finds_gaps() {
        let mut s = state(vec![]);
        mark_saved(&mut s, 10, 20);
        mark_saved(&mut s, 30, 40);
        mark_saved(&mut s, 20, 30);
        assert_eq!(s.ranges, vec![[10, 40]]);
        assert_eq!(missing(&s), vec![[0, 10], [40, 100]]);
        assert_eq!(saved_bytes(&s), 30);
    }

    #[test]
    fn json_matches_electron() {
        let s = state(vec![[0, 5]]);
        assert_eq!(
            serde_json::to_string(&s).unwrap(),
            r#"{"version":1,"total":100,"validator":"\"x\"","resourceId":null,"ranges":[[0,5]]}"#
        );
    }

    #[test]
    fn path_hash_is_sha256_of_the_path() {
        let dir = std::env::temp_dir().join("hydra-ranges-test");
        configure_directory(dir.clone());
        let file = if cfg!(windows) {
            PathBuf::from(r"C:\Games\A.zip")
        } else {
            PathBuf::from("/games/A.zip")
        };
        let expected = sha256_hex(&if cfg!(windows) {
            r"c:\games\a.zip".to_string()
        } else {
            "/games/A.zip".to_string()
        });
        assert_eq!(
            state_path(&file).unwrap(),
            dir.join(format!("{expected}.json"))
        );
    }
}
