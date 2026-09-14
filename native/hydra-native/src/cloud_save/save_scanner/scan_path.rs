use std::collections::BTreeMap;
use std::io::ErrorKind;
use std::path::{Component, Path, PathBuf};

use globetter::MatchOptions;
use globset::GlobBuilder;
use walkdir::WalkDir;

use super::glob::{expand_braces, has_glob_pattern, normalize_path};
use super::types::{ScannedCloudSaveFile, ScannedCloudSavePath};
use crate::cloud_save::identity::local_id;
use crate::cloud_save::path_resolution::{
    capture_store_user_with_components, StoreUserCapture, STORE_USER_CAPTURE_MARKER,
};
use crate::cloud_save::restore::is_cloud_save_artifact_path;

const MAX_SCAN_DEPTH: usize = 100;

fn filesystem_path(path: &Path) -> String {
    let path = path.to_string_lossy();

    #[cfg(windows)]
    {
        path.replace('\\', "/")
    }

    #[cfg(not(windows))]
    {
        path.into_owned()
    }
}

fn portable_relative_path(path: &Path) -> String {
    path.iter()
        .map(|component| component.to_string_lossy())
        .collect::<Vec<_>>()
        .join("/")
}

fn canonical_path(path: &Path) -> Result<String, String> {
    std::fs::canonicalize(path)
        .map_err(|error| format!("cloud_save_filesystem_error: {error}"))
        .map(|path| filesystem_path(&path))
}

fn relative_path(root: &Path, path: &Path) -> Option<String> {
    path.strip_prefix(root)
        .ok()
        .map(portable_relative_path)
        .filter(|relative| !relative.is_empty())
}

fn scanned_group_key(resolved_root: &str, store_user_id: Option<&str>) -> String {
    format!("{resolved_root}\0{}", store_user_id.unwrap_or_default())
}

fn scanned_candidate_id(
    resolved_path: &str,
    resolved_root: &str,
    store_user_id: Option<&str>,
) -> String {
    match store_user_id {
        Some(store_user_id) => local_id(&[resolved_path, resolved_root, store_user_id]),
        None => local_id(&[resolved_path, resolved_root]),
    }
}

fn match_options(case_sensitive: bool, follow_links: bool) -> MatchOptions {
    MatchOptions {
        case_sensitive,
        require_literal_separator: true,
        require_literal_leading_dot: false,
        follow_links,
    }
}

fn can_descend(path: &Path, follow_links: bool) -> Result<bool, String> {
    let metadata = std::fs::symlink_metadata(path)
        .map_err(|error| format!("cloud_save_filesystem_error: {error}"))?;
    if metadata.file_type().is_symlink() && !follow_links {
        return Ok(false);
    }

    std::fs::metadata(path)
        .map(|metadata| metadata.is_dir())
        .map_err(|error| format!("cloud_save_filesystem_error: {error}"))
}

fn component_matches(
    parent: &Path,
    pattern: &str,
    is_last: bool,
    follow_links: bool,
) -> Result<Vec<PathBuf>, String> {
    let has_pattern = pattern.contains(['*', '?', '[']);
    let exact = parent.join(pattern);
    if !has_pattern && exact.exists() {
        if is_last || can_descend(&exact, follow_links)? {
            return Ok(vec![exact]);
        }
        return Ok(Vec::new());
    }

    let matcher = has_pattern
        .then(|| {
            GlobBuilder::new(pattern)
                .case_insensitive(true)
                .literal_separator(true)
                .build()
                .map(|glob| glob.compile_matcher())
                .map_err(|error| format!("cloud_save_invalid_glob: {error}"))
        })
        .transpose()?;
    let folded_pattern = (!has_pattern).then(|| pattern.to_lowercase());
    let entries = match std::fs::read_dir(parent) {
        Ok(entries) => entries,
        Err(error) if matches!(error.kind(), ErrorKind::NotFound | ErrorKind::NotADirectory) => {
            return Ok(Vec::new());
        }
        Err(error) => return Err(format!("cloud_save_filesystem_error: {error}")),
    };
    let mut matches = Vec::new();

    for entry in entries {
        let entry = entry.map_err(|error| format!("cloud_save_filesystem_error: {error}"))?;
        let file_name = entry.file_name();
        let matches_pattern = if let Some(matcher) = &matcher {
            matcher.is_match(Path::new(&file_name))
        } else if let Some(folded_pattern) = &folded_pattern {
            file_name.to_string_lossy().to_lowercase() == *folded_pattern
        } else {
            false
        };
        if !matches_pattern {
            continue;
        }

        let path = entry.path();
        if is_last || can_descend(&path, follow_links)? {
            matches.push(path);
        }
    }

    Ok(matches)
}

fn recursive_components(
    roots: Vec<PathBuf>,
    is_last: bool,
    follow_links: bool,
) -> Result<Vec<PathBuf>, String> {
    let mut matches = Vec::new();
    for root in roots {
        if !is_last {
            matches.push(root.clone());
        }
        for entry in WalkDir::new(&root)
            .min_depth(1)
            .max_depth(MAX_SCAN_DEPTH)
            .follow_links(follow_links)
        {
            let entry = entry.map_err(|error| format!("cloud_save_filesystem_error: {error}"))?;
            if is_last || entry.file_type().is_dir() {
                matches.push(entry.into_path());
            }
        }
    }

    Ok(matches)
}

fn case_insensitive_matches(pattern: &str, follow_links: bool) -> Result<Vec<PathBuf>, String> {
    let mut anchor = PathBuf::new();
    let mut patterns = Vec::new();
    for component in Path::new(pattern).components() {
        match component {
            Component::Prefix(prefix) => anchor.push(prefix.as_os_str()),
            Component::RootDir => anchor.push(component.as_os_str()),
            Component::CurDir => {}
            Component::ParentDir => patterns.push("..".to_string()),
            Component::Normal(value) => patterns.push(value.to_string_lossy().into_owned()),
        }
    }
    if anchor.as_os_str().is_empty() {
        anchor.push(".");
    }

    let mut matches = vec![anchor];
    for (index, component) in patterns.iter().enumerate() {
        let is_last = index + 1 == patterns.len();
        matches = if component == "**" {
            recursive_components(matches, is_last, follow_links)?
        } else {
            let mut next = Vec::new();
            for parent in matches {
                next.extend(component_matches(
                    &parent,
                    component,
                    is_last,
                    follow_links,
                )?);
            }
            next
        };
        if matches.is_empty() {
            break;
        }
    }

    Ok(matches)
}

fn glob_matches(pattern: &str, options: MatchOptions) -> Result<Vec<PathBuf>, String> {
    let normalized_pattern = normalize_path(pattern);
    let pattern = normalized_pattern.as_str();
    let direct_path = Path::new(pattern);
    if direct_path.exists() {
        return Ok(vec![direct_path.to_path_buf()]);
    }
    if !has_glob_pattern(pattern) && options.case_sensitive {
        return match std::fs::metadata(direct_path) {
            Ok(_) => Ok(vec![direct_path.to_path_buf()]),
            Err(error) if error.kind() == ErrorKind::NotFound => Ok(Vec::new()),
            Err(error) => Err(format!("cloud_save_filesystem_error: {error}")),
        };
    }

    let mut matches = Vec::new();
    for expanded in expand_braces(pattern)? {
        if options.case_sensitive {
            let entries = globetter::glob_with(&expanded, options)
                .map_err(|error| format!("cloud_save_invalid_glob: {error}"))?;
            for entry in entries {
                matches
                    .push(entry.map_err(|error| format!("cloud_save_filesystem_error: {error}"))?);
            }
        } else {
            matches.extend(case_insensitive_matches(&expanded, options.follow_links)?);
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

fn shared_directory_scan_root(
    matched: &Path,
    scan_roots: &[PathBuf],
    case_sensitive: bool,
) -> Option<(PathBuf, String)> {
    let root = most_specific_scan_root(matched, scan_roots, case_sensitive)?;
    let canonical_root = std::fs::canonicalize(root).ok()?;
    let canonical_matched = std::fs::canonicalize(matched).ok()?;
    let relative = canonical_matched.strip_prefix(&canonical_root).ok()?;

    Some((canonical_root, portable_relative_path(relative)))
}

fn most_specific_scan_root<'a>(
    matched: &Path,
    scan_roots: &'a [PathBuf],
    case_sensitive: bool,
) -> Option<&'a Path> {
    scan_roots
        .iter()
        .filter(|root| root.is_dir() && path_starts_with(matched, root, case_sensitive))
        .max_by_key(|root| root.components().count())
        .map(PathBuf::as_path)
}

fn scan_directory(root: &Path, follow_links: bool) -> Result<ScannedCloudSavePath, String> {
    let mut files = Vec::new();
    let traversal_root = std::fs::canonicalize(root)
        .map_err(|error| format!("cloud_save_filesystem_error: {error}"))?;

    for entry in WalkDir::new(&traversal_root)
        .max_depth(MAX_SCAN_DEPTH)
        .follow_links(follow_links)
    {
        let entry = entry.map_err(|error| format!("cloud_save_filesystem_error: {error}"))?;
        if !entry.file_type().is_file() || is_cloud_save_artifact_path(entry.path()) {
            continue;
        }

        let Some(relative_path) = relative_path(&traversal_root, entry.path()) else {
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
        candidate_id: String::new(),
        resolved_path: canonical_path(&traversal_root)?,
        store_user_id: None,
        case_sensitive: true,
        files,
    })
}

fn add_file(
    scanned_by_root: &mut BTreeMap<String, ScannedCloudSavePath>,
    root: &Path,
    file: &Path,
    store_user_id: Option<&str>,
) -> Result<String, String> {
    if is_cloud_save_artifact_path(file) {
        return Ok(String::new());
    }
    let resolved_root = canonical_path(root)?;
    let relative_path = relative_path(root, file)
        .or_else(|| {
            file.file_name()
                .map(|name| name.to_string_lossy().into_owned())
        })
        .unwrap_or_default();

    if relative_path.is_empty() {
        return Ok(String::new());
    }

    let group_key = scanned_group_key(&resolved_root, store_user_id);
    scanned_by_root
        .entry(group_key.clone())
        .or_insert_with(|| ScannedCloudSavePath {
            candidate_id: String::new(),
            resolved_path: resolved_root,
            store_user_id: store_user_id.map(ToString::to_string),
            case_sensitive: true,
            files: Vec::new(),
        })
        .files
        .push(ScannedCloudSaveFile {
            absolute_path: canonical_path(file)?,
            relative_path,
        });

    Ok(group_key)
}

fn captured_components_are_directories(
    matched: &Path,
    capture: &StoreUserCapture,
    follow_links: bool,
    capture_may_be_leaf_file: bool,
) -> Result<bool, String> {
    for offset in &capture.component_offsets_from_end {
        let mut component_path = matched.to_path_buf();
        for _ in 0..*offset {
            if !component_path.pop() {
                return Ok(false);
            }
        }
        let link_metadata = std::fs::symlink_metadata(&component_path)
            .map_err(|error| format!("cloud_save_filesystem_error: {error}"))?;
        if link_metadata.file_type().is_symlink() && !follow_links {
            return Ok(false);
        }
        let metadata = std::fs::metadata(&component_path)
            .map_err(|error| format!("cloud_save_filesystem_error: {error}"))?;
        if *offset == 0 && capture_may_be_leaf_file && metadata.is_file() {
            continue;
        }
        if !metadata.is_dir() {
            return Ok(false);
        }
    }

    Ok(true)
}

fn captured_file_parent_patterns(
    resolved_path: &str,
    capture_template: &str,
) -> Option<(String, String)> {
    let resolved_parent = Path::new(resolved_path).parent()?;
    let template_parent = Path::new(capture_template).parent()?;
    let template_parent = normalize_path(&template_parent.to_string_lossy());

    Some((
        normalize_path(&resolved_parent.to_string_lossy()),
        template_parent,
    ))
}

fn add_empty_captured_file_roots(
    scanned_by_root: &mut BTreeMap<String, ScannedCloudSavePath>,
    resolved_path: &str,
    capture_template: &str,
    scan_roots: &[PathBuf],
    case_sensitive: bool,
    follow_links: bool,
) -> Result<(), String> {
    let Some((parent_pattern, parent_template)) =
        captured_file_parent_patterns(resolved_path, capture_template)
    else {
        return Ok(());
    };
    let options = match_options(case_sensitive, follow_links);

    for matched in glob_matches(&parent_pattern, options)? {
        if is_cloud_save_artifact_path(&matched) {
            continue;
        }
        let metadata = std::fs::metadata(&matched)
            .map_err(|error| format!("cloud_save_filesystem_error: {error}"))?;
        if !metadata.is_dir() {
            continue;
        }
        let concrete = normalize_path(&matched.to_string_lossy());
        let capture = if parent_template.contains(STORE_USER_CAPTURE_MARKER) {
            let Some(capture) =
                capture_store_user_with_components(&parent_template, &concrete, case_sensitive)
            else {
                continue;
            };
            if !captured_components_are_directories(&matched, &capture, follow_links, false)? {
                continue;
            }
            Some(capture.value)
        } else {
            None
        };

        let identity_root =
            most_specific_scan_root(&matched, scan_roots, case_sensitive).unwrap_or(&matched);
        let resolved_root = canonical_path(identity_root)?;
        let group_key = scanned_group_key(&resolved_root, capture.as_deref());
        let candidate_id = scanned_candidate_id(resolved_path, &resolved_root, capture.as_deref());
        scanned_by_root
            .entry(group_key)
            .and_modify(|existing| {
                existing.store_user_id = capture.clone();
                existing.case_sensitive = case_sensitive;
                existing.candidate_id = candidate_id.clone();
            })
            .or_insert_with(|| ScannedCloudSavePath {
                candidate_id,
                resolved_path: resolved_root,
                store_user_id: capture,
                case_sensitive,
                files: Vec::new(),
            });
    }

    Ok(())
}

pub fn scan_resolved_path_with_capture(
    resolved_path: &str,
    case_sensitive: bool,
    scan_root_pattern: Option<&str>,
    capture_template: Option<&str>,
    capture_may_be_leaf_file: bool,
    follow_links: bool,
) -> Result<Vec<ScannedCloudSavePath>, String> {
    let options = match_options(case_sensitive, follow_links);
    let matches = glob_matches(resolved_path, options)?;
    let scan_roots = scan_root_pattern
        .map(|pattern| glob_matches(pattern, options))
        .transpose()?
        .unwrap_or_default();
    let mut scanned_by_root = BTreeMap::<String, ScannedCloudSavePath>::new();

    for matched in matches {
        if is_cloud_save_artifact_path(&matched) {
            continue;
        }
        let concrete = normalize_path(&matched.to_string_lossy());
        let captured = match capture_template {
            Some(template) => {
                let Some(capture) =
                    capture_store_user_with_components(template, &concrete, case_sensitive)
                else {
                    continue;
                };
                if !captured_components_are_directories(
                    &matched,
                    &capture,
                    follow_links,
                    capture_may_be_leaf_file,
                )? {
                    continue;
                }
                Some(capture.value)
            }
            None => None,
        };
        let metadata = std::fs::metadata(&matched)
            .map_err(|error| format!("cloud_save_filesystem_error: {error}"))?;

        if metadata.is_dir() {
            let mut scanned = scan_directory(&matched, follow_links)?;
            scanned.store_user_id = captured;
            scanned.case_sensitive = case_sensitive;
            if let Some((shared_root, relative_root)) =
                shared_directory_scan_root(&matched, &scan_roots, case_sensitive)
            {
                if !relative_root.is_empty() {
                    for file in &mut scanned.files {
                        file.relative_path = format!("{relative_root}/{}", file.relative_path);
                    }
                }
                scanned.resolved_path = canonical_path(&shared_root)?;
            }
            scanned.candidate_id = scanned_candidate_id(
                resolved_path,
                &scanned.resolved_path,
                scanned.store_user_id.as_deref(),
            );
            let group_key =
                scanned_group_key(&scanned.resolved_path, scanned.store_user_id.as_deref());
            scanned_by_root
                .entry(group_key)
                .and_modify(|existing| existing.files.extend(scanned.files.iter().cloned()))
                .or_insert(scanned);
            continue;
        }

        if metadata.is_file() {
            let root = most_specific_scan_root(&matched, &scan_roots, case_sensitive)
                .or_else(|| matched.parent());

            if let Some(root) = root {
                let resolved_root = canonical_path(root)?;
                let group_key =
                    add_file(&mut scanned_by_root, root, &matched, captured.as_deref())?;
                if let Some(scanned) = scanned_by_root.get_mut(&group_key) {
                    scanned.store_user_id = captured.clone();
                    scanned.case_sensitive = case_sensitive;
                    scanned.candidate_id =
                        scanned_candidate_id(resolved_path, &resolved_root, captured.as_deref());
                }
            }
        }
    }

    if capture_may_be_leaf_file {
        if let Some(template) = capture_template {
            add_empty_captured_file_roots(
                &mut scanned_by_root,
                resolved_path,
                template,
                &scan_roots,
                case_sensitive,
                follow_links,
            )?;
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

pub fn scan_resolved_path(
    resolved_path: &str,
    case_sensitive: bool,
    scan_root_pattern: Option<&str>,
) -> Result<Vec<ScannedCloudSavePath>, String> {
    scan_resolved_path_with_capture(
        resolved_path,
        case_sensitive,
        scan_root_pattern,
        None,
        false,
        true,
    )
}

#[cfg(test)]
mod tests {
    use std::fs;

    use tempfile::tempdir;

    use super::*;

    fn filesystem_is_case_sensitive(root: &Path) -> bool {
        let exact = root.join("HydraCaseSensitivityProbe");
        let different_case = root.join("hydracasesensitivityprobe");
        fs::write(&exact, b"probe").unwrap();
        let is_case_sensitive = !different_case.exists();
        fs::remove_file(exact).unwrap();
        is_case_sensitive
    }

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
    fn resolves_a_literal_path_case_insensitively_as_a_fallback() {
        let temp = tempdir().unwrap();
        if !filesystem_is_case_sensitive(temp.path()) {
            return;
        }
        let directory = temp.path().join("Prefix").join("Users").join("SteamUser");
        fs::create_dir_all(&directory).unwrap();
        fs::write(directory.join("Save.DAT"), b"save").unwrap();

        let requested = temp
            .path()
            .join("prefix")
            .join("users")
            .join("steamuser")
            .join("save.dat")
            .display()
            .to_string();
        let insensitive = scan_resolved_path(&requested, false, None).unwrap();
        let sensitive = scan_resolved_path(&requested, true, None).unwrap();

        assert_eq!(insensitive[0].files.len(), 1);
        assert!(sensitive.is_empty());
    }

    #[test]
    fn resolves_literal_components_after_wildcards_case_insensitively() {
        let temp = tempdir().unwrap();
        if !filesystem_is_case_sensitive(temp.path()) {
            return;
        }
        let directory = temp
            .path()
            .join("Prefix")
            .join("drive_c")
            .join("users")
            .join("steamuser")
            .join("AppData")
            .join("Roaming")
            .join("Balatro");
        fs::create_dir_all(&directory).unwrap();
        fs::write(directory.join("Save.DAT"), b"save").unwrap();

        let requested = format!(
            "{}/prefix/drive_*/users/*/appdata/roaming/balatro/*.dat",
            temp.path().display()
        );
        let insensitive = scan_resolved_path(&requested, false, None).unwrap();
        let sensitive = scan_resolved_path(&requested, true, None).unwrap();

        assert_eq!(insensitive.iter().flat_map(|path| &path.files).count(), 1);
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
        let pattern = directory.display().to_string();

        let scanned =
            scan_resolved_path(&pattern, true, Some(&temp.path().display().to_string())).unwrap();

        assert_eq!(scanned[0].files.len(), 1);
        assert_eq!(scanned[0].files[0].relative_path, "{Deluxe}/save.dat");
    }

    #[test]
    fn ignores_only_exact_cloud_save_artifact_names() {
        let temp = tempdir().unwrap();
        let restore_artifact = format!(".hydra-restore-{}-stage", "a".repeat(64));
        let legacy_delete_artifact = ".hydra-delete-550e8400-e29b-41d4-a716-446655440000-backup";
        let delete_artifact = format!(".hydra-delete-{}-backup", "b".repeat(64));
        fs::write(temp.path().join(&restore_artifact), b"temporary").unwrap();
        fs::write(temp.path().join(legacy_delete_artifact), b"temporary").unwrap();
        fs::write(temp.path().join(&delete_artifact), b"temporary").unwrap();
        fs::write(temp.path().join(".hydra-restore-save.dat"), b"user").unwrap();
        fs::write(temp.path().join(".hydra-delete-save.dat"), b"user").unwrap();
        fs::write(temp.path().join("save.dat"), b"save").unwrap();

        let scanned = scan_resolved_path(&temp.path().display().to_string(), true, None).unwrap();
        let relative_paths = scanned[0]
            .files
            .iter()
            .map(|file| file.relative_path.as_str())
            .collect::<Vec<_>>();

        assert!(!relative_paths.contains(&restore_artifact.as_str()));
        assert!(!relative_paths.contains(&legacy_delete_artifact));
        assert!(!relative_paths.contains(&delete_artifact.as_str()));
        assert!(relative_paths.contains(&".hydra-restore-save.dat"));
        assert!(relative_paths.contains(&".hydra-delete-save.dat"));
        assert!(relative_paths.contains(&"save.dat"));
    }

    #[cfg(unix)]
    #[test]
    fn preserves_literal_backslashes_in_filesystem_paths() {
        let temp = tempdir().unwrap();
        let nested = temp.path().join("save");
        let backslash = temp.path().join(r"save\slot1.dat");
        let slash = nested.join("slot1.dat");
        fs::create_dir(&nested).unwrap();
        fs::write(&backslash, b"backslash").unwrap();
        fs::write(&slash, b"slash").unwrap();

        let scanned = scan_resolved_path(&temp.path().display().to_string(), true, None).unwrap();
        let files = &scanned[0].files;

        assert_eq!(files.len(), 2);
        assert!(files.iter().any(|file| {
            file.relative_path == r"save\slot1.dat"
                && file.absolute_path == backslash.display().to_string()
        }));
        assert!(files
            .iter()
            .any(|file| file.relative_path == "save/slot1.dat"));
    }

    #[test]
    fn preserves_every_directory_matched_by_one_glob() {
        let temp = tempfile::tempdir_in(".").unwrap();
        let profiles = temp.path().join("Profiles");
        for profile in ["Profile1", "Profile2"] {
            let directory = profiles.join(profile);
            fs::create_dir_all(&directory).unwrap();
            fs::write(directory.join("slot.dat"), profile.as_bytes()).unwrap();
        }

        let pattern = profiles.join("Profile*").display().to_string();
        let scan_root = profiles.display().to_string();
        assert_eq!(
            glob_matches(&pattern, match_options(true, true))
                .unwrap()
                .len(),
            2,
            "pattern: {pattern}"
        );
        let scanned = scan_resolved_path(&pattern, true, Some(&scan_root)).unwrap();

        assert_eq!(scanned.len(), 1);
        assert_eq!(
            scanned[0]
                .files
                .iter()
                .map(|file| file.relative_path.as_str())
                .collect::<Vec<_>>(),
            vec!["Profile1/slot.dat", "Profile2/slot.dat"]
        );
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
    fn can_refuse_symlinks_that_leave_a_custom_root() {
        use std::os::unix::fs::symlink;

        let temp = tempdir().unwrap();
        let root = temp.path().join("custom");
        let outside = temp.path().join("outside");
        fs::create_dir_all(&root).unwrap();
        fs::create_dir_all(&outside).unwrap();
        fs::write(outside.join("save.dat"), b"save").unwrap();
        symlink(&outside, root.join("linked")).unwrap();

        let scanned = scan_resolved_path_with_capture(
            &root.display().to_string(),
            true,
            None,
            None,
            false,
            false,
        )
        .unwrap();

        assert!(scanned[0].files.is_empty());
    }

    #[cfg(unix)]
    #[test]
    fn traverses_a_custom_root_that_is_itself_a_symlink() {
        use std::os::unix::fs::symlink;

        let temp = tempdir().unwrap();
        let real = temp.path().join("real");
        let linked = temp.path().join("linked");
        fs::create_dir_all(&real).unwrap();
        fs::write(real.join("save.dat"), b"save").unwrap();
        symlink(&real, &linked).unwrap();

        let scanned = scan_resolved_path_with_capture(
            &linked.display().to_string(),
            true,
            None,
            None,
            false,
            false,
        )
        .unwrap();

        assert_eq!(scanned[0].files.len(), 1);
        assert_eq!(scanned[0].files[0].relative_path, "save.dat");
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
