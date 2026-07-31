use std::collections::HashSet;
use std::io::ErrorKind;
use std::path::{Path, PathBuf};

use napi::bindgen_prelude::Error;
use napi_derive::napi;

use crate::cloud_save::hashing::hash_file;

use super::artifacts::delete_backup_path;
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

fn collect_target_ancestors(target: &Path, root: &Path, directories: &mut HashSet<PathBuf>) {
    let root_key = path_key(root);
    let mut current = target.parent();
    while let Some(directory) = current {
        if !target_is_within_root(directory, root) || path_key(directory) == root_key {
            break;
        }
        directories.insert(directory.to_path_buf());
        current = directory.parent();
    }
}

async fn prune_empty_target_ancestors(
    roots: &[String],
    prepared: &[PreparedDeletion],
) -> (Vec<String>, u32) {
    let mut directories = HashSet::new();
    let mut failure_count = 0u32;
    let mut allowed_root_keys = HashSet::new();
    for root in roots {
        let path = PathBuf::from(root);
        if !path.is_absolute() || path.parent().is_none() {
            failure_count = failure_count.saturating_add(1);
            continue;
        }
        allowed_root_keys.insert(path_key(&path));
    }

    for item in prepared {
        let root = Path::new(&item.input.restore_root_path);
        if allowed_root_keys.contains(&path_key(root)) {
            collect_target_ancestors(Path::new(&item.input.target_path), root, &mut directories);
        }
    }

    let mut directories = directories.into_iter().collect::<Vec<_>>();
    directories.sort_by(|left, right| {
        right
            .components()
            .count()
            .cmp(&left.components().count())
            .then_with(|| path_key(left).cmp(&path_key(right)))
    });

    let mut deleted = Vec::new();
    for directory in directories {
        let metadata = match tokio::fs::symlink_metadata(&directory).await {
            Ok(metadata) => metadata,
            Err(error) if error.kind() == ErrorKind::NotFound => continue,
            Err(_) => {
                failure_count = failure_count.saturating_add(1);
                continue;
            }
        };
        if metadata.file_type().is_symlink() || !metadata.is_dir() {
            continue;
        }
        match tokio::fs::remove_dir(&directory).await {
            Ok(()) => {
                deleted.push(directory.to_string_lossy().to_string());
                if sync_parent_directory(&directory).await.is_err() {
                    failure_count = failure_count.saturating_add(1);
                }
            }
            Err(error)
                if error.kind() == ErrorKind::NotFound
                    || error.kind() == ErrorKind::DirectoryNotEmpty => {}
            Err(_) => failure_count = failure_count.saturating_add(1),
        }
    }
    (deleted, failure_count)
}

async fn hash_path(path: String) -> Result<String, String> {
    tokio::task::spawn_blocking(move || hash_file(&path))
        .await
        .map_err(|_| "cloud_save_delete_hash_task_failed".to_string())?
        .map_err(|_| "cloud_save_delete_hash_failed".to_string())
}

async fn sync_file(path: &Path) -> Result<(), String> {
    tokio::fs::OpenOptions::new()
        .read(true)
        .write(true)
        .open(path)
        .await
        .map_err(|_| "cloud_save_delete_sync_failed".to_string())?
        .sync_all()
        .await
        .map_err(|_| "cloud_save_delete_sync_failed".to_string())
}

#[cfg(unix)]
async fn sync_directory(path: &Path) -> Result<(), String> {
    tokio::fs::File::open(path)
        .await
        .map_err(|_| "cloud_save_delete_directory_sync_failed".to_string())?
        .sync_all()
        .await
        .map_err(|_| "cloud_save_delete_directory_sync_failed".to_string())
}

#[cfg(not(unix))]
async fn sync_directory(_path: &Path) -> Result<(), String> {
    Ok(())
}

async fn sync_parent_directory(path: &Path) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "cloud_save_delete_target_without_parent".to_string())?;
    sync_directory(parent).await
}

async fn rollback(prepared: &mut [PreparedDeletion]) -> Result<(), String> {
    let mut failed = false;
    for item in prepared.iter_mut().rev() {
        if item.moved {
            if tokio::fs::rename(&item.backup_path, &item.input.target_path)
                .await
                .is_err()
            {
                failed = true;
                continue;
            }
            item.moved = false;
            if sync_file(Path::new(&item.input.target_path)).await.is_err()
                || sync_parent_directory(Path::new(&item.input.target_path))
                    .await
                    .is_err()
            {
                failed = true;
            }
        }
    }

    if failed {
        Err("cloud_save_delete_rollback_failed".to_string())
    } else {
        Ok(())
    }
}

async fn rollback_error(prepared: &mut [PreparedDeletion], reason: &str) -> String {
    match rollback(prepared).await {
        Ok(()) => reason.to_string(),
        Err(error) => error,
    }
}

async fn move_to_backups(prepared: &mut [PreparedDeletion]) -> Result<(), String> {
    for index in 0..prepared.len() {
        let target_path = PathBuf::from(&prepared[index].input.target_path);
        let backup_path = prepared[index].backup_path.clone();
        if tokio::fs::rename(&target_path, &backup_path).await.is_err() {
            return Err(rollback_error(prepared, "cloud_save_delete_move_failed").await);
        }
        prepared[index].moved = true;
        if sync_file(&backup_path).await.is_err()
            || sync_parent_directory(&backup_path).await.is_err()
        {
            return Err(rollback_error(prepared, "cloud_save_delete_move_failed").await);
        }
    }

    Ok(())
}

async fn recover_backup(item: &PreparedDeletion) -> Result<(), String> {
    let backup_metadata = match tokio::fs::symlink_metadata(&item.backup_path).await {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == ErrorKind::NotFound => return Ok(()),
        Err(_) => return Err("cloud_save_delete_artifact_inspection_failed".to_string()),
    };
    if !backup_metadata.is_file() || backup_metadata.file_type().is_symlink() {
        return Err("cloud_save_delete_invalid_backup_artifact".to_string());
    }

    let target = Path::new(&item.input.target_path);
    match tokio::fs::symlink_metadata(target).await {
        Err(error) if error.kind() == ErrorKind::NotFound => {
            tokio::fs::rename(&item.backup_path, target)
                .await
                .map_err(|_| "cloud_save_delete_backup_recovery_failed".to_string())?;
            sync_file(target).await?;
            sync_parent_directory(target).await
        }
        Err(_) => Err("cloud_save_delete_target_inspection_failed".to_string()),
        Ok(metadata) => {
            if !metadata.is_file() || metadata.file_type().is_symlink() {
                return Err("cloud_save_delete_recovery_conflict".to_string());
            }
            if metadata.len() != backup_metadata.len()
                || hash_path(item.input.target_path.clone()).await?
                    != hash_path(item.backup_path.display().to_string()).await?
            {
                return Err("cloud_save_delete_recovery_conflict".to_string());
            }
            tokio::fs::remove_file(&item.backup_path)
                .await
                .map_err(|_| "cloud_save_delete_backup_recovery_failed".to_string())?;
            sync_parent_directory(&item.backup_path).await
        }
    }
}

async fn validate_moved(item: &PreparedDeletion) -> Result<(), String> {
    let metadata = tokio::fs::metadata(&item.backup_path)
        .await
        .map_err(|_| "cloud_save_delete_target_changed".to_string())?;
    if !metadata.is_file() || metadata.len() as f64 != item.input.expected_size_bytes {
        return Err("cloud_save_delete_target_changed".to_string());
    }
    if hash_path(item.backup_path.display().to_string()).await? != item.input.expected_hash {
        return Err("cloud_save_delete_target_changed".to_string());
    }

    Ok(())
}

async fn cleanup_backups(prepared: &[PreparedDeletion]) -> u32 {
    let mut failure_count = 0;
    for item in prepared {
        match tokio::fs::remove_file(&item.backup_path).await {
            Ok(()) => {
                if sync_parent_directory(&item.backup_path).await.is_err() {
                    failure_count += 1;
                }
            }
            Err(error) if error.kind() == ErrorKind::NotFound => {}
            Err(_) => failure_count += 1,
        }
    }
    failure_count
}

fn prepare_input(input: DeleteLocalSaveTarget) -> Result<PreparedDeletion, String> {
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
    Ok(PreparedDeletion {
        backup_path: delete_backup_path(target, &path_key(target))?,
        input,
        moved: false,
    })
}

async fn validate_target(item: &PreparedDeletion) -> Result<(), String> {
    let target = Path::new(&item.input.target_path);
    let metadata = tokio::fs::symlink_metadata(target)
        .await
        .map_err(|_| "cloud_save_delete_target_missing".to_string())?;
    if !metadata.is_file()
        || metadata.file_type().is_symlink()
        || metadata.len() as f64 != item.input.expected_size_bytes
    {
        return Err("cloud_save_delete_target_changed".to_string());
    }
    if hash_path(item.input.target_path.clone()).await? != item.input.expected_hash {
        return Err("cloud_save_delete_target_changed".to_string());
    }

    Ok(())
}

#[napi]
pub async fn delete_local_save_targets(
    files: Vec<DeleteLocalSaveTarget>,
    cleanup_root_paths: Option<Vec<String>>,
) -> napi::Result<DeleteLocalSaveTargetsResult> {
    let mut seen_targets = HashSet::new();
    let mut prepared = Vec::with_capacity(files.len());
    for file in files {
        if !seen_targets.insert(path_key(Path::new(&file.target_path))) {
            return Err(Error::from_reason("cloud_save_duplicate_delete_target"));
        }
        prepared.push(prepare_input(file).map_err(Error::from_reason)?);
    }

    for item in &prepared {
        recover_backup(item).await.map_err(Error::from_reason)?;
    }
    for item in &prepared {
        validate_target(item).await.map_err(Error::from_reason)?;
    }

    move_to_backups(&mut prepared)
        .await
        .map_err(Error::from_reason)?;

    for item in &prepared {
        if validate_moved(item).await.is_err() {
            let error = rollback_error(&mut prepared, "cloud_save_delete_target_changed").await;
            return Err(Error::from_reason(error));
        }
    }

    // Once every backup has been validated, the deletion is logically committed.
    // Cleanup must not turn an applied deletion into a failure or attempt rollback.
    let backup_cleanup_failure_count = cleanup_backups(&prepared).await;
    let (deleted_directories, directory_cleanup_failure_count) =
        prune_empty_target_ancestors(&cleanup_root_paths.unwrap_or_default(), &prepared).await;
    let cleanup_failure_count =
        backup_cleanup_failure_count.saturating_add(directory_cleanup_failure_count);

    Ok(DeleteLocalSaveTargetsResult {
        deleted_files: prepared
            .into_iter()
            .map(|item| DeletedLocalSaveFile {
                variant_id: item.input.variant_id,
                raw_path: item.input.raw_path,
                relative_path: item.input.relative_path,
            })
            .collect(),
        deleted_directories,
        cleanup_failure_count,
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

        let result = delete_local_save_targets(vec![target(temp.path(), "slot.sav", bytes)], None)
            .await
            .unwrap();

        assert_eq!(result.deleted_files.len(), 1);
        assert_eq!(result.cleanup_failure_count, 0);
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

        let result = delete_local_save_targets(
            vec![
                target(temp.path(), "first.sav", b"first"),
                target(temp.path(), "second.sav", b"expected"),
            ],
            None,
        )
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

        assert!(delete_local_save_targets(vec![input], None).await.is_err());
        assert!(outside.join("slot.sav").exists());
    }

    #[tokio::test]
    async fn removes_empty_target_ancestors_without_deleting_root() {
        let temp = tempdir().unwrap();
        let root = temp.path().join("save");
        let nested = root.join("slots");
        std::fs::create_dir_all(&nested).unwrap();
        std::fs::write(nested.join("slot.sav"), b"save").unwrap();

        let result = delete_local_save_targets(
            vec![target(&root, "slots/slot.sav", b"save")],
            Some(vec![root.display().to_string()]),
        )
        .await
        .unwrap();

        assert!(root.exists());
        assert!(!nested.exists());
        assert!(result
            .deleted_directories
            .iter()
            .any(|directory| directory == &nested.display().to_string()));
        assert!(!result
            .deleted_directories
            .iter()
            .any(|directory| directory == &root.display().to_string()));
    }

    #[tokio::test]
    async fn keeps_directories_with_unrecognized_files() {
        let temp = tempdir().unwrap();
        let root = temp.path().join("save");
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(root.join("slot.sav"), b"save").unwrap();
        std::fs::write(root.join("keep.log"), b"keep").unwrap();

        delete_local_save_targets(
            vec![target(&root, "slot.sav", b"save")],
            Some(vec![root.display().to_string()]),
        )
        .await
        .unwrap();

        assert!(root.exists());
        assert!(root.join("keep.log").exists());
    }

    #[tokio::test]
    async fn keeps_an_empty_registered_root_without_files() {
        let temp = tempdir().unwrap();
        let root = temp.path().join("empty-save");
        let nested = root.join("nested");
        std::fs::create_dir_all(&nested).unwrap();

        let result = delete_local_save_targets(Vec::new(), Some(vec![root.display().to_string()]))
            .await
            .unwrap();

        assert!(root.exists());
        assert!(nested.exists());
        assert!(result.deleted_directories.is_empty());
    }

    #[tokio::test]
    async fn reports_directory_cleanup_failure_after_committing_deletion() {
        let temp = tempdir().unwrap();
        let path = temp.path().join("slot.sav");
        std::fs::write(&path, b"save").unwrap();

        let result = delete_local_save_targets(
            vec![target(temp.path(), "slot.sav", b"save")],
            Some(vec!["relative-cleanup-root".to_string()]),
        )
        .await
        .unwrap();

        assert!(!path.exists());
        assert_eq!(result.cleanup_failure_count, 1);
        assert!(result.deleted_directories.is_empty());
    }

    #[tokio::test]
    async fn does_not_prune_unrelated_empty_sibling_directories() {
        let temp = tempdir().unwrap();
        let root = temp.path().join("save");
        let slots = root.join("slots");
        let unrelated = root.join("unrelated-empty");
        std::fs::create_dir_all(&slots).unwrap();
        std::fs::create_dir_all(&unrelated).unwrap();
        std::fs::write(slots.join("slot.sav"), b"save").unwrap();

        delete_local_save_targets(
            vec![target(&root, "slots/slot.sav", b"save")],
            Some(vec![root.display().to_string()]),
        )
        .await
        .unwrap();

        assert!(unrelated.exists());
    }

    #[tokio::test]
    async fn rolls_back_when_a_target_changes_after_preparation() {
        let temp = tempdir().unwrap();
        let path = temp.path().join("slot.sav");
        std::fs::write(&path, b"save").unwrap();
        let mut prepared = vec![prepare_input(target(temp.path(), "slot.sav", b"save")).unwrap()];
        validate_target(&prepared[0]).await.unwrap();

        std::fs::write(&path, b"changed").unwrap();
        move_to_backups(&mut prepared).await.unwrap();
        assert!(validate_moved(&prepared[0]).await.is_err());
        rollback(&mut prepared).await.unwrap();

        assert_eq!(std::fs::read(&path).unwrap(), b"changed");
    }

    #[tokio::test]
    async fn a_move_failure_restores_targets_already_moved() {
        let temp = tempdir().unwrap();
        let first_path = temp.path().join("first.sav");
        let second_path = temp.path().join("second.sav");
        std::fs::write(&first_path, b"first").unwrap();
        std::fs::write(&second_path, b"second").unwrap();
        let mut prepared = vec![
            prepare_input(target(temp.path(), "first.sav", b"first")).unwrap(),
            prepare_input(target(temp.path(), "second.sav", b"second")).unwrap(),
        ];
        validate_target(&prepared[0]).await.unwrap();
        validate_target(&prepared[1]).await.unwrap();
        std::fs::remove_file(&second_path).unwrap();

        assert!(move_to_backups(&mut prepared).await.is_err());
        assert_eq!(std::fs::read(&first_path).unwrap(), b"first");
    }

    #[tokio::test]
    async fn recovers_an_interrupted_move_before_the_next_deletion() {
        let temp = tempdir().unwrap();
        let input = target(temp.path(), "slot.sav", b"save");
        std::fs::write(&input.target_path, b"save").unwrap();
        let mut interrupted = vec![prepare_input(input.clone()).unwrap()];
        validate_target(&interrupted[0]).await.unwrap();
        move_to_backups(&mut interrupted).await.unwrap();
        assert!(!Path::new(&input.target_path).exists());
        assert!(interrupted[0].backup_path.exists());

        let recovered = prepare_input(input).unwrap();
        recover_backup(&recovered).await.unwrap();

        assert_eq!(
            std::fs::read(&recovered.input.target_path).unwrap(),
            b"save"
        );
        assert!(!recovered.backup_path.exists());
    }

    #[tokio::test]
    async fn failed_rollback_leaves_a_recoverable_backup() {
        let temp = tempdir().unwrap();
        let input = target(temp.path(), "slot.sav", b"save");
        std::fs::write(&input.target_path, b"save").unwrap();
        let mut prepared = vec![prepare_input(input.clone()).unwrap()];
        validate_target(&prepared[0]).await.unwrap();
        move_to_backups(&mut prepared).await.unwrap();
        std::fs::create_dir(&input.target_path).unwrap();

        assert_eq!(
            rollback(&mut prepared).await.unwrap_err(),
            "cloud_save_delete_rollback_failed"
        );
        assert!(prepared[0].backup_path.exists());

        std::fs::remove_dir(&input.target_path).unwrap();
        let recovered = prepare_input(input).unwrap();
        recover_backup(&recovered).await.unwrap();
        assert_eq!(
            std::fs::read(&recovered.input.target_path).unwrap(),
            b"save"
        );
    }

    #[tokio::test]
    async fn preserves_divergent_target_and_backup_during_recovery() {
        let temp = tempdir().unwrap();
        let input = target(temp.path(), "slot.sav", b"save");
        std::fs::write(&input.target_path, b"save").unwrap();
        let mut prepared = vec![prepare_input(input.clone()).unwrap()];
        validate_target(&prepared[0]).await.unwrap();
        move_to_backups(&mut prepared).await.unwrap();
        std::fs::write(&input.target_path, b"new-save").unwrap();

        assert_eq!(
            recover_backup(&prepared[0]).await.unwrap_err(),
            "cloud_save_delete_recovery_conflict"
        );
        assert_eq!(std::fs::read(&input.target_path).unwrap(), b"new-save");
        assert_eq!(std::fs::read(&prepared[0].backup_path).unwrap(), b"save");
    }

    #[tokio::test]
    async fn removes_an_identical_redundant_backup_during_recovery() {
        let temp = tempdir().unwrap();
        let input = target(temp.path(), "slot.sav", b"save");
        std::fs::write(&input.target_path, b"save").unwrap();
        let prepared = prepare_input(input).unwrap();
        std::fs::write(&prepared.backup_path, b"save").unwrap();

        recover_backup(&prepared).await.unwrap();

        assert_eq!(std::fs::read(&prepared.input.target_path).unwrap(), b"save");
        assert!(!prepared.backup_path.exists());
    }

    #[tokio::test]
    async fn preserves_an_invalid_backup_artifact() {
        let temp = tempdir().unwrap();
        let input = target(temp.path(), "slot.sav", b"save");
        std::fs::write(&input.target_path, b"save").unwrap();
        let prepared = prepare_input(input).unwrap();
        std::fs::create_dir(&prepared.backup_path).unwrap();

        assert_eq!(
            recover_backup(&prepared).await.unwrap_err(),
            "cloud_save_delete_invalid_backup_artifact"
        );
        assert_eq!(std::fs::read(&prepared.input.target_path).unwrap(), b"save");
        assert!(prepared.backup_path.is_dir());
    }

    #[tokio::test]
    async fn cleanup_failure_is_reported_without_rolling_back() {
        let temp = tempdir().unwrap();
        let input = target(temp.path(), "slot.sav", b"save");
        let backup_path = temp.path().join("backup-directory");
        std::fs::create_dir(&backup_path).unwrap();
        let prepared = vec![PreparedDeletion {
            input,
            backup_path,
            moved: true,
        }];

        assert_eq!(cleanup_backups(&prepared).await, 1);
        assert!(!Path::new(&prepared[0].input.target_path).exists());
    }
}
