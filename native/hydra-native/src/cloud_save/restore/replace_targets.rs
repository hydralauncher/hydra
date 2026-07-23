use std::collections::HashSet;
use std::io::ErrorKind;
use std::path::{Path, PathBuf};

use napi::bindgen_prelude::Error;
use napi_derive::napi;
use uuid::Uuid;

use crate::cloud_save::hashing::hash_file;

use super::types::{
    ReplaceRestoreTarget, ReplaceRestoreTargetsResult, RestoreFailedFile, RestoreResultFile,
    RestoreSkippedFile, RestoreTargetAction,
};
use super::validation::{validate_hash, validate_relative_path};

struct PreparedTarget {
    input: ReplaceRestoreTarget,
    expected_hash: String,
    staging_path: PathBuf,
    backup_path: Option<PathBuf>,
    installed: bool,
}

fn identity(input: &ReplaceRestoreTarget) -> RestoreResultFile {
    RestoreResultFile {
        logical_file_id: input.logical_file_id.clone(),
        variant_id: input.variant_id.clone(),
        rule_id: input.rule_id.clone(),
        relative_path: input.relative_path.clone(),
        target_path: input.target_path.clone(),
    }
}

fn failure(input: &ReplaceRestoreTarget, reason: &str) -> RestoreFailedFile {
    RestoreFailedFile {
        logical_file_id: input.logical_file_id.clone(),
        variant_id: input.variant_id.clone(),
        rule_id: input.rule_id.clone(),
        relative_path: input.relative_path.clone(),
        target_path: input.target_path.clone(),
        reason: reason.to_string(),
    }
}

fn sibling_path(target: &Path, suffix: &str) -> Result<PathBuf, String> {
    let parent = target
        .parent()
        .ok_or_else(|| "cloud_save_restore_target_without_parent".to_string())?;
    Ok(parent.join(format!(".hydra-restore-{}-{suffix}", Uuid::new_v4())))
}

fn target_key(path: &str) -> String {
    let normalized = path.replace('\\', "/");
    if cfg!(windows) {
        normalized.to_ascii_lowercase()
    } else {
        normalized
    }
}

async fn remove_if_exists(path: &Path) -> Result<(), String> {
    match tokio::fs::remove_file(path).await {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error.to_string()),
    }
}

async fn cleanup_staging(prepared: &[PreparedTarget]) -> Result<(), String> {
    let mut failed = false;
    for item in prepared {
        failed |= remove_if_exists(&item.staging_path).await.is_err();
    }
    if failed {
        Err("cloud_save_restore_cleanup_failed".to_string())
    } else {
        Ok(())
    }
}

async fn rollback(prepared: &mut [PreparedTarget]) -> Result<(), String> {
    let mut failed = false;

    for item in prepared.iter_mut().rev() {
        let target = Path::new(&item.input.target_path);
        if item.installed {
            if remove_if_exists(target).await.is_err() {
                failed = true;
                continue;
            }
            item.installed = false;
        }

        if let Some(backup) = item.backup_path.as_ref() {
            if tokio::fs::rename(backup, target).await.is_ok() {
                item.backup_path = None;
            } else {
                failed = true;
            }
        }
        failed |= remove_if_exists(&item.staging_path).await.is_err();
    }

    if failed {
        Err("cloud_save_restore_rollback_failed".to_string())
    } else {
        Ok(())
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

async fn hash_path(path: String, stage: &'static str) -> Result<String, String> {
    tokio::task::spawn_blocking(move || hash_file(&path))
        .await
        .map_err(|_| format!("cloud_save_{stage}_hash_task_failed"))?
        .map_err(|_| format!("cloud_save_{stage}_hash_failed"))
}

async fn prepare_target(input: ReplaceRestoreTarget) -> Result<PreparedTarget, String> {
    validate_relative_path(&input.relative_path)?;
    if input.target_path.is_empty() {
        return Err("cloud_save_invalid_restore_target".to_string());
    }
    let temp_path = input
        .temp_path
        .as_deref()
        .filter(|path| !path.is_empty())
        .ok_or_else(|| "cloud_save_restore_temp_path_missing".to_string())?;
    let expected_hash = input
        .expected_hash
        .clone()
        .ok_or_else(|| "cloud_save_restore_expected_hash_missing".to_string())?;
    validate_hash(&expected_hash)?;
    if hash_path(temp_path.to_string(), "restore_temp").await? != expected_hash {
        return Err("cloud_save_restore_temp_hash_mismatch".to_string());
    }

    let target = Path::new(&input.target_path);
    let parent = target
        .parent()
        .ok_or_else(|| "cloud_save_restore_target_without_parent".to_string())?;
    tokio::fs::create_dir_all(parent)
        .await
        .map_err(|_| "cloud_save_restore_target_directory_failed".to_string())?;
    let staging_path = sibling_path(target, "stage")?;
    if tokio::fs::copy(temp_path, &staging_path).await.is_err() {
        let _ = remove_if_exists(&staging_path).await;
        return Err("cloud_save_restore_staging_copy_failed".to_string());
    }
    let staging_hash = match hash_path(staging_path.display().to_string(), "restore_staging").await
    {
        Ok(hash) => hash,
        Err(error) => {
            let _ = remove_if_exists(&staging_path).await;
            return Err(error);
        }
    };
    if staging_hash != expected_hash {
        let _ = remove_if_exists(&staging_path).await;
        return Err("cloud_save_restore_staging_hash_mismatch".to_string());
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
        .map_err(|_| "cloud_save_restore_target_inspection_failed".to_string())?
    {
        if !tokio::fs::metadata(target)
            .await
            .map_err(|_| "cloud_save_restore_target_inspection_failed".to_string())?
            .is_file()
        {
            return Err("cloud_save_restore_target_not_file".to_string());
        }
        let backup = sibling_path(target, "backup")?;
        tokio::fs::rename(target, &backup)
            .await
            .map_err(|_| "cloud_save_restore_backup_failed".to_string())?;
        item.backup_path = Some(backup);
    }

    tokio::fs::rename(&item.staging_path, target)
        .await
        .map_err(|_| "cloud_save_restore_install_failed".to_string())?;
    item.installed = true;

    if hash_path(item.input.target_path.clone(), "restore_final").await? != item.expected_hash {
        return Err("cloud_save_restore_final_hash_mismatch".to_string());
    }
    Ok(())
}

async fn remove_backups(prepared: &mut [PreparedTarget]) -> Result<(), String> {
    for item in prepared {
        if let Some(backup) = item.backup_path.as_ref() {
            remove_if_exists(backup)
                .await
                .map_err(|_| "cloud_save_restore_cleanup_failed".to_string())?;
            item.backup_path = None;
        }
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
        validate_relative_path(&file.relative_path).map_err(Error::from_reason)?;
        if file.target_path.is_empty() {
            return Err(Error::from_reason("cloud_save_invalid_restore_target"));
        }
        if !seen_targets.insert(target_key(&file.target_path)) {
            return Err(Error::from_reason("cloud_save_duplicate_restore_target"));
        }
        match file.action {
            RestoreTargetAction::Restore => restore_inputs.push(file),
            RestoreTargetAction::Skip => skipped_files.push(RestoreSkippedFile {
                logical_file_id: file.logical_file_id,
                variant_id: file.variant_id,
                rule_id: file.rule_id,
                relative_path: file.relative_path,
                target_path: file.target_path,
                reason: "already_matches_expected_state".to_string(),
            }),
        }
    }

    let mut prepared = Vec::new();
    for (index, input) in restore_inputs.iter().cloned().enumerate() {
        match prepare_target(input).await {
            Ok(item) => prepared.push(item),
            Err(_) => {
                cleanup_staging(&prepared)
                    .await
                    .map_err(Error::from_reason)?;
                return Ok(failed_result(&restore_inputs, skipped_files, index));
            }
        }
    }

    for index in 0..prepared.len() {
        if commit_target(&mut prepared[index]).await.is_err() {
            rollback(&mut prepared).await.map_err(Error::from_reason)?;
            return Ok(failed_result(&restore_inputs, skipped_files, index));
        }
    }

    remove_backups(&mut prepared)
        .await
        .map_err(Error::from_reason)?;
    Ok(ReplaceRestoreTargetsResult {
        restored_files: restore_inputs.iter().map(identity).collect(),
        skipped_files,
        failed_files: Vec::new(),
    })
}

#[cfg(test)]
mod tests {
    use tempfile::tempdir;

    use super::*;

    fn restore(temp: &Path, target: &Path, content: &[u8]) -> ReplaceRestoreTarget {
        ReplaceRestoreTarget {
            logical_file_id: target.file_name().unwrap().to_string_lossy().to_string(),
            variant_id: "variant".to_string(),
            rule_id: "rule".to_string(),
            relative_path: target.file_name().unwrap().to_string_lossy().to_string(),
            target_path: target.display().to_string(),
            action: RestoreTargetAction::Restore,
            temp_path: Some(temp.display().to_string()),
            expected_hash: Some(blake3::hash(content).to_hex().to_string()),
        }
    }

    #[tokio::test]
    async fn replaces_new_and_existing_targets_without_touching_skips() {
        let directory = tempdir().unwrap();
        let first_temp = directory.path().join("first.blob");
        let second_temp = directory.path().join("second.blob");
        let first_target = directory.path().join("existing.sav");
        let second_target = directory.path().join("new.sav");
        let skipped_target = directory.path().join("skip.sav");
        tokio::fs::write(&first_temp, b"first-remote")
            .await
            .unwrap();
        tokio::fs::write(&second_temp, b"second-remote")
            .await
            .unwrap();
        tokio::fs::write(&first_target, b"first-local")
            .await
            .unwrap();
        tokio::fs::write(&skipped_target, b"same").await.unwrap();
        let skip = ReplaceRestoreTarget {
            logical_file_id: "skip".to_string(),
            variant_id: "variant".to_string(),
            rule_id: "rule".to_string(),
            relative_path: "skip.sav".to_string(),
            target_path: skipped_target.display().to_string(),
            action: RestoreTargetAction::Skip,
            temp_path: None,
            expected_hash: None,
        };

        let result = replace_restore_targets(vec![
            restore(&first_temp, &first_target, b"first-remote"),
            restore(&second_temp, &second_target, b"second-remote"),
            skip,
        ])
        .await
        .unwrap();

        assert_eq!(
            tokio::fs::read(first_target).await.unwrap(),
            b"first-remote"
        );
        assert_eq!(
            tokio::fs::read(second_target).await.unwrap(),
            b"second-remote"
        );
        assert_eq!(tokio::fs::read(skipped_target).await.unwrap(), b"same");
        assert_eq!(result.restored_files.len(), 2);
        assert_eq!(result.skipped_files.len(), 1);
        assert!(result.failed_files.is_empty());
    }

    #[tokio::test]
    async fn invalid_temp_hash_does_not_mutate_target() {
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
    async fn failure_on_second_target_rolls_back_first_without_residue() {
        let directory = tempdir().unwrap();
        let first_temp = directory.path().join("first.blob");
        let second_temp = directory.path().join("second.blob");
        let first_target = directory.path().join("first.sav");
        let invalid_target = directory.path().join("target-directory");
        tokio::fs::write(&first_temp, b"first-remote")
            .await
            .unwrap();
        tokio::fs::write(&second_temp, b"second-remote")
            .await
            .unwrap();
        tokio::fs::write(&first_target, b"first-local")
            .await
            .unwrap();
        tokio::fs::create_dir(&invalid_target).await.unwrap();

        let result = replace_restore_targets(vec![
            restore(&first_temp, &first_target, b"first-remote"),
            restore(&second_temp, &invalid_target, b"second-remote"),
        ])
        .await
        .unwrap();

        assert_eq!(
            tokio::fs::read(&first_target).await.unwrap(),
            b"first-local"
        );
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

    #[tokio::test]
    async fn rejects_duplicate_targets() {
        let directory = tempdir().unwrap();
        let temp = directory.path().join("remote.blob");
        let target = directory.path().join("save.dat");
        tokio::fs::write(&temp, b"save").await.unwrap();
        let first = restore(&temp, &target, b"save");

        assert!(replace_restore_targets(vec![first.clone(), first])
            .await
            .is_err());
    }
}
