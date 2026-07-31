use std::io::ErrorKind;
use std::path::{Path, PathBuf};

use napi::bindgen_prelude::Error;
use napi_derive::napi;
use tokio::io::AsyncWriteExt;

use crate::cloud_save::http::blob_http_client;

use super::validation::{validate_hash, validate_path_component, validate_size};

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
    client: &reqwest::Client,
    download_url: String,
    expected_size: u64,
    final_path: &Path,
    partial_path: &Path,
) -> Result<(), String> {
    let mut response = client
        .get(download_url)
        .send()
        .await
        .map_err(|error| download_error("Failed to download restore blob", error))?
        .error_for_status()
        .map_err(|error| download_error("Failed to download restore blob", error))?;
    if response
        .content_length()
        .is_some_and(|content_length| content_length != expected_size)
    {
        return Err("cloud_save_restore_download_size_mismatch".to_string());
    }
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

    let mut downloaded_size = 0_u64;
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|error| download_error("Failed to read restore blob response", error))?
    {
        downloaded_size = downloaded_size
            .checked_add(chunk.len() as u64)
            .ok_or_else(|| "cloud_save_restore_download_size_mismatch".to_string())?;
        if downloaded_size > expected_size {
            return Err("cloud_save_restore_download_size_mismatch".to_string());
        }
        output
            .write_all(&chunk)
            .await
            .map_err(|error| format!("Failed to write temporary restore blob: {error}"))?;
    }
    if downloaded_size != expected_size {
        return Err("cloud_save_restore_download_size_mismatch".to_string());
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
    expected_size_bytes: f64,
    download_url: String,
    temp_root: String,
) -> napi::Result<String> {
    validate_path_component(&snapshot_id).map_err(Error::from_reason)?;
    validate_hash(&hash).map_err(Error::from_reason)?;
    validate_size(expected_size_bytes).map_err(Error::from_reason)?;
    if temp_root.is_empty() {
        return Err(Error::from_reason("cloud_save_invalid_restore_temp_root"));
    }

    let (final_path, partial_path) = build_paths(&temp_root, &snapshot_id, &hash);
    let client = blob_http_client().map_err(Error::from_reason)?;
    if let Err(error) = download_blob(
        client,
        download_url,
        expected_size_bytes as u64,
        &final_path,
        &partial_path,
    )
    .await
    {
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
    use std::time::Duration;

    use tempfile::tempdir;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    use super::*;
    use crate::cloud_save::http::build_blob_http_client;

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

    async fn stalled_server() -> String {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.unwrap();
            let mut request = [0_u8; 1024];
            let _ = stream.read(&mut request).await;
            tokio::time::sleep(Duration::from_millis(250)).await;
        });
        format!("http://{address}/blob")
    }

    #[tokio::test]
    async fn downloads_atomically_and_cleans_snapshot() {
        let url = server(b"HTTP/1.1 200 OK\r\nContent-Length: 4\r\n\r\nsave").await;
        let directory = tempdir().unwrap();
        let hash = "a".repeat(64);
        let result = download_restore_blob_to_temp(
            "snapshot_1".to_string(),
            hash.clone(),
            4.0,
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
            10.0,
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
            0.0,
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

    #[tokio::test]
    async fn rejects_declared_and_streamed_size_mismatches() {
        let directory = tempdir().unwrap();
        let hash = "a".repeat(64);
        let declared = server(b"HTTP/1.1 200 OK\r\nContent-Length: 4\r\n\r\nsave").await;
        let error = download_restore_blob_to_temp(
            "snapshot_1".to_string(),
            hash.clone(),
            3.0,
            declared,
            directory.path().display().to_string(),
        )
        .await
        .unwrap_err()
        .to_string();
        assert!(error.contains("cloud_save_restore_download_size_mismatch"));

        let streamed =
            server(b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n5\r\nlarge\r\n0\r\n\r\n")
                .await;
        let error = download_restore_blob_to_temp(
            "snapshot_1".to_string(),
            hash.clone(),
            4.0,
            streamed,
            directory.path().display().to_string(),
        )
        .await
        .unwrap_err()
        .to_string();
        let (final_path, partial_path) =
            build_paths(&directory.path().display().to_string(), "snapshot_1", &hash);
        assert!(error.contains("cloud_save_restore_download_size_mismatch"));
        assert!(!final_path.exists());
        assert!(!partial_path.exists());
    }

    #[tokio::test]
    async fn stops_a_stalled_download_on_the_read_timeout() {
        let directory = tempdir().unwrap();
        let (final_path, partial_path) = build_paths(
            &directory.path().display().to_string(),
            "snapshot_1",
            &"a".repeat(64),
        );
        let client = build_blob_http_client(
            Duration::from_secs(1),
            Duration::from_millis(25),
            Duration::from_secs(1),
        )
        .unwrap();

        let error = download_blob(
            &client,
            stalled_server().await,
            4,
            &final_path,
            &partial_path,
        )
        .await
        .unwrap_err();

        assert!(error.contains("Failed to download restore blob"));
        assert!(!final_path.exists());
        assert!(!partial_path.exists());
    }
}
