use napi::bindgen_prelude::Error;
use napi_derive::napi;
use serde::Serialize;
use serde_json::{json, Value};
use std::collections::{BTreeMap, HashMap};
use std::sync::{Mutex, OnceLock};

use super::hashing::{build_snapshot_aggregate_hash, BuildSnapshotAggregateHashInput};
use super::local_snapshot::{
    build_local_game_snapshot, build_local_save_snapshot_files_with_cache,
    BuildLocalGameSnapshotInput, DiscoveredLocalSaveFile, LocalFileHashCacheEntry,
    LocalGameSnapshotFile,
};
use super::manifest::types::CloudSaveGameId;
use super::manifest::{get_save_rules_for_game, GetSaveRulesForGameInput};
use super::path_resolution::{resolve_save_rules_with_context, ResolveSaveRulesInput};
use super::save_scanner::scan_resolved_save_rules;

#[derive(Serialize)]
struct CloudSaveDebugLog {
    event: String,
    details: String,
}

static DEBUG_LOGS: OnceLock<Mutex<HashMap<String, String>>> = OnceLock::new();

fn debug_key(shop: &str, object_id: &str) -> String {
    format!("{shop}:{object_id}")
}

struct DebugLogSession {
    key: String,
    logs: Vec<CloudSaveDebugLog>,
}

impl DebugLogSession {
    fn new(shop: &str, object_id: &str) -> Self {
        Self {
            key: debug_key(shop, object_id),
            logs: Vec::new(),
        }
    }
}

impl Drop for DebugLogSession {
    fn drop(&mut self) {
        let serialized = serde_json::to_string(&self.logs).unwrap_or_else(|_| "[]".to_string());
        if let Ok(mut logs) = DEBUG_LOGS.get_or_init(|| Mutex::new(HashMap::new())).lock() {
            logs.insert(self.key.clone(), serialized);
        }
    }
}

#[napi]
pub fn take_cloud_save_debug_logs(shop: String, object_id: String) -> Option<String> {
    DEBUG_LOGS
        .get_or_init(|| Mutex::new(HashMap::new()))
        .lock()
        .ok()?
        .remove(&debug_key(&shop, &object_id))
}

fn emit_debug(logs: &mut Vec<CloudSaveDebugLog>, event: &str, details: Value) {
    logs.push(CloudSaveDebugLog {
        event: event.to_string(),
        details: details.to_string(),
    });
}

fn pipeline_error(logs: &mut Vec<CloudSaveDebugLog>, stage: &str, error: &impl ToString) -> Error {
    let message = error.to_string();
    emit_debug(
        logs,
        "error",
        json!({
            "stage": stage,
            "message": message,
        }),
    );
    Error::from_reason(message)
}

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
    pub hash_cache: Vec<LocalFileHashCacheEntry>,
}

#[napi(object)]
pub struct LocalGameSnapshotWithHash {
    pub game_id: CloudSaveGameId,
    pub manifest_key: Option<String>,
    pub file_count: u32,
    pub total_size_bytes: f64,
    pub files: Vec<LocalGameSnapshotFile>,
    pub aggregate_hash: String,
    pub source_files: Vec<LocalGameSnapshotSourceFile>,
    pub hash_cache: Vec<LocalFileHashCacheEntry>,
}

#[napi(object)]
pub struct LocalGameSnapshotSourceFile {
    pub raw_path: String,
    pub relative_path: String,
    pub absolute_path: String,
    pub hash: String,
    pub size_bytes: f64,
}

#[napi]
pub async fn build_local_game_snapshot_pipeline(
    input: BuildLocalGameSnapshotPipelineInput,
) -> napi::Result<LocalGameSnapshotWithHash> {
    let shop = input.shop;
    let object_id = input.object_id;
    let mut debug_session = DebugLogSession::new(&shop, &object_id);
    emit_debug(
        &mut debug_session.logs,
        "pipeline context input",
        json!({
            "shop": shop,
            "objectId": object_id,
            "platform": input.platform,
            "homeDir": input.home_dir,
            "documentsDir": input.documents_dir,
            "appDataDir": input.app_data_dir,
            "executablePath": input.executable_path,
            "winePrefixPath": input.wine_prefix_path,
            "protonPath": input.proton_path,
            "steamPath": input.steam_path,
        }),
    );
    let save_rules = get_save_rules_for_game(GetSaveRulesForGameInput {
        shop: shop.clone(),
        object_id: object_id.clone(),
        title: input.title,
        remote_id: input.remote_id,
        user_data_path: input.user_data_path,
        source_url: input.source_url,
    })
    .await
    .map_err(|error| pipeline_error(&mut debug_session.logs, "manifest", &error))?;
    let manifest_key = save_rules.manifest_key;
    emit_debug(
        &mut debug_session.logs,
        "manifest rules",
        json!({
            "manifestKey": manifest_key,
            "rules": save_rules.rules.iter().map(|rule| json!({
                "rawPath": rule.raw_path,
                "kind": rule.kind,
                "source": rule.source,
                "tags": rule.tags,
                "when": rule.when.iter().map(|condition| json!({
                    "os": condition.os,
                    "store": condition.store,
                })).collect::<Vec<_>>(),
            })).collect::<Vec<_>>(),
        }),
    );
    let resolution_input = ResolveSaveRulesInput {
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
        rules: save_rules.rules,
    };
    let (resolved_rules, resolution_context) = resolve_save_rules_with_context(resolution_input)
        .map_err(|error| pipeline_error(&mut debug_session.logs, "path resolution", &error))?;
    let native_saved_games = resolution_context
        .saved_games_dir
        .clone()
        .unwrap_or_else(|| format!("{}/Saved Games", resolution_context.home_dir));
    let wine_mappings = resolution_context.wine_prefix_path.as_ref().map(|prefix| {
        let users = format!("{prefix}/drive_*/users/*");
        json!({
            "modern": {
                "<home>": users,
                "<home>/Saved Games": format!("{users}/Saved Games"),
                "<winAppData>": format!("{users}/AppData/Roaming"),
                "<winLocalAppData>": format!("{users}/AppData/Local"),
                "<winLocalAppDataLow>": format!("{users}/AppData/LocalLow"),
                "<winDocuments>": format!("{users}/Documents"),
            },
            "legacy": {
                "<winAppData>": format!("{users}/Application Data"),
                "<winLocalAppData>": format!("{users}/Local Settings/Application Data"),
                "<winDocuments>": format!("{users}/My Documents"),
            },
        })
    });
    emit_debug(
        &mut debug_session.logs,
        "token mappings",
        json!({
            "native": {
                "<home>": resolution_context.home_dir,
                "<home>/Saved Games": native_saved_games,
                "<winAppData>": resolution_context.app_data_dir,
                "<winLocalAppData>": resolution_context.local_app_data_dir,
                "<winLocalAppDataLow>": resolution_context.local_app_data_low_dir,
                "<winDocuments>": resolution_context.documents_dir,
            },
            "wine": wine_mappings,
            "shared": {
                "<root>": resolution_context.steam_roots,
                "<base>": resolution_context.install_dir,
                "<game>": resolution_context.game_dir,
            },
        }),
    );
    emit_debug(
        &mut debug_session.logs,
        "resolved rules",
        json!({
            "rules": resolved_rules.iter().map(|rule| json!({
                "rawPath": rule.raw_path,
                "resolvedPaths": rule.resolved_paths,
                "caseSensitive": rule.resolved_path_case_sensitive,
                "dynamic": rule.resolved_path_dynamic,
                "scanRoots": rule.resolved_path_scan_roots,
                "unresolvedTokens": rule.unresolved_tokens,
            })).collect::<Vec<_>>(),
        }),
    );
    emit_debug(
        &mut debug_session.logs,
        "scanner input",
        json!({
            "paths": resolved_rules.iter().flat_map(|rule| {
                rule.resolved_paths.iter().map(|path| json!({
                    "rawPath": rule.raw_path,
                    "path": path,
                }))
            }).collect::<Vec<_>>(),
        }),
    );
    let scanned_rules = scan_resolved_save_rules(resolved_rules)
        .await
        .map_err(|error| pipeline_error(&mut debug_session.logs, "scanner", &error))?;
    emit_debug(
        &mut debug_session.logs,
        "scanner result",
        json!({
            "rules": scanned_rules.iter().map(|rule| json!({
                "rawPath": rule.raw_path,
                "scannedPaths": rule.scanned_paths.iter().map(|path| json!({
                    "resolvedPath": path.resolved_path,
                    "files": path.files.iter().map(|file| json!({
                        "absolutePath": file.absolute_path,
                        "relativePath": file.relative_path,
                    })).collect::<Vec<_>>(),
                })).collect::<Vec<_>>(),
            })).collect::<Vec<_>>(),
        }),
    );
    let mut discovered_files = BTreeMap::new();

    for rule in scanned_rules {
        for scanned_path in rule.scanned_paths {
            for file in scanned_path.files {
                let discovered = DiscoveredLocalSaveFile {
                    raw_path: rule.raw_path.clone(),
                    absolute_path: file.absolute_path.clone(),
                    root_path: scanned_path.resolved_path.clone(),
                    relative_path: file.relative_path,
                    source: rule.source.clone(),
                };
                discovered_files
                    .entry(file.absolute_path)
                    .and_modify(|existing: &mut DiscoveredLocalSaveFile| {
                        if discovered.raw_path < existing.raw_path {
                            *existing = discovered.clone();
                        }
                    })
                    .or_insert(discovered);
            }
        }
    }

    let built_files = build_local_save_snapshot_files_with_cache(
        discovered_files.into_values().collect(),
        input.hash_cache,
    )
    .await
    .map_err(|error| pipeline_error(&mut debug_session.logs, "metadata and hashing", &error))?;
    let files = built_files.files;
    let source_files: Vec<LocalGameSnapshotSourceFile> = files
        .iter()
        .map(|file| LocalGameSnapshotSourceFile {
            raw_path: file.raw_path.clone(),
            relative_path: file.relative_path.clone(),
            absolute_path: file.absolute_path.clone(),
            hash: file.hash.clone(),
            size_bytes: file.size_bytes,
        })
        .collect();
    let snapshot = build_local_game_snapshot(BuildLocalGameSnapshotInput {
        game_id: CloudSaveGameId { shop, object_id },
        manifest_key,
        files,
    });
    let aggregate_hash = build_snapshot_aggregate_hash(BuildSnapshotAggregateHashInput {
        files: snapshot.files.clone(),
    })
    .map_err(|error| pipeline_error(&mut debug_session.logs, "aggregate hash", &error))?;

    emit_debug(
        &mut debug_session.logs,
        "snapshot result",
        json!({
            "manifestKey": snapshot.manifest_key,
            "fileCount": snapshot.file_count,
            "totalSizeBytes": snapshot.total_size_bytes,
            "aggregateHash": aggregate_hash,
            "files": source_files.iter().map(|file| json!({
                "rawPath": file.raw_path,
                "absolutePath": file.absolute_path,
                "relativePath": file.relative_path,
                "sizeBytes": file.size_bytes,
                "hash": file.hash,
            })).collect::<Vec<_>>(),
        }),
    );

    Ok(LocalGameSnapshotWithHash {
        game_id: snapshot.game_id,
        manifest_key: snapshot.manifest_key,
        file_count: snapshot.file_count,
        total_size_bytes: snapshot.total_size_bytes,
        files: snapshot.files,
        aggregate_hash,
        source_files,
        hash_cache: built_files.hash_cache,
    })
}
