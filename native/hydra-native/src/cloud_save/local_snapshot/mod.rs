mod build;
mod build_file;
mod build_files;
mod types;

use napi::bindgen_prelude::Error;
use napi_derive::napi;

pub use types::{
    BuildLocalGameSnapshotInput, DiscoveredLocalSaveFile, LocalGameSnapshot, LocalSaveSnapshotFile,
};

#[napi]
pub async fn build_local_save_snapshot_files(
    files: Vec<DiscoveredLocalSaveFile>,
) -> napi::Result<Vec<LocalSaveSnapshotFile>> {
    tokio::task::spawn_blocking(move || build_files::build_files(files))
        .await
        .map_err(|error| Error::from_reason(error.to_string()))?
        .map_err(Error::from_reason)
}

#[napi]
pub fn build_local_game_snapshot(input: BuildLocalGameSnapshotInput) -> LocalGameSnapshot {
    build::build_snapshot(input)
}
