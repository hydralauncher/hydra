use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, OnceLock};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use anyhow::{Context, Result};
use tokio::fs;
use tokio::sync::Mutex;

use super::indexer::build_manifest_index;
use super::types::ManifestIndex;
use crate::constants::MANIFEST_INDEX_VERSION;

const MANIFEST_CACHE_TTL_MS: i64 = 24 * 60 * 60 * 1000;
const MANIFEST_HTTP_TIMEOUT_SECS: u64 = 30;
const RAW_MANIFEST_FILE_NAME: &str = "cloud-save-manifest.yaml";
const INDEX_FILE_NAME: &str = "cloud-save-manifest-index.json";

type ManifestCache = Arc<Mutex<Option<ManifestIndex>>>;
type ManifestCaches = Mutex<HashMap<PathBuf, ManifestCache>>;

static CACHE_LOCKS: OnceLock<ManifestCaches> = OnceLock::new();
static HTTP_CLIENT: OnceLock<reqwest::Client> = OnceLock::new();

fn http_client() -> &'static reqwest::Client {
    HTTP_CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .timeout(Duration::from_secs(MANIFEST_HTTP_TIMEOUT_SECS))
            .build()
            .expect("Failed to build cloud save manifest HTTP client")
    })
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

fn is_index_expired(index: &ManifestIndex, current_time: i64) -> bool {
    index.fetched_at + MANIFEST_CACHE_TTL_MS <= current_time
}

async fn cache_for(key: PathBuf) -> ManifestCache {
    let caches = CACHE_LOCKS.get_or_init(|| Mutex::new(HashMap::new()));
    let mut caches = caches.lock().await;
    caches
        .entry(key)
        .or_insert_with(|| Arc::new(Mutex::new(None)))
        .clone()
}

fn raw_manifest_path(user_data_path: &Path) -> PathBuf {
    user_data_path.join(RAW_MANIFEST_FILE_NAME)
}

fn index_path(user_data_path: &Path) -> PathBuf {
    user_data_path.join(INDEX_FILE_NAME)
}

async fn read_index(path: &Path) -> Option<ManifestIndex> {
    let content = fs::read_to_string(path).await.ok()?;
    let index: ManifestIndex = serde_json::from_str(&content).ok()?;
    (index.version == MANIFEST_INDEX_VERSION).then_some(index)
}

async fn raw_manifest_fetched_at(path: &Path) -> Option<i64> {
    let modified = fs::metadata(path).await.ok()?.modified().ok()?;
    Some(
        modified
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as i64,
    )
}

async fn remove_cache_file(path: &Path) -> Result<()> {
    match fs::remove_file(path).await {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error)
            .with_context(|| format!("Failed to remove stale cache file {}", path.display())),
    }
}

async fn write_atomically(path: &Path, content: &[u8]) -> Result<()> {
    let parent = path
        .parent()
        .with_context(|| format!("Invalid manifest cache path: {}", path.display()))?;
    fs::create_dir_all(parent)
        .await
        .with_context(|| format!("Failed to create cache directory {}", parent.display()))?;
    let temp_path = path.with_extension(format!("{}.{}.tmp", std::process::id(), now_ms()));
    if let Err(error) = fs::write(&temp_path, content).await {
        return Err(error).with_context(|| {
            format!(
                "Failed to write temporary cache file {}",
                temp_path.display()
            )
        });
    }
    if let Err(error) = fs::rename(&temp_path, path).await {
        let _ = fs::remove_file(&temp_path).await;
        return Err(error).with_context(|| {
            format!(
                "Failed to replace cache file {} with {}",
                path.display(),
                temp_path.display()
            )
        });
    }
    Ok(())
}

async fn write_index(path: &Path, index: &ManifestIndex) -> Result<()> {
    let content = serde_json::to_vec_pretty(index)
        .with_context(|| format!("Failed to serialize manifest index for {}", path.display()))?;
    write_atomically(path, &content).await
}

async fn download_manifest(source_url: &str) -> Result<String> {
    let response = http_client()
        .get(source_url)
        .send()
        .await
        .with_context(|| format!("Failed to download cloud save manifest from {source_url}"))?
        .error_for_status()
        .with_context(|| format!("Cloud save manifest request failed for {source_url}"))?;

    response
        .text()
        .await
        .with_context(|| format!("Failed to read cloud save manifest body from {source_url}"))
}

async fn load_index(user_data_path: &Path, source_url: &str) -> Result<ManifestIndex> {
    let current_time = now_ms();
    let index_file = index_path(user_data_path);
    let raw_file = raw_manifest_path(user_data_path);
    let disk_index = read_index(&index_file).await;
    let has_matching_disk_index = disk_index
        .as_ref()
        .is_some_and(|index| index.source_url == source_url);
    let disk_index = disk_index.filter(|index| index.source_url == source_url);
    let mut fallback = disk_index.clone();

    if let Some(index) = &disk_index {
        if !is_index_expired(index, current_time) {
            return Ok(index.clone());
        }
    }

    let raw_yaml = if disk_index.is_some() {
        fs::read_to_string(&raw_file).await.ok()
    } else {
        None
    };

    if let Some(raw_yaml) = raw_yaml {
        let fetched_at = raw_manifest_fetched_at(&raw_file)
            .await
            .unwrap_or(current_time);
        if let Ok(rebuilt) = build_manifest_index(&raw_yaml, source_url, fetched_at) {
            // A valid rebuilt index remains usable in memory if refreshing disk fails.
            let _ = write_index(&index_file, &rebuilt).await;
            if !is_index_expired(&rebuilt, current_time) {
                return Ok(rebuilt);
            }
            fallback = Some(rebuilt);
        }
    }

    let fresh_result = async {
        let raw_yaml = download_manifest(source_url).await?;
        let fresh = build_manifest_index(&raw_yaml, source_url, now_ms())?;
        if !has_matching_disk_index {
            remove_cache_file(&raw_file).await?;
            remove_cache_file(&index_file).await?;
        }
        write_atomically(&raw_file, raw_yaml.as_bytes()).await?;
        write_index(&index_file, &fresh).await?;
        Ok::<ManifestIndex, anyhow::Error>(fresh)
    }
    .await;

    fresh_result.or_else(|error| fallback.ok_or(error))
}

pub async fn get_manifest_index(user_data_path: &Path, source_url: &str) -> Result<ManifestIndex> {
    let cache = cache_for(user_data_path.to_path_buf()).await;
    let mut cached = cache.lock().await;

    if let Some(index) = cached.as_ref() {
        if index.source_url == source_url && !is_index_expired(index, now_ms()) {
            return Ok(index.clone());
        }
    }

    let fallback = cached
        .as_ref()
        .filter(|index| index.source_url == source_url)
        .cloned();
    let index = load_index(user_data_path, source_url)
        .await
        .or_else(|error| fallback.ok_or(error))?;
    *cached = Some(index.clone());
    Ok(index)
}
