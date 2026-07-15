mod glob;
mod scan_path;
mod scan_rules;
mod types;

use napi::bindgen_prelude::Error;
use napi_derive::napi;

use crate::cloud_save::path_resolution::ResolvedCloudSaveRule;

pub use types::ScannedCloudSaveRule;

#[napi]
pub async fn scan_resolved_save_rules(
    rules: Vec<ResolvedCloudSaveRule>,
) -> napi::Result<Vec<ScannedCloudSaveRule>> {
    tokio::task::spawn_blocking(move || scan_rules::scan_rules(rules))
        .await
        .map_err(|error| Error::from_reason(error.to_string()))?
        .map_err(Error::from_reason)
}
