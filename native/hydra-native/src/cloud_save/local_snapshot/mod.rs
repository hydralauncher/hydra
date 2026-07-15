mod build;
mod guardrails;
pub(crate) mod types;

use napi::bindgen_prelude::Error;
use napi_derive::napi;

pub use types::{BuildLocalGameSnapshotInput, LocalGameSnapshotWithHash};

#[napi]
pub async fn build_local_game_snapshot(
    input: BuildLocalGameSnapshotInput,
) -> napi::Result<LocalGameSnapshotWithHash> {
    tokio::task::spawn_blocking(move || build::build_snapshot(input))
        .await
        .map_err(|error| Error::from_reason(error.to_string()))?
        .map_err(Error::from_reason)
}
