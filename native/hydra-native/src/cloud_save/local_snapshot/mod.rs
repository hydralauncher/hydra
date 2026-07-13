mod build;
mod build_file;
mod build_files;
pub(crate) mod types;

use napi::bindgen_prelude::Error;
use napi_derive::napi;

pub use types::{
    BuildLocalGameSnapshotInput, DiscoveredLocalSaveFile, LocalFileHashCacheEntry,
    LocalGameSnapshot, LocalGameSnapshotFile, LocalSaveSnapshotFile,
};

pub(crate) async fn build_local_save_snapshot_files_with_cache(
    files: Vec<DiscoveredLocalSaveFile>,
    hash_cache: Vec<LocalFileHashCacheEntry>,
) -> napi::Result<build_files::LocalSnapshotFilesWithCache> {
    tokio::task::spawn_blocking(move || build_files::build_files(files, hash_cache))
        .await
        .map_err(|error| Error::from_reason(error.to_string()))?
        .map_err(Error::from_reason)
}

#[napi]
pub async fn build_local_save_snapshot_files(
    files: Vec<DiscoveredLocalSaveFile>,
) -> napi::Result<Vec<LocalSaveSnapshotFile>> {
    Ok(build_local_save_snapshot_files_with_cache(files, vec![])
        .await?
        .files)
}

#[napi]
pub fn build_local_game_snapshot(input: BuildLocalGameSnapshotInput) -> LocalGameSnapshot {
    build::build_snapshot(input)
}
