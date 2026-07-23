mod types;

use std::collections::{btree_map::Entry, BTreeMap, HashSet};
use std::path::Path;

use napi::bindgen_prelude::Error;
use napi_derive::napi;

use super::identity::{
    build_snapshot_variant, local_id, normalize_text, portable_bindings, store_user_identity,
    LocalResolutionBindings, SnapshotVariant, StoreUserContext, UserLocationCoverage,
    DISCOVERY_ENGINE_VERSION,
};
use super::local_snapshot::types::DiscoveredLocalSaveFile;
use super::local_snapshot::{
    build_local_game_snapshot, BuildLocalGameSnapshotInput, LocalGameSnapshotWithHash,
};
use super::manifest::types::CloudSaveGameId;
use super::manifest::{get_save_rules_for_game, GetSaveRulesForGameInput};
use super::path_resolution::{resolve_save_rules, ResolveSaveRulesInput};
use super::save_scanner::{scan_resolved_save_rules, ScannedCloudSaveRule};

pub use types::BuildLocalGameSnapshotPipelineInput;

const DYNAMIC_PATH_PRIORITY: u8 = 0;
const STATIC_PATH_PRIORITY: u8 = 1;
const STATIC_FILE_PRIORITY: u8 = 2;

fn coverage_authority(identity_authority: &str) -> String {
    match identity_authority {
        "active" => "authoritative",
        "known" => "exact",
        _ => "inferred",
    }
    .to_string()
}

fn collect_discovered_files(
    shop: &str,
    object_id: &str,
    save_namespace_key: &str,
    environment_id: &str,
    store_user_context: &StoreUserContext,
    scanned_rules: Vec<ScannedCloudSaveRule>,
) -> Result<
    (
        Vec<SnapshotVariant>,
        Vec<DiscoveredLocalSaveFile>,
        Vec<UserLocationCoverage>,
    ),
    String,
> {
    let mut discovered_by_path = BTreeMap::new();
    let mut coverage = Vec::new();
    let mut identity_by_candidate = BTreeMap::<String, (String, String)>::new();
    let mut variants_by_id = BTreeMap::<String, SnapshotVariant>::new();

    for rule in scanned_rules {
        let priority = if rule
            .resolved_paths
            .iter()
            .any(|path| !path.dynamic && Path::new(&path.path).is_file())
        {
            STATIC_FILE_PRIORITY
        } else if rule.resolved_paths.iter().any(|path| !path.dynamic) {
            STATIC_PATH_PRIORITY
        } else {
            DYNAMIC_PATH_PRIORITY
        };
        for scanned_path in rule.scanned_paths {
            let store_user = store_user_identity(
                shop,
                scanned_path.store_user_id.as_deref(),
                store_user_context,
            );
            let authority = store_user.authority.clone();
            let coverage_authority = coverage_authority(&authority);
            let concrete_user_segment = store_user.concrete_folder_id.clone();
            let bindings = portable_bindings(shop, object_id, store_user);
            let variant =
                build_snapshot_variant(save_namespace_key, &bindings, scanned_path.case_sensitive);
            let variant_id = variant.variant_id.clone();
            if let Some(existing) = variants_by_id.insert(variant_id.clone(), variant.clone()) {
                if existing.kind != variant.kind
                    || existing.steam_id64 != variant.steam_id64
                    || existing.concrete_folder_id != variant.concrete_folder_id
                {
                    return Err("cloud_save_variant_metadata_mismatch".to_string());
                }
            }
            identity_by_candidate.insert(
                scanned_path.candidate_id.clone(),
                (variant_id.clone(), coverage_authority.clone()),
            );
            for file in scanned_path.files {
                let relative_path = normalize_text(&file.relative_path.replace('\\', "/"));
                let provenance = vec![format!("{}:{}", rule.source, rule.rule_id)];
                let discovered = DiscoveredLocalSaveFile {
                    variant_id: variant_id.clone(),
                    rule_id: rule.rule_id.clone(),
                    raw_path: rule.raw_path.clone(),
                    absolute_path: file.absolute_path.clone(),
                    relative_path,
                    local_bindings: LocalResolutionBindings {
                        environment_id: environment_id.to_string(),
                        root_id: local_id(&[environment_id, &scanned_path.resolved_path]),
                        prefix_generation_id: None,
                        concrete_user_segment: concrete_user_segment.clone(),
                        concrete_path: scanned_path.resolved_path.clone(),
                    },
                    confidence: coverage_authority.clone(),
                    provenance,
                };

                match discovered_by_path.entry(file.absolute_path) {
                    Entry::Vacant(entry) => {
                        entry.insert((priority, discovered));
                    }
                    Entry::Occupied(mut entry) => {
                        let (existing_priority, existing) = entry.get_mut();
                        let replace = priority > *existing_priority
                            || (priority == *existing_priority
                                && (
                                    &discovered.variant_id,
                                    &discovered.raw_path,
                                    &discovered.relative_path,
                                ) < (
                                    &existing.variant_id,
                                    &existing.raw_path,
                                    &existing.relative_path,
                                ));
                        if replace {
                            let mut replacement = discovered;
                            replacement
                                .provenance
                                .extend(existing.provenance.iter().cloned());
                            replacement.provenance.sort();
                            replacement.provenance.dedup();
                            entry.insert((priority, replacement));
                        } else {
                            existing.provenance.extend(discovered.provenance);
                            existing.provenance.sort();
                            existing.provenance.dedup();
                        }
                    }
                }
            }
        }

        for mut item in rule.coverage {
            if let Some((variant_id, authority)) = identity_by_candidate.get(&item.candidate_id) {
                item.variant_id = Some(variant_id.clone());
                item.authority = authority.clone();
            }
            coverage.push(item);
        }
    }

    let mut discovered_by_identity = BTreeMap::new();
    let mut ambiguous = HashSet::new();
    for (_, discovered) in discovered_by_path.into_values() {
        let identity = (
            discovered.variant_id.clone(),
            discovered.raw_path.clone(),
            discovered.relative_path.clone(),
        );
        match discovered_by_identity.entry(identity.clone()) {
            Entry::Vacant(entry) => {
                entry.insert(discovered);
            }
            Entry::Occupied(entry) if entry.get().absolute_path != discovered.absolute_path => {
                ambiguous.insert(identity);
                coverage.push(UserLocationCoverage {
                    candidate_id: local_id(&[
                        "ambiguous",
                        &discovered.variant_id,
                        &discovered.raw_path,
                        &discovered.relative_path,
                    ]),
                    rule_id: discovered.rule_id.clone(),
                    variant_id: Some(discovered.variant_id.clone()),
                    raw_path: Some(discovered.raw_path.clone()),
                    relative_path: Some(discovered.relative_path.clone()),
                    authority: discovered.confidence.clone(),
                    outcome: "partial".to_string(),
                    enumerated_completely: false,
                    warning_codes: vec!["ambiguous-location".to_string()],
                });
            }
            Entry::Occupied(_) => {}
        }
    }
    for identity in ambiguous {
        discovered_by_identity.remove(&identity);
    }
    coverage.sort_by(|left, right| {
        left.rule_id
            .cmp(&right.rule_id)
            .then_with(|| left.variant_id.cmp(&right.variant_id))
            .then_with(|| left.candidate_id.cmp(&right.candidate_id))
    });

    Ok((
        variants_by_id.into_values().collect(),
        discovered_by_identity.into_values().collect(),
        coverage,
    ))
}

#[napi]
pub async fn build_local_game_snapshot_pipeline(
    input: BuildLocalGameSnapshotPipelineInput,
) -> napi::Result<LocalGameSnapshotWithHash> {
    let shop = input.shop;
    let object_id = input.object_id;
    let save_namespace_key = format!("{shop}:{object_id}");
    let save_rules = get_save_rules_for_game(GetSaveRulesForGameInput {
        shop: shop.clone(),
        object_id: object_id.clone(),
        title: input.title,
        remote_id: input.remote_id,
        user_data_path: input.user_data_path,
        source_url: input.source_url,
    })
    .await?;
    let manifest_key = save_rules.manifest_key;
    let rule_source_revision = save_rules.rule_source_revision;
    let resolved_rules = resolve_save_rules(ResolveSaveRulesInput {
        shop: shop.clone(),
        object_id: object_id.clone(),
        platform: input.platform,
        home_dir: input.home_dir,
        documents_dir: input.documents_dir,
        app_data_dir: input.app_data_dir,
        executable_path: input.executable_path,
        wine_prefix_path: input.wine_prefix_path,
        steam_path: input.steam_path,
        rules: save_rules.rules,
    })?;
    let scanned_rules = scan_resolved_save_rules(resolved_rules).await?;
    let environment_id = input.environment_id;
    let store_user_context = input.store_user_context;
    let namespace_for_collect = save_namespace_key.clone();
    let shop_for_collect = shop.clone();
    let object_for_collect = object_id.clone();
    let (variants, discovered_files, coverage) = tokio::task::spawn_blocking(move || {
        collect_discovered_files(
            &shop_for_collect,
            &object_for_collect,
            &namespace_for_collect,
            &environment_id,
            &store_user_context,
            scanned_rules,
        )
    })
    .await
    .map_err(|error| Error::from_reason(error.to_string()))?
    .map_err(Error::from_reason)?;

    build_local_game_snapshot(BuildLocalGameSnapshotInput {
        game_id: CloudSaveGameId { shop, object_id },
        manifest_key,
        rule_source_revision,
        discovery_engine_version: DISCOVERY_ENGINE_VERSION,
        coverage,
        variants,
        files: discovered_files,
        hash_cache: input.hash_cache,
    })
    .await
}

#[cfg(test)]
mod tests {
    use std::fs;

    use tempfile::tempdir;

    use super::*;
    use crate::cloud_save::path_resolution::ResolvedCloudSavePath;
    use crate::cloud_save::save_scanner::{ScannedCloudSaveFile, ScannedCloudSavePath};

    fn scanned_rule(
        raw_path: &str,
        user: Option<&str>,
        absolute_path: &str,
        relative_path: &str,
    ) -> ScannedCloudSaveRule {
        ScannedCloudSaveRule {
            rule_id: format!("rule-{raw_path}"),
            kind: "dir".into(),
            raw_path: raw_path.into(),
            source: "test".into(),
            tags: vec!["save".into()],
            when: vec![],
            resolved_paths: vec![ResolvedCloudSavePath {
                path: absolute_path.into(),
                case_sensitive: false,
                dynamic: user.is_some(),
                scan_root: None,
            }],
            unresolved_tokens: vec![],
            scanned_paths: vec![ScannedCloudSavePath {
                candidate_id: format!("candidate-{user:?}"),
                resolved_path: Path::new(absolute_path)
                    .parent()
                    .unwrap()
                    .display()
                    .to_string(),
                store_user_id: user.map(ToString::to_string),
                case_sensitive: false,
                files: vec![ScannedCloudSaveFile {
                    absolute_path: absolute_path.into(),
                    relative_path: relative_path.into(),
                }],
            }],
            coverage: vec![],
        }
    }

    #[test]
    fn keeps_same_relative_file_for_two_store_users() {
        let temp = tempdir().unwrap();
        let first = temp.path().join("111111/S0000.sl2");
        let second = temp.path().join("222222/S0000.sl2");
        fs::create_dir_all(first.parent().unwrap()).unwrap();
        fs::create_dir_all(second.parent().unwrap()).unwrap();
        fs::write(&first, b"same").unwrap();
        fs::write(&second, b"same").unwrap();

        let (variants, files, _) = collect_discovered_files(
            "steam",
            "814380",
            "steam:814380",
            "environment",
            &StoreUserContext::default(),
            vec![
                scanned_rule(
                    "<winAppData>/Sekiro/<storeUserId>",
                    Some("111111"),
                    &first.display().to_string(),
                    "S0000.sl2",
                ),
                scanned_rule(
                    "<winAppData>/Sekiro/<storeUserId>",
                    Some("222222"),
                    &second.display().to_string(),
                    "S0000.sl2",
                ),
            ],
        )
        .unwrap();

        assert_eq!(files.len(), 2);
        assert_eq!(variants.len(), 2);
        assert_ne!(files[0].variant_id, files[1].variant_id);
    }
}
