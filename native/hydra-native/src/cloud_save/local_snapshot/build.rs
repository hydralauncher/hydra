use std::collections::{BTreeMap, HashMap};

use crate::cloud_save::hashing::types::HashedLocalFile;
use crate::cloud_save::hashing::{
    batch::hash_files, build_aggregate_hash, BuildSnapshotAggregateHashInput,
    SnapshotAggregateHashFile,
};

use super::guardrails::{prepare_snapshot_files, validate_built_files, validate_hashed_files};
use super::types::{
    BuildLocalGameSnapshotInput, BuiltLocalSaveFile, LocalGameSnapshotBuildOutcome,
    LocalGameSnapshotConflict, LocalGameSnapshotConflictCopy, LocalGameSnapshotFile,
    LocalGameSnapshotSourceFile, LocalGameSnapshotWithHash,
};

pub fn build_snapshot_outcome(
    input: BuildLocalGameSnapshotInput,
) -> Result<LocalGameSnapshotBuildOutcome, String> {
    let initial_metadata =
        prepare_snapshot_files(&input.files).map_err(|error| error.to_string())?;

    let hashed = hash_files(
        input
            .files
            .iter()
            .map(|file| file.absolute_path.clone())
            .collect(),
        input.hash_cache,
    )?;
    validate_hashed_files(&hashed.files, &initial_metadata).map_err(|error| error.to_string())?;
    let hashed_by_path = hashed
        .files
        .into_iter()
        .map(|file| (file.absolute_path.clone(), file))
        .collect::<HashMap<String, HashedLocalFile>>();
    let built_files = input
        .files
        .into_iter()
        .map(|file| {
            let hashed = hashed_by_path
                .get(&file.absolute_path)
                .ok_or_else(|| "cloud_save_hash_result_missing".to_string())?;

            Ok(BuiltLocalSaveFile {
                raw_path: file.raw_path,
                relative_path: file.relative_path,
                absolute_path: file.absolute_path,
                hash: hashed.hash.clone(),
                size_bytes: hashed.size_bytes,
                last_modified_at: hashed.last_modified_at.clone(),
            })
        })
        .collect::<Result<Vec<_>, String>>()?;
    let mut files_by_logical_path = BTreeMap::<(String, String), Vec<BuiltLocalSaveFile>>::new();
    for file in built_files {
        files_by_logical_path
            .entry((file.raw_path.clone(), file.relative_path.clone()))
            .or_default()
            .push(file);
    }

    let mut conflicts = Vec::new();
    let mut built_files = Vec::with_capacity(files_by_logical_path.len());
    for ((raw_path, relative_path), mut copies) in files_by_logical_path {
        copies.sort_by(|left, right| left.absolute_path.cmp(&right.absolute_path));
        let first = copies
            .first()
            .ok_or_else(|| "cloud_save_empty_logical_file_group".to_string())?;
        let differs = copies
            .iter()
            .any(|copy| copy.hash != first.hash || copy.size_bytes != first.size_bytes);

        if differs {
            conflicts.push(LocalGameSnapshotConflict {
                raw_path,
                relative_path,
                copies: copies
                    .into_iter()
                    .map(|copy| LocalGameSnapshotConflictCopy {
                        absolute_path: copy.absolute_path,
                        hash: copy.hash,
                        size_bytes: copy.size_bytes,
                        last_modified_at: copy.last_modified_at,
                    })
                    .collect(),
            });
        } else {
            built_files.push(copies.remove(0));
        }
    }

    if !conflicts.is_empty() {
        return Ok(LocalGameSnapshotBuildOutcome::LocalConflict {
            conflicts,
            hash_cache: hashed.hash_cache,
        });
    }

    let total_size_bytes = validate_built_files(&built_files).map_err(|error| error.to_string())?;

    let files = built_files
        .iter()
        .map(|file| LocalGameSnapshotFile {
            raw_path: file.raw_path.clone(),
            relative_path: file.relative_path.clone(),
            hash: file.hash.clone(),
            size_bytes: file.size_bytes,
            last_modified_at: file.last_modified_at.clone(),
        })
        .collect::<Vec<_>>();
    let source_files = built_files
        .iter()
        .map(|file| LocalGameSnapshotSourceFile {
            raw_path: file.raw_path.clone(),
            relative_path: file.relative_path.clone(),
            absolute_path: file.absolute_path.clone(),
            hash: file.hash.clone(),
            size_bytes: file.size_bytes,
        })
        .collect();
    let aggregate_hash = build_aggregate_hash(BuildSnapshotAggregateHashInput {
        files: files
            .iter()
            .map(|file| SnapshotAggregateHashFile {
                raw_path: file.raw_path.clone(),
                relative_path: file.relative_path.clone(),
                hash: file.hash.clone(),
                size_bytes: file.size_bytes,
            })
            .collect(),
    })?;

    Ok(LocalGameSnapshotBuildOutcome::Ready(
        LocalGameSnapshotWithHash {
            game_id: input.game_id,
            manifest_key: input.manifest_key,
            file_count: files.len() as u32,
            total_size_bytes: total_size_bytes as f64,
            files,
            aggregate_hash,
            source_files,
            hash_cache: hashed.hash_cache,
        },
    ))
}

pub fn build_snapshot(
    input: BuildLocalGameSnapshotInput,
) -> Result<LocalGameSnapshotWithHash, String> {
    match build_snapshot_outcome(input)? {
        LocalGameSnapshotBuildOutcome::Ready(snapshot) => Ok(snapshot),
        LocalGameSnapshotBuildOutcome::LocalConflict { .. } => {
            Err("cloud_save_conflicting_local_copies".to_string())
        }
    }
}

#[cfg(test)]
mod tests {
    use std::fs;

    use tempfile::tempdir;

    use super::*;
    use crate::cloud_save::local_snapshot::types::DiscoveredLocalSaveFile;
    use crate::cloud_save::manifest::types::CloudSaveGameId;

    fn input(files: Vec<DiscoveredLocalSaveFile>) -> BuildLocalGameSnapshotInput {
        BuildLocalGameSnapshotInput {
            game_id: CloudSaveGameId {
                shop: "steam".into(),
                object_id: "2379780".into(),
            },
            manifest_key: Some("2379780".into()),
            files,
            hash_cache: vec![],
        }
    }

    #[test]
    fn builds_deterministic_snapshot_with_source_files() {
        let temp = tempdir().unwrap();
        let empty = temp.path().join("empty.dat");
        let save = temp.path().join("save.dat");
        fs::write(&empty, b"").unwrap();
        fs::write(&save, b"save").unwrap();
        let discovered = |path: &std::path::Path, relative_path: &str| DiscoveredLocalSaveFile {
            raw_path: "<home>/game".into(),
            absolute_path: path.display().to_string(),
            relative_path: relative_path.into(),
        };

        let first = build_snapshot(input(vec![
            discovered(&save, "save.dat"),
            discovered(&empty, "empty.dat"),
        ]))
        .unwrap();
        let second = build_snapshot(input(vec![
            discovered(&empty, "empty.dat"),
            discovered(&save, "save.dat"),
        ]))
        .unwrap();

        assert_eq!(first.file_count, 2);
        assert_eq!(first.total_size_bytes, 4.0);
        assert_eq!(first.files[0].relative_path, "empty.dat");
        assert_eq!(first.source_files.len(), 2);
        assert_eq!(first.aggregate_hash, second.aggregate_hash);
        assert_eq!(first.files[0].size_bytes, 0.0);
    }

    #[test]
    fn consolidates_identical_logical_copies_after_hashing() {
        let temp = tempdir().unwrap();
        let first_path = temp.path().join("steamuser/save.dat");
        let second_path = temp.path().join("victor/save.dat");
        fs::create_dir_all(first_path.parent().unwrap()).unwrap();
        fs::create_dir_all(second_path.parent().unwrap()).unwrap();
        fs::write(&first_path, b"same-save").unwrap();
        fs::write(&second_path, b"same-save").unwrap();
        let discovered = |path: &std::path::Path| DiscoveredLocalSaveFile {
            raw_path: "<winAppData>/Game".into(),
            absolute_path: path.display().to_string(),
            relative_path: "save.dat".into(),
        };

        let mirrored = build_snapshot(input(vec![
            discovered(&first_path),
            discovered(&second_path),
        ]))
        .unwrap();
        let single = build_snapshot(input(vec![discovered(&first_path)])).unwrap();

        assert_eq!(mirrored.file_count, 1);
        assert_eq!(mirrored.source_files.len(), 1);
        assert_eq!(mirrored.total_size_bytes, 9.0);
        assert_eq!(mirrored.aggregate_hash, single.aggregate_hash);
    }

    #[test]
    fn reports_conflicting_logical_copies_and_preserves_hash_cache() {
        let temp = tempdir().unwrap();
        let first_path = temp.path().join("steamuser/save.dat");
        let second_path = temp.path().join("victor/save.dat");
        fs::create_dir_all(first_path.parent().unwrap()).unwrap();
        fs::create_dir_all(second_path.parent().unwrap()).unwrap();
        fs::write(&first_path, b"new-save").unwrap();
        fs::write(&second_path, b"old-save").unwrap();
        let discovered = |path: &std::path::Path| DiscoveredLocalSaveFile {
            raw_path: "<winAppData>/Game".into(),
            absolute_path: path.display().to_string(),
            relative_path: "save.dat".into(),
        };

        let outcome = build_snapshot_outcome(input(vec![
            discovered(&first_path),
            discovered(&second_path),
        ]))
        .unwrap();

        let LocalGameSnapshotBuildOutcome::LocalConflict {
            conflicts,
            hash_cache,
        } = outcome
        else {
            panic!("expected local conflict");
        };
        assert_eq!(conflicts.len(), 1);
        assert_eq!(conflicts[0].copies.len(), 2);
        assert_eq!(hash_cache.len(), 2);
        assert_eq!(
            build_snapshot(input(vec![
                discovered(&first_path),
                discovered(&second_path),
            ]))
            .err()
            .as_deref(),
            Some("cloud_save_conflicting_local_copies")
        );
    }
}
