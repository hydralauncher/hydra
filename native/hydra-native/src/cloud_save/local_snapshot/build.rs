use std::collections::HashMap;

use crate::cloud_save::hashing::types::HashedLocalFile;
use crate::cloud_save::hashing::{
    batch::hash_files, build_aggregate_hash, BuildSnapshotAggregateHashInput,
    SnapshotAggregateHashFile,
};

use super::guardrails::{prepare_snapshot_files, validate_built_files, validate_hashed_files};
use super::types::{
    BuildLocalGameSnapshotInput, BuiltLocalSaveFile, LocalGameSnapshotFile,
    LocalGameSnapshotSourceFile, LocalGameSnapshotWithHash,
};

pub fn build_snapshot(
    input: BuildLocalGameSnapshotInput,
) -> Result<LocalGameSnapshotWithHash, String> {
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
    let mut built_files = input
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
    let total_size_bytes = validate_built_files(&built_files).map_err(|error| error.to_string())?;

    built_files.sort_by(|left, right| {
        left.raw_path
            .cmp(&right.raw_path)
            .then(left.relative_path.cmp(&right.relative_path))
            .then(left.absolute_path.cmp(&right.absolute_path))
    });

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

    Ok(LocalGameSnapshotWithHash {
        game_id: input.game_id,
        manifest_key: input.manifest_key,
        file_count: files.len() as u32,
        total_size_bytes: total_size_bytes as f64,
        files,
        aggregate_hash,
        source_files,
        hash_cache: hashed.hash_cache,
    })
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
}
