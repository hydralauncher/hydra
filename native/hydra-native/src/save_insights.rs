use std::path::PathBuf;

use hydra_save_insights::{summarize, FileContent, SaveFile};
use napi::bindgen_prelude::Error;
use napi_derive::napi;

#[napi(object)]
pub struct SaveInsightsFile {
    pub raw_path: String,
    pub relative_path: String,
    pub path: String,
    pub size_bytes: f64,
    pub modified_at_ms: Option<f64>,
}

/// Returns the summary as JSON, or `None` when no parser read anything.
#[napi]
pub async fn summarize_save_files(
    shop: String,
    object_id: String,
    files: Vec<SaveInsightsFile>,
) -> napi::Result<Option<String>> {
    tokio::task::spawn_blocking(move || {
        let files: Vec<SaveFile> = files
            .into_iter()
            .map(|file| SaveFile {
                raw_path: file.raw_path,
                relative_path: file.relative_path,
                size: file.size_bytes.max(0.0) as u64,
                modified_at_ms: file.modified_at_ms.map(|ms| ms as i64),
                content: FileContent::Path(PathBuf::from(file.path)),
            })
            .collect();
        summarize(&shop, &object_id, &files)
            .map(|summary| serde_json::to_string(&summary))
            .transpose()
            .map_err(|err| Error::from_reason(err.to_string()))
    })
    .await
    .map_err(|err| Error::from_reason(err.to_string()))?
}
