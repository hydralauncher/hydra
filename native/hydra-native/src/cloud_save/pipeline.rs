use napi::bindgen_prelude::Error;
use napi_derive::napi;

use super::hashing::{build_snapshot_aggregate_hash, BuildSnapshotAggregateHashInput};
use super::local_snapshot::{
    build_local_game_snapshot, build_local_save_snapshot_files, BuildLocalGameSnapshotInput,
    DiscoveredLocalSaveFile, LocalGameSnapshotFile,
};
use super::manifest::types::CloudSaveGameId;
use super::manifest::{get_save_rules_for_game, GetSaveRulesForGameInput};
use super::path_resolution::{resolve_save_rules, ResolveSaveRulesInput};
use super::save_scanner::scan_resolved_save_rules;

#[napi(object)]
pub struct BuildLocalGameSnapshotPipelineInput {
    pub shop: String,
    pub object_id: String,
    pub title: Option<String>,
    pub remote_id: Option<String>,
    pub user_data_path: String,
    pub source_url: Option<String>,
    pub platform: String,
    pub home_dir: String,
    pub documents_dir: Option<String>,
    pub app_data_dir: Option<String>,
    pub executable_path: Option<String>,
    pub wine_prefix_path: Option<String>,
    pub proton_path: Option<String>,
    pub steam_path: Option<String>,
    pub steam_user_ids: Vec<String>,
}

#[napi(object)]
pub struct LocalGameSnapshotWithHash {
    pub game_id: CloudSaveGameId,
    pub manifest_key: Option<String>,
    pub file_count: u32,
    pub total_size_bytes: f64,
    pub files: Vec<LocalGameSnapshotFile>,
    pub aggregate_hash: String,
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
        proton_path: input.proton_path,
        steam_path: input.steam_path,
        steam_user_ids: input.steam_user_ids,
        rules: save_rules.rules,
    })?;
    let scanned_rules = scan_resolved_save_rules(resolved_rules).await?;
    let mut discovered_files = Vec::new();

    for rule in scanned_rules {
        for scanned_path in rule.scanned_paths {
            for file in scanned_path.files {
                discovered_files.push(DiscoveredLocalSaveFile {
                    raw_path: rule.raw_path.clone(),
                    absolute_path: file.absolute_path,
                    root_path: scanned_path.resolved_path.clone(),
                    relative_path: file.relative_path,
                    source: rule.source.clone(),
                });
            }
        }
    }

    let files = build_local_save_snapshot_files(discovered_files).await?;
    let snapshot = build_local_game_snapshot(BuildLocalGameSnapshotInput {
        game_id: CloudSaveGameId { shop, object_id },
        manifest_key,
        files,
    });
    let aggregate_hash = build_snapshot_aggregate_hash(BuildSnapshotAggregateHashInput {
        files: snapshot.files.clone(),
    })
    .map_err(|error| Error::from_reason(error.to_string()))?;

    Ok(LocalGameSnapshotWithHash {
        game_id: snapshot.game_id,
        manifest_key: snapshot.manifest_key,
        file_count: snapshot.file_count,
        total_size_bytes: snapshot.total_size_bytes,
        files: snapshot.files,
        aggregate_hash,
    })
}
