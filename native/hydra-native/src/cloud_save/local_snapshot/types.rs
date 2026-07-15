use napi_derive::napi;

use crate::cloud_save::hashing::LocalFileHashCacheEntry;
use crate::cloud_save::manifest::types::CloudSaveGameId;

#[napi(object)]
#[derive(Clone, Debug)]
pub struct DiscoveredLocalSaveFile {
    pub raw_path: String,
    pub absolute_path: String,
    pub relative_path: String,
}

#[napi(object)]
pub struct BuildLocalGameSnapshotInput {
    pub game_id: CloudSaveGameId,
    pub manifest_key: Option<String>,
    pub files: Vec<DiscoveredLocalSaveFile>,
    pub hash_cache: Vec<LocalFileHashCacheEntry>,
}

#[napi(object)]
#[derive(Clone, Debug)]
pub struct LocalGameSnapshotFile {
    pub raw_path: String,
    pub relative_path: String,
    pub hash: String,
    pub size_bytes: f64,
    pub last_modified_at: String,
}

#[napi(object)]
#[derive(Clone, Debug)]
pub struct LocalGameSnapshotSourceFile {
    pub raw_path: String,
    pub relative_path: String,
    pub absolute_path: String,
    pub hash: String,
    pub size_bytes: f64,
}

#[napi(object)]
pub struct LocalGameSnapshotWithHash {
    pub game_id: CloudSaveGameId,
    pub manifest_key: Option<String>,
    pub file_count: u32,
    pub total_size_bytes: f64,
    pub files: Vec<LocalGameSnapshotFile>,
    pub aggregate_hash: String,
    pub source_files: Vec<LocalGameSnapshotSourceFile>,
    pub hash_cache: Vec<LocalFileHashCacheEntry>,
}

#[derive(Clone, Debug)]
pub(crate) struct BuiltLocalSaveFile {
    pub raw_path: String,
    pub relative_path: String,
    pub absolute_path: String,
    pub hash: String,
    pub size_bytes: f64,
    pub last_modified_at: String,
}
