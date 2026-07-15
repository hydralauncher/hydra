use std::collections::HashSet;

use super::candidates::{native_paths, normalize_candidate, steam_proton_paths, wine_paths};
use super::tokens::{has_unresolved_placeholder, tokens_in_path};
use super::types::{PathResolutionContext, ResolvedCloudSavePath};

pub struct ResolvedPath {
    pub paths: Vec<ResolvedCloudSavePath>,
    pub unresolved_tokens: Vec<String>,
}

fn collect_paths(
    paths: &mut Vec<ResolvedCloudSavePath>,
    seen: &mut HashSet<(String, bool)>,
    candidates: Vec<String>,
    case_sensitive: bool,
    dynamic: bool,
) {
    for path in candidates {
        if has_unresolved_placeholder(&path) {
            continue;
        }

        if seen.insert((path.clone(), case_sensitive)) {
            paths.push(ResolvedCloudSavePath {
                path,
                case_sensitive,
                dynamic,
                scan_root: None,
            });
        }
    }
}

fn is_glob_segment(segment: &str) -> bool {
    segment.contains(['*', '?', '[', '{'])
}

fn raw_glob_base(raw_path: &str) -> Option<String> {
    let normalized = normalize_candidate(raw_path);
    let segments = normalized.split('/').collect::<Vec<_>>();
    let first_glob = segments
        .iter()
        .position(|segment| is_glob_segment(segment))?;

    Some(match first_glob {
        0 => ".".to_string(),
        index => segments[..index].join("/"),
    })
}

fn assign_scan_roots(paths: &mut [ResolvedCloudSavePath], roots: &[ResolvedCloudSavePath]) {
    for candidate in paths {
        candidate.scan_root = roots
            .iter()
            .filter(|root| {
                candidate.path == root.path
                    || candidate
                        .path
                        .starts_with(&format!("{}/", root.path.trim_end_matches('/')))
            })
            .max_by_key(|root| root.path.len())
            .map(|root| root.path.clone());
    }
}

pub fn resolve_path(raw_path: &str, context: &PathResolutionContext) -> ResolvedPath {
    let raw_path = normalize_candidate(raw_path)
        .replace("*<storeUserId>", "<storeUserId>")
        .replace("<storeUserId>*", "<storeUserId>");
    let store_user_dynamic = raw_path.contains("<storeUserId>");
    let mut paths = Vec::new();
    let mut seen = HashSet::new();

    collect_paths(
        &mut paths,
        &mut seen,
        native_paths(&raw_path, context, None),
        context.platform == "linux",
        store_user_dynamic,
    );

    for root in &context.steam_roots {
        collect_paths(
            &mut paths,
            &mut seen,
            native_paths(&raw_path, context, Some(root)),
            context.platform == "linux",
            store_user_dynamic,
        );
    }

    if context.platform == "linux" && context.shop == "steam" {
        for root in &context.steam_roots {
            collect_paths(
                &mut paths,
                &mut seen,
                steam_proton_paths(&raw_path, context, root),
                false,
                store_user_dynamic,
            );
        }
    }

    if let Some(prefix) = &context.wine_prefix_path {
        collect_paths(
            &mut paths,
            &mut seen,
            wine_paths(&raw_path, context, prefix),
            false,
            true,
        );
    }

    if let Some(raw_scan_root) = raw_glob_base(&raw_path) {
        let roots = resolve_path(&raw_scan_root, context).paths;
        assign_scan_roots(&mut paths, &roots);
    }

    let unresolved_tokens = paths
        .is_empty()
        .then(|| tokens_in_path(&raw_path))
        .unwrap_or_default();

    ResolvedPath {
        paths,
        unresolved_tokens,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    use crate::cloud_save::manifest::{get_save_rules_for_game, GetSaveRulesForGameInput};
    use crate::cloud_save::path_resolution::context::build_context;
    use crate::cloud_save::path_resolution::types::ResolveSaveRulesInput;

    use tempfile::tempdir;

    #[tokio::test]
    async fn resolves_real_balatro_save_path_with_wine() {
        let shop = "steam";
        let object_id = "2379780";
        let cache_directory = tempdir().unwrap();

        let game_rules = get_save_rules_for_game(GetSaveRulesForGameInput {
            shop: shop.to_string(),
            object_id: object_id.to_string(),
            remote_id: None,
            title: Some("Balatro".to_string()),
            source_url: None,
            user_data_path: cache_directory.path().display().to_string(),
        })
        .await
        .unwrap();

        let rule = game_rules
            .rules
            .iter()
            .find(|rule| rule.raw_path == "<winAppData>/Balatro")
            .expect("Balatro Windows Steam save rule should exist");

        let input = ResolveSaveRulesInput {
            shop: shop.to_string(),
            object_id: object_id.to_string(),
            platform: "linux".to_string(),
            home_dir: "/home/spectre".to_string(),
            executable_path: Some("/home/spectre/Games/Balatro/Balatro.exe".to_string()),
            documents_dir: None,
            app_data_dir: None,
            wine_prefix_path: Some("/home/spectre/.wine".to_string()),
            steam_path: None,
            rules: Vec::new(),
        };

        let context = build_context(&input).unwrap();
        let result = resolve_path(&rule.raw_path, &context);

        let expected_path = concat!(
            "/home/spectre/.wine/",
            "drive_*/users/*/AppData/Roaming/Balatro"
        );

        assert_eq!(game_rules.manifest_key.as_deref(), Some(object_id));
        assert_eq!(rule.kind, "dir");
        assert_eq!(rule.source, "ludusavi");
        assert!(rule.tags.iter().any(|tag| tag == "save"));
        assert!(result.paths.iter().any(|path| path.path == expected_path));
        assert!(result.unresolved_tokens.is_empty());
    }

    #[test]
    fn resolves_store_user_as_dynamic_wildcard() {
        let input = ResolveSaveRulesInput {
            shop: "steam".to_string(),
            object_id: "1888930".to_string(),
            platform: "linux".to_string(),
            home_dir: "/home/victor".to_string(),
            executable_path: Some("/games/TLOU/tlou-i.exe".to_string()),
            documents_dir: None,
            app_data_dir: None,
            wine_prefix_path: Some("/prefix".to_string()),
            steam_path: None,
            rules: Vec::new(),
        };
        let context = build_context(&input).unwrap();

        let result = resolve_path(
            "<home>/Saved Games/The Last of Us Part I/users/<storeUserId>/savedata",
            &context,
        );

        assert!(result.paths.iter().any(|candidate| {
            candidate.dynamic
                && candidate.path
                    == "/prefix/drive_*/users/*/Saved Games/The Last of Us Part I/users/*/savedata"
        }));
    }
}
