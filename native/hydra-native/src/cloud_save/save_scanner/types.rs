use napi_derive::napi;

use crate::cloud_save::identity::UserLocationCoverage;
use crate::cloud_save::manifest::types::CloudSaveRuleCondition;
use crate::cloud_save::path_resolution::ResolvedCloudSavePath;

#[napi(object)]
#[derive(Clone, Debug)]
pub struct ScannedCloudSaveFile {
    pub absolute_path: String,
    pub relative_path: String,
}

#[napi(object)]
#[derive(Clone, Debug)]
pub struct ScannedCloudSavePath {
    pub candidate_id: String,
    pub resolved_path: String,
    pub store_user_id: Option<String>,
    pub case_sensitive: bool,
    pub files: Vec<ScannedCloudSaveFile>,
}

#[napi(object)]
#[derive(Debug)]
pub struct ScannedCloudSaveRule {
    pub rule_id: String,
    pub kind: String,
    pub raw_path: String,
    pub source: String,
    pub tags: Vec<String>,
    pub when: Vec<CloudSaveRuleCondition>,
    pub resolved_paths: Vec<ResolvedCloudSavePath>,
    pub unresolved_tokens: Vec<String>,
    pub scanned_paths: Vec<ScannedCloudSavePath>,
    pub coverage: Vec<UserLocationCoverage>,
}
