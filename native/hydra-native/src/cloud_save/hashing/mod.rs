mod file;

use napi::bindgen_prelude::Error;
use napi_derive::napi;

#[napi]
pub async fn hash_local_save_file(file_path: String) -> napi::Result<String> {
    tokio::task::spawn_blocking(move || file::hash_file(&file_path))
        .await
        .map_err(|error| Error::from_reason(error.to_string()))?
        .map_err(Error::from_reason)
}
