use napi_derive::napi;

use crate::cloud_save::hashing::LocalFileHashCacheEntry;

#[napi(object)]
pub struct BuildLocalGameSnapshotPipelineInput {
    pub shop: String,
    pub object_id: String,
    pub title: Option<String>,
    pub remote_id: Option<String>,
    pub user_data_path: String,
    pub source_url: Option<String>,
    pub platform: String,
    pub home_dir: String,
    pub documents_dir: Option<String>,
    pub app_data_dir: Option<String>,
    pub executable_path: Option<String>,
    pub wine_prefix_path: Option<String>,
    pub wine_prefix_is_explicit: Option<bool>,
    pub steam_path: Option<String>,
    pub hash_cache: Vec<LocalFileHashCacheEntry>,
}
