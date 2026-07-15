mod types;

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

fn collect_discovered_files(
    scanned_rules: Vec<ScannedCloudSaveRule>,
) -> Vec<DiscoveredLocalSaveFile> {
    let mut discovered_files = Vec::new();

    for rule in scanned_rules {
        for scanned_path in rule.scanned_paths {
            for file in scanned_path.files {
                discovered_files.push(DiscoveredLocalSaveFile {
                    raw_path: rule.raw_path.clone(),
                    absolute_path: file.absolute_path,
                    relative_path: file.relative_path,
                });
            }
        }
    }

    discovered_files
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

    build_local_game_snapshot(BuildLocalGameSnapshotInput {
        game_id: CloudSaveGameId { shop, object_id },
        manifest_key,
        files: collect_discovered_files(scanned_rules),
        hash_cache: input.hash_cache,
    })
    .await
}
