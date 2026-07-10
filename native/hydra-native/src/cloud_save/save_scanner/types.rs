use napi_derive::napi;

use crate::cloud_save::manifest::types::CloudSaveRuleCondition;

#[napi(object)]
#[derive(Debug)]
pub struct ScannedCloudSaveFile {
    pub absolute_path: String,
    pub relative_path: String,
}

#[napi(object)]
#[derive(Debug)]
pub struct ScannedCloudSavePath {
    pub resolved_path: String,
    pub files: Vec<ScannedCloudSaveFile>,
}

#[napi(object)]
pub struct ScannedCloudSaveRule {
    pub kind: String,
    pub raw_path: String,
    pub source: String,
    pub tags: Vec<String>,
    pub when: Vec<CloudSaveRuleCondition>,
    pub resolved_paths: Vec<String>,
    pub unresolved_tokens: Vec<String>,
    pub scanned_paths: Vec<ScannedCloudSavePath>,
}
