use std::collections::HashMap;

use napi_derive::napi;

use crate::cloud_save::manifest::types::{CloudSaveRule, CloudSaveRuleCondition};

pub const PATH_RESOLUTION_TOKENS: [&str; 10] = [
    "<base>",
    "<home>",
    "<storeUserId>",
    "<winAppData>",
    "<winLocalAppData>",
    "<winDocuments>",
    "<winPublic>",
    "<winProgramData>",
    "%APPDATA%",
    "%LOCALAPPDATA%",
];

pub const WINDOWS_LIKE_TOKENS: [&str; 7] = [
    "<winAppData>",
    "<winLocalAppData>",
    "<winDocuments>",
    "<winPublic>",
    "<winProgramData>",
    "%APPDATA%",
    "%LOCALAPPDATA%",
];

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
    pub proton_path: Option<String>,
    pub steam_path: Option<String>,
    pub steam_user_ids: Vec<String>,
    pub rules: Vec<CloudSaveRule>,
}

pub struct PathResolutionContext {
    pub platform: String,
    pub home_dir: String,
    pub documents_dir: Option<String>,
    pub app_data_dir: Option<String>,
    pub local_app_data_dir: Option<String>,
    pub public_dir: Option<String>,
    pub program_data_dir: Option<String>,
    pub install_dir: Option<String>,
    pub wine_prefix_path: Option<String>,
}

pub type TokenMap = HashMap<&'static str, Vec<String>>;

#[napi(object)]
pub struct ResolvedCloudSaveRule {
    pub kind: String,
    pub raw_path: String,
    pub source: String,
    pub tags: Vec<String>,
    pub when: Vec<CloudSaveRuleCondition>,
    pub resolved_paths: Vec<String>,
    pub unresolved_tokens: Vec<String>,
}
