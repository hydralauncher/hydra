mod aggregate;
pub(crate) mod batch;
mod file;
pub(crate) mod types;

use napi::bindgen_prelude::Error;
use napi_derive::napi;

pub(crate) use aggregate::build_hash as build_aggregate_hash;
pub(crate) use file::hash_file;
pub use types::{
    BuildSnapshotAggregateHashInput, LocalFileHashCacheEntry, SnapshotAggregateHashFile,
};

#[napi]
pub async fn hash_local_save_file(file_path: String) -> napi::Result<String> {
    tokio::task::spawn_blocking(move || {
        let types::HashFilesResult {
            mut files,
            hash_cache,
        } = batch::hash_files(vec![file_path], vec![])?;
        debug_assert_eq!(files.len(), hash_cache.len());

        files
            .pop()
            .map(|file| file.hash)
            .ok_or_else(|| "cloud_save_hash_result_missing".to_string())
    })
    .await
    .map_err(|error| Error::from_reason(error.to_string()))?
    .map_err(Error::from_reason)
}

#[napi]
pub fn build_snapshot_aggregate_hash(
    input: BuildSnapshotAggregateHashInput,
) -> napi::Result<String> {
    aggregate::build_hash(input).map_err(Error::from_reason)
}
