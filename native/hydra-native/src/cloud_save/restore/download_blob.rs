use std::io::ErrorKind;
use std::path::{Path, PathBuf};

use napi::bindgen_prelude::Error;
use napi_derive::napi;
use tokio::io::AsyncWriteExt;

use super::validation::{validate_hash, validate_path_component};

fn build_paths(temp_root: &str, snapshot_id: &str, hash: &str) -> (PathBuf, PathBuf) {
    let directory = Path::new(temp_root)
        .join("hydra-cloud-saves")
        .join(snapshot_id);
    (
        directory.join(format!("{hash}.blob")),
        directory.join(format!("{hash}.blob.part")),
    )
}

async fn remove_if_exists(path: &Path) -> std::io::Result<()> {
    match tokio::fs::remove_file(path).await {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error),
    }
}

fn download_error(stage: &str, error: reqwest::Error) -> String {
    format!("{stage}: {}", error.without_url())
}

async fn download_blob(
    download_url: String,
    final_path: &Path,
    partial_path: &Path,
) -> Result<(), String> {
    let mut response = reqwest::Client::new()
        .get(download_url)
        .send()
        .await
        .map_err(|error| download_error("Failed to download restore blob", error))?
        .error_for_status()
        .map_err(|error| download_error("Failed to download restore blob", error))?;
    let parent = final_path
        .parent()
        .ok_or_else(|| "cloud_save_invalid_restore_temp_path".to_string())?;
    tokio::fs::create_dir_all(parent)
        .await
        .map_err(|error| format!("Failed to create restore temporary directory: {error}"))?;
    remove_if_exists(partial_path)
        .await
        .map_err(|error| format!("Failed to clear partial restore blob: {error}"))?;
    let mut output = tokio::fs::File::create(partial_path)
        .await
        .map_err(|error| format!("Failed to create temporary restore blob: {error}"))?;

    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|error| download_error("Failed to read restore blob response", error))?
    {
        output
            .write_all(&chunk)
            .await
            .map_err(|error| format!("Failed to write temporary restore blob: {error}"))?;
    }
    output
        .flush()
        .await
        .map_err(|error| format!("Failed to flush temporary restore blob: {error}"))?;
    output
        .sync_all()
        .await
        .map_err(|error| format!("Failed to sync temporary restore blob: {error}"))?;
    drop(output);

    remove_if_exists(final_path)
        .await
        .map_err(|error| format!("Failed to replace temporary restore blob: {error}"))?;
    tokio::fs::rename(partial_path, final_path)
        .await
        .map_err(|error| format!("Failed to finalize temporary restore blob: {error}"))
}

#[napi]
pub async fn download_restore_blob_to_temp(
    snapshot_id: String,
    hash: String,
    download_url: String,
    temp_root: String,
) -> napi::Result<String> {
    validate_path_component(&snapshot_id).map_err(Error::from_reason)?;
    validate_hash(&hash).map_err(Error::from_reason)?;
    if temp_root.is_empty() {
        return Err(Error::from_reason("cloud_save_invalid_restore_temp_root"));
    }

    let (final_path, partial_path) = build_paths(&temp_root, &snapshot_id, &hash);
    if let Err(error) = download_blob(download_url, &final_path, &partial_path).await {
        let _ = remove_if_exists(&partial_path).await;
        return Err(Error::from_reason(error));
    }

    Ok(final_path.to_string_lossy().to_string())
}

#[napi]
pub async fn cleanup_restore_temp_snapshot(
    snapshot_id: String,
    temp_root: String,
) -> napi::Result<()> {
    validate_path_component(&snapshot_id).map_err(Error::from_reason)?;
    if temp_root.is_empty() {
        return Err(Error::from_reason("cloud_save_invalid_restore_temp_root"));
    }
    let directory = Path::new(&temp_root)
        .join("hydra-cloud-saves")
        .join(snapshot_id);
    match tokio::fs::remove_dir_all(directory).await {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(()),
        Err(error) => Err(Error::from_reason(format!(
            "Failed to clean restore temporary directory: {error}"
        ))),
    }
}

#[cfg(test)]
mod tests {
    use tempfile::tempdir;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    use super::*;

    async fn server(response: &'static [u8]) -> String {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.unwrap();
            let mut request = [0_u8; 1024];
            let _ = stream.read(&mut request).await;
            stream.write_all(response).await.unwrap();
        });
        format!("http://{address}/blob?signature=secret")
    }

    #[tokio::test]
    async fn downloads_atomically_and_cleans_snapshot() {
        let url = server(b"HTTP/1.1 200 OK\r\nContent-Length: 4\r\n\r\nsave").await;
        let directory = tempdir().unwrap();
        let hash = "a".repeat(64);
        let result = download_restore_blob_to_temp(
            "snapshot_1".to_string(),
            hash.clone(),
            url,
            directory.path().display().to_string(),
        )
        .await
        .unwrap();

        assert_eq!(tokio::fs::read(&result).await.unwrap(), b"save");
        assert!(!PathBuf::from(format!("{result}.part")).exists());

        cleanup_restore_temp_snapshot(
            "snapshot_1".to_string(),
            directory.path().display().to_string(),
        )
        .await
        .unwrap();
        assert!(!Path::new(&result).exists());
    }

    #[tokio::test]
    async fn removes_partial_download_and_signed_url_from_errors() {
        let directory = tempdir().unwrap();
        let hash = "a".repeat(64);
        let truncated = server(b"HTTP/1.1 200 OK\r\nContent-Length: 10\r\n\r\nshort").await;
        let error = download_restore_blob_to_temp(
            "snapshot_1".to_string(),
            hash.clone(),
            truncated,
            directory.path().display().to_string(),
        )
        .await
        .unwrap_err()
        .to_string();
        let (final_path, partial_path) =
            build_paths(&directory.path().display().to_string(), "snapshot_1", &hash);
        assert!(!final_path.exists());
        assert!(!partial_path.exists());
        assert!(!error.contains("signature=secret"));

        let rejected = server(b"HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n").await;
        let error = download_restore_blob_to_temp(
            "snapshot_1".to_string(),
            hash,
            rejected,
            directory.path().display().to_string(),
        )
        .await
        .unwrap_err()
        .to_string();
        assert!(error.contains("403 Forbidden"));
        assert!(!error.contains("signature=secret"));
        assert!(!error.contains("http://"));
    }
}
