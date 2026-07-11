mod file;
mod aggregate;

use napi::bindgen_prelude::Error;
use napi_derive::napi;

pub(crate) use file::hash_file;
pub use aggregate::BuildSnapshotAggregateHashInput;

#[napi]
pub async fn hash_local_save_file(file_path: String) -> napi::Result<String> {
    tokio::task::spawn_blocking(move || file::hash_file(&file_path))
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
