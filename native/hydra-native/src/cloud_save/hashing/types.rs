use crate::cloud_save::identity::SnapshotVariant;
use napi_derive::napi;

#[napi(object)]
#[derive(Clone, Debug)]
pub struct SnapshotAggregateHashFile {
    pub variant_id: String,
    pub raw_path: String,
    pub relative_path: String,
    pub hash: String,
    pub size_bytes: f64,
}

#[napi(object)]
pub struct BuildSnapshotAggregateHashInput {
    pub variants: Vec<SnapshotVariant>,
    pub files: Vec<SnapshotAggregateHashFile>,
}

#[napi(object)]
#[derive(Clone, Debug)]
pub struct LocalFileHashCacheEntry {
    pub absolute_path: String,
    pub size_bytes: f64,
    pub last_modified_at: String,
    pub hash: String,
    pub algorithm: Option<String>,
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
