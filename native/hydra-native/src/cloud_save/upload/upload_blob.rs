use napi::bindgen_prelude::Error;
use napi_derive::napi;

#[napi]
pub async fn upload_local_save_blob(absolute_path: String, upload_url: String) -> napi::Result<()> {
    let content = tokio::fs::read(&absolute_path)
        .await
        .map_err(|error| Error::from_reason(format!("Failed to read local save file: {error}")))?;
    let response = reqwest::Client::new()
        .put(upload_url)
        .body(content)
        .send()
        .await
        .map_err(|error| {
            Error::from_reason(format!("Failed to upload local save file: {error}"))
        })?;

    response.error_for_status().map_err(|error| {
        Error::from_reason(format!("Failed to upload local save file: {error}"))
    })?;

    Ok(())
}
