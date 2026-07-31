use std::collections::{HashMap, HashSet};
use std::fmt;
use std::fs;

use super::types::{BuiltLocalSaveFile, DiscoveredLocalSaveFile};
use crate::cloud_save::hashing::batch::format_modified_at;

pub const MAX_SNAPSHOT_FILE_COUNT: usize = 500;
pub const MAX_SNAPSHOT_TOTAL_SIZE_BYTES: u64 = 2_147_483_647;

#[derive(Debug, PartialEq)]
pub struct InitialFileMetadata {
    pub size_bytes: f64,
    pub last_modified_at: String,
}

pub struct PreparedSnapshotFiles {
    pub metadata_by_path: HashMap<String, InitialFileMetadata>,
    pub unavailable_paths: Vec<String>,
}

#[derive(Debug, PartialEq)]
pub enum LocalSnapshotGuardError {
    TooManyFiles,
    SnapshotTooLarge,
    DuplicateFile,
    HashSizeMismatch,
    #[cfg(test)]
    FileMetadataUnavailable,
}

impl fmt::Display for LocalSnapshotGuardError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::TooManyFiles => "cloud_save_too_many_files",
            Self::SnapshotTooLarge => "cloud_save_snapshot_too_large",
            Self::DuplicateFile => "cloud_save_duplicate_file",
            Self::HashSizeMismatch => "cloud_save_hash_size_mismatch",
            #[cfg(test)]
            Self::FileMetadataUnavailable => "cloud_save_file_metadata_unavailable",
        })
    }
}

fn validate_unique(files: &[DiscoveredLocalSaveFile]) -> Result<(), LocalSnapshotGuardError> {
    let mut identities = HashSet::with_capacity(files.len());
    for file in files {
        if !identities.insert((&file.variant_id, &file.raw_path, &file.relative_path)) {
            return Err(LocalSnapshotGuardError::DuplicateFile);
        }
    }
    Ok(())
}

#[cfg(test)]
pub fn prepare_snapshot_files(
    files: &[DiscoveredLocalSaveFile],
) -> Result<HashMap<String, InitialFileMetadata>, LocalSnapshotGuardError> {
    if files.len() > MAX_SNAPSHOT_FILE_COUNT {
        return Err(LocalSnapshotGuardError::TooManyFiles);
    }
    validate_unique(files)?;

    let mut total_size_bytes = 0_u64;
    let mut metadata_by_path = HashMap::with_capacity(files.len());
    for file in files {
        let metadata = fs::metadata(&file.absolute_path)
            .map_err(|_| LocalSnapshotGuardError::FileMetadataUnavailable)?;
        if !metadata.is_file() {
            return Err(LocalSnapshotGuardError::FileMetadataUnavailable);
        }
        total_size_bytes = total_size_bytes
            .checked_add(metadata.len())
            .ok_or(LocalSnapshotGuardError::SnapshotTooLarge)?;
        if total_size_bytes > MAX_SNAPSHOT_TOTAL_SIZE_BYTES {
            return Err(LocalSnapshotGuardError::SnapshotTooLarge);
        }
        let modified = metadata
            .modified()
            .map_err(|_| LocalSnapshotGuardError::FileMetadataUnavailable)?;
        let last_modified_at = format_modified_at(modified)
            .map_err(|_| LocalSnapshotGuardError::FileMetadataUnavailable)?;
        metadata_by_path.insert(
            file.absolute_path.clone(),
            InitialFileMetadata {
                size_bytes: metadata.len() as f64,
                last_modified_at,
            },
        );
    }
    Ok(metadata_by_path)
}

pub fn prepare_snapshot_files_best_effort(
    files: &[DiscoveredLocalSaveFile],
) -> Result<PreparedSnapshotFiles, LocalSnapshotGuardError> {
    validate_unique(files)?;

    let mut metadata_by_path = HashMap::with_capacity(files.len());
    let mut unavailable_paths = Vec::new();
    for file in files {
        let Ok(metadata) = fs::metadata(&file.absolute_path) else {
            unavailable_paths.push(file.absolute_path.clone());
            continue;
        };
        if !metadata.is_file() {
            unavailable_paths.push(file.absolute_path.clone());
            continue;
        }
        let Ok(modified) = metadata.modified() else {
            unavailable_paths.push(file.absolute_path.clone());
            continue;
        };
        let Ok(last_modified_at) = format_modified_at(modified) else {
            unavailable_paths.push(file.absolute_path.clone());
            continue;
        };
        metadata_by_path.insert(
            file.absolute_path.clone(),
            InitialFileMetadata {
                size_bytes: metadata.len() as f64,
                last_modified_at,
            },
        );
    }
    Ok(PreparedSnapshotFiles {
        metadata_by_path,
        unavailable_paths,
    })
}

pub fn validate_built_files(files: &[BuiltLocalSaveFile]) -> Result<u64, LocalSnapshotGuardError> {
    let mut total_size_bytes = 0_u64;
    let mut size_by_hash = HashMap::new();
    for file in files {
        let size_bytes = file.size_bytes as u64;
        total_size_bytes = total_size_bytes
            .checked_add(size_bytes)
            .ok_or(LocalSnapshotGuardError::SnapshotTooLarge)?;
        if let Some(previous_size) = size_by_hash.insert(&file.hash, size_bytes) {
            if previous_size != size_bytes {
                return Err(LocalSnapshotGuardError::HashSizeMismatch);
            }
        }
    }
    Ok(total_size_bytes)
}

#[cfg(test)]
mod tests {
    use std::fs::File;

    use super::*;
    use crate::cloud_save::identity::LocalResolutionBindings;

    fn discovered(variant_id: &str, relative_path: &str) -> DiscoveredLocalSaveFile {
        DiscoveredLocalSaveFile {
            variant_id: variant_id.into(),
            rule_id: "rule".into(),
            raw_path: "<home>/game".into(),
            absolute_path: relative_path.into(),
            relative_path: relative_path.into(),
            local_bindings: LocalResolutionBindings {
                environment_id: "environment".into(),
                root_id: "root".into(),
                prefix_generation_id: None,
                concrete_user_segment: "__default__".into(),
                concrete_path: relative_path.into(),
            },
            confidence: "inferred".into(),
            provenance: vec!["test".into()],
        }
    }

    #[test]
    fn validates_count_and_composite_identity() {
        let too_many = (0..=MAX_SNAPSHOT_FILE_COUNT)
            .map(|index| discovered("variant", &index.to_string()))
            .collect::<Vec<_>>();
        assert_eq!(
            prepare_snapshot_files(&too_many),
            Err(LocalSnapshotGuardError::TooManyFiles)
        );

        let file = discovered("variant", "save.dat");
        assert_eq!(
            prepare_snapshot_files(&[file.clone(), file]),
            Err(LocalSnapshotGuardError::DuplicateFile)
        );
        assert!(prepare_snapshot_files(&[
            discovered("one", "save.dat"),
            discovered("two", "save.dat")
        ])
        .is_err());
    }

    #[test]
    fn best_effort_discovery_keeps_files_above_the_upload_limit() {
        let temp = tempfile::tempdir().unwrap();
        let save = temp.path().join("large.sav");
        File::create(&save)
            .unwrap()
            .set_len(MAX_SNAPSHOT_TOTAL_SIZE_BYTES + 1)
            .unwrap();

        let prepared =
            prepare_snapshot_files_best_effort(&[discovered("variant", &save.to_string_lossy())])
                .unwrap();

        assert_eq!(
            prepared.metadata_by_path[&save.to_string_lossy().to_string()].size_bytes,
            (MAX_SNAPSHOT_TOTAL_SIZE_BYTES + 1) as f64
        );
        assert!(prepared.unavailable_paths.is_empty());
    }

    #[test]
    fn built_snapshot_can_be_analyzed_above_the_upload_limit() {
        let file = BuiltLocalSaveFile {
            variant_id: "variant".into(),
            rule_id: "rule".into(),
            raw_path: "<home>/game".into(),
            relative_path: "large.sav".into(),
            absolute_path: "/game/large.sav".into(),
            hash: "a".repeat(64),
            size_bytes: (MAX_SNAPSHOT_TOTAL_SIZE_BYTES + 1) as f64,
            last_modified_at: "2026-07-30T00:00:00.000Z".into(),
            local_bindings: LocalResolutionBindings {
                environment_id: "environment".into(),
                root_id: "root".into(),
                prefix_generation_id: None,
                concrete_user_segment: "__default__".into(),
                concrete_path: "/game".into(),
            },
            confidence: "inferred".into(),
            provenance: vec!["test".into()],
        };

        assert_eq!(
            validate_built_files(&[file]).unwrap(),
            MAX_SNAPSHOT_TOTAL_SIZE_BYTES + 1
        );
    }
}
