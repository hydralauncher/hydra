use std::path::Path;

use napi::bindgen_prelude::Error;
use napi_derive::napi;

use crate::cloud_save::hashing::hash_file;

fn should_skip(local_path: &str, expected_hash: &str) -> Result<bool, String> {
    let path = Path::new(local_path);
    if !path
        .try_exists()
        .map_err(|error| format!("Failed to inspect local restore file: {error}"))?
    {
        return Ok(false);
    }

    hash_file(local_path)
        .map(|actual_hash| actual_hash == expected_hash)
        .map_err(|error| format!("Failed to hash local restore file: {error}"))
}

#[napi]
pub async fn should_skip_restore_file(
    local_path: String,
    expected_hash: String,
) -> napi::Result<bool> {
    tokio::task::spawn_blocking(move || should_skip(&local_path, &expected_hash))
        .await
        .map_err(|error| Error::from_reason(error.to_string()))?
        .map_err(Error::from_reason)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[tokio::test]
    async fn skips_matching_file_without_modifying_it() {
        let directory = tempdir().unwrap();
        let path = directory.path().join("save.blob");
        let content = b"cloud save";
        tokio::fs::write(&path, content).await.unwrap();

        let result = should_skip_restore_file(
            path.display().to_string(),
            blake3::hash(content).to_hex().to_string(),
        )
        .await
        .unwrap();

        assert!(result);
        assert_eq!(tokio::fs::read(path).await.unwrap(), content);
    }

    #[tokio::test]
    async fn does_not_skip_different_or_missing_file() {
        let directory = tempdir().unwrap();
        let path = directory.path().join("save.blob");
        tokio::fs::write(&path, b"local").await.unwrap();
        let expected_hash = blake3::hash(b"remote").to_hex().to_string();

        assert!(
            !should_skip_restore_file(path.display().to_string(), expected_hash.clone())
                .await
                .unwrap()
        );
        assert!(!should_skip_restore_file(
            directory.path().join("missing.blob").display().to_string(),
            expected_hash,
        )
        .await
        .unwrap());
    }

    #[tokio::test]
    async fn skips_matching_empty_file() {
        let directory = tempdir().unwrap();
        let path = directory.path().join("empty.blob");
        tokio::fs::write(&path, []).await.unwrap();

        assert!(should_skip_restore_file(
            path.display().to_string(),
            blake3::hash(b"").to_hex().to_string(),
        )
        .await
        .unwrap());
    }

    #[tokio::test]
    async fn fails_when_path_is_not_a_readable_file() {
        let directory = tempdir().unwrap();

        assert!(should_skip_restore_file(
            directory.path().display().to_string(),
            blake3::hash(b"").to_hex().to_string(),
        )
        .await
        .is_err());
    }
}
