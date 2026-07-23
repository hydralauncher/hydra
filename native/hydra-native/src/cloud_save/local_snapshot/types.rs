use napi_derive::napi;

use crate::cloud_save::hashing::LocalFileHashCacheEntry;
use crate::cloud_save::identity::{LocalResolutionBindings, PortableLocator, UserLocationCoverage};
use crate::cloud_save::manifest::types::CloudSaveGameId;

#[napi(object)]
#[derive(Clone, Debug)]
pub struct DiscoveredLocalSaveFile {
    pub logical_file_id: String,
    pub variant_id: String,
    pub rule_id: String,
    pub absolute_path: String,
    pub relative_path: String,
    pub locator: PortableLocator,
    pub local_bindings: LocalResolutionBindings,
    pub confidence: String,
    pub provenance: Vec<String>,
}

#[napi(object)]
pub struct BuildLocalGameSnapshotInput {
    pub game_id: CloudSaveGameId,
    pub manifest_key: Option<String>,
    pub schema_version: u32,
    pub save_namespace_key: String,
    pub rule_source_revision: String,
    pub discovery_engine_version: u32,
    pub coverage: Vec<UserLocationCoverage>,
    pub files: Vec<DiscoveredLocalSaveFile>,
    pub hash_cache: Vec<LocalFileHashCacheEntry>,
}

#[napi(object)]
#[derive(Clone, Debug)]
pub struct LocalGameSnapshotFile {
    pub logical_file_id: String,
    pub variant_id: String,
    pub rule_id: String,
    pub relative_path: String,
    pub locator: PortableLocator,
    pub content_hash: String,
    pub size_bytes: f64,
}

#[napi(object)]
#[derive(Clone, Debug)]
pub struct LocalGameSnapshotSourceFile {
    pub logical_file_id: String,
    pub variant_id: String,
    pub rule_id: String,
    pub relative_path: String,
    pub absolute_path: String,
    pub content_hash: String,
    pub size_bytes: f64,
    pub last_modified_at: String,
    pub local_bindings: LocalResolutionBindings,
    pub confidence: String,
    pub provenance: Vec<String>,
}

#[napi(object)]
pub struct LocalGameSnapshotWithHash {
    pub game_id: CloudSaveGameId,
    pub manifest_key: Option<String>,
    pub schema_version: u32,
    pub save_namespace_key: String,
    pub rule_source_revision: String,
    pub discovery_engine_version: u32,
    pub coverage: Vec<UserLocationCoverage>,
    pub file_count: u32,
    pub total_size_bytes: f64,
    pub files: Vec<LocalGameSnapshotFile>,
    pub aggregate_hash: String,
    pub source_files: Vec<LocalGameSnapshotSourceFile>,
    pub hash_cache: Vec<LocalFileHashCacheEntry>,
}

#[derive(Clone, Debug)]
pub(crate) struct BuiltLocalSaveFile {
    pub logical_file_id: String,
    pub variant_id: String,
    pub rule_id: String,
    pub relative_path: String,
    pub absolute_path: String,
    pub locator: PortableLocator,
    pub content_hash: String,
    pub size_bytes: f64,
    pub last_modified_at: String,
    pub local_bindings: LocalResolutionBindings,
    pub confidence: String,
    pub provenance: Vec<String>,
}
