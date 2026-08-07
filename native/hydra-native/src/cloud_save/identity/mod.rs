use napi_derive::napi;
use serde::Serialize;
use sha2::{Digest, Sha256};
use unicode_normalization::UnicodeNormalization;

use crate::cloud_save::manifest::types::{CloudSaveRule, CloudSaveRuleCondition};

pub const IDENTITY_VERSION: u32 = 1;
pub const RULE_ID_VERSION: u32 = 1;
pub const DISCOVERY_ENGINE_VERSION: u32 = 4;

#[napi(object)]
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotVariant {
    pub variant_id: String,
    pub kind: String,
    pub steam_id64: Option<String>,
    pub concrete_folder_id: Option<String>,
}

#[napi(object)]
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StoreUserIdentity {
    pub kind: String,
    pub store: String,
    pub steam_id64: Option<String>,
    pub account_id32: Option<String>,
    pub concrete_folder_id: String,
    pub source: String,
    pub authority: String,
}

#[napi(object)]
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PortableStoreUserIdentity {
    pub kind: String,
    pub store: String,
    pub steam_id64: Option<String>,
    pub account_id32: Option<String>,
    pub concrete_folder_id: String,
}

#[napi(object)]
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PortableBindings {
    pub store: String,
    pub store_game_id: String,
    pub store_user: PortableStoreUserIdentity,
}

#[napi(object)]
#[derive(Clone, Debug)]
pub struct LocalResolutionBindings {
    pub environment_id: String,
    pub root_id: String,
    pub prefix_generation_id: Option<String>,
    pub concrete_user_segment: String,
    pub concrete_path: String,
}

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

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CanonicalVariant<'a> {
    variant_id_version: u32,
    shop: &'a str,
    object_id: &'a str,
    kind: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    steam_id64: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    concrete_folder_id: Option<&'a str>,
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

pub fn store_user_identity(store: &str, captured: Option<&str>) -> StoreUserIdentity {
    let concrete = captured.unwrap_or("__unbound__");
    if captured.is_none() {
        return StoreUserIdentity {
            kind: "default".to_string(),
            store: store.to_string(),
            steam_id64: None,
            account_id32: None,
            concrete_folder_id: concrete.to_string(),
            source: "unbound-rule".to_string(),
            authority: "inferred".to_string(),
        };
    }
    StoreUserIdentity {
        kind: "folder-profile".to_string(),
        store: store.to_string(),
        steam_id64: None,
        account_id32: None,
        concrete_folder_id: concrete.to_string(),
        source: "folder-match".to_string(),
        authority: "literal".to_string(),
    }
}

pub fn portable_bindings(
    store: &str,
    store_game_id: &str,
    store_user: StoreUserIdentity,
) -> PortableBindings {
    PortableBindings {
        store: store.to_string(),
        store_game_id: store_game_id.to_string(),
        store_user: PortableStoreUserIdentity {
            kind: store_user.kind,
            store: store_user.store,
            steam_id64: store_user.steam_id64,
            account_id32: store_user.account_id32,
            concrete_folder_id: store_user.concrete_folder_id,
        },
    }
}

pub fn build_variant_id(
    _save_namespace_key: &str,
    bindings: &PortableBindings,
    case_sensitive: bool,
) -> String {
    let store_user = &bindings.store_user;
    if store_user.kind == "default" {
        return hash_json(&CanonicalVariant {
            variant_id_version: IDENTITY_VERSION,
            shop: &bindings.store,
            object_id: &bindings.store_game_id,
            kind: "default",
            steam_id64: None,
            concrete_folder_id: None,
        });
    }
    let normalized = normalize_text(&store_user.concrete_folder_id);
    let normalized = if case_sensitive {
        normalized
    } else {
        normalized.to_lowercase()
    };
    hash_json(&CanonicalVariant {
        variant_id_version: IDENTITY_VERSION,
        shop: &bindings.store,
        object_id: &bindings.store_game_id,
        kind: "opaque-folder",
        steam_id64: None,
        concrete_folder_id: Some(&normalized),
    })
}

pub fn build_snapshot_variant(
    save_namespace_key: &str,
    bindings: &PortableBindings,
    case_sensitive: bool,
) -> SnapshotVariant {
    let variant_id = build_variant_id(save_namespace_key, bindings, case_sensitive);
    let store_user = &bindings.store_user;
    match store_user.kind.as_str() {
        "default" => SnapshotVariant {
            variant_id,
            kind: "default".to_string(),
            steam_id64: None,
            concrete_folder_id: None,
        },
        _ => {
            let concrete_folder_id = normalize_text(&store_user.concrete_folder_id);
            let concrete_folder_id = if case_sensitive {
                concrete_folder_id
            } else {
                concrete_folder_id.to_lowercase()
            };
            SnapshotVariant {
                variant_id,
                kind: "opaque-folder".to_string(),
                steam_id64: None,
                concrete_folder_id: Some(concrete_folder_id),
            }
        }
    }
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
    fn literal_profiles_keep_distinct_variant_ids() {
        let steam_id64 = "76561198051718575";
        let account_id32 = "91452847";
        let steam_id_profile = portable_bindings(
            "steam",
            "814380",
            store_user_identity("steam", Some(steam_id64)),
        );
        let account_id_profile = portable_bindings(
            "steam",
            "814380",
            store_user_identity("steam", Some(account_id32)),
        );
        assert_ne!(
            build_variant_id("steam:814380", &steam_id_profile, false),
            build_variant_id("steam:814380", &account_id_profile, false)
        );
    }

    #[test]
    fn numeric_profiles_remain_literal() {
        let steam_id64 = "76561199800542110";
        let account_id32 = "1840276382";

        for captured in [steam_id64, account_id32] {
            let identity = store_user_identity("steam", Some(captured));
            assert_eq!(identity.kind, "folder-profile");
            assert!(identity.steam_id64.is_none());
            assert!(identity.account_id32.is_none());
            assert_eq!(identity.concrete_folder_id, captured);
            assert_eq!(identity.source, "folder-match");
            assert_eq!(identity.authority, "literal");
        }
    }

    #[test]
    fn builds_default_and_opaque_wire_variants_without_local_bindings() {
        let default_bindings = portable_bindings("steam", "1", store_user_identity("steam", None));
        let default = build_snapshot_variant("steam:1", &default_bindings, false);
        assert_eq!(default.kind, "default");
        assert!(default.steam_id64.is_none());
        assert!(default.concrete_folder_id.is_none());

        let opaque_bindings =
            portable_bindings("steam", "1", store_user_identity("steam", Some("Goldberg")));
        let opaque = build_snapshot_variant("steam:1", &opaque_bindings, false);
        assert_eq!(opaque.kind, "opaque-folder");
        assert_eq!(opaque.concrete_folder_id.as_deref(), Some("goldberg"));
        assert!(opaque.steam_id64.is_none());
        assert_ne!(default.variant_id, opaque.variant_id);
    }

    #[test]
    fn preserves_existing_default_and_opaque_variant_ids() {
        let default_bindings =
            portable_bindings("steam", "1817070", store_user_identity("steam", None));
        let default = build_snapshot_variant("steam:1817070", &default_bindings, false);
        assert_eq!(
            default.variant_id,
            "6bb5b19456b48c65d5b6120154934d146013679fd8673e7d42694fff131774db"
        );

        let profile_bindings = portable_bindings(
            "steam",
            "1817070",
            store_user_identity("steam", Some("76561197960271872")),
        );
        let profile = build_snapshot_variant("steam:1817070", &profile_bindings, false);
        assert_eq!(profile.kind, "opaque-folder");
        assert_eq!(
            profile.variant_id,
            "82e6580b982018f47d8ce8e17656a22675f2277d2cdd0a11ae501b10c8a430e1"
        );
    }

    #[test]
    fn canonical_sekiro_fixture_uses_sha256_variant_and_snapshot() {
        use crate::cloud_save::hashing::{
            build_aggregate_hash, BuildSnapshotAggregateHashInput, SnapshotAggregateHashFile,
        };

        let mut rule = rule("<winAppData>/Sekiro/<storeUserId>/S0000.sl2");
        rule.kind = "file".into();
        rule.rule_id = build_rule_id(&rule);
        let bindings = portable_bindings(
            "steam",
            "814380",
            store_user_identity("steam", Some("12345")),
        );
        let variant = build_snapshot_variant("steam:814380", &bindings, false);
        let variant_id = variant.variant_id.clone();
        let aggregate_hash = build_aggregate_hash(BuildSnapshotAggregateHashInput {
            variants: vec![variant],
            files: vec![SnapshotAggregateHashFile {
                variant_id: variant_id.clone(),
                raw_path: rule.raw_path.clone(),
                relative_path: "S0000.sl2".into(),
                hash: "a".repeat(64),
                size_bytes: 4.0,
            }],
        })
        .unwrap();

        assert_eq!(rule.rule_id.len(), 64);
        assert_eq!(
            variant_id,
            "0885b75e18b67b0d4201b78cec6f9711326eb0affcd91ae1bbcb467a40a19e32"
        );
        assert_eq!(
            aggregate_hash,
            "c940e59b1eaa065e7c748a80aafde1328584a58ff5cca3d0810474ebecf5fa15"
        );
    }
}
