use std::collections::HashMap;
use std::path::{Path, PathBuf};

use napi::bindgen_prelude::Error;
use napi_derive::napi;

use crate::cloud_save::hashing::hash_file;
use crate::cloud_save::identity::{
    build_logical_file_id, build_variant_id, is_safe_capture, normalize_rule_path,
    store_user_identity,
};
use crate::cloud_save::manifest::types::CloudSaveRule;
use crate::cloud_save::path_resolution::{
    build_context, glob_base_path, resolve_restore_root, ResolveSaveRulesInput,
};

use super::types::{
    BlockedRestoreFile, ResolveRestoreTargetsInput, ResolveRestoreTargetsResult,
    ResolvedRestoreTarget, RestoreManifestFile,
};
use super::validation::{validate_hash, validate_relative_path, validate_size};

fn join_path(root: &str, relative_path: &str) -> String {
    format!(
        "{}/{}",
        root.trim_end_matches(['/', '\\']),
        relative_path.trim_start_matches(['/', '\\'])
    )
    .replace('\\', "/")
}

fn validate_file(file: &RestoreManifestFile, shop: &str, object_id: &str) -> Result<(), String> {
    if file.logical_file_id.is_empty()
        || file.variant_id.is_empty()
        || file.rule_id.is_empty()
        || file.locator.version != 1
        || file.rule_id != file.locator.rule_id
        || file.locator.bindings.store != shop
        || file.locator.bindings.store_game_id != object_id
        || normalize_rule_path(&file.locator.raw_rule) != file.locator.raw_rule
    {
        return Err("cloud_save_invalid_restore_locator".to_string());
    }
    validate_relative_path(&file.relative_path)?;
    validate_hash(&file.content_hash)?;
    validate_size(file.size_bytes)?;
    let namespace = format!("{shop}:{object_id}");
    let identity_matches = [false, true].into_iter().any(|case_sensitive| {
        build_variant_id(&namespace, &file.locator.bindings, case_sensitive) == file.variant_id
            && build_logical_file_id(
                &namespace,
                &file.variant_id,
                &file.rule_id,
                &file.relative_path,
                case_sensitive,
            )
            .is_ok_and(|logical_file_id| logical_file_id == file.logical_file_id)
    });
    if !identity_matches {
        return Err("cloud_save_restore_identity_mismatch".to_string());
    }
    Ok(())
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

fn blocked(file: RestoreManifestFile, reason: &str) -> BlockedRestoreFile {
    BlockedRestoreFile {
        logical_file_id: file.logical_file_id,
        variant_id: file.variant_id,
        rule_id: file.rule_id,
        relative_path: file.relative_path,
        locator: file.locator,
        content_hash: file.content_hash,
        size_bytes: file.size_bytes,
        reason: reason.to_string(),
    }
}

fn concrete_user_values(
    file: &RestoreManifestFile,
    context: &crate::cloud_save::identity::StoreUserContext,
) -> Result<Vec<String>, &'static str> {
    let remote = &file.locator.bindings.store_user;
    if !is_safe_capture(&remote.concrete_folder_id) {
        return Err("blocked-user-ambiguous");
    }
    if remote.kind == "opaque-folder" {
        return Ok(vec![remote.concrete_folder_id.clone()]);
    }

    let matched = [remote.steam_id64.as_deref(), remote.account_id32.as_deref()]
        .into_iter()
        .flatten()
        .any(|representation| {
            let identity = store_user_identity("steam", Some(representation), context);
            identity.kind == "validated-account"
                && identity.steam_id64 == remote.steam_id64
                && identity.account_id32 == remote.account_id32
        });
    if !matched {
        return Err("blocked-user-not-found");
    }

    let mut alternatives = remote
        .steam_id64
        .iter()
        .chain(remote.account_id32.iter())
        .filter(|value| *value != &remote.concrete_folder_id)
        .cloned()
        .collect::<Vec<_>>();
    alternatives.sort();
    alternatives.dedup();
    let mut values = vec![remote.concrete_folder_id.clone()];
    values.extend(alternatives);
    Ok(values)
}

fn bind_store_user(raw_rule: &str, value: &str) -> String {
    raw_rule
        .replace("*<storeUserId>", value)
        .replace("<storeUserId>*", value)
        .replace("<storeUserId>", value)
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
    let approved = input
        .approved_rules
        .into_iter()
        .map(|rule| (rule.rule_id.clone(), rule))
        .collect::<HashMap<_, _>>();
    let mut candidates = Vec::<(ResolvedRestoreTarget, RestoreManifestFile)>::new();
    let mut blocked_files = Vec::new();

    for file in input.files {
        validate_file(&file, &input.shop, &input.object_id).map_err(Error::from_reason)?;
        let Some(rule) = approved.get(&file.rule_id).filter(|rule| {
            normalize_rule_path(&rule.raw_rule) == file.locator.raw_rule
                && rule.source == file.locator.rule_source
        }) else {
            blocked_files.push(blocked(file, "blocked-rule-unavailable"));
            continue;
        };
        let user_values = if rule.raw_rule.contains("<storeUserId>") {
            match concrete_user_values(&file, &input.store_user_context) {
                Ok(values) => values,
                Err(reason) => {
                    blocked_files.push(blocked(file, reason));
                    continue;
                }
            }
        } else {
            vec!["__unbound__".to_string()]
        };
        let directory = file.locator.target_semantics != "single-file";
        let root_rule = if file.locator.target_semantics == "glob-set" {
            glob_base_path(&rule.raw_rule).unwrap_or_else(|| rule.raw_rule.clone())
        } else {
            rule.raw_rule.clone()
        };

        let mut resolved_roots = Vec::new();
        for user_value in user_values {
            let concrete_rule = if root_rule.contains("<storeUserId>") {
                bind_store_user(&root_rule, &user_value)
            } else {
                root_rule.clone()
            };
            if let Ok(root) = resolve_restore_root(
                &concrete_rule,
                &context,
                directory,
                std::slice::from_ref(&file.relative_path),
            ) {
                if file.locator.bindings.store_user.kind == "opaque-folder"
                    && !Path::new(&root).exists()
                {
                    continue;
                }
                resolved_roots.push((root.clone(), Path::new(&root).exists()));
            }
        }
        if file.locator.bindings.store_user.kind == "validated-account" {
            let existing = resolved_roots
                .iter()
                .filter(|(_, exists)| *exists)
                .cloned()
                .collect::<Vec<_>>();
            if existing.is_empty() {
                resolved_roots.truncate(1);
            } else {
                resolved_roots = existing;
            }
        }
        resolved_roots.dedup_by(|left, right| {
            canonical_target_key(&left.0, case_sensitive)
                == canonical_target_key(&right.0, case_sensitive)
        });
        if resolved_roots.is_empty() {
            blocked_files.push(blocked(file, "blocked-user-not-found"));
            continue;
        }
        if resolved_roots.len() > 1 {
            blocked_files.push(blocked(file, "blocked-user-ambiguous"));
            continue;
        }
        let root = resolved_roots.remove(0).0;
        let target_path = if directory {
            join_path(&root, &file.relative_path)
        } else {
            root.clone()
        };
        if !target_is_within_root(&target_path, &root, case_sensitive) {
            blocked_files.push(blocked(file, "blocked-target-outside-root"));
            continue;
        }
        let action = if Path::new(&target_path).is_file()
            && hash_file(&target_path).is_ok_and(|hash| hash == file.content_hash)
        {
            "skip-identical"
        } else if Path::new(&target_path).exists() {
            "replace"
        } else {
            "create"
        };
        candidates.push((
            ResolvedRestoreTarget {
                logical_file_id: file.logical_file_id.clone(),
                variant_id: file.variant_id.clone(),
                rule_id: file.rule_id.clone(),
                relative_path: file.relative_path.clone(),
                target_path,
                content_hash: file.content_hash.clone(),
                size_bytes: file.size_bytes,
                action: action.to_string(),
            },
            file,
        ));
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
            blocked_files.push(blocked(file, "blocked-user-ambiguous"));
        } else {
            actions.push(target);
        }
    }
    actions.sort_by(|left, right| left.logical_file_id.cmp(&right.logical_file_id));
    blocked_files.sort_by(|left, right| left.logical_file_id.cmp(&right.logical_file_id));

    Ok(ResolveRestoreTargetsResult {
        actions,
        blocked: blocked_files,
    })
}

#[cfg(test)]
mod tests {
    use std::fs;

    use tempfile::tempdir;

    use super::*;
    use crate::cloud_save::identity::{
        portable_bindings, KnownStoreAccount, PortableLocator, StoreUserContext,
    };
    use crate::cloud_save::restore::types::ApprovedRestoreRule;

    const RAW_RULE: &str = "<home>/Game/<storeUserId>";

    fn file(
        context: &StoreUserContext,
        captured: &str,
        relative_path: &str,
    ) -> RestoreManifestFile {
        let identity = store_user_identity("steam", Some(captured), context);
        let bindings = portable_bindings("steam", "1", identity);
        let variant_id = build_variant_id("steam:1", &bindings, false);
        let rule_id = "rule".to_string();
        RestoreManifestFile {
            logical_file_id: build_logical_file_id(
                "steam:1",
                &variant_id,
                &rule_id,
                relative_path,
                false,
            )
            .unwrap(),
            variant_id,
            rule_id: rule_id.clone(),
            relative_path: relative_path.to_string(),
            locator: PortableLocator {
                version: 1,
                rule_id,
                raw_rule: RAW_RULE.into(),
                rule_source: "test".into(),
                root_kind: "home".into(),
                bindings,
                target_semantics: "directory-tree".into(),
            },
            content_hash: "a".repeat(64),
            size_bytes: 4.0,
        }
    }

    fn input(
        home: &Path,
        context: StoreUserContext,
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
                rule_id: "rule".into(),
                raw_rule: RAW_RULE.into(),
                source: "test".into(),
            }],
            files,
        }
    }

    #[test]
    fn maps_two_opaque_folders_independently_even_with_same_content_hash() {
        let temp = tempdir().unwrap();
        for user in ["Goldberg", "Rune"] {
            fs::create_dir_all(temp.path().join("Game").join(user)).unwrap();
        }
        let context = StoreUserContext::default();
        let result = resolve_restore_targets(input(
            temp.path(),
            context.clone(),
            vec![
                file(&context, "Goldberg", "slot.dat"),
                file(&context, "Rune", "slot.dat"),
            ],
        ))
        .unwrap();

        assert!(result.blocked.is_empty());
        assert_eq!(result.actions.len(), 2);
        let targets = result
            .actions
            .iter()
            .map(|action| action.target_path.replace('\\', "/"))
            .collect::<Vec<_>>();
        assert!(targets
            .iter()
            .any(|path| path.ends_with("/Game/Goldberg/slot.dat")));
        assert!(targets
            .iter()
            .any(|path| path.ends_with("/Game/Rune/slot.dat")));
    }

    #[test]
    fn refuses_to_create_a_missing_opaque_folder() {
        let temp = tempdir().unwrap();
        let context = StoreUserContext::default();
        let result = resolve_restore_targets(input(
            temp.path(),
            context.clone(),
            vec![file(&context, "Unknown", "slot.dat")],
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
        let result = resolve_restore_targets(input(
            temp.path(),
            context.clone(),
            vec![file(&context, "12345", "slot.dat")],
        ))
        .unwrap();

        assert!(result.blocked.is_empty());
        assert_eq!(result.actions.len(), 1);
        assert_eq!(result.actions[0].action, "create");
        assert!(result.actions[0]
            .target_path
            .replace('\\', "/")
            .ends_with("/Game/12345/slot.dat"));
    }
}
