use std::fs;

use time::OffsetDateTime;

use crate::cloud_save::hashing::hash_file;

use super::types::{DiscoveredLocalSaveFile, LocalSaveSnapshotFile};

fn format_modified_at(modified: std::time::SystemTime) -> String {
    let datetime = OffsetDateTime::from(modified);
    format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}.{:03}Z",
        datetime.year(),
        u8::from(datetime.month()),
        datetime.day(),
        datetime.hour(),
        datetime.minute(),
        datetime.second(),
        datetime.millisecond()
    )
}

pub fn build_file(file: DiscoveredLocalSaveFile) -> Result<LocalSaveSnapshotFile, String> {
    let metadata = fs::metadata(&file.absolute_path).map_err(|error| error.to_string())?;
    let modified = metadata.modified().map_err(|error| error.to_string())?;
    let hash = hash_file(&file.absolute_path)?;

    Ok(LocalSaveSnapshotFile {
        raw_path: file.raw_path,
        absolute_path: file.absolute_path,
        root_path: file.root_path,
        relative_path: file.relative_path,
        source: file.source,
        hash,
        size_bytes: metadata.len() as f64,
        last_modified_at: format_modified_at(modified),
    })
}
