use napi_derive::napi;
use serde::Serialize;
use sha2::{Digest, Sha256};
use unicode_normalization::UnicodeNormalization;

use crate::cloud_save::manifest::types::{CloudSaveRule, CloudSaveRuleCondition};

pub const RULE_ID_VERSION: u32 = 1;

#[napi(object)]
#[derive(Clone, Debug)]
pub struct UserLocationCoverage {
    pub candidate_id: String,
    pub rule_id: String,
    pub variant_id: Option<String>,
    pub raw_path: Option<String>,
    pub relative_path: Option<String>,
    pub selected_root: bool,
    pub authority: String,
    pub outcome: String,
    pub enumerated_completely: bool,
    pub warning_codes: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CanonicalRuleCondition<'a> {
    os: Option<&'a str>,
    store: Option<&'a str>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CanonicalRule<'a> {
    rule_id_version: u32,
    source_namespace: &'a str,
    raw_rule: &'a str,
    target_semantics: &'a str,
    constraints: Vec<CanonicalRuleCondition<'a>>,
}

fn hash_json<T: Serialize>(value: &T) -> String {
    let serialized = serde_json::to_vec(value).expect("canonical cloud save identity serializes");
    format!("{:x}", Sha256::digest(serialized))
}

pub fn normalize_text(value: &str) -> String {
    value.nfc().collect::<String>()
}

pub fn normalize_rule_path(value: &str) -> String {
    normalize_text(&value.replace('\\', "/"))
}

pub fn target_semantics(rule: &CloudSaveRule) -> &'static str {
    if rule.kind == "dir" {
        "directory-tree"
    } else if rule
        .raw_path
        .chars()
        .any(|character| matches!(character, '*' | '?' | '[' | '{'))
    {
        "glob-set"
    } else {
        "single-file"
    }
}

pub fn build_rule_id(rule: &CloudSaveRule) -> String {
    let raw_rule = normalize_rule_path(&rule.raw_path);
    let semantics = target_semantics(rule);
    let mut constraints = rule.when.iter().collect::<Vec<_>>();
    constraints.sort_by(|left, right| {
        left.os
            .cmp(&right.os)
            .then_with(|| left.store.cmp(&right.store))
    });
    constraints.dedup_by(|left, right| left.os == right.os && left.store == right.store);
    hash_json(&CanonicalRule {
        rule_id_version: RULE_ID_VERSION,
        source_namespace: &rule.source,
        raw_rule: &raw_rule,
        target_semantics: semantics,
        constraints: constraints
            .into_iter()
            .map(
                |condition: &CloudSaveRuleCondition| CanonicalRuleCondition {
                    os: condition.os.as_deref(),
                    store: condition.store.as_deref(),
                },
            )
            .collect(),
    })
}

pub fn local_id(parts: &[&str]) -> String {
    let mut hasher = blake3::Hasher::new();
    for part in parts {
        hasher.update(&(part.len() as u64).to_le_bytes());
        hasher.update(part.as_bytes());
    }
    hasher.finalize().to_hex().to_string()
}

pub fn is_safe_capture(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 255
        && !value.contains(['/', '\\', '\0'])
        && value != "."
        && value != ".."
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rule(raw_path: &str) -> CloudSaveRule {
        let mut rule = CloudSaveRule {
            rule_id: String::new(),
            kind: "dir".into(),
            raw_path: raw_path.into(),
            source: "ludusavi".into(),
            tags: vec!["save".into()],
            when: vec![],
            preferred_path: None,
        };
        rule.rule_id = build_rule_id(&rule);
        rule
    }

    #[test]
    fn stable_rule_id_ignores_tags_and_changes_with_semantics() {
        let first = rule("<winAppData>/Game/<storeUserId>");
        let mut reordered_metadata = first.clone();
        reordered_metadata.tags = vec!["config".into()];
        assert_eq!(build_rule_id(&first), build_rule_id(&reordered_metadata));

        reordered_metadata.raw_path.push_str("/saves");
        assert_ne!(build_rule_id(&first), build_rule_id(&reordered_metadata));
    }

    #[test]
    fn local_ids_are_length_delimited() {
        assert_ne!(local_id(&["ab", "c"]), local_id(&["a", "bc"]));
        assert_eq!(local_id(&["same"]), local_id(&["same"]));
    }

    #[test]
    fn capture_validation_rejects_path_segments() {
        assert!(is_safe_capture("76561198012345678"));
        for value in ["", ".", "..", "a/b", "a\\b", "a\0b"] {
            assert!(!is_safe_capture(value));
        }
    }
}
