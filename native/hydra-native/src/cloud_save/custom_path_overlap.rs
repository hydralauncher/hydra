use globset::GlobBuilder;
use napi_derive::napi;

use super::manifest::types::CloudSaveRule;
use super::path_resolution::{
    resolve_save_rules, ResolveSaveRulesInput, ResolvedCloudSavePath, ResolvedCloudSaveRule,
};

const MAPPED_LOCATION_OVERLAP: &str = "mapped-location-overlap";
const CUSTOM_LOCATION_OVERLAP: &str = "custom-location-overlap";
const REMOTE_TARGET_MAPPED: &str = "remote-target-mapped";

#[napi(object)]
pub struct CheckCloudSaveCustomPathOverlapInput {
    pub shop: String,
    pub object_id: String,
    pub platform: String,
    pub home_dir: String,
    pub documents_dir: Option<String>,
    pub app_data_dir: Option<String>,
    pub executable_path: Option<String>,
    pub wine_prefix_path: Option<String>,
    pub steam_path: Option<String>,
    pub rules: Vec<CloudSaveRule>,
    pub selected_path: String,
    pub remote_relative_paths: Vec<String>,
}

#[napi(object)]
pub struct CheckCloudSaveCustomPathOverlapResult {
    pub has_overlap: bool,
    pub reason: Option<String>,
    pub conflicting_raw_path: Option<String>,
}

fn no_overlap() -> CheckCloudSaveCustomPathOverlapResult {
    CheckCloudSaveCustomPathOverlapResult {
        has_overlap: false,
        reason: None,
        conflicting_raw_path: None,
    }
}

fn overlap(reason: &str, raw_path: String) -> CheckCloudSaveCustomPathOverlapResult {
    CheckCloudSaveCustomPathOverlapResult {
        has_overlap: true,
        reason: Some(reason.to_string()),
        conflicting_raw_path: Some(raw_path),
    }
}

fn normalize_path(value: &str) -> String {
    let normalized = value.replace('\\', "/");
    if normalized == "/" || is_windows_root(&normalized) {
        normalized
    } else {
        normalized.trim_end_matches('/').to_string()
    }
}

fn is_windows_root(value: &str) -> bool {
    value.len() == 3
        && value.as_bytes()[1] == b':'
        && value.as_bytes()[2] == b'/'
        && value.as_bytes()[0].is_ascii_alphabetic()
}

fn path_key(value: &str, case_sensitive: bool) -> String {
    let normalized = normalize_path(value);
    if case_sensitive {
        normalized
    } else {
        normalized.to_lowercase()
    }
}

fn is_same_or_child(candidate: &str, root: &str, case_sensitive: bool) -> bool {
    let candidate = path_key(candidate, case_sensitive);
    let root = path_key(root, case_sensitive);
    candidate == root || candidate.starts_with(&format!("{}/", root.trim_end_matches('/')))
}

fn parent_path(value: &str) -> Option<String> {
    let normalized = normalize_path(value);
    if normalized == "/" || is_windows_root(&normalized) {
        return None;
    }

    let separator = normalized.rfind('/')?;
    if separator == 0 {
        return Some("/".to_string());
    }
    if separator == 2 && normalized.as_bytes()[1] == b':' {
        return Some(normalized[..=separator].to_string());
    }
    Some(normalized[..separator].to_string())
}

fn path_and_ancestors(value: &str) -> Vec<String> {
    let mut paths = Vec::new();
    let mut current = normalize_path(value);
    loop {
        paths.push(current.clone());
        let Some(parent) = parent_path(&current) else {
            break;
        };
        current = parent;
    }
    paths
}

fn pattern_matches(pattern: &str, value: &str, case_sensitive: bool) -> bool {
    GlobBuilder::new(&normalize_path(pattern))
        .case_insensitive(!case_sensitive)
        .literal_separator(true)
        .build()
        .map(|glob| glob.compile_matcher().is_match(normalize_path(value)))
        .unwrap_or(false)
}

fn pattern_covers_path(selected_path: &str, candidate: &ResolvedCloudSavePath) -> bool {
    path_and_ancestors(selected_path)
        .iter()
        .any(|ancestor| pattern_matches(&candidate.path, ancestor, candidate.case_sensitive))
}

fn pattern_can_match_in_subtree(pattern: &str, selected_path: &str, case_sensitive: bool) -> bool {
    if GlobBuilder::new(&normalize_path(pattern))
        .case_insensitive(!case_sensitive)
        .literal_separator(true)
        .build()
        .is_err()
    {
        return false;
    }

    let normalized_pattern = normalize_path(pattern);
    let normalized_selected = normalize_path(selected_path);
    let pattern_segments = normalized_pattern
        .split('/')
        .filter(|segment| !segment.is_empty())
        .collect::<Vec<_>>();
    let selected_segments = normalized_selected
        .split('/')
        .filter(|segment| !segment.is_empty())
        .collect::<Vec<_>>();
    let mut visited = std::collections::HashSet::new();

    fn prefix_is_compatible(
        pattern_segments: &[&str],
        selected_segments: &[&str],
        pattern_index: usize,
        selected_index: usize,
        case_sensitive: bool,
        visited: &mut std::collections::HashSet<(usize, usize)>,
    ) -> bool {
        if selected_index == selected_segments.len() {
            return true;
        }
        if pattern_index == pattern_segments.len()
            || !visited.insert((pattern_index, selected_index))
        {
            return false;
        }

        let pattern_segment = pattern_segments[pattern_index];
        if pattern_segment == "**" {
            return prefix_is_compatible(
                pattern_segments,
                selected_segments,
                pattern_index + 1,
                selected_index,
                case_sensitive,
                visited,
            ) || prefix_is_compatible(
                pattern_segments,
                selected_segments,
                pattern_index,
                selected_index + 1,
                case_sensitive,
                visited,
            );
        }

        pattern_matches(
            pattern_segment,
            selected_segments[selected_index],
            case_sensitive,
        ) && prefix_is_compatible(
            pattern_segments,
            selected_segments,
            pattern_index + 1,
            selected_index + 1,
            case_sensitive,
            visited,
        )
    }

    prefix_is_compatible(
        &pattern_segments,
        &selected_segments,
        0,
        0,
        case_sensitive,
        &mut visited,
    )
}

fn mapped_rule_overlaps(selected_path: &str, candidate: &ResolvedCloudSavePath) -> bool {
    pattern_covers_path(selected_path, candidate)
        || pattern_can_match_in_subtree(&candidate.path, selected_path, candidate.case_sensitive)
}

fn custom_rule_overlaps(selected_path: &str, candidate: &ResolvedCloudSavePath) -> bool {
    is_same_or_child(selected_path, &candidate.path, candidate.case_sensitive)
        || is_same_or_child(&candidate.path, selected_path, candidate.case_sensitive)
}

fn join_remote_target(selected_path: &str, relative_path: &str) -> Result<String, String> {
    let normalized_relative = relative_path.replace('\\', "/");
    if normalized_relative.starts_with('/')
        || normalized_relative
            .split('/')
            .any(|segment| segment.is_empty() || segment == "." || segment == "..")
    {
        return Err("cloud_save_custom_path_invalid_remote_relative_path".to_string());
    }

    Ok(format!(
        "{}/{}",
        normalize_path(selected_path).trim_end_matches('/'),
        normalized_relative
    ))
}

fn remote_target_is_mapped(target: &str, rule: &ResolvedCloudSaveRule) -> bool {
    rule.resolved_paths.iter().any(|candidate| {
        if rule.kind == "dir" {
            pattern_covers_path(target, candidate)
        } else {
            pattern_matches(&candidate.path, target, candidate.case_sensitive)
        }
    })
}

#[napi]
pub fn check_cloud_save_custom_path_overlap(
    input: CheckCloudSaveCustomPathOverlapInput,
) -> napi::Result<CheckCloudSaveCustomPathOverlapResult> {
    let selected_path = normalize_path(&input.selected_path);
    let remote_targets = input
        .remote_relative_paths
        .iter()
        .map(|relative_path| join_remote_target(&selected_path, relative_path))
        .collect::<Result<Vec<_>, _>>()
        .map_err(napi::Error::from_reason)?;
    let rules = resolve_save_rules(ResolveSaveRulesInput {
        shop: input.shop,
        object_id: input.object_id,
        platform: input.platform,
        home_dir: input.home_dir,
        documents_dir: input.documents_dir,
        app_data_dir: input.app_data_dir,
        executable_path: input.executable_path,
        wine_prefix_path: input.wine_prefix_path,
        steam_path: input.steam_path,
        rules: input.rules,
    })?;

    for rule in &rules {
        if rule.source == "custom" {
            if rule
                .resolved_paths
                .iter()
                .any(|candidate| custom_rule_overlaps(&selected_path, candidate))
            {
                return Ok(overlap(CUSTOM_LOCATION_OVERLAP, rule.raw_path.clone()));
            }
            continue;
        }

        if rule
            .resolved_paths
            .iter()
            .any(|candidate| mapped_rule_overlaps(&selected_path, candidate))
        {
            return Ok(overlap(MAPPED_LOCATION_OVERLAP, rule.raw_path.clone()));
        }

        if remote_targets
            .iter()
            .any(|target| remote_target_is_mapped(target, rule))
        {
            return Ok(overlap(REMOTE_TARGET_MAPPED, rule.raw_path.clone()));
        }
    }

    Ok(no_overlap())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cloud_save::manifest::types::CloudSaveRuleCondition;

    fn rule(
        kind: &str,
        raw_path: &str,
        source: &str,
        preferred_path: Option<&str>,
    ) -> CloudSaveRule {
        CloudSaveRule {
            rule_id: format!("{source}:{raw_path}"),
            kind: kind.to_string(),
            raw_path: raw_path.to_string(),
            source: source.to_string(),
            tags: vec!["save".to_string()],
            when: Vec::<CloudSaveRuleCondition>::new(),
            preferred_path: preferred_path.map(ToString::to_string),
        }
    }

    fn check(
        platform: &str,
        home_dir: &str,
        selected_path: &str,
        rules: Vec<CloudSaveRule>,
        remote_relative_paths: Vec<&str>,
    ) -> CheckCloudSaveCustomPathOverlapResult {
        check_cloud_save_custom_path_overlap(CheckCloudSaveCustomPathOverlapInput {
            shop: "steam".to_string(),
            object_id: "1".to_string(),
            platform: platform.to_string(),
            home_dir: home_dir.to_string(),
            documents_dir: None,
            app_data_dir: None,
            executable_path: None,
            wine_prefix_path: None,
            steam_path: None,
            rules,
            selected_path: selected_path.to_string(),
            remote_relative_paths: remote_relative_paths
                .into_iter()
                .map(ToString::to_string)
                .collect(),
        })
        .unwrap()
    }

    #[test]
    fn blocks_a_manifest_directory_and_overlap_in_both_directions() {
        let rules = || vec![rule("dir", "<home>/Game/Saves", "ludusavi", None)];

        let exact = check(
            "linux",
            "/home/player",
            "/home/player/Game/Saves",
            rules(),
            vec![],
        );
        let child = check(
            "linux",
            "/home/player",
            "/home/player/Game/Saves/Profile",
            rules(),
            vec![],
        );
        let parent = check(
            "linux",
            "/home/player",
            "/home/player/Game",
            rules(),
            vec![],
        );

        assert_eq!(exact.reason.as_deref(), Some(MAPPED_LOCATION_OVERLAP));
        assert_eq!(child.reason.as_deref(), Some(MAPPED_LOCATION_OVERLAP));
        assert_eq!(parent.reason.as_deref(), Some(MAPPED_LOCATION_OVERLAP));
    }

    #[test]
    fn blocks_a_file_pattern_scope_but_allows_a_disjoint_subdirectory() {
        let rules = || vec![rule("file", "<home>/Game/*.sav", "ludusavi", None)];

        let parent = check(
            "linux",
            "/home/player",
            "/home/player/Game",
            rules(),
            vec![],
        );
        let ancestor = check("linux", "/home/player", "/home/player", rules(), vec![]);
        let disjoint_child = check(
            "linux",
            "/home/player",
            "/home/player/Game/Config",
            rules(),
            vec![],
        );

        assert_eq!(parent.reason.as_deref(), Some(MAPPED_LOCATION_OVERLAP));
        assert_eq!(ancestor.reason.as_deref(), Some(MAPPED_LOCATION_OVERLAP));
        assert!(!disjoint_child.has_overlap);
    }

    #[test]
    fn checks_dynamic_rule_segments_without_blocking_unrelated_siblings() {
        let rules = || vec![rule("dir", "<home>/*/Saves", "ludusavi", None)];

        let possible_parent = check(
            "linux",
            "/home/player",
            "/home/player/Profile",
            rules(),
            vec![],
        );
        let unrelated_sibling = check(
            "linux",
            "/home/player",
            "/home/player/Profile/Config",
            rules(),
            vec![],
        );
        let mapped_child = check(
            "linux",
            "/home/player",
            "/home/player/Profile/Saves/Slot",
            rules(),
            vec![],
        );

        assert_eq!(
            possible_parent.reason.as_deref(),
            Some(MAPPED_LOCATION_OVERLAP)
        );
        assert!(!unrelated_sibling.has_overlap);
        assert_eq!(
            mapped_child.reason.as_deref(),
            Some(MAPPED_LOCATION_OVERLAP)
        );
    }

    #[test]
    fn blocks_custom_paths_that_overlap_in_either_direction() {
        let rules = || {
            vec![rule(
                "dir",
                "<custom><linux><home>/Game/Saves",
                "custom",
                Some("/home/player/Game/Saves"),
            )]
        };

        let parent = check(
            "linux",
            "/home/player",
            "/home/player/Game",
            rules(),
            vec![],
        );
        let child = check(
            "linux",
            "/home/player",
            "/home/player/Game/Saves/Profile",
            rules(),
            vec![],
        );
        let exact = check(
            "linux",
            "/home/player",
            "/home/player/Game/Saves",
            rules(),
            vec![],
        );

        assert_eq!(parent.reason.as_deref(), Some(CUSTOM_LOCATION_OVERLAP));
        assert_eq!(child.reason.as_deref(), Some(CUSTOM_LOCATION_OVERLAP));
        assert_eq!(exact.reason.as_deref(), Some(CUSTOM_LOCATION_OVERLAP));
    }

    #[test]
    fn compares_windows_paths_without_case_sensitivity() {
        let result = check(
            "windows",
            "C:/Users/Player",
            "c:/users/player/game/saves/profile",
            vec![rule("dir", "<home>/Game/Saves", "ludusavi", None)],
            vec![],
        );

        assert_eq!(result.reason.as_deref(), Some(MAPPED_LOCATION_OVERLAP));
    }

    #[test]
    fn matches_a_concrete_wine_profile_against_dynamic_candidates() {
        let mut input = CheckCloudSaveCustomPathOverlapInput {
            shop: "steam".to_string(),
            object_id: "1".to_string(),
            platform: "linux".to_string(),
            home_dir: "/home/player".to_string(),
            documents_dir: None,
            app_data_dir: None,
            executable_path: Some("/games/Game.exe".to_string()),
            wine_prefix_path: Some("/prefix".to_string()),
            steam_path: None,
            rules: vec![rule("dir", "<winAppData>/Game", "ludusavi", None)],
            selected_path: "/prefix/drive_c/users/another-user/AppData/Roaming/Game/Profile"
                .to_string(),
            remote_relative_paths: vec![],
        };

        let result = check_cloud_save_custom_path_overlap(input).unwrap();
        assert_eq!(result.reason.as_deref(), Some(MAPPED_LOCATION_OVERLAP));

        input = CheckCloudSaveCustomPathOverlapInput {
            shop: "steam".to_string(),
            object_id: "1".to_string(),
            platform: "linux".to_string(),
            home_dir: "/home/player".to_string(),
            documents_dir: None,
            app_data_dir: None,
            executable_path: Some("/games/Game.exe".to_string()),
            wine_prefix_path: Some("/prefix".to_string()),
            steam_path: None,
            rules: vec![rule("dir", "<winAppData>/Game", "ludusavi", None)],
            selected_path: "/prefix/drive_c/users/another-user/Documents".to_string(),
            remote_relative_paths: vec![],
        };

        assert!(
            !check_cloud_save_custom_path_overlap(input)
                .unwrap()
                .has_overlap
        );
    }
}
