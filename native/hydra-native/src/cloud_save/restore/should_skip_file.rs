use std::path::Path;

use napi::bindgen_prelude::Error;
use napi_derive::napi;

use crate::cloud_save::hashing::hash_file;

use super::validation::validate_hash;

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
    validate_hash(&expected_hash).map_err(Error::from_reason)?;
    tokio::task::spawn_blocking(move || should_skip(&local_path, &expected_hash))
        .await
        .map_err(|error| Error::from_reason(error.to_string()))?
        .map_err(Error::from_reason)
}

#[cfg(test)]
mod tests {
    use sha2::{Digest, Sha256};
    use tempfile::tempdir;

    use super::*;

    #[tokio::test]
    async fn skips_only_matching_existing_files() {
        let directory = tempdir().unwrap();
        let regular = directory.path().join("save.blob");
        let empty = directory.path().join("empty.blob");
        tokio::fs::write(&regular, b"save").await.unwrap();
        tokio::fs::write(&empty, []).await.unwrap();

        assert!(should_skip_restore_file(
            regular.display().to_string(),
            format!("{:x}", Sha256::digest(b"save")),
        )
        .await
        .unwrap());
        assert!(should_skip_restore_file(
            empty.display().to_string(),
            format!("{:x}", Sha256::digest(b"")),
        )
        .await
        .unwrap());
        assert!(!should_skip_restore_file(
            regular.display().to_string(),
            format!("{:x}", Sha256::digest(b"other")),
        )
        .await
        .unwrap());
        assert!(!should_skip_restore_file(
            directory.path().join("missing").display().to_string(),
            format!("{:x}", Sha256::digest(b"")),
        )
        .await
        .unwrap());
        assert!(should_skip_restore_file(
            directory.path().display().to_string(),
            format!("{:x}", Sha256::digest(b"")),
        )
        .await
        .is_err());
    }
}
