use std::collections::HashSet;
use std::path::{Path, PathBuf};

use globetter::MatchOptions;

use super::context::normalize_separators;
use super::resolve_path::resolve_path;
use super::types::{PathResolutionContext, ResolvedCloudSavePath};

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
        return (!path.exists() || has_expected_type(path, directory))
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

pub fn resolve_restore_root(
    raw_path: &str,
    context: &PathResolutionContext,
    directory: bool,
) -> Result<String, String> {
    let resolved = resolve_path(raw_path, context);
    if resolved.paths.is_empty() {
        return Err(format!(
            "cloud_save_unresolved_restore_tokens: {}",
            resolved.unresolved_tokens.join(", ")
        ));
    }
    let candidates = if context.wine_prefix_path.is_some()
        && resolved.paths.iter().any(|candidate| candidate.dynamic)
    {
        resolved
            .paths
            .iter()
            .filter(|candidate| candidate.dynamic)
            .collect::<Vec<_>>()
    } else {
        resolved.paths.iter().collect::<Vec<_>>()
    };
    let complete = candidates
        .iter()
        .map(|candidate| complete_matches(candidate, directory))
        .collect::<Result<Vec<_>, _>>()?
        .into_iter()
        .flatten()
        .collect::<HashSet<_>>();

    match complete.len() {
        1 => return Ok(complete.into_iter().next().unwrap()),
        2.. => return Err("cloud_save_ambiguous_restore_roots".to_string()),
        _ => {}
    }

    for candidate in candidates {
        let materialized = materialize_candidate(candidate, directory)
            .into_iter()
            .collect::<HashSet<_>>();
        match materialized.len() {
            1 => return Ok(materialized.into_iter().next().unwrap()),
            2.. => return Err("cloud_save_ambiguous_restore_roots".to_string()),
            _ => {}
        }
    }

    Err("cloud_save_restore_root_not_found".to_string())
}
