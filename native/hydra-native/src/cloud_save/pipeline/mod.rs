mod types;

use std::collections::{btree_map::Entry, BTreeMap};
use std::path::Path;

use napi::bindgen_prelude::Error;
use napi_derive::napi;

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

fn collect_discovered_files(
    scanned_rules: Vec<ScannedCloudSaveRule>,
) -> Vec<DiscoveredLocalSaveFile> {
    let mut discovered_by_path = BTreeMap::new();

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
            for file in scanned_path.files {
                let discovered = DiscoveredLocalSaveFile {
                    raw_path: rule.raw_path.clone(),
                    absolute_path: file.absolute_path.clone(),
                    relative_path: file.relative_path,
                };

                match discovered_by_path.entry(file.absolute_path) {
                    Entry::Vacant(entry) => {
                        entry.insert((priority, discovered));
                    }
                    Entry::Occupied(mut entry) if priority > entry.get().0 => {
                        entry.insert((priority, discovered));
                    }
                    Entry::Occupied(_) => {}
                }
            }
        }
    }

    let mut discovered_by_logical_path = BTreeMap::new();

    for (priority, discovered) in discovered_by_path.into_values() {
        let logical_path = (
            discovered.raw_path.clone(),
            discovered.relative_path.clone(),
        );

        match discovered_by_logical_path.entry(logical_path) {
            Entry::Vacant(entry) => {
                entry.insert((priority, discovered));
            }
            Entry::Occupied(mut entry) if priority > entry.get().0 => {
                entry.insert((priority, discovered));
            }
            Entry::Occupied(_) => {}
        }
    }

    discovered_by_logical_path
        .into_values()
        .map(|(_, discovered)| discovered)
        .collect()
}

#[napi]
pub async fn build_local_game_snapshot_pipeline(
    input: BuildLocalGameSnapshotPipelineInput,
) -> napi::Result<LocalGameSnapshotWithHash> {
    let shop = input.shop;
    let object_id = input.object_id;
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
    let discovered_files =
        tokio::task::spawn_blocking(move || collect_discovered_files(scanned_rules))
            .await
            .map_err(|error| Error::from_reason(error.to_string()))?;

    build_local_game_snapshot(BuildLocalGameSnapshotInput {
        game_id: CloudSaveGameId { shop, object_id },
        manifest_key,
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
        resolved_path: &str,
        absolute_path: &str,
        relative_path: &str,
        dynamic: bool,
    ) -> ScannedCloudSaveRule {
        ScannedCloudSaveRule {
            kind: "file".into(),
            raw_path: raw_path.into(),
            source: "test".into(),
            tags: vec!["save".into()],
            when: vec![],
            resolved_paths: vec![ResolvedCloudSavePath {
                path: resolved_path.into(),
                case_sensitive: true,
                dynamic,
                scan_root: None,
            }],
            unresolved_tokens: vec![],
            scanned_paths: vec![ScannedCloudSavePath {
                resolved_path: resolved_path.into(),
                files: vec![ScannedCloudSaveFile {
                    absolute_path: absolute_path.into(),
                    relative_path: relative_path.into(),
                }],
            }],
        }
    }

    #[test]
    fn deduplicates_logical_files_and_keeps_existing_priority() {
        let temp = tempdir().unwrap();
        let dynamic_file = temp.path().join("dynamic/save.dat");
        let static_file = temp.path().join("static/save.dat");
        fs::create_dir_all(dynamic_file.parent().unwrap()).unwrap();
        fs::create_dir_all(static_file.parent().unwrap()).unwrap();
        fs::write(&dynamic_file, b"dynamic").unwrap();
        fs::write(&static_file, b"static").unwrap();

        let files = collect_discovered_files(vec![
            scanned_rule(
                "<winAppData>/Game",
                &dynamic_file.display().to_string(),
                &dynamic_file.display().to_string(),
                "save.dat",
                true,
            ),
            scanned_rule(
                "<winAppData>/Game",
                &static_file.display().to_string(),
                &static_file.display().to_string(),
                "save.dat",
                false,
            ),
        ]);

        assert_eq!(files.len(), 1);
        assert_eq!(files[0].absolute_path, static_file.display().to_string());
    }

    #[test]
    fn keeps_distinct_logical_files() {
        let files = collect_discovered_files(vec![
            scanned_rule("rule", "/a", "/a/slot.dat", "slot.dat", true),
            scanned_rule("rule", "/b", "/b/profile.dat", "profile.dat", true),
        ]);

        assert_eq!(files.len(), 2);
    }
}
