use std::collections::{BTreeMap, HashSet};
use std::path::Path;

use globetter::MatchOptions;
use walkdir::WalkDir;

use super::types::{ScannedCloudSaveFile, ScannedCloudSavePath};

pub fn normalize_scanned_path(value: &str) -> String {
    value.replace('\\', "/")
}

fn relative_path(root: &Path, path: &Path) -> Option<String> {
    path.strip_prefix(root)
        .ok()
        .map(|relative| normalize_scanned_path(&relative.to_string_lossy()))
        .filter(|relative| !relative.is_empty())
}

fn canonical_root(path: &Path) -> String {
    std::fs::canonicalize(path)
        .unwrap_or_else(|_| path.to_path_buf())
        .to_string_lossy()
        .replace('\\', "/")
}

fn glob_matches(pattern: &str, options: MatchOptions) -> Vec<std::path::PathBuf> {
    let direct_path = Path::new(pattern);
    if !pattern.contains(['*', '?', '[', '{']) && direct_path.exists() {
        return vec![direct_path.to_path_buf()];
    }
    globetter::glob_with(pattern, options)
        .ok()
        .into_iter()
        .flatten()
        .filter_map(Result::ok)
        .collect()
}

fn path_starts_with(path: &Path, root: &Path, case_sensitive: bool) -> bool {
    if case_sensitive {
        path.starts_with(root)
    } else {
        let path = normalize_scanned_path(&path.to_string_lossy()).to_lowercase();
        let root = normalize_scanned_path(&root.to_string_lossy()).to_lowercase();
        path == root || path.starts_with(&format!("{}/", root.trim_end_matches('/')))
    }
}

fn scan_directory(root: &Path) -> ScannedCloudSavePath {
    let mut files = Vec::new();
    let mut seen = HashSet::new();

    for entry in WalkDir::new(root)
        .max_depth(100)
        .follow_links(true)
        .into_iter()
        .filter_map(Result::ok)
    {
        if !entry.file_type().is_file() {
            continue;
        }
        let Some(relative_path) = relative_path(root, entry.path()) else {
            continue;
        };
        let absolute_path = normalize_scanned_path(&entry.path().to_string_lossy());
        if seen.insert(absolute_path.clone()) {
            files.push(ScannedCloudSaveFile {
                absolute_path,
                relative_path,
            });
        }
    }

    files.sort_by(|left, right| left.relative_path.cmp(&right.relative_path));
    ScannedCloudSavePath {
        resolved_path: canonical_root(root),
        files,
    }
}

pub fn scan_resolved_path(
    resolved_path: &str,
    case_sensitive: bool,
    scan_root_pattern: Option<&str>,
) -> Vec<ScannedCloudSavePath> {
    let options = MatchOptions {
        case_sensitive,
        require_literal_separator: true,
        require_literal_leading_dot: false,
        follow_links: true,
    };
    let matches = glob_matches(resolved_path, options);
    let scan_roots = scan_root_pattern
        .map(|pattern| glob_matches(pattern, options))
        .unwrap_or_default();
    let mut scanned_by_root = BTreeMap::<String, ScannedCloudSavePath>::new();

    for matched in matches {
        if matched.is_dir() {
            let scanned = scan_directory(&matched);
            scanned_by_root
                .entry(scanned.resolved_path.clone())
                .or_insert(scanned);
        } else if matched.is_file() {
            let root = scan_roots
                .iter()
                .filter(|root| root.is_dir() && path_starts_with(&matched, root, case_sensitive))
                .max_by_key(|root| root.components().count())
                .map(|root| root.as_path())
                .or_else(|| matched.parent());
            let Some(root) = root else {
                continue;
            };
            let canonical_root = canonical_root(root);
            let Some(relative_path) = relative_path(root, &matched) else {
                continue;
            };
            let file = ScannedCloudSaveFile {
                absolute_path: normalize_scanned_path(&matched.to_string_lossy()),
                relative_path,
            };
            let scanned = scanned_by_root
                .entry(canonical_root.clone())
                .or_insert_with(|| ScannedCloudSavePath {
                    resolved_path: canonical_root,
                    files: Vec::new(),
                });
            if !scanned
                .files
                .iter()
                .any(|existing| existing.absolute_path == file.absolute_path)
            {
                scanned.files.push(file);
            }
        }
    }

    for scanned in scanned_by_root.values_mut() {
        scanned
            .files
            .sort_by(|left, right| left.relative_path.cmp(&right.relative_path));
    }
    scanned_by_root.into_values().collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    #[test]
    fn supports_recursive_and_case_insensitive_globs() {
        let temp = tempdir().unwrap();
        let nested = temp.path().join("Profiles/One");
        fs::create_dir_all(&nested).unwrap();
        fs::write(nested.join("SAVE.DAT"), b"save").unwrap();
        let pattern = format!("{}/profiles/**/*.dat", temp.path().display());

        let scan_root = temp.path().display().to_string();
        let insensitive = scan_resolved_path(&pattern, false, Some(&scan_root));
        let sensitive = scan_resolved_path(&pattern, true, Some(&scan_root));

        assert_eq!(insensitive.iter().flat_map(|path| &path.files).count(), 1);
        assert_eq!(
            insensitive[0].files[0].relative_path.to_lowercase(),
            "profiles/one/save.dat"
        );
        assert!(sensitive.is_empty());
    }

    #[cfg(unix)]
    #[test]
    fn follows_directory_symlinks_like_ludusavi() {
        use std::os::unix::fs::symlink;

        let temp = tempdir().unwrap();
        let real = temp.path().join("real");
        fs::create_dir_all(&real).unwrap();
        fs::write(real.join("save.dat"), b"save").unwrap();
        let linked = temp.path().join("linked");
        symlink(&real, &linked).unwrap();

        let scanned = scan_resolved_path(&linked.display().to_string(), true, None);

        assert_eq!(scanned[0].files.len(), 1);
        assert_eq!(scanned[0].files[0].relative_path, "save.dat");
    }
}
