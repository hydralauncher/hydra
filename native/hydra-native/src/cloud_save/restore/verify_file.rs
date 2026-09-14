use napi::bindgen_prelude::Error;
use napi_derive::napi;

use crate::cloud_save::hashing::hash_file;

use super::types::VerifyDownloadedRestoreFileResult;
use super::validation::validate_hash;

#[napi]
pub async fn verify_downloaded_restore_file(
    temp_path: String,
    expected_hash: String,
) -> napi::Result<VerifyDownloadedRestoreFileResult> {
    validate_hash(&expected_hash).map_err(Error::from_reason)?;
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
    use sha2::{Digest, Sha256};
    use tempfile::tempdir;

    use super::*;

    #[tokio::test]
    async fn verifies_regular_empty_mismatched_and_missing_files() {
        let directory = tempdir().unwrap();
        let regular = directory.path().join("regular.blob");
        let empty = directory.path().join("empty.blob");
        tokio::fs::write(&regular, b"save").await.unwrap();
        tokio::fs::write(&empty, []).await.unwrap();

        assert!(
            verify_downloaded_restore_file(
                regular.display().to_string(),
                format!("{:x}", Sha256::digest(b"save")),
            )
            .await
            .unwrap()
            .ok
        );
        assert!(
            verify_downloaded_restore_file(
                empty.display().to_string(),
                format!("{:x}", Sha256::digest(b"")),
            )
            .await
            .unwrap()
            .ok
        );
        assert_eq!(
            verify_downloaded_restore_file(
                regular.display().to_string(),
                format!("{:x}", Sha256::digest(b"other")),
            )
            .await
            .unwrap()
            .reason
            .as_deref(),
            Some("hash_mismatch")
        );
        assert!(verify_downloaded_restore_file(
            directory.path().join("missing").display().to_string(),
            format!("{:x}", Sha256::digest(b"")),
        )
        .await
        .is_err());
    }
}
