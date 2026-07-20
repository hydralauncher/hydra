use std::path::{Path, PathBuf};

use globetter::MatchOptions;

use super::context::normalize_separators;
use super::resolve_path::resolve_path;
use super::types::{PathResolutionContext, ResolvedCloudSavePath};
use crate::cloud_save::save_scanner::scan_resolved_path;

fn is_glob_segment(segment: &str) -> bool {
    segment.contains(['*', '?', '[', '{'])
}

fn is_system_wine_profile(parent: &Path, name: &str) -> bool {
    let parent = normalize_separators(&parent.to_string_lossy()).to_ascii_lowercase();
    parent.ends_with("/users")
        && matches!(
            name.to_ascii_lowercase().as_str(),
            "public" | "default" | "default user" | "all users" | "defaultuser0"
        )
}

fn segment_matches(pattern: &str, value: &str, case_sensitive: bool) -> bool {
    globset::GlobBuilder::new(pattern)
        .case_insensitive(!case_sensitive)
        .literal_separator(true)
        .build()
        .map(|pattern| pattern.compile_matcher().is_match(value))
        .unwrap_or(false)
}

fn has_expected_type(path: &Path, directory: bool) -> bool {
    if directory {
        path.is_dir()
    } else {
        path.is_file()
    }
}

fn exact_windows_profile(path: &str) -> Option<PathBuf> {
    let lower = path.to_ascii_lowercase();
    let marker = "/drive_c/users/";
    let profile_start = lower.find(marker)? + marker.len();
    let profile_end = path[profile_start..]
        .find('/')
        .map(|offset| profile_start + offset)
        .unwrap_or(path.len());
    let profile = &path[profile_start..profile_end];

    (!profile.is_empty() && !is_glob_segment(profile)).then(|| PathBuf::from(&path[..profile_end]))
}

fn materialize_candidate(candidate: &ResolvedCloudSavePath, directory: bool) -> Vec<String> {
    let normalized = normalize_separators(&candidate.path);
    let absolute = normalized.starts_with('/');
    let segments = normalized
        .split('/')
        .filter(|segment| !segment.is_empty())
        .collect::<Vec<_>>();
    let Some(last_dynamic) = segments
        .iter()
        .rposition(|segment| is_glob_segment(segment))
    else {
        let path = Path::new(&normalized);
        let can_create = !path.exists()
            && exact_windows_profile(&normalized).is_none_or(|profile| profile.is_dir());
        return (can_create || has_expected_type(path, directory))
            .then_some(normalized)
            .into_iter()
            .collect();
    };
    let windows_drive = !absolute
        && segments
            .first()
            .is_some_and(|segment| segment.ends_with(':'));
    let mut paths = if absolute {
        vec![PathBuf::from("/")]
    } else if windows_drive {
        vec![PathBuf::from(format!("{}/", segments[0]))]
    } else {
        vec![PathBuf::new()]
    };
    let start = usize::from(windows_drive);

    for (index, segment) in segments.iter().enumerate().skip(start) {
        if index > last_dynamic {
            for path in &mut paths {
                path.push(segment);
            }
            continue;
        }
        if !is_glob_segment(segment) {
            for path in &mut paths {
                path.push(segment);
            }
            if index < last_dynamic {
                paths.retain(|path| path.is_dir());
            }
            continue;
        }

        let mut expanded = Vec::new();
        for parent in paths {
            let Ok(entries) = std::fs::read_dir(&parent) else {
                continue;
            };
            for entry in entries.filter_map(Result::ok) {
                let Ok(file_type) = entry.file_type() else {
                    continue;
                };
                if !file_type.is_dir() {
                    continue;
                }
                let name = entry.file_name().to_string_lossy().to_string();
                if !is_system_wine_profile(&parent, &name)
                    && segment_matches(segment, &name, candidate.case_sensitive)
                {
                    expanded.push(entry.path());
                }
            }
        }
        paths = expanded;
    }

    paths
        .into_iter()
        .map(|path| normalize_separators(&path.to_string_lossy()))
        .collect()
}

fn complete_matches(
    candidate: &ResolvedCloudSavePath,
    directory: bool,
) -> Result<Vec<String>, String> {
    let entries = globetter::glob_with(
        &candidate.path,
        MatchOptions {
            case_sensitive: candidate.case_sensitive,
            require_literal_separator: true,
            require_literal_leading_dot: false,
            follow_links: true,
        },
    )
    .map_err(|error| format!("cloud_save_invalid_glob: {error}"))?;

    entries
        .map(|entry| {
            entry
                .map_err(|error| format!("cloud_save_filesystem_error: {error}"))
                .map(|path| (has_expected_type(&path, directory), path))
        })
        .filter_map(|entry| match entry {
            Ok((true, path)) => Some(Ok(normalize_separators(&path.to_string_lossy()))),
            Ok((false, _)) => None,
            Err(error) => Some(Err(error)),
        })
        .collect()
}

fn first_sorted(mut paths: Vec<String>) -> Option<String> {
    paths.sort();
    paths.dedup();
    paths.into_iter().next()
}

pub fn resolve_restore_root(
    raw_path: &str,
    context: &PathResolutionContext,
    directory: bool,
    relative_paths: &[String],
) -> Result<String, String> {
    let resolved = resolve_path(raw_path, context);
    if resolved.paths.is_empty() {
        return Err(format!(
            "cloud_save_unresolved_restore_tokens: {}",
            resolved.unresolved_tokens.join(", ")
        ));
    }
    let mut complete_by_candidate = Vec::with_capacity(resolved.paths.len());
    for candidate in &resolved.paths {
        let mut complete = complete_matches(candidate, directory)?;
        complete.sort();
        complete.dedup();
        if directory {
            let requested_target = complete.iter().find(|root| {
                relative_paths.iter().any(|relative_path| {
                    Path::new(root)
                        .join(relative_path.replace('\\', "/"))
                        .is_file()
                })
            });
            if let Some(root) = requested_target {
                return Ok(root.clone());
            }
        } else if let Some(file) = first_sorted(complete.clone()) {
            return Ok(file);
        }
        complete_by_candidate.push(complete);
    }

    if directory {
        for candidate in &resolved.paths {
            let scanned_paths = scan_resolved_path(
                &candidate.path,
                candidate.case_sensitive,
                candidate.scan_root.as_deref(),
            )?;
            if let Some(scanned) = scanned_paths
                .into_iter()
                .find(|scanned| !scanned.files.is_empty())
            {
                return Ok(scanned.resolved_path);
            }
        }
    }

    for complete in complete_by_candidate {
        if let Some(existing) = first_sorted(complete) {
            return Ok(existing);
        }
    }

    for candidate in &resolved.paths {
        if let Some(materialized) = first_sorted(materialize_candidate(candidate, directory)) {
            return Ok(materialized);
        }
    }

    Err("cloud_save_restore_root_not_found".to_string())
}
