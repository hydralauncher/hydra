use napi_derive::napi;

use crate::cloud_save::manifest::types::CloudSaveGameId;

#[napi(object)]
pub struct DiscoveredLocalSaveFile {
    pub raw_path: String,
    pub absolute_path: String,
    pub root_path: String,
    pub relative_path: String,
    pub source: String,
}

#[napi(object)]
pub struct LocalSaveSnapshotFile {
    pub raw_path: String,
    pub absolute_path: String,
    pub root_path: String,
    pub relative_path: String,
    pub source: String,
    pub hash: String,
    pub size_bytes: f64,
    pub last_modified_at: String,
}

#[napi(object)]
#[derive(Clone)]
pub struct LocalGameSnapshotFile {
    pub raw_path: String,
    pub relative_path: String,
    pub hash: String,
    pub size_bytes: f64,
    pub last_modified_at: String,
}

#[napi(object)]
pub struct BuildLocalGameSnapshotInput {
    pub files: Vec<LocalSaveSnapshotFile>,
    pub game_id: CloudSaveGameId,
    pub manifest_key: Option<String>,
}

#[napi(object)]
pub struct LocalGameSnapshot {
    pub game_id: CloudSaveGameId,
    pub manifest_key: Option<String>,
    pub file_count: u32,
    pub total_size_bytes: f64,
    pub files: Vec<LocalGameSnapshotFile>,
}
