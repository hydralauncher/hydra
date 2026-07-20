use std::collections::{HashMap, HashSet};
use std::fmt;
use std::fs;

use crate::cloud_save::hashing::batch::format_modified_at;
use crate::cloud_save::hashing::types::HashedLocalFile;

use super::types::{BuiltLocalSaveFile, DiscoveredLocalSaveFile};

pub const MAX_SNAPSHOT_FILE_COUNT: usize = 500;
pub const MAX_SNAPSHOT_TOTAL_SIZE_BYTES: u64 = 2_147_483_647;
pub const MAX_LOCAL_COPIES_PER_LOGICAL_FILE: usize = 32;

#[derive(Debug, PartialEq)]
pub struct InitialFileMetadata {
    size_bytes: f64,
    last_modified_at: String,
}

#[derive(Debug, PartialEq)]
pub enum LocalSnapshotGuardError {
    TooManyFiles,
    TooManyFileCopies,
    SnapshotTooLarge,
    DuplicateFile,
    HashSizeMismatch,
    FileChangedDuringSnapshot,
    FileMetadataUnavailable,
}

impl fmt::Display for LocalSnapshotGuardError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::TooManyFiles => "cloud_save_too_many_files",
            Self::TooManyFileCopies => "cloud_save_too_many_file_copies",
            Self::SnapshotTooLarge => "cloud_save_snapshot_too_large",
            Self::DuplicateFile => "cloud_save_duplicate_file",
            Self::HashSizeMismatch => "cloud_save_hash_size_mismatch",
            Self::FileChangedDuringSnapshot => "cloud_save_file_changed_during_snapshot",
            Self::FileMetadataUnavailable => "cloud_save_file_metadata_unavailable",
        })
    }
}

pub fn prepare_snapshot_files(
    files: &[DiscoveredLocalSaveFile],
) -> Result<HashMap<String, InitialFileMetadata>, LocalSnapshotGuardError> {
    let mut copies_by_logical_path = HashMap::new();
    for file in files {
        let copies = copies_by_logical_path
            .entry((&file.raw_path, &file.relative_path))
            .or_insert(0_usize);
        *copies += 1;
        if *copies > MAX_LOCAL_COPIES_PER_LOGICAL_FILE {
            return Err(LocalSnapshotGuardError::TooManyFileCopies);
        }
    }
    if copies_by_logical_path.len() > MAX_SNAPSHOT_FILE_COUNT {
        return Err(LocalSnapshotGuardError::TooManyFiles);
    }

    let mut metadata_by_path = HashMap::with_capacity(files.len());
    for file in files {
        let metadata = fs::metadata(&file.absolute_path)
            .map_err(|_| LocalSnapshotGuardError::FileMetadataUnavailable)?;
        if !metadata.is_file() {
            return Err(LocalSnapshotGuardError::FileMetadataUnavailable);
        }

        if metadata.len() > MAX_SNAPSHOT_TOTAL_SIZE_BYTES {
            return Err(LocalSnapshotGuardError::SnapshotTooLarge);
        }

        let modified = metadata
            .modified()
            .map_err(|_| LocalSnapshotGuardError::FileMetadataUnavailable)?;
        metadata_by_path.insert(
            file.absolute_path.clone(),
            InitialFileMetadata {
                size_bytes: metadata.len() as f64,
                last_modified_at: format_modified_at(modified),
            },
        );
    }

    Ok(metadata_by_path)
}

pub fn validate_hashed_files(
    files: &[HashedLocalFile],
    initial_metadata: &HashMap<String, InitialFileMetadata>,
) -> Result<(), LocalSnapshotGuardError> {
    for file in files {
        let initial = initial_metadata
            .get(&file.absolute_path)
            .ok_or(LocalSnapshotGuardError::FileChangedDuringSnapshot)?;

        if initial.size_bytes != file.size_bytes
            || initial.last_modified_at != file.last_modified_at
        {
            return Err(LocalSnapshotGuardError::FileChangedDuringSnapshot);
        }
    }

    Ok(())
}

pub fn validate_built_files(files: &[BuiltLocalSaveFile]) -> Result<u64, LocalSnapshotGuardError> {
    let mut total_size_bytes = 0_u64;
    let mut size_by_hash = HashMap::new();
    let mut logical_paths = HashSet::with_capacity(files.len());

    for file in files {
        if !logical_paths.insert((&file.raw_path, &file.relative_path)) {
            return Err(LocalSnapshotGuardError::DuplicateFile);
        }
        let size_bytes = file.size_bytes as u64;
        total_size_bytes = total_size_bytes
            .checked_add(size_bytes)
            .ok_or(LocalSnapshotGuardError::SnapshotTooLarge)?;
        if total_size_bytes > MAX_SNAPSHOT_TOTAL_SIZE_BYTES {
            return Err(LocalSnapshotGuardError::SnapshotTooLarge);
        }

        if let Some(previous_size) = size_by_hash.insert(&file.hash, size_bytes) {
            if previous_size != size_bytes {
                return Err(LocalSnapshotGuardError::HashSizeMismatch);
            }
        }
    }

    for file in files {
        let metadata = fs::metadata(&file.absolute_path)
            .map_err(|_| LocalSnapshotGuardError::FileChangedDuringSnapshot)?;
        let modified = metadata
            .modified()
            .map_err(|_| LocalSnapshotGuardError::FileChangedDuringSnapshot)?;

        if !metadata.is_file()
            || metadata.len() as f64 != file.size_bytes
            || format_modified_at(modified) != file.last_modified_at
        {
            return Err(LocalSnapshotGuardError::FileChangedDuringSnapshot);
        }
    }

    Ok(total_size_bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn discovered(raw_path: &str, relative_path: &str) -> DiscoveredLocalSaveFile {
        DiscoveredLocalSaveFile {
            raw_path: raw_path.into(),
            absolute_path: relative_path.into(),
            relative_path: relative_path.into(),
        }
    }

    #[test]
    fn validates_logical_count_and_copy_count() {
        let too_many = (0..=MAX_SNAPSHOT_FILE_COUNT)
            .map(|index| discovered("<home>/game", &index.to_string()))
            .collect::<Vec<_>>();
        assert_eq!(
            prepare_snapshot_files(&too_many),
            Err(LocalSnapshotGuardError::TooManyFiles)
        );

        let copies = (0..=MAX_LOCAL_COPIES_PER_LOGICAL_FILE)
            .map(|index| DiscoveredLocalSaveFile {
                raw_path: "<home>/game".into(),
                absolute_path: format!("copy-{index}"),
                relative_path: "save.dat".into(),
            })
            .collect::<Vec<_>>();
        assert_eq!(
            prepare_snapshot_files(&copies),
            Err(LocalSnapshotGuardError::TooManyFileCopies)
        );
        assert!(prepare_snapshot_files(&[]).is_ok());
    }

    #[test]
    fn rejects_oversized_snapshot_before_hashing() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("large.sav");
        fs::File::create(&path)
            .unwrap()
            .set_len(MAX_SNAPSHOT_TOTAL_SIZE_BYTES + 1)
            .unwrap();
        let file = DiscoveredLocalSaveFile {
            raw_path: "<home>/game".into(),
            absolute_path: path.display().to_string(),
            relative_path: "large.sav".into(),
        };

        assert_eq!(
            prepare_snapshot_files(&[file]),
            Err(LocalSnapshotGuardError::SnapshotTooLarge)
        );
    }
}
