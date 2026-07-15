use std::collections::HashSet;

use super::candidates::{native_paths, normalize_candidate, steam_proton_paths, wine_paths};
use super::tokens::{expand_store_user_ids, has_unresolved_placeholder, tokens_in_path};
use super::types::PathResolutionContext;

pub struct ResolvedPath {
    pub resolved_paths: Vec<String>,
    pub unresolved_tokens: Vec<String>,
}

fn collect_paths(
    resolved_paths: &mut Vec<String>,
    seen: &mut HashSet<String>,
    candidates: Vec<String>,
    steam_user_ids: &[String],
) {
    for candidate in candidates {
        for expanded in expand_store_user_ids(candidate, steam_user_ids) {
            if has_unresolved_placeholder(&expanded) {
                continue;
            }
            let normalized = normalize_candidate(&expanded);
            if seen.insert(normalized.clone()) {
                resolved_paths.push(normalized);
            }
        }
    }
}

pub fn resolve_path(
    raw_path: &str,
    context: &PathResolutionContext,
    steam_user_ids: &[String],
) -> ResolvedPath {
    let raw_path = normalize_candidate(raw_path)
        .replace("*<storeUserId>", "<storeUserId>")
        .replace("<storeUserId>*", "<storeUserId>");
    let mut resolved_paths = Vec::new();
    let mut seen = HashSet::new();

    collect_paths(
        &mut resolved_paths,
        &mut seen,
        native_paths(&raw_path, context, None),
        steam_user_ids,
    );

    for root in &context.steam_roots {
        collect_paths(
            &mut resolved_paths,
            &mut seen,
            native_paths(&raw_path, context, Some(root)),
            steam_user_ids,
        );
    }

    if context.platform == "linux" && context.shop == "steam" {
        for root in &context.steam_roots {
            collect_paths(
                &mut resolved_paths,
                &mut seen,
                steam_proton_paths(&raw_path, context, root),
                steam_user_ids,
            );
        }
    }

    if let Some(prefix) = &context.wine_prefix_path {
        collect_paths(
            &mut resolved_paths,
            &mut seen,
            wine_paths(&raw_path, context, prefix),
            steam_user_ids,
        );
    }

    let unresolved_tokens = resolved_paths
        .is_empty()
        .then(|| tokens_in_path(&raw_path))
        .unwrap_or_default();

    ResolvedPath {
        resolved_paths,
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
            proton_path: None,
            steam_path: None,
            steam_user_ids: Vec::new(),
            rules: Vec::new(),
        };

        let context = build_context(&input).unwrap();
        let result = resolve_path(&rule.raw_path, &context, &input.steam_user_ids);

        let expected_path = concat!(
            "/home/spectre/.wine/",
            "drive_*/users/*/AppData/Roaming/Balatro"
        );

        assert_eq!(game_rules.manifest_key.as_deref(), Some(object_id));
        assert_eq!(rule.kind, "dir");
        assert_eq!(rule.source, "ludusavi");
        assert!(rule.tags.iter().any(|tag| tag == "save"));
        assert!(result
            .resolved_paths
            .iter()
            .any(|path| path == expected_path));
        assert!(result.unresolved_tokens.is_empty());
    }
}
