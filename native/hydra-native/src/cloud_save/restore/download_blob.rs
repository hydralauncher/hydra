use std::io::ErrorKind;
use std::path::{Path, PathBuf};

use napi::bindgen_prelude::Error;
use napi_derive::napi;
use tokio::io::AsyncWriteExt;

fn validate_path_component(label: &str, value: &str) -> Result<(), String> {
    if value.is_empty()
        || !value
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || matches!(character, '-' | '_'))
    {
        return Err(format!("Invalid restore {label}: {value}"));
    }
    Ok(())
}

fn build_paths(temp_root: &str, snapshot_id: &str, hash: &str) -> (PathBuf, PathBuf) {
    let directory = Path::new(temp_root)
        .join("hydra-cloud-saves")
        .join(snapshot_id);
    let final_path = directory.join(format!("{hash}.blob"));
    let partial_path = directory.join(format!("{hash}.blob.part"));
    (final_path, partial_path)
}

async fn remove_if_exists(path: &Path) -> std::io::Result<()> {
    match tokio::fs::remove_file(path).await {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error),
    }
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
        .map_err(|error| format!("Failed to download restore blob: {}", error.without_url()))?
        .error_for_status()
        .map_err(|error| format!("Failed to download restore blob: {}", error.without_url()))?;
    let parent = final_path
        .parent()
        .ok_or_else(|| "Invalid restore temporary path".to_string())?;
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
        .map_err(|error| format!("Failed to read restore blob response: {error}"))?
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
    validate_path_component("snapshot ID", &snapshot_id).map_err(Error::from_reason)?;
    validate_path_component("blob hash", &hash).map_err(Error::from_reason)?;
    if temp_root.is_empty() {
        return Err(Error::from_reason("Invalid restore temporary root"));
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
    validate_path_component("snapshot ID", &snapshot_id).map_err(Error::from_reason)?;
    if temp_root.is_empty() {
        return Err(Error::from_reason("Invalid restore temporary root"));
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
    use super::*;
    use tempfile::tempdir;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    async fn server(response: &'static [u8]) -> String {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.unwrap();
            let mut request = [0_u8; 1024];
            let _ = stream.read(&mut request).await;
            stream.write_all(response).await.unwrap();
        });
        format!("http://{address}/blob")
    }

    #[tokio::test]
    async fn downloads_blob_to_isolated_temporary_path() {
        let url = server(b"HTTP/1.1 200 OK\r\nContent-Length: 4\r\n\r\nsave").await;
        let directory = tempdir().unwrap();
        let result = download_restore_blob_to_temp(
            "abcd1234".to_string(),
            "abc123".to_string(),
            url,
            directory.path().display().to_string(),
        )
        .await
        .unwrap();

        assert_eq!(tokio::fs::read(&result).await.unwrap(), b"save");
        assert!(result.ends_with("hydra-cloud-saves/abcd1234/abc123.blob"));
        assert!(!PathBuf::from(format!("{result}.part")).exists());
    }

    #[tokio::test]
    async fn removes_partial_file_after_failed_download() {
        let url = server(b"HTTP/1.1 200 OK\r\nContent-Length: 10\r\n\r\nshort").await;
        let directory = tempdir().unwrap();
        let result = download_restore_blob_to_temp(
            "abcd1234".to_string(),
            "abc123".to_string(),
            url,
            directory.path().display().to_string(),
        )
        .await;
        let (final_path, partial_path) = build_paths(
            &directory.path().display().to_string(),
            "abcd1234",
            "abc123",
        );

        assert!(result.is_err());
        assert!(!final_path.exists());
        assert!(!partial_path.exists());
    }

    #[tokio::test]
    async fn rejects_http_errors_and_unsafe_components() {
        let url = server(b"HTTP/1.1 500 Internal Server Error\r\nContent-Length: 0\r\n\r\n").await;
        let directory = tempdir().unwrap();
        assert!(download_restore_blob_to_temp(
            "abcd1234".to_string(),
            "abc123".to_string(),
            url,
            directory.path().display().to_string(),
        )
        .await
        .is_err());
        assert!(download_restore_blob_to_temp(
            "../snapshot".to_string(),
            "abc123".to_string(),
            "https://example.com".to_string(),
            directory.path().display().to_string(),
        )
        .await
        .is_err());
    }

    #[tokio::test]
    async fn cleans_snapshot_temporary_directory() {
        let directory = tempdir().unwrap();
        let snapshot_directory = directory.path().join("hydra-cloud-saves").join("abcd1234");
        tokio::fs::create_dir_all(&snapshot_directory)
            .await
            .unwrap();
        tokio::fs::write(snapshot_directory.join("abc123.blob"), b"save")
            .await
            .unwrap();

        cleanup_restore_temp_snapshot(
            "abcd1234".to_string(),
            directory.path().display().to_string(),
        )
        .await
        .unwrap();

        assert!(!snapshot_directory.exists());
    }
}
