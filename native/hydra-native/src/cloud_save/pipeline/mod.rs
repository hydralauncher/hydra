mod types;

use std::collections::{btree_map::Entry, BTreeMap, HashSet};
use std::path::Path;

use napi::bindgen_prelude::Error;
use napi_derive::napi;

use super::identity::{
    build_snapshot_variant, local_id, normalize_text, portable_bindings, store_user_identity,
    LocalResolutionBindings, SnapshotVariant, UserLocationCoverage, DISCOVERY_ENGINE_VERSION,
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
        "known" | "literal" => "exact",
        _ => "inferred",
    }
    .to_string()
}

fn collect_discovered_files(
    shop: &str,
    object_id: &str,
    save_namespace_key: &str,
    environment_id: &str,
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
        let path_priority = if rule
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
        // A custom rule that overlaps a manifest rule must not rename an
        // already tracked file and create a second remote identity.
        let priority = (rule.source != "custom", path_priority);
        for scanned_path in rule.scanned_paths {
            let store_user = store_user_identity(shop, scanned_path.store_user_id.as_deref());
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
                    selected_root: true,
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
    let mut rules = save_rules.rules;
    rules.extend(input.extra_rules.unwrap_or_default());
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
        rules,
    })?;
    let scanned_rules = scan_resolved_save_rules(resolved_rules).await?;
    let environment_id = input.environment_id;
    let namespace_for_collect = save_namespace_key.clone();
    let shop_for_collect = shop.clone();
    let object_for_collect = object_id.clone();
    let (variants, discovered_files, coverage) = tokio::task::spawn_blocking(move || {
        collect_discovered_files(
            &shop_for_collect,
            &object_for_collect,
            &namespace_for_collect,
            &environment_id,
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
    #[cfg(not(windows))]
    use std::time::{SystemTime, UNIX_EPOCH};

    #[cfg(not(windows))]
    use indexmap::IndexMap;
    use tempfile::tempdir;

    use super::*;
    #[cfg(not(windows))]
    use crate::cloud_save::manifest::types::{
        ManifestFileRule, ManifestGameEntry, ManifestIndex, ManifestRuleCondition,
    };
    use crate::cloud_save::path_resolution::ResolvedCloudSavePath;
    use crate::cloud_save::save_scanner::{ScannedCloudSaveFile, ScannedCloudSavePath};
    #[cfg(not(windows))]
    use crate::constants::MANIFEST_INDEX_VERSION;

    // Windows uses the live KnownFolder path even when the input home is synthetic.
    // Keep this fixture away from a real player's save directory on Windows.
    #[cfg(not(windows))]
    #[tokio::test]
    async fn epic_catalogue_snapshot_detects_two_accounts_and_a_changed_save() {
        let temp = tempdir().unwrap();
        let home = temp.path().join("Users/Hydra");
        let roaming = home.join("AppData/Roaming");
        let local = home.join("AppData/Local");
        let first_save = local.join("FactoryGame/Saved/SaveGames/EpicUserA/slot.sav");
        let second_save = local.join("FactoryGame/Saved/SaveGames/EpicUserB/slot.sav");
        fs::create_dir_all(first_save.parent().unwrap()).unwrap();
        fs::create_dir_all(second_save.parent().unwrap()).unwrap();
        fs::write(&first_save, b"first account").unwrap();
        fs::write(&second_save, b"second account").unwrap();

        let source_url = "https://example.invalid/epic-fixture.yaml";
        let raw_path = "<winLocalAppData>/FactoryGame/Saved/SaveGames/<storeUserId>";
        let mut games = IndexMap::new();
        games.insert(
            "Satisfactory".to_string(),
            ManifestGameEntry {
                manifest_key: "Satisfactory".into(),
                files: vec![
                    ManifestFileRule {
                        raw_path: raw_path.into(),
                        tags: vec!["save".into()],
                        when: vec![],
                    },
                    ManifestFileRule {
                        raw_path: "<root>/userdata/steam-only.sav".into(),
                        tags: vec!["save".into()],
                        when: vec![ManifestRuleCondition {
                            os: None,
                            store: Some("steam".into()),
                        }],
                    },
                ],
            },
        );
        let fetched_at = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_millis() as i64;
        let index = ManifestIndex {
            version: MANIFEST_INDEX_VERSION,
            fetched_at,
            source_url: source_url.into(),
            games,
        };
        fs::write(
            temp.path().join("cloud-save-manifest-index.json"),
            serde_json::to_vec(&index).unwrap(),
        )
        .unwrap();

        let input = |hash_cache| BuildLocalGameSnapshotPipelineInput {
            shop: "epic".into(),
            object_id: "namespace:playable-item-id".into(),
            title: Some("Satisfactory".into()),
            remote_id: None,
            user_data_path: temp.path().to_string_lossy().into_owned(),
            source_url: Some(source_url.into()),
            platform: "windows".into(),
            home_dir: home.to_string_lossy().into_owned(),
            documents_dir: None,
            app_data_dir: Some(roaming.to_string_lossy().into_owned()),
            executable_path: Some(
                temp.path()
                    .join("Games/Satisfactory/FactoryGame.exe")
                    .to_string_lossy()
                    .into_owned(),
            ),
            wine_prefix_path: None,
            steam_path: Some(temp.path().join("Steam").to_string_lossy().into_owned()),
            environment_id: "epic-fixture-environment".into(),
            hash_cache,
            extra_rules: None,
        };

        let initial = build_local_game_snapshot_pipeline(input(vec![]))
            .await
            .unwrap();
        assert_eq!(initial.game_id.shop, "epic");
        assert_eq!(initial.game_id.object_id, "namespace:playable-item-id");
        assert_eq!(initial.manifest_key.as_deref(), Some("Satisfactory"));
        assert_eq!(initial.file_count, 2);
        assert_eq!(initial.variants.len(), 2);
        assert!(initial
            .variants
            .iter()
            .all(|variant| variant.kind == "opaque-folder"));
        assert!(initial.files.iter().all(|file| file.raw_path == raw_path));
        assert_ne!(initial.files[0].variant_id, initial.files[1].variant_id);
        let previous_hashes = initial
            .source_files
            .iter()
            .map(|file| (file.absolute_path.clone(), file.hash.clone()))
            .collect::<std::collections::HashMap<_, _>>();
        let previous_aggregate = initial.aggregate_hash;

        fs::write(&second_save, b"second account changed after game exit").unwrap();
        let changed = build_local_game_snapshot_pipeline(input(initial.hash_cache))
            .await
            .unwrap();
        assert_eq!(changed.file_count, 2);
        assert_ne!(changed.aggregate_hash, previous_aggregate);
        let second_save = fs::canonicalize(second_save).unwrap();
        let changed_file = changed
            .source_files
            .iter()
            .find(|file| fs::canonicalize(&file.absolute_path).unwrap() == second_save)
            .unwrap();
        assert_ne!(
            changed_file.hash,
            previous_hashes[&changed_file.absolute_path]
        );
    }

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

    #[test]
    fn assigns_variant_coverage_to_an_empty_store_user_root() {
        let temp = tempdir().unwrap();
        let profile = temp.path().join("76561197960267366");
        fs::create_dir_all(&profile).unwrap();
        let candidate_id = "candidate-empty-profile".to_string();
        let raw_path = "<winAppData>/Sekiro/<storeUserId>/S0000.sl2";
        let rule = ScannedCloudSaveRule {
            rule_id: "sekiro-save".into(),
            kind: "file".into(),
            raw_path: raw_path.into(),
            source: "ludusavi".into(),
            tags: vec!["save".into()],
            when: vec![],
            resolved_paths: vec![],
            unresolved_tokens: vec![],
            scanned_paths: vec![ScannedCloudSavePath {
                candidate_id: candidate_id.clone(),
                resolved_path: profile.display().to_string(),
                store_user_id: Some("76561197960267366".into()),
                case_sensitive: false,
                files: vec![],
            }],
            coverage: vec![UserLocationCoverage {
                candidate_id,
                rule_id: "sekiro-save".into(),
                variant_id: None,
                raw_path: Some(raw_path.into()),
                relative_path: None,
                selected_root: true,
                authority: "inferred".into(),
                outcome: "scanned".into(),
                enumerated_completely: true,
                warning_codes: vec![],
            }],
        };

        let (variants, files, coverage) =
            collect_discovered_files("steam", "814380", "steam:814380", "environment", vec![rule])
                .unwrap();

        assert!(files.is_empty());
        assert_eq!(variants.len(), 1);
        assert_eq!(variants[0].kind, "opaque-folder");
        assert_eq!(
            variants[0].concrete_folder_id.as_deref(),
            Some("76561197960267366")
        );
        assert_eq!(coverage.len(), 1);
        assert_eq!(
            coverage[0].variant_id.as_deref(),
            Some(variants[0].variant_id.as_str())
        );
        assert_eq!(coverage[0].authority, "exact");
        assert!(coverage[0].selected_root);
        assert!(coverage[0].enumerated_completely);
    }

    #[test]
    fn keeps_leaf_parent_coverage_generic_without_creating_a_default_variant() {
        let candidate_id = "candidate-profiles-parent".to_string();
        let raw_path = "<home>/Game/PlayerProfile<storeUserId>.sav";
        let rule = ScannedCloudSaveRule {
            rule_id: "profile-save".into(),
            kind: "file".into(),
            raw_path: raw_path.into(),
            source: "ludusavi".into(),
            tags: vec!["save".into()],
            when: vec![],
            resolved_paths: vec![],
            unresolved_tokens: vec![],
            scanned_paths: vec![],
            coverage: vec![UserLocationCoverage {
                candidate_id,
                rule_id: "profile-save".into(),
                variant_id: None,
                raw_path: Some(raw_path.into()),
                relative_path: None,
                selected_root: true,
                authority: "inferred".into(),
                outcome: "scanned".into(),
                enumerated_completely: true,
                warning_codes: vec![],
            }],
        };

        let (variants, files, coverage) =
            collect_discovered_files("steam", "1", "steam:1", "environment", vec![rule]).unwrap();

        assert!(variants.is_empty());
        assert!(files.is_empty());
        assert_eq!(coverage.len(), 1);
        assert!(coverage[0].variant_id.is_none());
        assert!(coverage[0].selected_root);
        assert!(coverage[0].enumerated_completely);
    }

    #[test]
    fn manifest_identity_wins_when_a_custom_rule_finds_the_same_file() {
        let temp = tempdir().unwrap();
        let save = temp.path().join("slot.sav");
        fs::write(&save, b"same").unwrap();
        let mut custom = scanned_rule(
            "<custom><windows><winDocuments>/Game",
            None,
            &save.display().to_string(),
            "slot.sav",
        );
        custom.source = "custom".into();
        let mut manifest = scanned_rule(
            "<winDocuments>/Game",
            None,
            &save.display().to_string(),
            "slot.sav",
        );
        manifest.source = "ludusavi".into();

        let (_, files, _) = collect_discovered_files(
            "steam",
            "1",
            "steam:1",
            "environment",
            vec![custom, manifest],
        )
        .unwrap();

        assert_eq!(files.len(), 1);
        assert_eq!(files[0].raw_path, "<winDocuments>/Game");
    }
}
