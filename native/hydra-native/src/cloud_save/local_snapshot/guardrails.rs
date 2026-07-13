use std::collections::{HashMap, HashSet};
use std::fmt;
use std::fs;

use super::build_file::format_modified_at;
use super::types::{DiscoveredLocalSaveFile, LocalSaveSnapshotFile};

pub const MAX_SNAPSHOT_FILE_COUNT: usize = 500;
pub const MAX_SNAPSHOT_TOTAL_SIZE_BYTES: u64 = 2_147_483_647;

#[derive(Debug, PartialEq)]
pub enum LocalSnapshotGuardError {
    TooManyFiles,
    SnapshotTooLarge,
    EmptyFile,
    DuplicateFile,
    HashSizeMismatch,
    FileChangedDuringSnapshot,
    FileMetadataUnavailable,
}

impl fmt::Display for LocalSnapshotGuardError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        let code = match self {
            Self::TooManyFiles => "cloud_save_too_many_files",
            Self::SnapshotTooLarge => "cloud_save_snapshot_too_large",
            Self::EmptyFile => "cloud_save_empty_file",
            Self::DuplicateFile => "cloud_save_duplicate_file",
            Self::HashSizeMismatch => "cloud_save_hash_size_mismatch",
            Self::FileChangedDuringSnapshot => "cloud_save_file_changed_during_snapshot",
            Self::FileMetadataUnavailable => "cloud_save_file_metadata_unavailable",
        };

        formatter.write_str(code)
    }
}

pub struct PreparedLocalSaveFile {
    pub file: DiscoveredLocalSaveFile,
    pub size_bytes: u64,
    pub last_modified_at: String,
}

fn validate_file_count(file_count: usize) -> Result<(), LocalSnapshotGuardError> {
    if file_count > MAX_SNAPSHOT_FILE_COUNT {
        return Err(LocalSnapshotGuardError::TooManyFiles);
    }

    Ok(())
}

fn validate_total_size(total_size: u64) -> Result<(), LocalSnapshotGuardError> {
    if total_size > MAX_SNAPSHOT_TOTAL_SIZE_BYTES {
        return Err(LocalSnapshotGuardError::SnapshotTooLarge);
    }

    Ok(())
}

pub fn prepare_files(
    files: Vec<DiscoveredLocalSaveFile>,
) -> Result<Vec<PreparedLocalSaveFile>, LocalSnapshotGuardError> {
    validate_file_count(files.len())?;

    let mut seen_paths = HashSet::new();
    let mut total_size = 0_u64;
    let mut prepared = Vec::with_capacity(files.len());

    for file in files {
        if !seen_paths.insert((file.raw_path.clone(), file.relative_path.clone())) {
            return Err(LocalSnapshotGuardError::DuplicateFile);
        }

        let metadata = fs::metadata(&file.absolute_path)
            .map_err(|_| LocalSnapshotGuardError::FileMetadataUnavailable)?;
        let size_bytes = metadata.len();
        if size_bytes == 0 {
            return Err(LocalSnapshotGuardError::EmptyFile);
        }

        total_size = total_size
            .checked_add(size_bytes)
            .ok_or(LocalSnapshotGuardError::SnapshotTooLarge)?;
        validate_total_size(total_size)?;
        let modified = metadata
            .modified()
            .map_err(|_| LocalSnapshotGuardError::FileMetadataUnavailable)?;

        prepared.push(PreparedLocalSaveFile {
            file,
            size_bytes,
            last_modified_at: format_modified_at(modified),
        });
    }

    Ok(prepared)
}

pub fn validate_built_files(
    files: &[LocalSaveSnapshotFile],
) -> Result<(), LocalSnapshotGuardError> {
    let mut size_by_hash = HashMap::new();

    for file in files {
        if let Some(existing_size) = size_by_hash.insert(file.hash.as_str(), file.size_bytes) {
            if existing_size != file.size_bytes {
                return Err(LocalSnapshotGuardError::HashSizeMismatch);
            }
        }

        let metadata = fs::metadata(&file.absolute_path)
            .map_err(|_| LocalSnapshotGuardError::FileChangedDuringSnapshot)?;
        let modified = metadata
            .modified()
            .map_err(|_| LocalSnapshotGuardError::FileChangedDuringSnapshot)?;

        if metadata.len() as f64 != file.size_bytes
            || format_modified_at(modified) != file.last_modified_at
        {
            return Err(LocalSnapshotGuardError::FileChangedDuringSnapshot);
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    use tempfile::tempdir;

    #[test]
    fn accepts_exact_limits_and_rejects_excess() {
        assert_eq!(validate_file_count(MAX_SNAPSHOT_FILE_COUNT), Ok(()));
        assert_eq!(
            validate_file_count(MAX_SNAPSHOT_FILE_COUNT + 1),
            Err(LocalSnapshotGuardError::TooManyFiles)
        );
        assert_eq!(validate_total_size(MAX_SNAPSHOT_TOTAL_SIZE_BYTES), Ok(()));
        assert_eq!(
            validate_total_size(MAX_SNAPSHOT_TOTAL_SIZE_BYTES + 1),
            Err(LocalSnapshotGuardError::SnapshotTooLarge)
        );
    }

    #[test]
    fn accepts_empty_snapshot_and_rejects_empty_file() {
        assert!(prepare_files(vec![]).unwrap().is_empty());

        let temp = tempdir().unwrap();
        let path = temp.path().join("empty.sav");
        fs::write(&path, []).unwrap();

        assert_eq!(
            prepare_files(vec![discovered_file(&path, "empty.sav")])
                .err()
                .unwrap(),
            LocalSnapshotGuardError::EmptyFile
        );
    }

    #[test]
    fn rejects_duplicate_logical_path() {
        let temp = tempdir().unwrap();
        let path = temp.path().join("save.dat");
        fs::write(&path, b"save").unwrap();
        let file = discovered_file(&path, "save.dat");

        assert_eq!(
            prepare_files(vec![file.clone(), file]).err().unwrap(),
            LocalSnapshotGuardError::DuplicateFile
        );
    }

    #[test]
    fn rejects_hash_size_mismatch_and_changed_metadata() {
        let temp = tempdir().unwrap();
        let first_path = temp.path().join("first.dat");
        let second_path = temp.path().join("second.dat");
        fs::write(&first_path, b"first").unwrap();
        fs::write(&second_path, b"second").unwrap();
        let mut first = snapshot_file(&first_path, "first.dat", "a", 5.0);
        let second = snapshot_file(&second_path, "second.dat", "a", 6.0);

        assert_eq!(
            validate_built_files(&[first.clone(), second]).unwrap_err(),
            LocalSnapshotGuardError::HashSizeMismatch
        );

        first.size_bytes = 4.0;
        assert_eq!(
            validate_built_files(&[first]).unwrap_err(),
            LocalSnapshotGuardError::FileChangedDuringSnapshot
        );

        let mut changed_mtime = snapshot_file(&first_path, "first.dat", "b", 5.0);
        changed_mtime.last_modified_at = "1970-01-01T00:00:00.000000000Z".into();
        assert_eq!(
            validate_built_files(&[changed_mtime]).unwrap_err(),
            LocalSnapshotGuardError::FileChangedDuringSnapshot
        );
    }

    fn discovered_file(path: &std::path::Path, relative_path: &str) -> DiscoveredLocalSaveFile {
        DiscoveredLocalSaveFile {
            raw_path: "<root>".into(),
            absolute_path: path.display().to_string(),
            root_path: path.parent().unwrap().display().to_string(),
            relative_path: relative_path.into(),
            source: "test".into(),
        }
    }

    fn snapshot_file(
        path: &std::path::Path,
        relative_path: &str,
        hash: &str,
        size_bytes: f64,
    ) -> LocalSaveSnapshotFile {
        let modified = fs::metadata(path).unwrap().modified().unwrap();
        LocalSaveSnapshotFile {
            raw_path: "<root>".into(),
            absolute_path: path.display().to_string(),
            root_path: path.parent().unwrap().display().to_string(),
            relative_path: relative_path.into(),
            source: "test".into(),
            hash: hash.into(),
            size_bytes,
            last_modified_at: format_modified_at(modified),
        }
    }
}
