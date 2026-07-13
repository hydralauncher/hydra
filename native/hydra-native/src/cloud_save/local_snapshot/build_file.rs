use std::fs;

use time::OffsetDateTime;

use crate::cloud_save::hashing::hash_file;

use super::types::{DiscoveredLocalSaveFile, LocalFileHashCacheEntry, LocalSaveSnapshotFile};

fn format_modified_at(modified: std::time::SystemTime) -> String {
    let datetime = OffsetDateTime::from(modified);
    format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}.{:09}Z",
        datetime.year(),
        u8::from(datetime.month()),
        datetime.day(),
        datetime.hour(),
        datetime.minute(),
        datetime.second(),
        datetime.nanosecond()
    )
}

fn is_valid_hash(hash: &str) -> bool {
    hash.len() == 64
        && hash
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

pub fn build_file(
    file: DiscoveredLocalSaveFile,
    cached: Option<&LocalFileHashCacheEntry>,
) -> Result<LocalSaveSnapshotFile, String> {
    let metadata = fs::metadata(&file.absolute_path).map_err(|error| error.to_string())?;
    let modified = metadata.modified().map_err(|error| error.to_string())?;
    let size_bytes = metadata.len() as f64;
    let last_modified_at = format_modified_at(modified);
    let hash = cached
        .filter(|entry| {
            entry.absolute_path == file.absolute_path
                && entry.size_bytes == size_bytes
                && entry.last_modified_at == last_modified_at
                && is_valid_hash(&entry.hash)
        })
        .map(|entry| entry.hash.clone())
        .map_or_else(|| hash_file(&file.absolute_path), Ok)?;

    Ok(LocalSaveSnapshotFile {
        raw_path: file.raw_path,
        absolute_path: file.absolute_path,
        root_path: file.root_path,
        relative_path: file.relative_path,
        source: file.source,
        hash,
        size_bytes,
        last_modified_at,
    })
}
