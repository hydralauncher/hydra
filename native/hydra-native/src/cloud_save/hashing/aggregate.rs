use napi_derive::napi;
use serde::Serialize;

use crate::cloud_save::local_snapshot::types::LocalGameSnapshotFile;

#[napi(object)]
pub struct BuildSnapshotAggregateHashInput {
    pub files: Vec<LocalGameSnapshotFile>,
}

#[derive(Serialize)]
struct CanonicalSnapshotFile<'a> {
    #[serde(rename = "rawPath")]
    raw_path: &'a str,
    #[serde(rename = "relativePath")]
    relative_path: &'a str,
    hash: &'a str,
    #[serde(rename = "sizeBytes")]
    size_bytes: u64,
    #[serde(rename = "lastModifiedAt")]
    last_modified_at: &'a str,
}

#[derive(Serialize)]
struct CanonicalSnapshot<'a> {
    files: Vec<CanonicalSnapshotFile<'a>>,
}

pub fn build_hash(mut input: BuildSnapshotAggregateHashInput) -> Result<String, String> {
    input.files.sort_by(|left, right| {
        left.raw_path
            .cmp(&right.raw_path)
            .then_with(|| left.relative_path.cmp(&right.relative_path))
    });

    let snapshot = CanonicalSnapshot {
        files: input
            .files
            .iter()
            .map(|file| CanonicalSnapshotFile {
                raw_path: &file.raw_path,
                relative_path: &file.relative_path,
                hash: &file.hash,
                size_bytes: file.size_bytes as u64,
                last_modified_at: &file.last_modified_at,
            })
            .collect(),
    };
    let serialized = serde_json::to_vec(&snapshot).map_err(|error| error.to_string())?;

    Ok(blake3::hash(&serialized).to_hex().to_string())
}
