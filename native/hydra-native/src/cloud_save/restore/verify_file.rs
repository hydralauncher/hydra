use napi::bindgen_prelude::Error;
use napi_derive::napi;

use crate::cloud_save::hashing::hash_file;

#[napi(object)]
pub struct VerifyDownloadedRestoreFileResult {
    pub ok: bool,
    pub reason: Option<String>,
}

#[napi]
pub async fn verify_downloaded_restore_file(
    temp_path: String,
    expected_hash: String,
) -> napi::Result<VerifyDownloadedRestoreFileResult> {
    let actual_hash = tokio::task::spawn_blocking(move || hash_file(&temp_path))
        .await
        .map_err(|error| Error::from_reason(error.to_string()))?
        .map_err(|error| Error::from_reason(format!("Failed to hash restore file: {error}")))?;
    let ok = actual_hash == expected_hash;

    Ok(VerifyDownloadedRestoreFileResult {
        ok,
        reason: (!ok).then(|| "hash_mismatch".to_string()),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[tokio::test]
    async fn accepts_matching_hash() {
        let directory = tempdir().unwrap();
        let path = directory.path().join("save.blob");
        let content = b"cloud save";
        tokio::fs::write(&path, content).await.unwrap();

        let result = verify_downloaded_restore_file(
            path.display().to_string(),
            blake3::hash(content).to_hex().to_string(),
        )
        .await
        .unwrap();

        assert!(result.ok);
        assert!(result.reason.is_none());
    }

    #[tokio::test]
    async fn reports_hash_mismatch() {
        let directory = tempdir().unwrap();
        let path = directory.path().join("save.blob");
        tokio::fs::write(&path, b"corrupted").await.unwrap();

        let result = verify_downloaded_restore_file(
            path.display().to_string(),
            blake3::hash(b"expected").to_hex().to_string(),
        )
        .await
        .unwrap();

        assert!(!result.ok);
        assert_eq!(result.reason.as_deref(), Some("hash_mismatch"));
        assert!(path.exists());
    }

    #[tokio::test]
    async fn accepts_empty_file_with_matching_hash() {
        let directory = tempdir().unwrap();
        let path = directory.path().join("empty.blob");
        tokio::fs::write(&path, []).await.unwrap();

        let result = verify_downloaded_restore_file(
            path.display().to_string(),
            blake3::hash(b"").to_hex().to_string(),
        )
        .await
        .unwrap();

        assert!(result.ok);
    }

    #[tokio::test]
    async fn fails_for_missing_file() {
        let result = verify_downloaded_restore_file(
            "/missing/restore.blob".to_string(),
            blake3::hash(b"").to_hex().to_string(),
        )
        .await;

        assert!(result.is_err());
    }
}
