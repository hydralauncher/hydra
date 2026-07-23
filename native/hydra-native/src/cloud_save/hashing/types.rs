use crate::cloud_save::identity::PortableLocator;
use napi_derive::napi;

#[napi(object)]
#[derive(Clone, Debug)]
pub struct SnapshotAggregateHashFile {
    pub logical_file_id: String,
    pub variant_id: String,
    pub rule_id: String,
    pub relative_path: String,
    pub locator: PortableLocator,
    pub content_hash: String,
    pub size_bytes: f64,
}

#[napi(object)]
pub struct BuildSnapshotAggregateHashInput {
    pub schema_version: u32,
    pub save_namespace_key: String,
    pub files: Vec<SnapshotAggregateHashFile>,
}

#[napi(object)]
#[derive(Clone, Debug)]
pub struct LocalFileHashCacheEntry {
    pub absolute_path: String,
    pub size_bytes: f64,
    pub last_modified_at: String,
    pub hash: String,
}

#[derive(Clone, Debug)]
pub struct HashedLocalFile {
    pub absolute_path: String,
    pub size_bytes: f64,
    pub last_modified_at: String,
    pub hash: String,
}

#[derive(Debug)]
pub struct HashFilesResult {
    pub files: Vec<HashedLocalFile>,
    pub hash_cache: Vec<LocalFileHashCacheEntry>,
}
