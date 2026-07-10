use indexmap::IndexMap;
use napi_derive::napi;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ManifestRuleCondition {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub os: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub store: Option<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ManifestFileRule {
    pub raw_path: String,
    pub tags: Vec<String>,
    pub when: Vec<ManifestRuleCondition>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ManifestGameEntry {
    pub manifest_key: String,
    pub files: Vec<ManifestFileRule>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ManifestIndex {
    pub version: u8,
    pub fetched_at: i64,
    pub source_url: String,
    pub games: IndexMap<String, ManifestGameEntry>,
}

#[napi(object)]
pub struct GetSaveRulesForGameInput {
    pub shop: String,
    pub object_id: String,
    pub title: Option<String>,
    pub remote_id: Option<String>,
    pub user_data_path: String,
    pub source_url: Option<String>,
}

#[napi(object)]
#[derive(Debug)]
pub struct CloudSaveGameId {
    pub shop: String,
    pub object_id: String,
}

#[napi(object)]
#[derive(Debug)]
pub struct CloudSaveRuleCondition {
    pub os: Option<String>,
    pub store: Option<String>,
}

#[napi(object)]
#[derive(Debug)]
pub struct CloudSaveRule {
    pub kind: String,
    pub raw_path: String,
    pub source: String,
    pub tags: Vec<String>,
    pub when: Vec<CloudSaveRuleCondition>,
}

#[napi(object)]
#[derive(Debug)]
pub struct GameSaveRules {
    pub game_id: CloudSaveGameId,
    pub manifest_key: Option<String>,
    pub rules: Vec<CloudSaveRule>,
}
