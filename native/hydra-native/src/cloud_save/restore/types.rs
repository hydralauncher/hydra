use napi_derive::napi;

use crate::cloud_save::identity::{SnapshotVariant, StoreUserContext};

#[napi(object)]
#[derive(Clone)]
pub struct RestoreManifestFile {
    pub variant_id: String,
    pub raw_path: String,
    pub relative_path: String,
    pub hash: String,
    pub size_bytes: f64,
    pub last_modified_at: String,
}

#[napi(object)]
#[derive(Clone)]
pub struct ApprovedRestoreRule {
    pub kind: String,
    pub raw_rule: String,
    pub source: String,
}

#[napi(object)]
pub struct ResolveRestoreTargetsInput {
    pub shop: String,
    pub object_id: String,
    pub platform: String,
    pub home_dir: String,
    pub documents_dir: Option<String>,
    pub app_data_dir: Option<String>,
    pub executable_path: Option<String>,
    pub wine_prefix_path: Option<String>,
    pub steam_path: Option<String>,
    pub store_user_context: StoreUserContext,
    pub approved_rules: Vec<ApprovedRestoreRule>,
    pub variants: Vec<SnapshotVariant>,
    pub files: Vec<RestoreManifestFile>,
}

#[napi(object)]
pub struct ResolvedRestoreTarget {
    pub variant_id: String,
    pub raw_path: String,
    pub relative_path: String,
    pub target_path: String,
    pub restore_root_path: String,
    pub hash: String,
    pub size_bytes: f64,
    pub last_modified_at: String,
    pub action: String,
}

#[napi(object)]
pub struct BlockedRestoreFile {
    pub variant_id: String,
    pub raw_path: String,
    pub relative_path: String,
    pub hash: String,
    pub size_bytes: f64,
    pub last_modified_at: String,
    pub reason: String,
}

#[napi(object)]
pub struct ResolveRestoreTargetsResult {
    pub actions: Vec<ResolvedRestoreTarget>,
    pub blocked: Vec<BlockedRestoreFile>,
}

#[napi(object)]
pub struct VerifyDownloadedRestoreFileResult {
    pub ok: bool,
    pub reason: Option<String>,
}

#[napi(string_enum = "lowercase")]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum RestoreTargetAction {
    Restore,
    Skip,
}

#[napi(object)]
#[derive(Clone)]
pub struct ReplaceRestoreTarget {
    pub variant_id: String,
    pub raw_path: String,
    pub relative_path: String,
    pub target_path: String,
    pub restore_root_path: String,
    pub last_modified_at: String,
    pub action: RestoreTargetAction,
    pub temp_path: Option<String>,
    pub expected_hash: Option<String>,
}

#[napi(object)]
pub struct RestoreResultFile {
    pub variant_id: String,
    pub raw_path: String,
    pub relative_path: String,
    pub target_path: String,
    pub restore_root_path: String,
    pub last_modified_at: String,
}

#[napi(object)]
pub struct RestoreSkippedFile {
    pub variant_id: String,
    pub raw_path: String,
    pub relative_path: String,
    pub target_path: String,
    pub restore_root_path: String,
    pub last_modified_at: String,
    pub reason: String,
}

#[napi(object)]
pub struct RestoreFailedFile {
    pub variant_id: String,
    pub raw_path: String,
    pub relative_path: String,
    pub target_path: String,
    pub restore_root_path: String,
    pub last_modified_at: String,
    pub reason: String,
}

#[napi(object)]
pub struct RestoreMetadataFailure {
    pub path: String,
    pub kind: String,
    pub reason: String,
}

#[napi(object)]
pub struct ReplaceRestoreTargetsResult {
    pub restored_files: Vec<RestoreResultFile>,
    pub skipped_files: Vec<RestoreSkippedFile>,
    pub failed_files: Vec<RestoreFailedFile>,
    pub metadata_failures: Vec<RestoreMetadataFailure>,
    pub updated_directory_count: u32,
}
