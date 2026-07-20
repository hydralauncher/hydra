use napi_derive::napi;

#[napi(object)]
pub struct RestoreManifestFile {
    pub raw_path: String,
    pub relative_path: String,
    pub hash: String,
    pub size_bytes: f64,
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
    pub wine_prefix_is_explicit: Option<bool>,
    pub steam_path: Option<String>,
    pub files: Vec<RestoreManifestFile>,
}

#[napi(object)]
pub struct ResolvedRestoreTarget {
    pub raw_path: String,
    pub relative_path: String,
    pub target_path: String,
    pub hash: String,
    pub size_bytes: f64,
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
    pub raw_path: String,
    pub relative_path: String,
    pub target_path: String,
    pub action: RestoreTargetAction,
    pub temp_path: Option<String>,
    pub expected_hash: Option<String>,
}

#[napi(object)]
pub struct RestoreResultFile {
    pub raw_path: String,
    pub relative_path: String,
    pub target_path: String,
}

#[napi(object)]
pub struct RestoreSkippedFile {
    pub raw_path: String,
    pub relative_path: String,
    pub target_path: String,
    pub reason: String,
}

#[napi(object)]
pub struct RestoreFailedFile {
    pub raw_path: String,
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
