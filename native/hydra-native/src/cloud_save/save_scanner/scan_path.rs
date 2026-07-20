use std::collections::BTreeMap;
use std::io::ErrorKind;
use std::path::{Path, PathBuf};

use globetter::MatchOptions;
use walkdir::WalkDir;

use super::glob::{expand_braces, has_glob_pattern, normalize_path};
use super::types::{ScannedCloudSaveFile, ScannedCloudSavePath};

const MAX_SCAN_DEPTH: usize = 100;

fn canonical_path(path: &Path) -> Result<String, String> {
    std::fs::canonicalize(path)
        .map_err(|error| format!("cloud_save_filesystem_error: {error}"))
        .map(|path| path.to_string_lossy().replace('\\', "/"))
}

fn relative_path(root: &Path, path: &Path) -> Option<String> {
    path.strip_prefix(root)
        .ok()
        .map(|relative| normalize_path(&relative.to_string_lossy()))
        .filter(|relative| !relative.is_empty())
}

fn match_options(case_sensitive: bool) -> MatchOptions {
    MatchOptions {
        case_sensitive,
        require_literal_separator: true,
        require_literal_leading_dot: false,
        follow_links: true,
    }
}

fn glob_matches(pattern: &str, options: MatchOptions) -> Result<Vec<PathBuf>, String> {
    let direct_path = Path::new(pattern);
    if !has_glob_pattern(pattern) {
        match std::fs::metadata(direct_path) {
            Ok(_) => return Ok(vec![direct_path.to_path_buf()]),
            Err(error) if error.kind() == ErrorKind::NotFound => {}
            Err(error) => {
                return Err(format!("cloud_save_filesystem_error: {error}"));
            }
        }
    }

    let mut matches = Vec::new();
    for expanded in expand_braces(pattern)? {
        let entries = globetter::glob_with(&expanded, options)
            .map_err(|error| format!("cloud_save_invalid_glob: {error}"))?;
        for entry in entries {
            matches.push(entry.map_err(|error| format!("cloud_save_filesystem_error: {error}"))?);
        }
    }

    matches.sort_by_key(|path| normalize_path(&path.to_string_lossy()));
    matches.dedup();
    Ok(matches)
}

fn path_starts_with(path: &Path, root: &Path, case_sensitive: bool) -> bool {
    if case_sensitive {
        return path.starts_with(root);
    }

    let path = normalize_path(&path.to_string_lossy()).to_lowercase();
    let root = normalize_path(&root.to_string_lossy()).to_lowercase();
    path == root || path.starts_with(&format!("{}/", root.trim_end_matches('/')))
}

fn scan_directory(root: &Path) -> Result<ScannedCloudSavePath, String> {
    let mut files = Vec::new();

    for entry in WalkDir::new(root)
        .max_depth(MAX_SCAN_DEPTH)
        .follow_links(true)
    {
        let entry = entry.map_err(|error| format!("cloud_save_filesystem_error: {error}"))?;
        if !entry.file_type().is_file() {
            continue;
        }

        let Some(relative_path) = relative_path(root, entry.path()) else {
            continue;
        };
        files.push(ScannedCloudSaveFile {
            absolute_path: canonical_path(entry.path())?,
            relative_path,
        });
    }

    files.sort_by(|left, right| {
        left.relative_path
            .cmp(&right.relative_path)
            .then(left.absolute_path.cmp(&right.absolute_path))
    });
    files.dedup_by(|left, right| left.absolute_path == right.absolute_path);

    Ok(ScannedCloudSavePath {
        resolved_path: canonical_path(root)?,
        files,
    })
}

fn add_file(
    scanned_by_root: &mut BTreeMap<String, ScannedCloudSavePath>,
    root: &Path,
    file: &Path,
) -> Result<(), String> {
    let resolved_root = canonical_path(root)?;
    let relative_path = relative_path(root, file)
        .or_else(|| {
            file.file_name()
                .map(|name| normalize_path(&name.to_string_lossy()))
        })
        .unwrap_or_default();

    if relative_path.is_empty() {
        return Ok(());
    }

    scanned_by_root
        .entry(resolved_root.clone())
        .or_insert_with(|| ScannedCloudSavePath {
            resolved_path: resolved_root,
            files: Vec::new(),
        })
        .files
        .push(ScannedCloudSaveFile {
            absolute_path: canonical_path(file)?,
            relative_path,
        });

    Ok(())
}

pub fn scan_resolved_path(
    resolved_path: &str,
    case_sensitive: bool,
    scan_root_pattern: Option<&str>,
) -> Result<Vec<ScannedCloudSavePath>, String> {
    let options = match_options(case_sensitive);
    let matches = glob_matches(resolved_path, options)?;
    let scan_roots = scan_root_pattern
        .map(|pattern| glob_matches(pattern, options))
        .transpose()?
        .unwrap_or_default();
    let mut scanned_by_root = BTreeMap::<String, ScannedCloudSavePath>::new();

    for matched in matches {
        let metadata = std::fs::metadata(&matched)
            .map_err(|error| format!("cloud_save_filesystem_error: {error}"))?;

        if metadata.is_dir() {
            let scanned = scan_directory(&matched)?;
            scanned_by_root
                .entry(scanned.resolved_path.clone())
                .or_insert(scanned);
            continue;
        }

        if metadata.is_file() {
            let root = scan_roots
                .iter()
                .filter(|root| root.is_dir() && path_starts_with(&matched, root, case_sensitive))
                .max_by_key(|root| root.components().count())
                .map(PathBuf::as_path)
                .or_else(|| matched.parent());

            if let Some(root) = root {
                add_file(&mut scanned_by_root, root, &matched)?;
            }
        }
    }

    for scanned in scanned_by_root.values_mut() {
        scanned.files.sort_by(|left, right| {
            left.relative_path
                .cmp(&right.relative_path)
                .then(left.absolute_path.cmp(&right.absolute_path))
        });
        scanned
            .files
            .dedup_by(|left, right| left.absolute_path == right.absolute_path);
    }

    Ok(scanned_by_root.into_values().collect())
}

#[cfg(test)]
mod tests {
    use std::fs;

    use tempfile::tempdir;

    use super::*;

    #[test]
    fn scans_files_directories_recursive_globs_and_braces() {
        let temp = tempdir().unwrap();
        let nested = temp.path().join("Saves/Profile");
        fs::create_dir_all(&nested).unwrap();
        fs::write(nested.join("slot.SAV"), b"save").unwrap();
        fs::write(nested.join("meta.dat"), b"meta").unwrap();

        let exact =
            scan_resolved_path(&nested.join("slot.SAV").display().to_string(), true, None).unwrap();
        let directory = scan_resolved_path(&nested.display().to_string(), true, None).unwrap();
        let pattern = format!("{}/saves/**/*.{{sav,dat}}", temp.path().display());
        let insensitive =
            scan_resolved_path(&pattern, false, Some(&temp.path().display().to_string())).unwrap();
        let sensitive =
            scan_resolved_path(&pattern, true, Some(&temp.path().display().to_string())).unwrap();

        assert_eq!(exact[0].files.len(), 1);
        assert_eq!(directory[0].files.len(), 2);
        assert_eq!(insensitive.iter().flat_map(|path| &path.files).count(), 2);
        assert!(sensitive.is_empty());
    }

    #[test]
    fn missing_path_is_empty_and_invalid_pattern_fails() {
        let missing = scan_resolved_path("/missing/cloud-save/path", true, None).unwrap();
        let invalid = scan_resolved_path("/tmp/[invalid", true, None).unwrap_err();

        assert!(missing.is_empty());
        assert!(invalid.starts_with("cloud_save_invalid_glob:"));
    }

    #[test]
    fn scans_paths_with_literal_braces() {
        let temp = tempdir().unwrap();
        let directory = temp.path().join("{Deluxe}");
        fs::create_dir(&directory).unwrap();
        fs::write(directory.join("save.dat"), b"save").unwrap();
        let pattern = format!("{}/[{{]Deluxe[}}]/*.dat", temp.path().display());

        let scanned =
            scan_resolved_path(&pattern, true, Some(&temp.path().display().to_string())).unwrap();

        assert_eq!(scanned[0].files.len(), 1);
        assert_eq!(scanned[0].files[0].relative_path, "{Deluxe}/save.dat");
    }

    #[test]
    fn limits_recursive_scans_to_one_hundred_levels() {
        let temp = tempdir().unwrap();
        let mut current = temp.path().to_path_buf();

        for depth in 1..=101 {
            current.push(depth.to_string());
            fs::create_dir(&current).unwrap();
            fs::write(current.join(format!("{depth}.sav")), b"save").unwrap();
        }

        let scanned = scan_resolved_path(&temp.path().display().to_string(), true, None).unwrap();
        let files = &scanned[0].files;

        assert_eq!(files.len(), 99);
        assert!(files
            .iter()
            .any(|file| file.relative_path.ends_with("99.sav")));
        assert!(!files
            .iter()
            .any(|file| file.relative_path.ends_with("100.sav")));
    }

    #[cfg(unix)]
    #[test]
    fn follows_directory_symlinks() {
        use std::os::unix::fs::symlink;

        let temp = tempdir().unwrap();
        let real = temp.path().join("real");
        fs::create_dir_all(&real).unwrap();
        fs::write(real.join("save.dat"), b"save").unwrap();
        let linked = temp.path().join("linked");
        symlink(&real, &linked).unwrap();

        let scanned = scan_resolved_path(&linked.display().to_string(), true, None).unwrap();

        assert_eq!(scanned[0].files.len(), 1);
        assert_eq!(scanned[0].files[0].relative_path, "save.dat");
    }

    #[cfg(unix)]
    #[test]
    fn deduplicates_a_file_reached_through_a_symlink() {
        use std::os::unix::fs::symlink;

        let temp = tempdir().unwrap();
        let root = temp.path().join("root");
        let real = root.join("real");
        fs::create_dir_all(&real).unwrap();
        fs::write(real.join("save.dat"), b"save").unwrap();
        symlink(&real, root.join("linked")).unwrap();

        let scanned = scan_resolved_path(&root.display().to_string(), true, None).unwrap();

        assert_eq!(scanned[0].files.len(), 1);
    }
}
