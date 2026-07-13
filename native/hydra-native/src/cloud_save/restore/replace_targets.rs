use std::collections::HashSet;
use std::path::{Path, PathBuf};

use napi::bindgen_prelude::Error;
use napi_derive::napi;
use uuid::Uuid;

use crate::cloud_save::hashing::hash_file;

#[napi(object)]
#[derive(Clone)]
pub struct ReplaceRestoreTarget {
    pub raw_path: String,
    pub relative_path: String,
    pub target_path: String,
    pub action: String,
    pub temp_path: Option<String>,
    pub expected_hash: Option<String>,
}

#[napi(object)]
pub struct RestoreResultFile {
    pub raw_path: String,
    pub relative_path: String,
    pub target_path: String,
}

#[napi(object)]
pub struct RestoreSkippedFile {
    pub raw_path: String,
    pub relative_path: String,
    pub target_path: String,
    pub reason: String,
}

#[napi(object)]
pub struct RestoreFailedFile {
    pub raw_path: String,
    pub relative_path: String,
    pub target_path: String,
    pub reason: String,
}

#[napi(object)]
pub struct ReplaceRestoreTargetsResult {
    pub restored_files: Vec<RestoreResultFile>,
    pub skipped_files: Vec<RestoreSkippedFile>,
    pub failed_files: Vec<RestoreFailedFile>,
}

struct PreparedTarget {
    input: ReplaceRestoreTarget,
    expected_hash: String,
    staging_path: PathBuf,
    backup_path: Option<PathBuf>,
    installed: bool,
}

fn identity(input: &ReplaceRestoreTarget) -> RestoreResultFile {
    RestoreResultFile {
        raw_path: input.raw_path.clone(),
        relative_path: input.relative_path.clone(),
        target_path: input.target_path.clone(),
    }
}

fn failure(input: &ReplaceRestoreTarget, reason: &str) -> RestoreFailedFile {
    RestoreFailedFile {
        raw_path: input.raw_path.clone(),
        relative_path: input.relative_path.clone(),
        target_path: input.target_path.clone(),
        reason: reason.to_string(),
    }
}

fn sibling_path(target: &Path, suffix: &str) -> Result<PathBuf, String> {
    let parent = target
        .parent()
        .ok_or_else(|| "Restore target has no parent directory".to_string())?;
    Ok(parent.join(format!(".hydra-restore-{}-{suffix}", Uuid::new_v4())))
}

async fn remove_if_exists(path: &Path) {
    let _ = tokio::fs::remove_file(path).await;
}

async fn cleanup_prepared(prepared: &[PreparedTarget]) {
    for item in prepared {
        remove_if_exists(&item.staging_path).await;
        if let Some(backup) = &item.backup_path {
            remove_if_exists(backup).await;
        }
    }
}

async fn rollback(prepared: &mut [PreparedTarget]) {
    for item in prepared.iter_mut().rev() {
        let target = Path::new(&item.input.target_path);
        if item.installed {
            remove_if_exists(target).await;
            item.installed = false;
        }
        if let Some(backup) = item.backup_path.take() {
            let _ = tokio::fs::rename(backup, target).await;
        }
        remove_if_exists(&item.staging_path).await;
    }
}

fn failed_result(
    restore_inputs: &[ReplaceRestoreTarget],
    skipped_files: Vec<RestoreSkippedFile>,
    failed_index: usize,
) -> ReplaceRestoreTargetsResult {
    ReplaceRestoreTargetsResult {
        restored_files: Vec::new(),
        skipped_files,
        failed_files: restore_inputs
            .iter()
            .enumerate()
            .map(|(index, input)| {
                failure(
                    input,
                    if index == failed_index {
                        "failed_to_replace_target"
                    } else {
                        "restore_rolled_back"
                    },
                )
            })
            .collect(),
    }
}

async fn prepare_target(input: ReplaceRestoreTarget) -> Result<PreparedTarget, String> {
    let temp_path = input
        .temp_path
        .as_deref()
        .ok_or_else(|| "Restore target is missing tempPath".to_string())?;
    let expected_hash = input
        .expected_hash
        .clone()
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "Restore target is missing expectedHash".to_string())?;
    let temp_path_for_hash = temp_path.to_string();
    let expected_hash_for_check = expected_hash.clone();
    tokio::task::spawn_blocking(move || hash_file(&temp_path_for_hash))
        .await
        .map_err(|error| error.to_string())?
        .map_err(|error| format!("Failed to hash temporary restore file: {error}"))?
        .eq(&expected_hash_for_check)
        .then_some(())
        .ok_or_else(|| "Temporary restore file hash mismatch".to_string())?;

    let target = Path::new(&input.target_path);
    let parent = target
        .parent()
        .ok_or_else(|| "Restore target has no parent directory".to_string())?;
    tokio::fs::create_dir_all(parent)
        .await
        .map_err(|error| format!("Failed to create restore target directory: {error}"))?;
    let staging_path = sibling_path(target, "stage")?;
    tokio::fs::copy(temp_path, &staging_path)
        .await
        .map_err(|error| format!("Failed to stage restore file: {error}"))?;

    let staging_for_hash = staging_path.display().to_string();
    let expected_for_staging = expected_hash.clone();
    let staging_valid = tokio::task::spawn_blocking(move || hash_file(&staging_for_hash))
        .await
        .map_err(|error| error.to_string())?
        .map_err(|error| format!("Failed to hash staged restore file: {error}"))?
        == expected_for_staging;
    if !staging_valid {
        remove_if_exists(&staging_path).await;
        return Err("Staged restore file hash mismatch".to_string());
    }

    Ok(PreparedTarget {
        input,
        expected_hash,
        staging_path,
        backup_path: None,
        installed: false,
    })
}

async fn commit_target(item: &mut PreparedTarget) -> Result<(), String> {
    let target = Path::new(&item.input.target_path);
    if target
        .try_exists()
        .map_err(|error| format!("Failed to inspect restore target: {error}"))?
    {
        if !tokio::fs::metadata(target)
            .await
            .map_err(|error| format!("Failed to inspect restore target: {error}"))?
            .is_file()
        {
            return Err("Restore target is not a file".to_string());
        }
        let backup = sibling_path(target, "backup")?;
        tokio::fs::rename(target, &backup)
            .await
            .map_err(|error| format!("Failed to back up restore target: {error}"))?;
        item.backup_path = Some(backup);
    }

    tokio::fs::rename(&item.staging_path, target)
        .await
        .map_err(|error| format!("Failed to install restore target: {error}"))?;
    item.installed = true;

    let target_for_hash = item.input.target_path.clone();
    let actual_hash = tokio::task::spawn_blocking(move || hash_file(&target_for_hash))
        .await
        .map_err(|error| error.to_string())?
        .map_err(|error| format!("Failed to validate final restore target: {error}"))?;
    if actual_hash != item.expected_hash {
        return Err("Final restore target hash mismatch".to_string());
    }
    Ok(())
}

#[napi]
pub async fn replace_restore_targets(
    files: Vec<ReplaceRestoreTarget>,
) -> napi::Result<ReplaceRestoreTargetsResult> {
    let mut restore_inputs = Vec::new();
    let mut skipped_files = Vec::new();
    let mut seen_targets = HashSet::new();

    for file in files {
        if !seen_targets.insert(file.target_path.clone()) {
            return Err(Error::from_reason("Duplicate restore target path"));
        }
        match file.action.as_str() {
            "restore" => restore_inputs.push(file),
            "skip" => skipped_files.push(RestoreSkippedFile {
                raw_path: file.raw_path,
                relative_path: file.relative_path,
                target_path: file.target_path,
                reason: "already_matches_expected_state".to_string(),
            }),
            _ => return Err(Error::from_reason("Invalid restore target action")),
        }
    }

    let mut prepared = Vec::new();
    for (index, input) in restore_inputs.iter().cloned().enumerate() {
        match prepare_target(input).await {
            Ok(item) => prepared.push(item),
            Err(_) => {
                cleanup_prepared(&prepared).await;
                return Ok(failed_result(&restore_inputs, skipped_files, index));
            }
        }
    }

    for index in 0..prepared.len() {
        if commit_target(&mut prepared[index]).await.is_err() {
            rollback(&mut prepared).await;
            return Ok(failed_result(&restore_inputs, skipped_files, index));
        }
    }

    for item in &mut prepared {
        if let Some(backup) = item.backup_path.take() {
            remove_if_exists(&backup).await;
        }
    }

    Ok(ReplaceRestoreTargetsResult {
        restored_files: restore_inputs.iter().map(identity).collect(),
        skipped_files,
        failed_files: Vec::new(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    fn restore(temp: &Path, target: &Path, content: &[u8]) -> ReplaceRestoreTarget {
        ReplaceRestoreTarget {
            raw_path: "<home>/game".to_string(),
            relative_path: target.file_name().unwrap().to_string_lossy().to_string(),
            target_path: target.display().to_string(),
            action: "restore".to_string(),
            temp_path: Some(temp.display().to_string()),
            expected_hash: Some(blake3::hash(content).to_hex().to_string()),
        }
    }

    #[tokio::test]
    async fn replaces_existing_target_and_keeps_skip_untouched() {
        let directory = tempdir().unwrap();
        let temp = directory.path().join("remote.blob");
        let target = directory.path().join("save.dat");
        let skipped = directory.path().join("config.dat");
        tokio::fs::write(&temp, b"remote").await.unwrap();
        tokio::fs::write(&target, b"local").await.unwrap();
        tokio::fs::write(&skipped, b"same").await.unwrap();
        let skip = ReplaceRestoreTarget {
            raw_path: "<home>/game".to_string(),
            relative_path: "config.dat".to_string(),
            target_path: skipped.display().to_string(),
            action: "skip".to_string(),
            temp_path: None,
            expected_hash: None,
        };

        let result = replace_restore_targets(vec![restore(&temp, &target, b"remote"), skip])
            .await
            .unwrap();

        assert_eq!(tokio::fs::read(target).await.unwrap(), b"remote");
        assert_eq!(tokio::fs::read(skipped).await.unwrap(), b"same");
        assert_eq!(result.restored_files.len(), 1);
        assert_eq!(result.skipped_files.len(), 1);
        assert!(result.failed_files.is_empty());
    }

    #[tokio::test]
    async fn invalid_temp_hash_does_not_change_target() {
        let directory = tempdir().unwrap();
        let temp = directory.path().join("remote.blob");
        let target = directory.path().join("save.dat");
        tokio::fs::write(&temp, b"corrupt").await.unwrap();
        tokio::fs::write(&target, b"local").await.unwrap();

        let result = replace_restore_targets(vec![restore(&temp, &target, b"expected")])
            .await
            .unwrap();

        assert_eq!(tokio::fs::read(target).await.unwrap(), b"local");
        assert_eq!(result.failed_files[0].reason, "failed_to_replace_target");
    }

    #[tokio::test]
    async fn rollback_restores_previous_target() {
        let directory = tempdir().unwrap();
        let target = directory.path().join("save.dat");
        let staging = directory.path().join("missing-stage");
        tokio::fs::write(&target, b"local").await.unwrap();
        let input = ReplaceRestoreTarget {
            raw_path: "raw".to_string(),
            relative_path: "save.dat".to_string(),
            target_path: target.display().to_string(),
            action: "restore".to_string(),
            temp_path: Some("temp".to_string()),
            expected_hash: Some("hash".to_string()),
        };
        let backup = sibling_path(&target, "backup").unwrap();
        tokio::fs::rename(&target, &backup).await.unwrap();
        let mut prepared = vec![PreparedTarget {
            input,
            expected_hash: "hash".to_string(),
            staging_path: staging,
            backup_path: Some(backup),
            installed: false,
        }];

        rollback(&mut prepared).await;

        assert_eq!(tokio::fs::read(target).await.unwrap(), b"local");
    }

    #[tokio::test]
    async fn failure_on_second_target_rolls_back_first_without_residue() {
        let directory = tempdir().unwrap();
        let first_temp = directory.path().join("first-remote.blob");
        let second_temp = directory.path().join("second-remote.blob");
        let first_target = directory.path().join("first-save.dat");
        let invalid_second_target = directory.path().join("target-directory");
        tokio::fs::write(&first_temp, b"first-remote")
            .await
            .unwrap();
        tokio::fs::write(&second_temp, b"second-remote")
            .await
            .unwrap();
        tokio::fs::write(&first_target, b"first-local")
            .await
            .unwrap();
        tokio::fs::create_dir(&invalid_second_target).await.unwrap();

        let result = replace_restore_targets(vec![
            restore(&first_temp, &first_target, b"first-remote"),
            restore(&second_temp, &invalid_second_target, b"second-remote"),
        ])
        .await
        .unwrap();

        assert_eq!(
            tokio::fs::read(&first_target).await.unwrap(),
            b"first-local"
        );
        assert!(result.restored_files.is_empty());
        assert_eq!(result.failed_files[0].reason, "restore_rolled_back");
        assert_eq!(result.failed_files[1].reason, "failed_to_replace_target");
        let entries = std::fs::read_dir(directory.path())
            .unwrap()
            .map(|entry| entry.unwrap().file_name().to_string_lossy().to_string())
            .collect::<Vec<_>>();
        assert!(!entries
            .iter()
            .any(|name| name.starts_with(".hydra-restore-")));
    }
}
