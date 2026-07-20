use napi_derive::napi;

use crate::cloud_save::manifest::types::{CloudSaveRule, CloudSaveRuleCondition};

#[napi(object)]
pub struct ResolveSaveRulesInput {
    pub shop: String,
    pub object_id: String,
    pub platform: String,
    pub home_dir: String,
    pub documents_dir: Option<String>,
    pub app_data_dir: Option<String>,
    pub executable_path: Option<String>,
    pub wine_prefix_path: Option<String>,
    pub steam_path: Option<String>,
    pub rules: Vec<CloudSaveRule>,
}

pub struct PathResolutionContext {
    pub shop: String,
    pub object_id: String,
    pub platform: String,
    pub home_dir: String,
    pub os_username: String,
    pub documents_dir: Option<String>,
    pub app_data_dir: Option<String>,
    pub local_app_data_dir: Option<String>,
    pub public_dir: Option<String>,
    pub program_data_dir: Option<String>,
    pub windows_dir: Option<String>,
    pub saved_games_dir: Option<String>,
    pub xdg_data_dir: Option<String>,
    pub xdg_config_dir: Option<String>,
    pub install_dir: Option<String>,
    pub wine_prefix_path: Option<String>,
    pub windows_compatibility: bool,
    pub derived_steam_root: Option<String>,
    pub configured_steam_root: Option<String>,
}

#[napi(object)]
#[derive(Clone, Debug)]
pub struct ResolvedCloudSavePath {
    pub path: String,
    pub case_sensitive: bool,
    pub dynamic: bool,
    pub scan_root: Option<String>,
}

#[napi(object)]
pub struct ResolvedCloudSaveRule {
    pub kind: String,
    pub raw_path: String,
    pub source: String,
    pub tags: Vec<String>,
    pub when: Vec<CloudSaveRuleCondition>,
    pub resolved_paths: Vec<ResolvedCloudSavePath>,
    pub unresolved_tokens: Vec<String>,
}
