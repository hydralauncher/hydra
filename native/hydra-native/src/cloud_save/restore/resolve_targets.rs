use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};

use napi::bindgen_prelude::Error;
use napi_derive::napi;

use crate::cloud_save::hashing::hash_file;
use crate::cloud_save::identity::{
    is_safe_capture, normalize_rule_path, KnownStoreAccount, SnapshotVariant,
};
use crate::cloud_save::manifest::types::CloudSaveRule;
use crate::cloud_save::path_resolution::{
    build_context, glob_base_path, resolve_restore_root, ResolveSaveRulesInput,
};

use super::metadata::parse_last_modified_at;
use super::types::{
    BlockedRestoreFile, ResolveRestoreTargetsInput, ResolveRestoreTargetsResult,
    ResolvedRestoreTarget, RestoreManifestFile,
};
use super::validation::{validate_hash, validate_relative_path, validate_size};

const STEAM_INDIVIDUAL_ACCOUNT_BASE: u64 = 76_561_197_960_265_728;

fn join_path(root: &str, relative_path: &str) -> String {
    format!(
        "{}/{}",
        root.trim_end_matches(['/', '\\']),
        relative_path.trim_start_matches(['/', '\\'])
    )
    .replace('\\', "/")
}

fn validate_file(file: &RestoreManifestFile) -> Result<(), String> {
    if file.variant_id.len() != 64
        || !file.variant_id.bytes().all(|byte| byte.is_ascii_hexdigit())
        || file.raw_path.is_empty()
        || normalize_rule_path(&file.raw_path) != file.raw_path
    {
        return Err("cloud_save_invalid_restore_identity".to_string());
    }
    validate_relative_path(&file.relative_path)?;
    validate_hash(&file.hash)?;
    validate_size(file.size_bytes)?;
    parse_last_modified_at(&file.last_modified_at).map(|_| ())
}

fn validate_variant(variant: &SnapshotVariant, shop: &str) -> Result<(), String> {
    if variant.variant_id.len() != 64
        || !variant
            .variant_id
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit())
    {
        return Err("cloud_save_invalid_restore_variant".to_string());
    }
    match variant.kind.as_str() {
        "default" if variant.steam_id64.is_none() && variant.concrete_folder_id.is_none() => Ok(()),
        "steam-account"
            if shop == "steam"
                && variant.concrete_folder_id.is_none()
                && variant.steam_id64.as_deref().is_some_and(|value| {
                    value.len() == 17 && value.bytes().all(|byte| byte.is_ascii_digit())
                }) =>
        {
            Ok(())
        }
        "opaque-folder"
            if variant.steam_id64.is_none()
                && variant
                    .concrete_folder_id
                    .as_deref()
                    .is_some_and(is_safe_capture) =>
        {
            Ok(())
        }
        _ => Err("cloud_save_invalid_restore_variant".to_string()),
    }
}

fn canonical_target_key(path: &str, case_sensitive: bool) -> String {
    let mut existing = PathBuf::from(path);
    let mut missing = Vec::new();
    while !existing.exists() {
        let Some(name) = existing.file_name().map(|name| name.to_os_string()) else {
            break;
        };
        missing.push(name);
        if !existing.pop() {
            break;
        }
    }

    let mut canonical = std::fs::canonicalize(&existing).unwrap_or(existing);
    for segment in missing.into_iter().rev() {
        canonical.push(segment);
    }
    let normalized = canonical.to_string_lossy().replace('\\', "/");
    if case_sensitive {
        normalized
    } else {
        normalized.to_lowercase()
    }
}

fn target_is_within_root(target: &str, root: &str, case_sensitive: bool) -> bool {
    let target = canonical_target_key(target, case_sensitive);
    let root = canonical_target_key(root, case_sensitive);
    target == root || target.starts_with(&format!("{}/", root.trim_end_matches('/')))
}

fn identity_key(file: &RestoreManifestFile) -> String {
    format!(
        "{}\0{}\0{}",
        file.variant_id, file.raw_path, file.relative_path
    )
}

fn blocked(file: RestoreManifestFile, reason: &str) -> BlockedRestoreFile {
    BlockedRestoreFile {
        variant_id: file.variant_id,
        raw_path: file.raw_path,
        relative_path: file.relative_path,
        hash: file.hash,
        size_bytes: file.size_bytes,
        last_modified_at: file.last_modified_at,
        reason: reason.to_string(),
    }
}

fn validated_steam_ids(account: &KnownStoreAccount) -> Option<(String, String)> {
    if account.store != "steam" {
        return None;
    }
    let steam_id64 = account.steam_id64.as_deref()?.parse::<u64>().ok()?;
    let account_id32 = steam_id64.checked_sub(STEAM_INDIVIDUAL_ACCOUNT_BASE)?;
    if account_id32 > u32::MAX as u64 {
        return None;
    }
    let account_id32 = account_id32.to_string();
    if account.account_id32.as_deref() != Some(account_id32.as_str()) {
        return None;
    }
    Some((steam_id64.to_string(), account_id32))
}

fn concrete_user_values(
    variant: &SnapshotVariant,
    context: &crate::cloud_save::identity::StoreUserContext,
) -> Result<Vec<String>, &'static str> {
    match variant.kind.as_str() {
        "default" => Ok(Vec::new()),
        "opaque-folder" => Ok(vec![variant
            .concrete_folder_id
            .clone()
            .ok_or("blocked-user-ambiguous")?]),
        "steam-account" => {
            let expected = variant
                .steam_id64
                .as_deref()
                .ok_or("blocked-user-ambiguous")?;
            let account = context
                .active
                .iter()
                .chain(context.known.iter())
                .find_map(|account| validated_steam_ids(account).filter(|ids| ids.0 == expected))
                .ok_or("blocked-user-not-found")?;
            Ok(vec![account.0, account.1])
        }
        _ => Err("blocked-user-ambiguous"),
    }
}

fn bind_store_user(raw_rule: &str, value: &str) -> String {
    raw_rule
        .replace("*<storeUserId>", value)
        .replace("<storeUserId>*", value)
        .replace("<storeUserId>", value)
}

fn has_glob(raw_rule: &str) -> bool {
    raw_rule
        .chars()
        .any(|character| matches!(character, '*' | '?' | '[' | '{'))
}

#[napi]
pub fn resolve_restore_targets(
    input: ResolveRestoreTargetsInput,
) -> napi::Result<ResolveRestoreTargetsResult> {
    let context = build_context(&ResolveSaveRulesInput {
        shop: input.shop.clone(),
        object_id: input.object_id.clone(),
        platform: input.platform.clone(),
        home_dir: input.home_dir,
        documents_dir: input.documents_dir,
        app_data_dir: input.app_data_dir,
        executable_path: input.executable_path,
        wine_prefix_path: input.wine_prefix_path,
        steam_path: input.steam_path,
        rules: Vec::<CloudSaveRule>::new(),
    })
    .map_err(Error::from_reason)?;
    let case_sensitive = context.platform == "linux" && !context.windows_compatibility;

    let mut variants = HashMap::new();
    for variant in input.variants {
        validate_variant(&variant, &input.shop).map_err(Error::from_reason)?;
        if variants
            .insert(variant.variant_id.clone(), variant)
            .is_some()
        {
            return Err(Error::from_reason("cloud_save_duplicate_restore_variant"));
        }
    }

    let approved = input
        .approved_rules
        .into_iter()
        .filter(|rule| !rule.kind.is_empty() && !rule.raw_path.is_empty())
        .collect::<Vec<_>>();
    let mut candidates = Vec::<(ResolvedRestoreTarget, RestoreManifestFile)>::new();
    let mut blocked_files = Vec::new();
    let mut identities = HashSet::new();
    let mut used_variants = HashSet::new();

    for file in input.files {
        validate_file(&file).map_err(Error::from_reason)?;
        if !identities.insert(identity_key(&file)) {
            return Err(Error::from_reason("cloud_save_duplicate_restore_identity"));
        }
        let Some(variant) = variants.get(&file.variant_id) else {
            return Err(Error::from_reason("cloud_save_restore_variant_not_found"));
        };
        used_variants.insert(file.variant_id.clone());

        let rules = approved
            .iter()
            .filter(|rule| normalize_rule_path(&rule.raw_path) == file.raw_path)
            .collect::<Vec<_>>();
        if rules.is_empty() {
            blocked_files.push(blocked(file, "blocked-rule-unavailable"));
            continue;
        }
        if variant.kind == "default" && file.raw_path.contains("<storeUserId>") {
            blocked_files.push(blocked(file, "blocked-user-ambiguous"));
            continue;
        }
        if variant.kind != "default" && !file.raw_path.contains("<storeUserId>") {
            blocked_files.push(blocked(file, "blocked-user-ambiguous"));
            continue;
        }

        let user_values = match concrete_user_values(variant, &input.store_user_context) {
            Ok(values) => values,
            Err(reason) => {
                blocked_files.push(blocked(file, reason));
                continue;
            }
        };

        let mut resolved_targets = Vec::new();
        for rule in rules {
            let directory = rule.kind == "dir" || has_glob(&rule.raw_path);
            let root_rule = if has_glob(&rule.raw_path) {
                glob_base_path(&rule.raw_path).unwrap_or_else(|| rule.raw_path.clone())
            } else {
                rule.raw_path.clone()
            };
            let concrete_values = if variant.kind == "default" {
                vec![None]
            } else {
                user_values.iter().map(Some).collect()
            };
            let mut resolved_roots = Vec::new();
            for user_value in concrete_values {
                let concrete_rule = user_value
                    .map(|value| bind_store_user(&root_rule, value))
                    .unwrap_or_else(|| root_rule.clone());
                if let Ok(root) = resolve_restore_root(
                    &concrete_rule,
                    &context,
                    directory,
                    std::slice::from_ref(&file.relative_path),
                ) {
                    if variant.kind == "opaque-folder" && !Path::new(&root).exists() {
                        continue;
                    }
                    resolved_roots.push(root);
                }
            }

            if variant.kind == "steam-account" {
                let existing = resolved_roots
                    .iter()
                    .filter(|root| Path::new(root).exists())
                    .cloned()
                    .collect::<Vec<_>>();
                if !existing.is_empty() {
                    resolved_roots = existing;
                } else {
                    resolved_roots.truncate(1);
                }
            }
            for root in resolved_roots {
                let target_path = if directory {
                    join_path(&root, &file.relative_path)
                } else {
                    root.clone()
                };
                let restore_root_path = if directory {
                    root
                } else {
                    Path::new(&target_path)
                        .parent()
                        .map(|parent| parent.to_string_lossy().replace('\\', "/"))
                        .unwrap_or_default()
                };
                if !restore_root_path.is_empty()
                    && target_is_within_root(&target_path, &restore_root_path, case_sensitive)
                {
                    resolved_targets.push((target_path, restore_root_path));
                }
            }
        }

        resolved_targets.sort_by(|left, right| {
            canonical_target_key(&left.0, case_sensitive)
                .cmp(&canonical_target_key(&right.0, case_sensitive))
                .then_with(|| {
                    Path::new(&right.1)
                        .components()
                        .count()
                        .cmp(&Path::new(&left.1).components().count())
                })
        });
        resolved_targets.dedup_by(|left, right| {
            canonical_target_key(&left.0, case_sensitive)
                == canonical_target_key(&right.0, case_sensitive)
        });
        if resolved_targets.is_empty() {
            blocked_files.push(blocked(file, "blocked-user-not-found"));
            continue;
        }
        if resolved_targets.len() > 1 {
            blocked_files.push(blocked(file, "blocked-target-ambiguous"));
            continue;
        }

        let (target_path, restore_root_path) = resolved_targets.remove(0);
        let action = if Path::new(&target_path).is_file()
            && hash_file(&target_path).is_ok_and(|hash| hash == file.hash)
        {
            "skip-identical"
        } else if Path::new(&target_path).exists() {
            "replace"
        } else {
            "create"
        };
        candidates.push((
            ResolvedRestoreTarget {
                variant_id: file.variant_id.clone(),
                raw_path: file.raw_path.clone(),
                relative_path: file.relative_path.clone(),
                target_path,
                restore_root_path,
                hash: file.hash.clone(),
                size_bytes: file.size_bytes,
                last_modified_at: file.last_modified_at.clone(),
                action: action.to_string(),
            },
            file,
        ));
    }

    if used_variants.len() != variants.len() {
        return Err(Error::from_reason("cloud_save_unused_restore_variant"));
    }

    let mut counts = HashMap::new();
    for (target, _) in &candidates {
        *counts
            .entry(canonical_target_key(&target.target_path, case_sensitive))
            .or_insert(0usize) += 1;
    }
    let mut actions = Vec::new();
    for (target, file) in candidates {
        if counts
            .get(&canonical_target_key(&target.target_path, case_sensitive))
            .copied()
            .unwrap_or_default()
            > 1
        {
            blocked_files.push(blocked(file, "blocked-target-ambiguous"));
        } else {
            actions.push(target);
        }
    }
    actions.sort_by_key(|file| {
        format!(
            "{}\0{}\0{}",
            file.variant_id, file.raw_path, file.relative_path
        )
    });
    blocked_files.sort_by_key(|file| {
        format!(
            "{}\0{}\0{}",
            file.variant_id, file.raw_path, file.relative_path
        )
    });

    Ok(ResolveRestoreTargetsResult {
        actions,
        blocked: blocked_files,
    })
}

#[cfg(test)]
mod tests {
    use std::fs;

    use sha2::{Digest, Sha256};
    use tempfile::tempdir;

    use super::*;
    use crate::cloud_save::identity::{KnownStoreAccount, StoreUserContext};
    use crate::cloud_save::restore::types::ApprovedRestoreRule;

    const RAW_RULE: &str = "<home>/Game/<storeUserId>";
    const LAST_MODIFIED_AT: &str = "2026-07-23T10:00:00.123Z";

    fn variant(kind: &str, user: &str) -> SnapshotVariant {
        SnapshotVariant {
            variant_id: format!("{:x}", Sha256::digest(format!("{kind}:{user}"))),
            kind: kind.into(),
            steam_id64: (kind == "steam-account").then(|| user.into()),
            concrete_folder_id: (kind == "opaque-folder").then(|| user.into()),
        }
    }

    fn file(variant: &SnapshotVariant, relative_path: &str) -> RestoreManifestFile {
        RestoreManifestFile {
            variant_id: variant.variant_id.clone(),
            raw_path: RAW_RULE.into(),
            relative_path: relative_path.to_string(),
            hash: "a".repeat(64),
            size_bytes: 4.0,
            last_modified_at: LAST_MODIFIED_AT.into(),
        }
    }

    fn input(
        home: &Path,
        context: StoreUserContext,
        variants: Vec<SnapshotVariant>,
        files: Vec<RestoreManifestFile>,
    ) -> ResolveRestoreTargetsInput {
        ResolveRestoreTargetsInput {
            shop: "steam".into(),
            object_id: "1".into(),
            platform: "windows".into(),
            home_dir: home.display().to_string(),
            documents_dir: None,
            app_data_dir: None,
            executable_path: None,
            wine_prefix_path: None,
            steam_path: None,
            store_user_context: context,
            approved_rules: vec![ApprovedRestoreRule {
                kind: "dir".into(),
                raw_path: RAW_RULE.into(),
                source: "test".into(),
            }],
            variants,
            files,
        }
    }

    #[test]
    fn maps_two_opaque_folders_independently_even_with_same_hash() {
        let temp = tempdir().unwrap();
        for user in ["Goldberg", "Rune"] {
            fs::create_dir_all(temp.path().join("Game").join(user)).unwrap();
        }
        let variants = vec![
            variant("opaque-folder", "Goldberg"),
            variant("opaque-folder", "Rune"),
        ];
        let files = variants
            .iter()
            .map(|variant| file(variant, "slot.dat"))
            .collect();
        let result = resolve_restore_targets(input(
            temp.path(),
            StoreUserContext::default(),
            variants,
            files,
        ))
        .unwrap();

        assert!(result.blocked.is_empty());
        assert_eq!(result.actions.len(), 2);
    }

    #[test]
    fn refuses_to_create_a_missing_opaque_folder() {
        let temp = tempdir().unwrap();
        let variants = vec![variant("opaque-folder", "Unknown")];
        let files = vec![file(&variants[0], "slot.dat")];
        let result = resolve_restore_targets(input(
            temp.path(),
            StoreUserContext::default(),
            variants,
            files,
        ))
        .unwrap();

        assert!(result.actions.is_empty());
        assert_eq!(result.blocked[0].reason, "blocked-user-not-found");
    }

    #[test]
    fn validated_account_can_create_its_exact_missing_folder() {
        let temp = tempdir().unwrap();
        let account = KnownStoreAccount {
            store: "steam".into(),
            steam_id64: Some("76561197960278073".into()),
            account_id32: Some("12345".into()),
            source: "loginusers".into(),
        };
        let context = StoreUserContext {
            active: Some(account.clone()),
            known: vec![account],
        };
        let variants = vec![variant("steam-account", "76561197960278073")];
        let files = vec![file(&variants[0], "slot.dat")];
        let result = resolve_restore_targets(input(temp.path(), context, variants, files)).unwrap();

        assert!(result.blocked.is_empty());
        assert_eq!(result.actions.len(), 1);
        assert_eq!(result.actions[0].action, "create");
    }

    #[test]
    fn blocks_a_steam_variant_when_the_account_is_not_known() {
        let temp = tempdir().unwrap();
        let variants = vec![variant("steam-account", "76561197960278073")];
        let files = vec![file(&variants[0], "slot.dat")];
        let result = resolve_restore_targets(input(
            temp.path(),
            StoreUserContext::default(),
            variants,
            files,
        ))
        .unwrap();

        assert!(result.actions.is_empty());
        assert_eq!(result.blocked[0].reason, "blocked-user-not-found");
    }

    #[test]
    fn resolves_a_default_variant_without_a_store_user() {
        let temp = tempdir().unwrap();
        let default = variant("default", "default");
        let raw_path = "<home>/Game/save.dat";
        let input = ResolveRestoreTargetsInput {
            shop: "steam".into(),
            object_id: "1".into(),
            platform: "windows".into(),
            home_dir: temp.path().display().to_string(),
            documents_dir: None,
            app_data_dir: None,
            executable_path: None,
            wine_prefix_path: None,
            steam_path: None,
            store_user_context: StoreUserContext::default(),
            approved_rules: vec![ApprovedRestoreRule {
                kind: "file".into(),
                raw_path: raw_path.into(),
                source: "test".into(),
            }],
            variants: vec![default.clone()],
            files: vec![RestoreManifestFile {
                variant_id: default.variant_id,
                raw_path: raw_path.into(),
                relative_path: "save.dat".into(),
                hash: "a".repeat(64),
                size_bytes: 4.0,
                last_modified_at: LAST_MODIFIED_AT.into(),
            }],
        };
        let result = resolve_restore_targets(input).unwrap();

        assert!(result.blocked.is_empty());
        assert_eq!(result.actions.len(), 1);
        assert!(result.actions[0]
            .target_path
            .replace('\\', "/")
            .ends_with("/Game/save.dat"));
        assert!(result.actions[0]
            .restore_root_path
            .replace('\\', "/")
            .ends_with("/Game"));
        assert_eq!(result.actions[0].last_modified_at, LAST_MODIFIED_AT);
    }

    #[test]
    fn blocks_rules_that_resolve_the_same_entry_to_different_targets() {
        let temp = tempdir().unwrap();
        let default = variant("default", "default");
        let raw_path = "<home>/Game";
        let input = ResolveRestoreTargetsInput {
            shop: "steam".into(),
            object_id: "1".into(),
            platform: "windows".into(),
            home_dir: temp.path().display().to_string(),
            documents_dir: None,
            app_data_dir: None,
            executable_path: None,
            wine_prefix_path: None,
            steam_path: None,
            store_user_context: StoreUserContext::default(),
            approved_rules: vec![
                ApprovedRestoreRule {
                    kind: "file".into(),
                    raw_path: raw_path.into(),
                    source: "first".into(),
                },
                ApprovedRestoreRule {
                    kind: "dir".into(),
                    raw_path: raw_path.into(),
                    source: "second".into(),
                },
            ],
            variants: vec![default.clone()],
            files: vec![RestoreManifestFile {
                variant_id: default.variant_id,
                raw_path: raw_path.into(),
                relative_path: "slot.dat".into(),
                hash: "a".repeat(64),
                size_bytes: 4.0,
                last_modified_at: LAST_MODIFIED_AT.into(),
            }],
        };
        let result = resolve_restore_targets(input).unwrap();

        assert!(result.actions.is_empty());
        assert_eq!(result.blocked[0].reason, "blocked-target-ambiguous");
    }

    #[test]
    fn rejects_traversal() {
        let temp = tempdir().unwrap();
        let variants = vec![variant("opaque-folder", "Goldberg")];
        let files = vec![file(&variants[0], "../slot.dat")];
        assert!(resolve_restore_targets(input(
            temp.path(),
            StoreUserContext::default(),
            variants,
            files
        ))
        .is_err());
    }
}
