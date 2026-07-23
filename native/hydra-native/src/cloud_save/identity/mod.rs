use napi_derive::napi;
use serde::Serialize;
use unicode_normalization::UnicodeNormalization;

use crate::cloud_save::manifest::types::{CloudSaveRule, CloudSaveRuleCondition};

pub const IDENTITY_VERSION: u32 = 1;
pub const RULE_ID_VERSION: u32 = 1;
pub const LOGICAL_ID_VERSION: u32 = 1;
pub const LOCATOR_VERSION: u32 = 1;
pub const SNAPSHOT_SCHEMA_VERSION: u32 = 2;
pub const DISCOVERY_ENGINE_VERSION: u32 = 2;

const STEAM_INDIVIDUAL_ACCOUNT_BASE: u64 = 76_561_197_960_265_728;

#[napi(object)]
#[derive(Clone, Debug)]
pub struct KnownStoreAccount {
    pub store: String,
    pub steam_id64: Option<String>,
    pub account_id32: Option<String>,
    pub source: String,
}

#[napi(object)]
#[derive(Clone, Debug, Default)]
pub struct StoreUserContext {
    pub active: Option<KnownStoreAccount>,
    pub known: Vec<KnownStoreAccount>,
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
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PortableLocator {
    pub version: u32,
    pub rule_id: String,
    pub raw_rule: String,
    pub rule_source: String,
    pub root_kind: String,
    pub bindings: PortableBindings,
    pub target_semantics: String,
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
    pub logical_file_id: Option<String>,
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
enum CanonicalStoreUser<'a> {
    ValidatedAccount {
        store: &'a str,
        steam_id64: &'a str,
        account_id32: &'a str,
    },
    OpaqueFolder {
        store: &'a str,
        normalized_folder_key: &'a str,
    },
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CanonicalVariant<'a> {
    identity_version: u32,
    save_namespace_key: &'a str,
    store: &'a str,
    store_user: CanonicalStoreUser<'a>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CanonicalLogicalFile<'a> {
    logical_id_version: u32,
    save_namespace_key: &'a str,
    variant_id: &'a str,
    rule_id: &'a str,
    relative_path: &'a str,
}

fn hash_json<T: Serialize>(value: &T) -> String {
    let serialized = serde_json::to_vec(value).expect("canonical cloud save identity serializes");
    blake3::hash(&serialized).to_hex().to_string()
}

pub fn normalize_text(value: &str) -> String {
    value.nfc().collect::<String>()
}

pub fn normalize_rule_path(value: &str) -> String {
    normalize_text(&value.replace('\\', "/"))
}

pub fn normalize_relative_path(value: &str, case_sensitive: bool) -> Result<String, String> {
    let normalized = normalize_text(&value.replace('\\', "/"));
    if normalized.is_empty()
        || normalized.starts_with('/')
        || normalized.contains('\0')
        || normalized
            .split('/')
            .any(|segment| segment.is_empty() || segment == "." || segment == "..")
        || (normalized.len() >= 2 && normalized.as_bytes()[1] == b':')
    {
        return Err("cloud_save_invalid_relative_path".to_string());
    }

    Ok(if case_sensitive {
        normalized
    } else {
        normalized.to_lowercase()
    })
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

pub fn root_kind(raw_rule: &str) -> String {
    let normalized = normalize_rule_path(raw_rule);
    let first = normalized.split('/').next().unwrap_or_default();
    if first.starts_with('<') && first.ends_with('>') {
        first.trim_matches(['<', '>']).to_string()
    } else if first.starts_with('%') && first.ends_with('%') {
        first.trim_matches('%').to_ascii_lowercase()
    } else {
        "literal".to_string()
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

fn validated_steam_account(account: &KnownStoreAccount) -> Option<(String, String)> {
    if account.store != "steam" {
        return None;
    }
    let steam_id64 = account.steam_id64.as_deref()?.parse::<u64>().ok()?;
    let account_id = steam_id64.checked_sub(STEAM_INDIVIDUAL_ACCOUNT_BASE)?;
    if account_id > u32::MAX as u64 {
        return None;
    }
    let account_id32 = account_id.to_string();
    if account.account_id32.as_deref() != Some(account_id32.as_str()) {
        return None;
    }
    Some((steam_id64.to_string(), account_id32))
}

fn account_matches(account: &KnownStoreAccount, captured: &str) -> Option<(String, String)> {
    let validated = validated_steam_account(account)?;
    ((captured == validated.0) || (captured == validated.1)).then_some(validated)
}

pub fn store_user_identity(
    store: &str,
    captured: Option<&str>,
    context: &StoreUserContext,
) -> StoreUserIdentity {
    let concrete = captured.unwrap_or("__unbound__");
    let active_match = context
        .active
        .as_ref()
        .and_then(|account| account_matches(account, concrete).map(|ids| (account, ids)));
    let known_match = context
        .known
        .iter()
        .find_map(|account| account_matches(account, concrete).map(|ids| (account, ids)));

    if let Some((account, (steam_id64, account_id32))) = active_match.or(known_match) {
        let authority = if context.active.as_ref().is_some_and(|active| {
            validated_steam_account(active).is_some_and(|ids| ids.0 == steam_id64)
        }) {
            "active"
        } else {
            "known"
        };
        return StoreUserIdentity {
            kind: "validated-account".to_string(),
            store: store.to_string(),
            steam_id64: Some(steam_id64),
            account_id32: Some(account_id32),
            concrete_folder_id: concrete.to_string(),
            source: account.source.clone(),
            authority: authority.to_string(),
        };
    }

    StoreUserIdentity {
        kind: "opaque-folder".to_string(),
        store: store.to_string(),
        steam_id64: None,
        account_id32: None,
        concrete_folder_id: concrete.to_string(),
        source: if captured.is_some() {
            "folder-match".to_string()
        } else {
            "unbound-rule".to_string()
        },
        authority: "inferred".to_string(),
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
    save_namespace_key: &str,
    bindings: &PortableBindings,
    case_sensitive: bool,
) -> String {
    let store_user = &bindings.store_user;
    if store_user.kind == "validated-account" {
        return hash_json(&CanonicalVariant {
            identity_version: IDENTITY_VERSION,
            save_namespace_key,
            store: &bindings.store,
            store_user: CanonicalStoreUser::ValidatedAccount {
                store: &store_user.store,
                steam_id64: store_user.steam_id64.as_deref().unwrap_or_default(),
                account_id32: store_user.account_id32.as_deref().unwrap_or_default(),
            },
        });
    }

    let normalized = normalize_text(&store_user.concrete_folder_id);
    let normalized = if case_sensitive {
        normalized
    } else {
        normalized.to_lowercase()
    };
    hash_json(&CanonicalVariant {
        identity_version: IDENTITY_VERSION,
        save_namespace_key,
        store: &bindings.store,
        store_user: CanonicalStoreUser::OpaqueFolder {
            store: &store_user.store,
            normalized_folder_key: &normalized,
        },
    })
}

pub fn build_logical_file_id(
    save_namespace_key: &str,
    variant_id: &str,
    rule_id: &str,
    relative_path: &str,
    case_sensitive: bool,
) -> Result<String, String> {
    let relative_path = normalize_relative_path(relative_path, case_sensitive)?;
    Ok(hash_json(&CanonicalLogicalFile {
        logical_id_version: LOGICAL_ID_VERSION,
        save_namespace_key,
        variant_id,
        rule_id,
        relative_path: &relative_path,
    }))
}

pub fn build_locator(rule: &CloudSaveRule, bindings: PortableBindings) -> PortableLocator {
    PortableLocator {
        version: LOCATOR_VERSION,
        rule_id: rule.rule_id.clone(),
        raw_rule: normalize_rule_path(&rule.raw_path),
        rule_source: rule.source.clone(),
        root_kind: root_kind(&rule.raw_path),
        bindings,
        target_semantics: target_semantics(rule).to_string(),
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
    fn steam_representations_share_a_variant() {
        let steam_id64 = "76561198051718575";
        let account_id32 = "91452847";
        let account = KnownStoreAccount {
            store: "steam".into(),
            steam_id64: Some(steam_id64.into()),
            account_id32: Some(account_id32.into()),
            source: "active-login".into(),
        };
        let context = StoreUserContext {
            active: Some(account.clone()),
            known: vec![account],
        };
        let namespace = "steam:814380";
        let for_64 = portable_bindings(
            "steam",
            "814380",
            store_user_identity("steam", Some(steam_id64), &context),
        );
        let for_32 = portable_bindings(
            "steam",
            "814380",
            store_user_identity("steam", Some(account_id32), &context),
        );
        assert_eq!(
            build_variant_id(namespace, &for_64, false),
            build_variant_id(namespace, &for_32, false)
        );
    }

    #[test]
    fn logical_id_does_not_include_content_or_machine_path() {
        let id =
            build_logical_file_id("steam:814380", "variant", "rule", "S0000.sl2", false).unwrap();
        assert_eq!(
            id,
            build_logical_file_id("steam:814380", "variant", "rule", "s0000.SL2", false).unwrap()
        );
    }

    #[test]
    fn canonical_sekiro_fixture_vectors() {
        use crate::cloud_save::hashing::{
            build_aggregate_hash, BuildSnapshotAggregateHashInput, SnapshotAggregateHashFile,
        };

        let mut rule = rule("<winAppData>/Sekiro/<storeUserId>/S0000.sl2");
        rule.kind = "file".into();
        rule.rule_id = build_rule_id(&rule);
        let account = KnownStoreAccount {
            store: "steam".into(),
            steam_id64: Some("76561197960278073".into()),
            account_id32: Some("12345".into()),
            source: "active-login".into(),
        };
        let context = StoreUserContext {
            active: Some(account.clone()),
            known: vec![account],
        };
        let bindings = portable_bindings(
            "steam",
            "814380",
            store_user_identity("steam", Some("12345"), &context),
        );
        let variant_id = build_variant_id("steam:814380", &bindings, false);
        let logical_file_id = build_logical_file_id(
            "steam:814380",
            &variant_id,
            &rule.rule_id,
            "S0000.sl2",
            false,
        )
        .unwrap();
        let aggregate_hash = build_aggregate_hash(BuildSnapshotAggregateHashInput {
            schema_version: SNAPSHOT_SCHEMA_VERSION,
            save_namespace_key: "steam:814380".into(),
            files: vec![SnapshotAggregateHashFile {
                logical_file_id: logical_file_id.clone(),
                variant_id: variant_id.clone(),
                rule_id: rule.rule_id.clone(),
                relative_path: "S0000.sl2".into(),
                locator: build_locator(&rule, bindings),
                content_hash: "a".repeat(64),
                size_bytes: 4.0,
            }],
        })
        .unwrap();

        assert_eq!(
            rule.rule_id,
            "3757c0684c7a1064a52bead49f78dac77f9580d0074764ab22feef8e1396e18c"
        );
        assert_eq!(
            variant_id,
            "41204671ffc251656913b1086cd00e73aacb1ce5dee726af18318e1ea2d85f12"
        );
        assert_eq!(
            logical_file_id,
            "8e8c5d499297e80a5de994f98348b5f9376a13b349c1b7077e81207f113fa378"
        );
        assert_eq!(
            aggregate_hash,
            "b2b0849654c9bd1d58f0cec3af351f9fd3539c6a17f191c5e5a8c80f2722d98c"
        );
    }
}
