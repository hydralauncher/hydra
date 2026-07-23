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

#[cfg(test)]
pub fn prepare_snapshot_files(
    files: &[DiscoveredLocalSaveFile],
) -> Result<HashMap<String, InitialFileMetadata>, LocalSnapshotGuardError> {
    if files.len() > MAX_SNAPSHOT_FILE_COUNT {
        return Err(LocalSnapshotGuardError::TooManyFiles);
    }

    let mut logical_paths = HashSet::with_capacity(files.len());
    for file in files {
        if !logical_paths.insert(&file.logical_file_id) {
            return Err(LocalSnapshotGuardError::DuplicateFile);
        }
    }

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

pub fn prepare_snapshot_files_best_effort(
    files: &[DiscoveredLocalSaveFile],
) -> Result<PreparedSnapshotFiles, LocalSnapshotGuardError> {
    if files.len() > MAX_SNAPSHOT_FILE_COUNT {
        return Err(LocalSnapshotGuardError::TooManyFiles);
    }
    let mut logical_paths = HashSet::with_capacity(files.len());
    for file in files {
        if !logical_paths.insert(&file.logical_file_id) {
            return Err(LocalSnapshotGuardError::DuplicateFile);
        }
    }

    let mut total_size_bytes = 0_u64;
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
        total_size_bytes = total_size_bytes
            .checked_add(metadata.len())
            .ok_or(LocalSnapshotGuardError::SnapshotTooLarge)?;
        if total_size_bytes > MAX_SNAPSHOT_TOTAL_SIZE_BYTES {
            return Err(LocalSnapshotGuardError::SnapshotTooLarge);
        }
        metadata_by_path.insert(
            file.absolute_path.clone(),
            InitialFileMetadata {
                size_bytes: metadata.len() as f64,
                last_modified_at: format_modified_at(modified),
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
        if total_size_bytes > MAX_SNAPSHOT_TOTAL_SIZE_BYTES {
            return Err(LocalSnapshotGuardError::SnapshotTooLarge);
        }

        if let Some(previous_size) = size_by_hash.insert(&file.content_hash, size_bytes) {
            if previous_size != size_bytes {
                return Err(LocalSnapshotGuardError::HashSizeMismatch);
            }
        }
    }

    Ok(total_size_bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn discovered(logical_file_id: &str, relative_path: &str) -> DiscoveredLocalSaveFile {
        use crate::cloud_save::identity::{
            LocalResolutionBindings, PortableBindings, PortableLocator, PortableStoreUserIdentity,
        };
        DiscoveredLocalSaveFile {
            logical_file_id: logical_file_id.into(),
            variant_id: "variant".into(),
            rule_id: "rule".into(),
            absolute_path: relative_path.into(),
            relative_path: relative_path.into(),
            locator: PortableLocator {
                version: 1,
                rule_id: "rule".into(),
                raw_rule: "<home>/game".into(),
                rule_source: "test".into(),
                root_kind: "home".into(),
                bindings: PortableBindings {
                    store: "steam".into(),
                    store_game_id: "1".into(),
                    store_user: PortableStoreUserIdentity {
                        kind: "opaque-folder".into(),
                        store: "steam".into(),
                        steam_id64: None,
                        account_id32: None,
                        concrete_folder_id: "__unbound__".into(),
                    },
                },
                target_semantics: "directory-tree".into(),
            },
            local_bindings: LocalResolutionBindings {
                environment_id: "environment".into(),
                root_id: "root".into(),
                prefix_generation_id: None,
                concrete_user_segment: "__unbound__".into(),
                concrete_path: relative_path.into(),
            },
            confidence: "inferred".into(),
            provenance: vec!["test".into()],
        }
    }

    #[test]
    fn validates_count_and_logical_identity() {
        let too_many = (0..=MAX_SNAPSHOT_FILE_COUNT)
            .map(|index| discovered("<home>/game", &index.to_string()))
            .collect::<Vec<_>>();
        assert_eq!(
            prepare_snapshot_files(&too_many),
            Err(LocalSnapshotGuardError::TooManyFiles)
        );

        let file = discovered("<home>/game", "save.dat");
        assert_eq!(
            prepare_snapshot_files(&[file.clone(), file]),
            Err(LocalSnapshotGuardError::DuplicateFile)
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
            ..discovered("large", "large.sav")
        };
        let file = DiscoveredLocalSaveFile {
            absolute_path: path.display().to_string(),
            ..file
        };

        assert_eq!(
            prepare_snapshot_files(&[file]),
            Err(LocalSnapshotGuardError::SnapshotTooLarge)
        );
    }
}
