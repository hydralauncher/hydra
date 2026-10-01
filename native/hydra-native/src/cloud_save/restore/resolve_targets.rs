use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};

use napi::bindgen_prelude::Error;
use napi_derive::napi;

use crate::cloud_save::hashing::batch::hash_files;
use crate::cloud_save::identity::{is_safe_capture, normalize_rule_path, SnapshotVariant};
use crate::cloud_save::manifest::types::CloudSaveRule;
use crate::cloud_save::path_resolution::{
    build_context, glob_base_path, path_is_foreign_environment, resolve_path, resolve_restore_root,
    rule_is_applicable, target_matches_rule, ResolveSaveRulesInput,
};

use super::metadata::parse_last_modified_at;
use super::types::{
    BlockedRestoreFile, ResolveRestoreTargetsInput, ResolveRestoreTargetsResult,
    ResolvedRestoreTarget, RestoreManifestFile,
};
use super::validation::{
    validate_hash, validate_relative_path, validate_size, validate_windows_relative_path,
};

fn join_path(root: &str, relative_path: &str) -> String {
    format!(
        "{}/{}",
        root.trim_end_matches(['/', '\\']),
        relative_path.trim_start_matches(['/', '\\'])
    )
    .replace('\\', "/")
}

fn validate_file(file: &RestoreManifestFile, windows_semantics: bool) -> Result<(), String> {
    if file.variant_id.len() != 64
        || !file.variant_id.bytes().all(|byte| byte.is_ascii_hexdigit())
        || file.raw_path.is_empty()
        || normalize_rule_path(&file.raw_path) != file.raw_path
    {
        return Err("cloud_save_invalid_restore_identity".to_string());
    }
    validate_relative_path(&file.relative_path)?;
    if windows_semantics {
        validate_windows_relative_path(&file.relative_path)?;
    }
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

fn concrete_user_values(variant: &SnapshotVariant) -> Result<Vec<String>, &'static str> {
    match variant.kind.as_str() {
        "default" => Ok(Vec::new()),
        "opaque-folder" => Ok(vec![variant
            .concrete_folder_id
            .clone()
            .ok_or("blocked-user-ambiguous")?]),
        "steam-account" => Ok(vec![variant
            .steam_id64
            .clone()
            .ok_or("blocked-user-ambiguous")?]),
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

fn resolve_restore_targets_inner(
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
    let windows_semantics = context.platform == "windows" || context.windows_compatibility;

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
    let mut deferred_files = Vec::new();
    let mut identities = HashSet::new();
    let mut used_variants = HashSet::new();

    for file in input.files {
        validate_file(&file, windows_semantics).map_err(Error::from_reason)?;
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
        let rules = rules
            .into_iter()
            .filter(|rule| {
                rule_is_applicable(&rule.when, &context)
                    && !path_is_foreign_environment(&rule.raw_path, &context)
            })
            .collect::<Vec<_>>();
        if rules.is_empty() {
            deferred_files.push(blocked(file, "foreign-environment"));
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

        let user_values = match concrete_user_values(variant) {
            Ok(values) => values,
            Err(reason) => {
                blocked_files.push(blocked(file, reason));
                continue;
            }
        };

        let mut resolved_targets = Vec::new();
        let mut rejected_incomplete_relative_path = false;
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
            let preferred_path = rule.preferred_path.as_ref().filter(|preferred_path| {
                variant.kind == "default"
                    || user_values.iter().any(|value| {
                        preferred_path
                            .replace('\\', "/")
                            .split('/')
                            .any(|segment| segment == value)
                    })
            });
            if let Some(preferred_path) = preferred_path {
                resolved_roots.push((preferred_path.replace('\\', "/"), None));
            }
            for user_value in concrete_values {
                if preferred_path.is_some() {
                    break;
                }
                let concrete_rule = user_value
                    .map(|value| bind_store_user(&root_rule, value))
                    .unwrap_or_else(|| root_rule.clone());
                let concrete_target_rule = user_value
                    .map(|value| bind_store_user(&rule.raw_path, value))
                    .unwrap_or_else(|| rule.raw_path.clone());
                let resolved_root = resolve_restore_root(
                    &concrete_rule,
                    &concrete_target_rule,
                    &context,
                    directory,
                    rule.kind == "dir",
                    std::slice::from_ref(&file.relative_path),
                );
                if resolved_root
                    .as_ref()
                    .is_err_and(|error| error == "cloud_save_restore_relative_path_incomplete")
                {
                    rejected_incomplete_relative_path = true;
                }
                if let Ok(root) = resolved_root {
                    let concrete_rule = has_glob(&rule.raw_path)
                        .then(|| resolve_path(&concrete_target_rule, &context).paths);
                    resolved_roots.push((root, concrete_rule));
                }
            }

            for (root, concrete_rule) in resolved_roots {
                let target_path = if directory {
                    join_path(&root, &file.relative_path)
                } else {
                    root.clone()
                };
                if concrete_rule.as_ref().is_some_and(|candidates| {
                    !target_matches_rule(candidates, &target_path, rule.kind == "dir")
                }) {
                    rejected_incomplete_relative_path = true;
                    continue;
                }
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
            blocked_files.push(blocked(
                file,
                if rejected_incomplete_relative_path {
                    "blocked-relative-path-incomplete"
                } else {
                    "blocked-user-not-found"
                },
            ));
            continue;
        }
        if resolved_targets.len() > 1 {
            blocked_files.push(blocked(file, "blocked-target-ambiguous"));
            continue;
        }

        let (target_path, restore_root_path) = resolved_targets.remove(0);
        let observed = hash_files(vec![target_path.clone()], vec![])
            .ok()
            .and_then(|mut result| result.files.pop())
            .map(|file| (file.hash, file.size_bytes, file.last_modified_at));
        let action = if observed
            .as_ref()
            .is_some_and(|(hash, _, _)| hash == &file.hash)
        {
            "skip-identical"
        } else if Path::new(&target_path).exists() {
            "replace"
        } else {
            "create"
        };
        let (observed_hash, observed_size_bytes, observed_last_modified_at) = observed
            .map(|(hash, size_bytes, last_modified_at)| {
                (Some(hash), Some(size_bytes), Some(last_modified_at))
            })
            .unwrap_or((None, None, None));
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
                observed_hash,
                observed_size_bytes,
                observed_last_modified_at,
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
    deferred_files.sort_by_key(|file| {
        format!(
            "{}\0{}\0{}",
            file.variant_id, file.raw_path, file.relative_path
        )
    });

    Ok(ResolveRestoreTargetsResult {
        actions,
        blocked: blocked_files,
        deferred: deferred_files,
    })
}

#[napi]
pub async fn resolve_restore_targets(
    input: ResolveRestoreTargetsInput,
) -> napi::Result<ResolveRestoreTargetsResult> {
    tokio::task::spawn_blocking(move || resolve_restore_targets_inner(input))
        .await
        .map_err(|_| Error::from_reason("cloud_save_restore_plan_task_failed"))?
}

#[cfg(test)]
mod tests {
    use std::fs;

    use sha2::{Digest, Sha256};
    use tempfile::tempdir;

    use super::*;
    use crate::cloud_save::manifest::types::CloudSaveRuleCondition;
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
            approved_rules: vec![ApprovedRestoreRule {
                kind: "dir".into(),
                raw_path: RAW_RULE.into(),
                source: "test".into(),
                preferred_path: None,
                when: vec![],
            }],
            variants,
            files,
        }
    }

    #[test]
    fn keeps_an_absolute_custom_path_exact() {
        let temp = tempdir().unwrap();
        let variant = variant("default", "");
        let mut remote_file = file(&variant, "slot.sav");
        remote_file.raw_path =
            "<custom><windows><absolute>C:/Users/Rodrigo/Downloads/Game/Saves".into();
        let mut restore_input = input(temp.path(), vec![variant], vec![remote_file]);
        restore_input.approved_rules = vec![ApprovedRestoreRule {
            kind: "dir".into(),
            raw_path: "<custom><windows><absolute>C:/Users/Rodrigo/Downloads/Game/Saves".into(),
            source: "custom".into(),
            preferred_path: None,
            when: vec![],
        }];

        let result = resolve_restore_targets_inner(restore_input).unwrap();

        assert!(result.blocked.is_empty());
        assert_eq!(result.actions.len(), 1);
        assert_eq!(
            Path::new(&result.actions[0].target_path),
            Path::new("C:/Users/Rodrigo/Downloads/Game/Saves/slot.sav")
        );
    }

    #[test]
    fn reports_the_current_file_metadata_for_an_existing_target() {
        let temp = tempdir().unwrap();
        let target_root = temp.path().join("Game");
        fs::create_dir_all(&target_root).unwrap();
        fs::write(target_root.join("slot.sav"), b"save").unwrap();
        let variant = variant("default", "");
        let mut remote_file = file(&variant, "slot.sav");
        remote_file.raw_path = "<home>/Game".into();
        remote_file.hash = format!("{:x}", Sha256::digest(b"save"));
        let mut restore_input = input(temp.path(), vec![variant], vec![remote_file.clone()]);
        restore_input.approved_rules = vec![ApprovedRestoreRule {
            kind: "dir".into(),
            raw_path: remote_file.raw_path.clone(),
            source: "test".into(),
            preferred_path: None,
            when: vec![],
        }];

        let result = resolve_restore_targets_inner(restore_input).unwrap();

        assert_eq!(result.actions.len(), 1);
        assert_eq!(result.actions[0].action, "skip-identical");
        assert_eq!(
            result.actions[0].observed_hash.as_deref(),
            Some(remote_file.hash.as_str())
        );
        assert_eq!(result.actions[0].observed_size_bytes, Some(4.0));
        assert!(result.actions[0].observed_last_modified_at.is_some());
    }

    #[test]
    fn restores_a_windows_custom_path_to_the_approved_active_profile() {
        let temp = tempdir().unwrap();
        let prefix = temp.path().join("prefix");
        fs::create_dir_all(prefix.join("drive_c/users/steamuser")).unwrap();
        fs::create_dir_all(prefix.join("drive_c/users/player-two")).unwrap();
        let approved_root = prefix.join("drive_c/users/player-two/AppData/Roaming/Game");
        let variant = variant("default", "");
        let raw_path = "<custom><windows><winAppData>/Game";
        let mut remote_file = file(&variant, "slot.sav");
        remote_file.raw_path = raw_path.into();
        let mut restore_input = input(temp.path(), vec![variant], vec![remote_file]);
        restore_input.platform = "linux".into();
        restore_input.executable_path =
            Some(temp.path().join("Game/game.exe").display().to_string());
        restore_input.wine_prefix_path = Some(prefix.display().to_string());
        restore_input.approved_rules = vec![ApprovedRestoreRule {
            kind: "dir".into(),
            raw_path: raw_path.into(),
            source: "custom".into(),
            preferred_path: Some(approved_root.display().to_string()),
            when: vec![CloudSaveRuleCondition {
                os: Some("windows".into()),
                store: None,
            }],
        }];

        let result = resolve_restore_targets_inner(restore_input).unwrap();

        assert!(result.blocked.is_empty());
        assert_eq!(result.actions.len(), 1);
        assert_eq!(
            Path::new(&result.actions[0].target_path),
            approved_root.join("slot.sav")
        );
    }

    #[test]
    fn an_approved_custom_path_restores_to_its_exact_preferred_path() {
        let temp = tempdir().unwrap();
        let prefix = temp.path().join("prefix");
        let selected = prefix.join("drive_c/users/player-two/Documents/Game");
        fs::create_dir_all(prefix.join("drive_c/users/steamuser/Documents/Game")).unwrap();
        fs::create_dir_all(&selected).unwrap();
        let variant = variant("default", "");
        let raw_path = "<custom><windows><winDocuments>/Game";
        let mut remote_file = file(&variant, "slot.sav");
        remote_file.raw_path = raw_path.into();
        let mut restore_input = input(temp.path(), vec![variant], vec![remote_file]);
        restore_input.platform = "linux".into();
        restore_input.executable_path =
            Some(temp.path().join("Game/game.exe").display().to_string());
        restore_input.wine_prefix_path = Some(prefix.display().to_string());
        restore_input.approved_rules = vec![ApprovedRestoreRule {
            kind: "dir".into(),
            raw_path: raw_path.into(),
            source: "custom".into(),
            preferred_path: Some(selected.display().to_string()),
            when: vec![],
        }];

        let result = resolve_restore_targets_inner(restore_input).unwrap();

        assert!(result.blocked.is_empty());
        assert_eq!(
            Path::new(&result.actions[0].target_path),
            selected.join("slot.sav")
        );
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
        let result = resolve_restore_targets_inner(input(temp.path(), variants, files)).unwrap();

        assert!(result.blocked.is_empty());
        assert_eq!(result.actions.len(), 2);
    }

    #[test]
    fn creates_an_exact_missing_profile_folder() {
        let temp = tempdir().unwrap();
        let variants = vec![variant("opaque-folder", "Unknown")];
        let files = vec![file(&variants[0], "slot.dat")];
        let result = resolve_restore_targets_inner(input(temp.path(), variants, files)).unwrap();

        assert!(result.blocked.is_empty());
        assert_eq!(result.actions.len(), 1);
        assert_eq!(result.actions[0].action, "create");
        assert!(result.actions[0]
            .target_path
            .replace('\\', "/")
            .ends_with("/Game/Unknown/slot.dat"));
    }

    fn intermediate_glob_restore_input(
        home: &Path,
        relative_path: &str,
    ) -> ResolveRestoreTargetsInput {
        let profile = variant("opaque-folder", "76561197960267366");
        let raw_path = "<home>/Hk_project/Saved/SaveGames/<storeUserId>/Slots/Slot_*/Data.sav";
        ResolveRestoreTargetsInput {
            shop: "steam".into(),
            object_id: "1332010".into(),
            platform: "windows".into(),
            home_dir: home.display().to_string(),
            documents_dir: None,
            app_data_dir: None,
            executable_path: None,
            wine_prefix_path: None,
            steam_path: None,
            approved_rules: vec![ApprovedRestoreRule {
                kind: "file".into(),
                raw_path: raw_path.into(),
                source: "ludusavi".into(),
                preferred_path: None,
                when: vec![],
            }],
            variants: vec![profile.clone()],
            files: vec![RestoreManifestFile {
                variant_id: profile.variant_id,
                raw_path: raw_path.into(),
                relative_path: relative_path.into(),
                hash: "a".repeat(64),
                size_bytes: 4.0,
                last_modified_at: LAST_MODIFIED_AT.into(),
            }],
        }
    }

    #[test]
    fn restores_intermediate_glob_segments_from_the_portable_relative_path() {
        let temp = tempdir().unwrap();
        let result = resolve_restore_targets_inner(intermediate_glob_restore_input(
            temp.path(),
            "Slot_1/Data.sav",
        ))
        .unwrap();

        assert!(result.blocked.is_empty());
        assert_eq!(result.actions.len(), 1);
        assert!(result.actions[0]
            .restore_root_path
            .replace('\\', "/")
            .ends_with("/76561197960267366/Slots"));
        assert!(result.actions[0]
            .target_path
            .replace('\\', "/")
            .ends_with("/76561197960267366/Slots/Slot_1/Data.sav"));
    }

    #[test]
    fn ignores_a_legacy_layout_when_resolving_intermediate_glob_segments() {
        let temp = tempdir().unwrap();
        let legacy = temp
            .path()
            .join("Hk_project/Saved/SaveGames/76561197960267366/Slots/Data.sav");
        fs::create_dir_all(legacy.parent().unwrap()).unwrap();
        fs::write(&legacy, b"legacy save").unwrap();

        let result = resolve_restore_targets_inner(intermediate_glob_restore_input(
            temp.path(),
            "Slot_1/Data.sav",
        ))
        .unwrap();

        assert!(result.blocked.is_empty());
        assert_eq!(result.actions.len(), 1);
        assert!(result.actions[0]
            .target_path
            .replace('\\', "/")
            .ends_with("/76561197960267366/Slots/Slot_1/Data.sav"));
        assert_eq!(fs::read(&legacy).unwrap(), b"legacy save");
    }

    #[test]
    fn ignores_a_legacy_layout_inside_the_active_wine_prefix() {
        let temp = tempdir().unwrap();
        let prefix = temp.path().join("prefix");
        let save_root = prefix.join(
            "drive_c/users/steamuser/AppData/Local/Hk_project/Saved/SaveGames/76561197960267366/Slots",
        );
        fs::create_dir_all(&save_root).unwrap();
        let legacy = save_root.join("Data.sav");
        fs::write(&legacy, b"legacy save").unwrap();

        let raw_path =
            "<winLocalAppData>/Hk_project/Saved/SaveGames/<storeUserId>/Slots/Slot_*/Data.sav";
        let mut restore_input = intermediate_glob_restore_input(temp.path(), "Slot_1/Data.sav");
        restore_input.platform = "linux".into();
        restore_input.executable_path = Some(temp.path().join("Stray.exe").display().to_string());
        restore_input.wine_prefix_path = Some(prefix.display().to_string());
        restore_input.approved_rules[0].raw_path = raw_path.into();
        restore_input.files[0].raw_path = raw_path.into();

        let result = resolve_restore_targets_inner(restore_input).unwrap();

        assert!(result.blocked.is_empty());
        assert_eq!(result.actions.len(), 1);
        assert_eq!(
            Path::new(&result.actions[0].target_path),
            save_root.join("Slot_1/Data.sav")
        );
        assert_eq!(fs::read(&legacy).unwrap(), b"legacy save");
    }

    #[test]
    fn resolves_each_profile_independently_when_legacy_layouts_exist() {
        let temp = tempdir().unwrap();
        let second_profile = variant("opaque-folder", "76561199873967367");
        let mut restore_input = intermediate_glob_restore_input(temp.path(), "Slot_1/Data.sav");
        let mut second_file = restore_input.files[0].clone();
        second_file.variant_id = second_profile.variant_id.clone();
        restore_input.variants.push(second_profile);
        restore_input.files.push(second_file);

        for profile in ["76561197960267366", "76561199873967367"] {
            let legacy = temp
                .path()
                .join("Hk_project/Saved/SaveGames")
                .join(profile)
                .join("Slots/Data.sav");
            fs::create_dir_all(legacy.parent().unwrap()).unwrap();
            fs::write(legacy, b"legacy save").unwrap();
        }

        let result = resolve_restore_targets_inner(restore_input).unwrap();

        assert!(result.blocked.is_empty());
        assert_eq!(result.actions.len(), 2);
        for profile in ["76561197960267366", "76561199873967367"] {
            assert!(result.actions.iter().any(|action| {
                action
                    .target_path
                    .replace('\\', "/")
                    .ends_with(&format!("/{profile}/Slots/Slot_1/Data.sav"))
            }));
        }
    }

    #[test]
    fn blocks_legacy_file_glob_entries_that_lost_intermediate_segments() {
        let temp = tempdir().unwrap();
        let result =
            resolve_restore_targets_inner(intermediate_glob_restore_input(temp.path(), "Data.sav"))
                .unwrap();

        assert!(result.actions.is_empty());
        assert_eq!(result.blocked.len(), 1);
        assert_eq!(result.blocked[0].reason, "blocked-relative-path-incomplete");
    }

    #[test]
    fn validates_intermediate_segments_for_directory_globs() {
        let temp = tempdir().unwrap();
        let raw_path = "<home>/Hk_project/Saved/SaveGames/<storeUserId>/Slots/Slot_*".to_string();
        let mut valid = intermediate_glob_restore_input(temp.path(), "Slot_1/Data.sav");
        valid.approved_rules[0].kind = "dir".into();
        valid.approved_rules[0].raw_path = raw_path.clone();
        valid.files[0].raw_path = raw_path.clone();

        let valid_result = resolve_restore_targets_inner(valid).unwrap();
        assert!(valid_result.blocked.is_empty());
        assert_eq!(valid_result.actions.len(), 1);
        assert!(valid_result.actions[0]
            .target_path
            .replace('\\', "/")
            .ends_with("/76561197960267366/Slots/Slot_1/Data.sav"));

        let mut legacy = intermediate_glob_restore_input(temp.path(), "Data.sav");
        legacy.approved_rules[0].kind = "dir".into();
        legacy.approved_rules[0].raw_path = raw_path.clone();
        legacy.files[0].raw_path = raw_path;

        let legacy_result = resolve_restore_targets_inner(legacy).unwrap();
        assert!(legacy_result.actions.is_empty());
        assert_eq!(legacy_result.blocked.len(), 1);
        assert_eq!(
            legacy_result.blocked[0].reason,
            "blocked-relative-path-incomplete"
        );
    }

    #[test]
    fn restores_wildcard_segments_that_precede_a_captured_profile() {
        let temp = tempdir().unwrap();
        let profile = variant("opaque-folder", "Goldberg");
        let raw_path = "<home>/Games/Game_*/<storeUserId>/slot.dat";
        let result = resolve_restore_targets_inner(ResolveRestoreTargetsInput {
            shop: "steam".into(),
            object_id: "1".into(),
            platform: "windows".into(),
            home_dir: temp.path().display().to_string(),
            documents_dir: None,
            app_data_dir: None,
            executable_path: None,
            wine_prefix_path: None,
            steam_path: None,
            approved_rules: vec![ApprovedRestoreRule {
                kind: "file".into(),
                raw_path: raw_path.into(),
                source: "test".into(),
                preferred_path: None,
                when: vec![],
            }],
            variants: vec![profile.clone()],
            files: vec![RestoreManifestFile {
                variant_id: profile.variant_id,
                raw_path: raw_path.into(),
                relative_path: "Game_A/Goldberg/slot.dat".into(),
                hash: "a".repeat(64),
                size_bytes: 4.0,
                last_modified_at: LAST_MODIFIED_AT.into(),
            }],
        })
        .unwrap();

        assert!(result.blocked.is_empty());
        assert_eq!(result.actions.len(), 1);
        assert!(result.actions[0]
            .target_path
            .replace('\\', "/")
            .ends_with("/Games/Game_A/Goldberg/slot.dat"));
    }

    #[test]
    fn keeps_valid_file_glob_shapes_restoreable() {
        for (raw_path, relative_path) in [
            ("<home>/Game/SLOT*.SAV", "slot1.sav"),
            ("<home>/Game/*.{sav,dat}", "slot.dat"),
            ("<home>/Game/[{]Deluxe[}]/save*.dat", "{Deluxe}/save1.dat"),
        ] {
            let temp = tempdir().unwrap();
            let default = variant("default", "default");
            let result = resolve_restore_targets_inner(ResolveRestoreTargetsInput {
                shop: "steam".into(),
                object_id: "1".into(),
                platform: "windows".into(),
                home_dir: temp.path().display().to_string(),
                documents_dir: None,
                app_data_dir: None,
                executable_path: None,
                wine_prefix_path: None,
                steam_path: None,
                approved_rules: vec![ApprovedRestoreRule {
                    kind: "file".into(),
                    raw_path: raw_path.into(),
                    source: "test".into(),
                    preferred_path: None,
                    when: vec![],
                }],
                variants: vec![default.clone()],
                files: vec![RestoreManifestFile {
                    variant_id: default.variant_id,
                    raw_path: raw_path.into(),
                    relative_path: relative_path.into(),
                    hash: "a".repeat(64),
                    size_bytes: 4.0,
                    last_modified_at: LAST_MODIFIED_AT.into(),
                }],
            })
            .unwrap();

            assert!(
                result.blocked.is_empty(),
                "{raw_path}: {:?}",
                result
                    .blocked
                    .iter()
                    .map(|file| file.reason.as_str())
                    .collect::<Vec<_>>()
            );
            assert_eq!(result.actions.len(), 1, "{raw_path}");
            assert!(
                result.actions[0]
                    .target_path
                    .replace('\\', "/")
                    .ends_with(&format!("/Game/{relative_path}")),
                "{raw_path}: {}",
                result.actions[0].target_path
            );
        }
    }

    #[test]
    fn defers_a_foreign_environment_without_blocking_the_restore() {
        let temp = tempdir().unwrap();
        let variant = variant("default", "");
        let raw_path = "<xdgConfig>/Team Cherry/Hollow Knight Silksong";
        let mut remote_file = file(&variant, "slot.dat");
        remote_file.raw_path = raw_path.into();
        let mut restore_input = input(temp.path(), vec![variant], vec![remote_file]);
        restore_input.approved_rules = vec![ApprovedRestoreRule {
            kind: "dir".into(),
            raw_path: raw_path.into(),
            source: "ludusavi".into(),
            preferred_path: None,
            when: vec![CloudSaveRuleCondition {
                os: Some("linux".into()),
                store: None,
            }],
        }];

        let result = resolve_restore_targets_inner(restore_input).unwrap();

        assert!(result.actions.is_empty());
        assert!(result.blocked.is_empty());
        assert_eq!(result.deferred.len(), 1);
        assert_eq!(result.deferred[0].reason, "foreign-environment");
    }

    #[test]
    fn legacy_steam_variant_uses_its_literal_folder_without_account_context() {
        let temp = tempdir().unwrap();
        let variants = vec![variant("steam-account", "76561197960278073")];
        let files = vec![file(&variants[0], "slot.dat")];
        let result = resolve_restore_targets_inner(input(temp.path(), variants, files)).unwrap();

        assert!(result.blocked.is_empty());
        assert_eq!(result.actions.len(), 1);
        assert_eq!(result.actions[0].action, "create");
        assert!(result.actions[0]
            .target_path
            .replace('\\', "/")
            .ends_with("/Game/76561197960278073/slot.dat"));
    }

    #[test]
    fn preserves_different_numeric_profile_folders_as_different_targets() {
        let temp = tempdir().unwrap();
        let profile_ids = ["76561199800542110", "1840276382", "Goldberg"];
        let variants = profile_ids
            .map(|profile_id| variant("opaque-folder", profile_id))
            .to_vec();
        let files = variants
            .iter()
            .map(|variant| file(variant, "slot.dat"))
            .collect();

        let result = resolve_restore_targets_inner(input(temp.path(), variants, files)).unwrap();

        assert!(result.blocked.is_empty());
        assert_eq!(result.actions.len(), 3);
        for profile_id in profile_ids {
            assert!(result.actions.iter().any(|action| {
                action
                    .target_path
                    .replace('\\', "/")
                    .ends_with(&format!("/Game/{profile_id}/slot.dat"))
            }));
        }
    }

    #[test]
    fn does_not_alias_different_numeric_folder_formats() {
        let temp = tempdir().unwrap();
        fs::create_dir_all(temp.path().join("Game").join("1840276382")).unwrap();
        let variants = vec![variant("opaque-folder", "76561199800542110")];
        let files = vec![file(&variants[0], "slot.dat")];

        let result = resolve_restore_targets_inner(input(temp.path(), variants, files)).unwrap();

        assert!(result.blocked.is_empty());
        assert_eq!(result.actions.len(), 1);
        assert!(result.actions[0]
            .target_path
            .replace('\\', "/")
            .ends_with("/Game/76561199800542110/slot.dat"));
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
            approved_rules: vec![ApprovedRestoreRule {
                kind: "file".into(),
                raw_path: raw_path.into(),
                source: "test".into(),
                preferred_path: None,
                when: vec![],
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
        let result = resolve_restore_targets_inner(input).unwrap();

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
    fn resolves_an_approved_custom_directory_and_can_create_it() {
        let default = variant("default", "default");
        let normalized_root = "C:/Users/hydra/AppData/Local/Temp/Custom Saves";
        let raw_path = format!("<custom><windows><absolute>{normalized_root}");
        let input = ResolveRestoreTargetsInput {
            shop: "steam".into(),
            object_id: "1".into(),
            platform: "windows".into(),
            home_dir: "C:/Users/hydra".into(),
            documents_dir: None,
            app_data_dir: None,
            executable_path: None,
            wine_prefix_path: None,
            steam_path: None,
            approved_rules: vec![ApprovedRestoreRule {
                kind: "dir".into(),
                raw_path: raw_path.clone(),
                source: "custom".into(),
                preferred_path: None,
                when: vec![],
            }],
            variants: vec![default.clone()],
            files: vec![RestoreManifestFile {
                variant_id: default.variant_id,
                raw_path,
                relative_path: "Profile/slot.sav".into(),
                hash: "a".repeat(64),
                size_bytes: 4.0,
                last_modified_at: LAST_MODIFIED_AT.into(),
            }],
        };

        let result = resolve_restore_targets_inner(input).unwrap();

        assert!(result.blocked.is_empty());
        assert_eq!(result.actions.len(), 1);
        assert_eq!(result.actions[0].action, "create");
        assert_eq!(
            result.actions[0].restore_root_path.replace('\\', "/"),
            normalized_root
        );
        assert!(result.actions[0]
            .target_path
            .replace('\\', "/")
            .ends_with("/Custom Saves/Profile/slot.sav"));
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
            approved_rules: vec![
                ApprovedRestoreRule {
                    kind: "file".into(),
                    raw_path: raw_path.into(),
                    source: "first".into(),
                    preferred_path: None,
                    when: vec![],
                },
                ApprovedRestoreRule {
                    kind: "dir".into(),
                    raw_path: raw_path.into(),
                    source: "second".into(),
                    preferred_path: None,
                    when: vec![],
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
        let result = resolve_restore_targets_inner(input).unwrap();

        assert!(result.actions.is_empty());
        assert_eq!(result.blocked[0].reason, "blocked-target-ambiguous");
    }

    #[test]
    fn rejects_traversal() {
        let temp = tempdir().unwrap();
        let variants = vec![variant("opaque-folder", "Goldberg")];
        let files = vec![file(&variants[0], "../slot.dat")];
        assert!(resolve_restore_targets_inner(input(temp.path(), variants, files)).is_err());
    }

    #[test]
    fn rejects_windows_unsafe_relative_paths_during_resolution() {
        for relative_path in ["slot.sav:stream", "CON", "Profile/NUL.txt", "save. "] {
            let temp = tempdir().unwrap();
            let variants = vec![variant("opaque-folder", "Goldberg")];
            let files = vec![file(&variants[0], relative_path)];

            assert!(resolve_restore_targets_inner(input(temp.path(), variants, files,)).is_err());
        }
    }
}
