use napi_derive::napi;

use crate::cloud_save::identity::{PortableLocator, StoreUserContext};

#[napi(object)]
#[derive(Clone)]
pub struct RestoreManifestFile {
    pub logical_file_id: String,
    pub variant_id: String,
    pub rule_id: String,
    pub relative_path: String,
    pub locator: PortableLocator,
    pub content_hash: String,
    pub size_bytes: f64,
}

#[napi(object)]
#[derive(Clone)]
pub struct ApprovedRestoreRule {
    pub rule_id: String,
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
    pub files: Vec<RestoreManifestFile>,
}

#[napi(object)]
pub struct ResolvedRestoreTarget {
    pub logical_file_id: String,
    pub variant_id: String,
    pub rule_id: String,
    pub relative_path: String,
    pub target_path: String,
    pub content_hash: String,
    pub size_bytes: f64,
    pub action: String,
}

#[napi(object)]
pub struct BlockedRestoreFile {
    pub logical_file_id: String,
    pub variant_id: String,
    pub rule_id: String,
    pub relative_path: String,
    pub locator: PortableLocator,
    pub content_hash: String,
    pub size_bytes: f64,
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
    pub logical_file_id: String,
    pub variant_id: String,
    pub rule_id: String,
    pub relative_path: String,
    pub target_path: String,
    pub action: RestoreTargetAction,
    pub temp_path: Option<String>,
    pub expected_hash: Option<String>,
}

#[napi(object)]
pub struct RestoreResultFile {
    pub logical_file_id: String,
    pub variant_id: String,
    pub rule_id: String,
    pub relative_path: String,
    pub target_path: String,
}

#[napi(object)]
pub struct RestoreSkippedFile {
    pub logical_file_id: String,
    pub variant_id: String,
    pub rule_id: String,
    pub relative_path: String,
    pub target_path: String,
    pub reason: String,
}

#[napi(object)]
pub struct RestoreFailedFile {
    pub logical_file_id: String,
    pub variant_id: String,
    pub rule_id: String,
    pub relative_path: String,
    pub target_path: String,
    pub reason: String,
}

#[napi(object)]
pub struct ReplaceRestoreTargetsResult {
    pub restored_files: Vec<RestoreResultFile>,
    pub skipped_files: Vec<RestoreSkippedFile>,
    pub failed_files: Vec<RestoreFailedFile>,
}
