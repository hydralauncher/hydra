use std::collections::{HashMap, HashSet};
use std::io::ErrorKind;
use std::path::{Path, PathBuf};

use filetime::FileTime;
use napi::bindgen_prelude::Error;
use napi_derive::napi;
use uuid::Uuid;

use crate::cloud_save::hashing::hash_file;

use super::metadata::{parse_last_modified_at, read_mtime, write_mtime, RestoreTimestamp};
use super::types::{
    ReplaceRestoreTarget, ReplaceRestoreTargetsResult, RestoreFailedFile, RestoreMetadataFailure,
    RestoreResultFile, RestoreSkippedFile, RestoreTargetAction,
};
use super::validation::{validate_hash, validate_relative_path};

struct ValidatedTarget {
    input: ReplaceRestoreTarget,
    expected_hash: String,
    desired_mtime: RestoreTimestamp,
    original_mtime: Option<FileTime>,
}

struct PreparedTarget {
    validated: ValidatedTarget,
    staging_path: PathBuf,
    backup_path: Option<PathBuf>,
    installed: bool,
}

struct DirectoryTimestamp {
    path: PathBuf,
    desired: RestoreTimestamp,
    original: Option<FileTime>,
    depth: usize,
}

fn identity(input: &ReplaceRestoreTarget) -> RestoreResultFile {
    RestoreResultFile {
        variant_id: input.variant_id.clone(),
        raw_path: input.raw_path.clone(),
        relative_path: input.relative_path.clone(),
        target_path: input.target_path.clone(),
        restore_root_path: input.restore_root_path.clone(),
        last_modified_at: input.last_modified_at.clone(),
    }
}

fn failure(input: &ReplaceRestoreTarget, reason: &str) -> RestoreFailedFile {
    RestoreFailedFile {
        variant_id: input.variant_id.clone(),
        raw_path: input.raw_path.clone(),
        relative_path: input.relative_path.clone(),
        target_path: input.target_path.clone(),
        restore_root_path: input.restore_root_path.clone(),
        last_modified_at: input.last_modified_at.clone(),
        reason: reason.to_string(),
    }
}

fn skipped(input: &ReplaceRestoreTarget) -> RestoreSkippedFile {
    RestoreSkippedFile {
        variant_id: input.variant_id.clone(),
        raw_path: input.raw_path.clone(),
        relative_path: input.relative_path.clone(),
        target_path: input.target_path.clone(),
        restore_root_path: input.restore_root_path.clone(),
        last_modified_at: input.last_modified_at.clone(),
        reason: "already_matches_expected_state".to_string(),
    }
}

fn metadata_failure(path: &Path, kind: &str, reason: &str) -> RestoreMetadataFailure {
    RestoreMetadataFailure {
        path: path.display().to_string(),
        kind: kind.to_string(),
        reason: reason.to_string(),
    }
}

fn sibling_path(target: &Path, suffix: &str) -> Result<PathBuf, String> {
    let parent = target
        .parent()
        .ok_or_else(|| "cloud_save_restore_target_without_parent".to_string())?;
    Ok(parent.join(format!(".hydra-restore-{}-{suffix}", Uuid::new_v4())))
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
        Err(_) => Err("cloud_save_restore_target_inspection_failed".to_string()),
    }
}

fn validate_target_containment(input: &ReplaceRestoreTarget) -> Result<(), String> {
    let target = Path::new(&input.target_path);
    let root = Path::new(&input.restore_root_path);
    if input.target_path.is_empty()
        || input.restore_root_path.is_empty()
        || !target_is_within_root(target, root)
        || target_is_symlink(target).unwrap_or(true)
    {
        Err("cloud_save_restore_target_outside_root".to_string())
    } else {
        Ok(())
    }
}

fn desired_directories(
    target: &Path,
    root: &Path,
    desired: RestoreTimestamp,
    directories: &mut HashMap<String, DirectoryTimestamp>,
) -> Result<(), String> {
    if !target_is_within_root(target, root) {
        return Err("cloud_save_restore_target_outside_root".to_string());
    }
    let root_key = path_key(root);
    let mut current = target
        .parent()
        .ok_or_else(|| "cloud_save_restore_target_without_parent".to_string())?
        .to_path_buf();

    loop {
        if !target_is_within_root(&current, root) {
            return Err("cloud_save_restore_target_outside_root".to_string());
        }
        let key = path_key(&current);
        let depth = canonical_path_with_missing(&current).components().count();
        match directories.get_mut(&key) {
            Some(directory) if desired > directory.desired => {
                directory.desired = desired;
            }
            Some(_) => {}
            None => {
                let original = if current.exists() {
                    Some(read_mtime(&current)?)
                } else {
                    None
                };
                directories.insert(
                    key.clone(),
                    DirectoryTimestamp {
                        path: current.clone(),
                        desired,
                        original,
                        depth,
                    },
                );
            }
        }
        if key == root_key {
            return Ok(());
        }
        if !current.pop() {
            return Err("cloud_save_restore_target_outside_root".to_string());
        }
    }
}

async fn remove_if_exists(path: &Path) -> Result<(), String> {
    match tokio::fs::remove_file(path).await {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error.to_string()),
    }
}

async fn hash_path(path: String, stage: &'static str) -> Result<String, String> {
    tokio::task::spawn_blocking(move || hash_file(&path))
        .await
        .map_err(|_| format!("cloud_save_{stage}_hash_task_failed"))?
        .map_err(|_| format!("cloud_save_{stage}_hash_failed"))
}

fn metadata_result(failure: RestoreMetadataFailure) -> ReplaceRestoreTargetsResult {
    ReplaceRestoreTargetsResult {
        restored_files: Vec::new(),
        skipped_files: Vec::new(),
        failed_files: Vec::new(),
        metadata_failures: vec![failure],
        updated_directory_count: 0,
    }
}

fn failed_result(
    inputs: &[ReplaceRestoreTarget],
    failed_target_key: &str,
    metadata_failures: Vec<RestoreMetadataFailure>,
) -> ReplaceRestoreTargetsResult {
    ReplaceRestoreTargetsResult {
        restored_files: Vec::new(),
        skipped_files: Vec::new(),
        failed_files: inputs
            .iter()
            .map(|input| {
                failure(
                    input,
                    if path_key(Path::new(&input.target_path)) == failed_target_key {
                        "failed_to_replace_target"
                    } else {
                        "restore_rolled_back"
                    },
                )
            })
            .collect(),
        metadata_failures,
        updated_directory_count: 0,
    }
}

fn validate_target(
    input: ReplaceRestoreTarget,
    directories: &mut HashMap<String, DirectoryTimestamp>,
) -> Result<ValidatedTarget, RestoreMetadataFailure> {
    if validate_target_containment(&input).is_err() {
        return Err(metadata_failure(
            Path::new(&input.target_path),
            "file",
            "target-outside-restore-root",
        ));
    }
    let target = Path::new(&input.target_path);
    let root = Path::new(&input.restore_root_path);
    let desired_mtime = parse_last_modified_at(&input.last_modified_at)
        .map_err(|_| metadata_failure(target, "file", "invalid-last-modified-at"))?;
    let expected_hash = input
        .expected_hash
        .clone()
        .expect("expected hash is validated before target metadata");
    let original_mtime = if target.exists() {
        Some(
            read_mtime(target)
                .map_err(|_| metadata_failure(target, "file", "failed-to-read-original-mtime"))?,
        )
    } else {
        None
    };
    desired_directories(target, root, desired_mtime, directories).map_err(|error| {
        metadata_failure(
            target,
            "file",
            if error == "cloud_save_restore_read_mtime_failed" {
                "failed-to-read-original-mtime"
            } else {
                "target-outside-restore-root"
            },
        )
    })?;

    Ok(ValidatedTarget {
        input,
        expected_hash,
        desired_mtime,
        original_mtime,
    })
}

async fn prepare_target(validated: ValidatedTarget) -> Result<PreparedTarget, String> {
    validate_target_containment(&validated.input)?;
    let temp_path = validated
        .input
        .temp_path
        .as_deref()
        .filter(|path| !path.is_empty())
        .ok_or_else(|| "cloud_save_restore_temp_path_missing".to_string())?;
    if hash_path(temp_path.to_string(), "restore_temp").await? != validated.expected_hash {
        return Err("cloud_save_restore_temp_hash_mismatch".to_string());
    }

    let target = Path::new(&validated.input.target_path);
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
    if hash_path(staging_path.display().to_string(), "restore_staging").await?
        != validated.expected_hash
    {
        let _ = remove_if_exists(&staging_path).await;
        return Err("cloud_save_restore_staging_hash_mismatch".to_string());
    }

    Ok(PreparedTarget {
        validated,
        staging_path,
        backup_path: None,
        installed: false,
    })
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

async fn commit_target(item: &mut PreparedTarget) -> Result<(), (&'static str, String)> {
    validate_target_containment(&item.validated.input).map_err(|error| ("content", error))?;
    let target = Path::new(&item.validated.input.target_path);
    if target.try_exists().map_err(|_| {
        (
            "content",
            "cloud_save_restore_target_inspection_failed".to_string(),
        )
    })? {
        if !tokio::fs::metadata(target)
            .await
            .map_err(|_| {
                (
                    "content",
                    "cloud_save_restore_target_inspection_failed".to_string(),
                )
            })?
            .is_file()
        {
            return Err(("content", "cloud_save_restore_target_not_file".to_string()));
        }
        let backup = sibling_path(target, "backup").map_err(|error| ("content", error))?;
        tokio::fs::rename(target, &backup)
            .await
            .map_err(|_| ("content", "cloud_save_restore_backup_failed".to_string()))?;
        item.backup_path = Some(backup);
    }

    tokio::fs::rename(&item.staging_path, target)
        .await
        .map_err(|_| ("content", "cloud_save_restore_install_failed".to_string()))?;
    item.installed = true;

    if hash_path(item.validated.input.target_path.clone(), "restore_final")
        .await
        .map_err(|error| ("content", error))?
        != item.validated.expected_hash
    {
        return Err((
            "content",
            "cloud_save_restore_final_hash_mismatch".to_string(),
        ));
    }
    write_mtime(target, item.validated.desired_mtime.as_file_time())
        .map_err(|error| ("metadata", error))
}

fn restore_original_directories(
    directories: &HashMap<String, DirectoryTimestamp>,
    metadata_failures: &mut Vec<RestoreMetadataFailure>,
) {
    let mut originals = directories
        .values()
        .filter_map(|directory| {
            directory
                .original
                .map(|original| (directory.depth, &directory.path, original))
        })
        .collect::<Vec<_>>();
    originals.sort_by(|left, right| right.0.cmp(&left.0));
    for (_, path, original) in originals {
        if write_mtime(path, original).is_err() {
            metadata_failures.push(metadata_failure(
                path,
                "directory",
                "failed-to-restore-mtime-during-rollback",
            ));
        }
    }
}

async fn rollback(
    prepared: &mut [PreparedTarget],
    applied_skips: &[ValidatedTarget],
    directories: &HashMap<String, DirectoryTimestamp>,
    metadata_failures: &mut Vec<RestoreMetadataFailure>,
) {
    for item in prepared.iter_mut().rev() {
        let target = Path::new(&item.validated.input.target_path);
        if item.installed {
            if remove_if_exists(target).await.is_err() {
                metadata_failures.push(metadata_failure(
                    target,
                    "file",
                    "failed-to-restore-mtime-during-rollback",
                ));
            }
            item.installed = false;
        }
        if let Some(backup) = item.backup_path.as_ref() {
            if tokio::fs::rename(backup, target).await.is_ok() {
                item.backup_path = None;
                if let Some(original) = item.validated.original_mtime {
                    if write_mtime(target, original).is_err() {
                        metadata_failures.push(metadata_failure(
                            target,
                            "file",
                            "failed-to-restore-mtime-during-rollback",
                        ));
                    }
                }
            } else {
                metadata_failures.push(metadata_failure(
                    target,
                    "file",
                    "failed-to-restore-mtime-during-rollback",
                ));
            }
        }
        let _ = remove_if_exists(&item.staging_path).await;
    }
    for skip in applied_skips {
        if let Some(original) = skip.original_mtime {
            let target = Path::new(&skip.input.target_path);
            if write_mtime(target, original).is_err() {
                metadata_failures.push(metadata_failure(
                    target,
                    "file",
                    "failed-to-restore-mtime-during-rollback",
                ));
            }
        }
    }
    restore_original_directories(directories, metadata_failures);
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

fn apply_directory_timestamps(
    directories: &HashMap<String, DirectoryTimestamp>,
) -> (u32, Vec<RestoreMetadataFailure>) {
    let mut ordered = directories.values().collect::<Vec<_>>();
    ordered.sort_by(|left, right| right.depth.cmp(&left.depth));
    let mut updated = 0u32;
    let mut failures = Vec::new();
    for directory in ordered {
        if write_mtime(&directory.path, directory.desired.as_file_time()).is_ok() {
            updated += 1;
        } else {
            failures.push(metadata_failure(
                &directory.path,
                "directory",
                "failed-to-set-mtime",
            ));
        }
    }
    (updated, failures)
}

#[napi]
pub async fn replace_restore_targets(
    files: Vec<ReplaceRestoreTarget>,
) -> napi::Result<ReplaceRestoreTargetsResult> {
    let all_inputs = files.clone();
    let mut seen_targets = HashSet::new();
    let mut directories = HashMap::new();
    let mut restore_targets = Vec::new();
    let mut skip_targets = Vec::new();

    for file in files {
        validate_relative_path(&file.relative_path).map_err(Error::from_reason)?;
        let expected_hash = file
            .expected_hash
            .as_deref()
            .ok_or_else(|| Error::from_reason("cloud_save_restore_expected_hash_missing"))?;
        validate_hash(expected_hash).map_err(Error::from_reason)?;
        if !seen_targets.insert(path_key(Path::new(&file.target_path))) {
            return Err(Error::from_reason("cloud_save_duplicate_restore_target"));
        }
        let validated = match validate_target(file, &mut directories) {
            Ok(validated) => validated,
            Err(failure) => return Ok(metadata_result(failure)),
        };
        match validated.input.action {
            RestoreTargetAction::Restore => restore_targets.push(validated),
            RestoreTargetAction::Skip => skip_targets.push(validated),
        }
    }

    let mut prepared = Vec::new();
    for validated in restore_targets {
        let failed_key = path_key(Path::new(&validated.input.target_path));
        match prepare_target(validated).await {
            Ok(item) => prepared.push(item),
            Err(_) => {
                cleanup_staging(&prepared)
                    .await
                    .map_err(Error::from_reason)?;
                let mut metadata_failures = Vec::new();
                restore_original_directories(&directories, &mut metadata_failures);
                return Ok(failed_result(&all_inputs, &failed_key, metadata_failures));
            }
        }
    }

    for index in 0..prepared.len() {
        if let Err((kind, _)) = commit_target(&mut prepared[index]).await {
            let failed_key = path_key(Path::new(&prepared[index].validated.input.target_path));
            let mut metadata_failures = if kind == "metadata" {
                vec![metadata_failure(
                    Path::new(&prepared[index].validated.input.target_path),
                    "file",
                    "failed-to-set-mtime",
                )]
            } else {
                Vec::new()
            };
            rollback(&mut prepared, &[], &directories, &mut metadata_failures).await;
            return Ok(failed_result(&all_inputs, &failed_key, metadata_failures));
        }
    }

    let mut applied_skips = Vec::new();
    for skip in skip_targets {
        if validate_target_containment(&skip.input).is_err() {
            let failed_key = path_key(Path::new(&skip.input.target_path));
            let mut metadata_failures = vec![metadata_failure(
                Path::new(&skip.input.target_path),
                "file",
                "target-outside-restore-root",
            )];
            rollback(
                &mut prepared,
                &applied_skips,
                &directories,
                &mut metadata_failures,
            )
            .await;
            return Ok(failed_result(&all_inputs, &failed_key, metadata_failures));
        }
        let target_path = skip.input.target_path.clone();
        let target = Path::new(&target_path);
        let hash_matches = target.is_file()
            && hash_path(target_path.clone(), "restore_skip")
                .await
                .is_ok_and(|hash| hash == skip.expected_hash);
        if !hash_matches {
            let failed_key = path_key(target);
            let mut metadata_failures = Vec::new();
            rollback(
                &mut prepared,
                &applied_skips,
                &directories,
                &mut metadata_failures,
            )
            .await;
            return Ok(failed_result(&all_inputs, &failed_key, metadata_failures));
        }
        applied_skips.push(skip);
        let current = applied_skips
            .last()
            .expect("the current skip target was just appended");
        if write_mtime(target, current.desired_mtime.as_file_time()).is_err() {
            let failed_key = path_key(target);
            let mut metadata_failures =
                vec![metadata_failure(target, "file", "failed-to-set-mtime")];
            rollback(
                &mut prepared,
                &applied_skips,
                &directories,
                &mut metadata_failures,
            )
            .await;
            return Ok(failed_result(&all_inputs, &failed_key, metadata_failures));
        }
    }

    remove_backups(&mut prepared)
        .await
        .map_err(Error::from_reason)?;
    let (updated_directory_count, metadata_failures) = apply_directory_timestamps(&directories);

    Ok(ReplaceRestoreTargetsResult {
        restored_files: prepared
            .iter()
            .map(|item| identity(&item.validated.input))
            .collect(),
        skipped_files: applied_skips
            .iter()
            .map(|item| skipped(&item.input))
            .collect(),
        failed_files: Vec::new(),
        metadata_failures,
        updated_directory_count,
    })
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use sha2::{Digest, Sha256};
    use tempfile::tempdir;

    use super::*;

    const FIRST_TIME: &str = "2026-07-20T10:00:00.123Z";
    const SECOND_TIME: &str = "2026-07-22T10:05:00.456Z";

    fn restore(
        temp: &Path,
        target: &Path,
        root: &Path,
        content: &[u8],
        last_modified_at: &str,
    ) -> ReplaceRestoreTarget {
        ReplaceRestoreTarget {
            variant_id: "variant".to_string(),
            raw_path: "<home>/Game".to_string(),
            relative_path: target
                .strip_prefix(root)
                .unwrap_or(target)
                .to_string_lossy()
                .replace('\\', "/"),
            target_path: target.display().to_string(),
            restore_root_path: root.display().to_string(),
            last_modified_at: last_modified_at.to_string(),
            action: RestoreTargetAction::Restore,
            temp_path: Some(temp.display().to_string()),
            expected_hash: Some(format!("{:x}", Sha256::digest(content))),
        }
    }

    fn skip(
        target: &Path,
        root: &Path,
        content: &[u8],
        last_modified_at: &str,
    ) -> ReplaceRestoreTarget {
        ReplaceRestoreTarget {
            variant_id: "variant".to_string(),
            raw_path: "<home>/Game".to_string(),
            relative_path: target
                .strip_prefix(root)
                .unwrap_or(target)
                .to_string_lossy()
                .replace('\\', "/"),
            target_path: target.display().to_string(),
            restore_root_path: root.display().to_string(),
            last_modified_at: last_modified_at.to_string(),
            action: RestoreTargetAction::Skip,
            temp_path: None,
            expected_hash: Some(format!("{:x}", Sha256::digest(content))),
        }
    }

    fn assert_mtime(path: &Path, expected: &str) {
        let actual = read_mtime(path).unwrap();
        let expected = parse_last_modified_at(expected).unwrap().as_file_time();
        let difference = actual.unix_seconds().abs_diff(expected.unix_seconds());
        assert!(
            difference <= Duration::from_secs(2).as_secs(),
            "{} differs by {difference}s",
            path.display()
        );
    }

    #[tokio::test]
    async fn restores_file_skip_and_directory_mtimes() {
        let directory = tempdir().unwrap();
        let root = directory.path().join("saves");
        let nested = root.join("slot");
        tokio::fs::create_dir_all(&nested).await.unwrap();
        let first_temp = directory.path().join("first.blob");
        let first_target = nested.join("existing.sav");
        let skipped_target = nested.join("skip.sav");
        tokio::fs::write(&first_temp, b"first-remote")
            .await
            .unwrap();
        tokio::fs::write(&first_target, b"first-local")
            .await
            .unwrap();
        tokio::fs::write(&skipped_target, b"same").await.unwrap();

        let result = replace_restore_targets(vec![
            restore(
                &first_temp,
                &first_target,
                &root,
                b"first-remote",
                FIRST_TIME,
            ),
            skip(&skipped_target, &root, b"same", SECOND_TIME),
        ])
        .await
        .unwrap();

        assert_eq!(
            tokio::fs::read(&first_target).await.unwrap(),
            b"first-remote"
        );
        assert_eq!(tokio::fs::read(&skipped_target).await.unwrap(), b"same");
        assert_mtime(&first_target, FIRST_TIME);
        assert_mtime(&skipped_target, SECOND_TIME);
        assert_mtime(&nested, SECOND_TIME);
        assert_mtime(&root, SECOND_TIME);
        assert_eq!(result.restored_files.len(), 1);
        assert_eq!(result.skipped_files.len(), 1);
        assert!(result.failed_files.is_empty());
        assert!(result.metadata_failures.is_empty());
        assert_eq!(result.updated_directory_count, 2);
    }

    #[tokio::test]
    async fn shared_blob_keeps_independent_target_timestamps() {
        let directory = tempdir().unwrap();
        let root = directory.path().join("saves");
        tokio::fs::create_dir_all(&root).await.unwrap();
        let temp = directory.path().join("shared.blob");
        let first_target = root.join("first.sav");
        let second_target = root.join("second.sav");
        tokio::fs::write(&temp, b"same").await.unwrap();

        replace_restore_targets(vec![
            restore(&temp, &first_target, &root, b"same", FIRST_TIME),
            restore(&temp, &second_target, &root, b"same", SECOND_TIME),
        ])
        .await
        .unwrap();

        assert_mtime(&first_target, FIRST_TIME);
        assert_mtime(&second_target, SECOND_TIME);
        assert_mtime(&root, SECOND_TIME);
    }

    #[tokio::test]
    async fn invalid_timestamp_or_outside_root_does_not_mutate_target() {
        let directory = tempdir().unwrap();
        let root = directory.path().join("saves");
        tokio::fs::create_dir_all(&root).await.unwrap();
        let temp = directory.path().join("remote.blob");
        let target = root.join("save.dat");
        tokio::fs::write(&temp, b"remote").await.unwrap();
        tokio::fs::write(&target, b"local").await.unwrap();

        let invalid = restore(&temp, &target, &root, b"remote", "invalid");
        let result = replace_restore_targets(vec![invalid]).await.unwrap();
        assert_eq!(tokio::fs::read(&target).await.unwrap(), b"local");
        assert_eq!(
            result.metadata_failures[0].reason,
            "invalid-last-modified-at"
        );

        let mut outside = restore(&temp, &target, &root.join("other"), b"remote", FIRST_TIME);
        outside.relative_path = "save.dat".to_string();
        let result = replace_restore_targets(vec![outside]).await.unwrap();
        assert_eq!(tokio::fs::read(&target).await.unwrap(), b"local");
        assert_eq!(
            result.metadata_failures[0].reason,
            "target-outside-restore-root"
        );
    }

    #[tokio::test]
    async fn invalid_temp_hash_does_not_mutate_target_or_leave_residue() {
        let directory = tempdir().unwrap();
        let root = directory.path().join("saves");
        tokio::fs::create_dir_all(&root).await.unwrap();
        let temp = directory.path().join("remote.blob");
        let target = root.join("save.dat");
        tokio::fs::write(&temp, b"corrupt").await.unwrap();
        tokio::fs::write(&target, b"local").await.unwrap();

        let result = replace_restore_targets(vec![restore(
            &temp,
            &target,
            &root,
            b"expected",
            FIRST_TIME,
        )])
        .await
        .unwrap();

        assert_eq!(tokio::fs::read(&target).await.unwrap(), b"local");
        assert_eq!(result.failed_files[0].reason, "failed_to_replace_target");
        let entries = std::fs::read_dir(&root)
            .unwrap()
            .map(|entry| entry.unwrap().file_name().to_string_lossy().to_string())
            .collect::<Vec<_>>();
        assert!(!entries
            .iter()
            .any(|name| name.starts_with(".hydra-restore-")));
    }

    #[tokio::test]
    async fn failure_on_second_target_rolls_back_first_without_residue() {
        let directory = tempdir().unwrap();
        let root = directory.path().join("saves");
        tokio::fs::create_dir_all(&root).await.unwrap();
        let first_temp = directory.path().join("first.blob");
        let second_temp = directory.path().join("second.blob");
        let first_target = root.join("first.sav");
        let invalid_target = root.join("target-directory");
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
            restore(
                &first_temp,
                &first_target,
                &root,
                b"first-remote",
                FIRST_TIME,
            ),
            restore(
                &second_temp,
                &invalid_target,
                &root,
                b"second-remote",
                SECOND_TIME,
            ),
        ])
        .await
        .unwrap();

        assert_eq!(
            tokio::fs::read(&first_target).await.unwrap(),
            b"first-local"
        );
        assert_eq!(result.failed_files[0].reason, "restore_rolled_back");
        assert_eq!(result.failed_files[1].reason, "failed_to_replace_target");
        let entries = std::fs::read_dir(&root)
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
        let root = directory.path().join("saves");
        tokio::fs::create_dir_all(&root).await.unwrap();
        let temp = directory.path().join("remote.blob");
        let target = root.join("save.dat");
        tokio::fs::write(&temp, b"save").await.unwrap();
        let first = restore(&temp, &target, &root, b"save", FIRST_TIME);

        assert!(replace_restore_targets(vec![first.clone(), first])
            .await
            .is_err());
    }
}
