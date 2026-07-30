use std::collections::HashSet;
use std::io::ErrorKind;
use std::path::{Path, PathBuf};

use napi::bindgen_prelude::Error;
use napi_derive::napi;
use uuid::Uuid;

use crate::cloud_save::hashing::hash_file;

use super::types::{DeleteLocalSaveTarget, DeleteLocalSaveTargetsResult, DeletedLocalSaveFile};
use super::validation::{validate_hash, validate_relative_path};

struct PreparedDeletion {
    input: DeleteLocalSaveTarget,
    backup_path: PathBuf,
    moved: bool,
}

fn canonical_path_with_missing(path: &Path) -> PathBuf {
    let mut existing = path.to_path_buf();
    let mut missing = Vec::new();
    while !existing.exists() {
        let Some(name) = existing.file_name().map(|name| name.to_os_string()) else {
            break;
        };
        missing.push(name);
        if !existing.pop() {
            break;
        }
    }
    let mut canonical = std::fs::canonicalize(&existing).unwrap_or(existing);
    for segment in missing.into_iter().rev() {
        canonical.push(segment);
    }
    canonical
}

fn path_key(path: &Path) -> String {
    let normalized = canonical_path_with_missing(path)
        .to_string_lossy()
        .replace('\\', "/");
    if cfg!(windows) {
        normalized.to_ascii_lowercase()
    } else {
        normalized
    }
}

fn target_is_within_root(target: &Path, root: &Path) -> bool {
    let target = path_key(target);
    let root = path_key(root);
    target == root || target.starts_with(&format!("{}/", root.trim_end_matches('/')))
}

fn target_is_symlink(path: &Path) -> Result<bool, String> {
    match std::fs::symlink_metadata(path) {
        Ok(metadata) => Ok(metadata.file_type().is_symlink()),
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(false),
        Err(_) => Err("cloud_save_delete_target_inspection_failed".to_string()),
    }
}

fn backup_path(target: &Path) -> Result<PathBuf, String> {
    let parent = target
        .parent()
        .ok_or_else(|| "cloud_save_delete_target_without_parent".to_string())?;
    Ok(parent.join(format!(".hydra-delete-{}-backup", Uuid::new_v4())))
}

async fn hash_path(path: String) -> Result<String, String> {
    tokio::task::spawn_blocking(move || hash_file(&path))
        .await
        .map_err(|_| "cloud_save_delete_hash_task_failed".to_string())?
        .map_err(|_| "cloud_save_delete_hash_failed".to_string())
}

async fn rollback(prepared: &mut [PreparedDeletion]) {
    for item in prepared.iter_mut().rev() {
        if item.moved {
            let _ = tokio::fs::rename(&item.backup_path, &item.input.target_path).await;
            item.moved = false;
        }
    }
}

async fn prepare(input: DeleteLocalSaveTarget) -> Result<PreparedDeletion, String> {
    validate_relative_path(&input.relative_path).map_err(|error| error.to_string())?;
    validate_hash(&input.expected_hash).map_err(|error| error.to_string())?;
    if !input.expected_size_bytes.is_finite()
        || input.expected_size_bytes < 0.0
        || input.expected_size_bytes.fract() != 0.0
    {
        return Err("cloud_save_delete_invalid_expected_size".to_string());
    }

    let target = Path::new(&input.target_path);
    let root = Path::new(&input.restore_root_path);
    if input.target_path.is_empty()
        || input.restore_root_path.is_empty()
        || !target_is_within_root(target, root)
        || target_is_symlink(target)?
    {
        return Err("cloud_save_delete_target_outside_root".to_string());
    }
    let metadata = tokio::fs::metadata(target)
        .await
        .map_err(|_| "cloud_save_delete_target_missing".to_string())?;
    if !metadata.is_file() || metadata.len() as f64 != input.expected_size_bytes {
        return Err("cloud_save_delete_target_changed".to_string());
    }
    if hash_path(input.target_path.clone()).await? != input.expected_hash {
        return Err("cloud_save_delete_target_changed".to_string());
    }

    Ok(PreparedDeletion {
        backup_path: backup_path(target)?,
        input,
        moved: false,
    })
}

#[napi]
pub async fn delete_local_save_targets(
    files: Vec<DeleteLocalSaveTarget>,
) -> napi::Result<DeleteLocalSaveTargetsResult> {
    let mut seen_targets = HashSet::new();
    let mut prepared = Vec::with_capacity(files.len());
    for file in files {
        if !seen_targets.insert(path_key(Path::new(&file.target_path))) {
            return Err(Error::from_reason("cloud_save_duplicate_delete_target"));
        }
        prepared.push(prepare(file).await.map_err(Error::from_reason)?);
    }

    for index in 0..prepared.len() {
        let item = &mut prepared[index];
        if tokio::fs::rename(&item.input.target_path, &item.backup_path)
            .await
            .is_err()
        {
            rollback(&mut prepared).await;
            return Err(Error::from_reason("cloud_save_delete_move_failed"));
        }
        item.moved = true;
    }

    for item in &prepared {
        tokio::fs::remove_file(&item.backup_path)
            .await
            .map_err(|_| Error::from_reason("cloud_save_delete_cleanup_failed"))?;
    }

    Ok(DeleteLocalSaveTargetsResult {
        deleted_files: prepared
            .into_iter()
            .map(|item| DeletedLocalSaveFile {
                variant_id: item.input.variant_id,
                raw_path: item.input.raw_path,
                relative_path: item.input.relative_path,
            })
            .collect(),
    })
}

#[cfg(test)]
mod tests {
    use sha2::{Digest, Sha256};
    use tempfile::tempdir;

    use super::*;

    fn hash(bytes: &[u8]) -> String {
        format!("{:x}", Sha256::digest(bytes))
    }

    fn target(root: &Path, relative_path: &str, bytes: &[u8]) -> DeleteLocalSaveTarget {
        DeleteLocalSaveTarget {
            variant_id: "1".repeat(64),
            raw_path: "<home>/game".to_string(),
            relative_path: relative_path.to_string(),
            target_path: root.join(relative_path).display().to_string(),
            restore_root_path: root.display().to_string(),
            expected_hash: hash(bytes),
            expected_size_bytes: bytes.len() as f64,
        }
    }

    #[tokio::test]
    async fn deletes_validated_files_without_leaving_backups() {
        let temp = tempdir().unwrap();
        let bytes = b"save";
        std::fs::write(temp.path().join("slot.sav"), bytes).unwrap();

        let result = delete_local_save_targets(vec![target(temp.path(), "slot.sav", bytes)])
            .await
            .unwrap();

        assert_eq!(result.deleted_files.len(), 1);
        assert!(!temp.path().join("slot.sav").exists());
        assert!(std::fs::read_dir(temp.path()).unwrap().all(|entry| !entry
            .unwrap()
            .file_name()
            .to_string_lossy()
            .contains(".hydra-delete-")));
    }

    #[tokio::test]
    async fn refuses_changed_files_before_deleting_any_target() {
        let temp = tempdir().unwrap();
        std::fs::write(temp.path().join("first.sav"), b"first").unwrap();
        std::fs::write(temp.path().join("second.sav"), b"changed").unwrap();

        let result = delete_local_save_targets(vec![
            target(temp.path(), "first.sav", b"first"),
            target(temp.path(), "second.sav", b"expected"),
        ])
        .await;

        assert!(result.is_err());
        assert!(temp.path().join("first.sav").exists());
        assert!(temp.path().join("second.sav").exists());
    }

    #[tokio::test]
    async fn refuses_targets_outside_the_approved_root() {
        let temp = tempdir().unwrap();
        let approved = temp.path().join("approved");
        let outside = temp.path().join("outside");
        std::fs::create_dir_all(&approved).unwrap();
        std::fs::create_dir_all(&outside).unwrap();
        std::fs::write(outside.join("slot.sav"), b"save").unwrap();
        let mut input = target(&outside, "slot.sav", b"save");
        input.restore_root_path = approved.display().to_string();

        assert!(delete_local_save_targets(vec![input]).await.is_err());
        assert!(outside.join("slot.sav").exists());
    }
}
