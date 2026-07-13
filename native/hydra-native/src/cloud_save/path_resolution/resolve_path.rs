use std::collections::HashSet;

use super::types::{PathResolutionContext, TokenMap, PATH_RESOLUTION_TOKENS, WINDOWS_LIKE_TOKENS};

pub struct ResolvedPath {
    pub resolved_paths: Vec<String>,
    pub unresolved_tokens: Vec<String>,
}

// TODO: Unknown manifest tokens are not detected.
// If the manifest introduces a token not listed in PATH_RESOLUTION_TOKENS,
// it may remain unreplaced without being added to unresolved_tokens.
fn tokens_used_by_path(raw_path: &str) -> Vec<&'static str> {
    PATH_RESOLUTION_TOKENS
        .iter()
        .copied()
        .filter(|token| raw_path.contains(token))
        .collect()
}

fn uses_windows_like_token(raw_path: &str) -> bool {
    WINDOWS_LIKE_TOKENS
        .iter()
        .any(|token| raw_path.contains(token))
}

fn normalize_path(value: &str) -> String {
    let value = value.replace('\\', "/");
    let absolute = value.starts_with('/');
    let trailing_slash = value.ends_with('/');
    let mut segments: Vec<&str> = Vec::new();

    for segment in value.split('/') {
        match segment {
            "" | "." => {}
            ".." => {
                if segments.last().is_some_and(|last| *last != "..") {
                    segments.pop();
                } else if !absolute {
                    segments.push(segment);
                }
            }
            _ => segments.push(segment),
        }
    }

    let mut normalized = if absolute {
        format!("/{}", segments.join("/"))
    } else if segments.is_empty() {
        ".".to_string()
    } else {
        segments.join("/")
    };

    if trailing_slash && normalized != "/" && normalized != "." {
        normalized.push('/');
    }

    normalized
}

fn expand_tokens(raw_path: &str, token_map: &TokenMap, tokens: &[&str]) -> Vec<String> {
    tokens
        .iter()
        .fold(vec![raw_path.to_string()], |paths, token| {
            let Some(values) = token_map.get(token) else {
                return paths;
            };

            paths
                .into_iter()
                .flat_map(|path| values.iter().map(move |value| path.replace(token, value)))
                .collect()
        })
}

fn apply_runtime_resolution(
    expanded_path: &str,
    raw_path: &str,
    context: &PathResolutionContext,
) -> String {
    if context.wine_prefix_path.is_some() && uses_windows_like_token(raw_path) {
        if let Some(prefix) = &context.wine_prefix_path {
            return normalize_path(&format!(
                "{}/{}",
                prefix.trim_end_matches('/'),
                expanded_path.trim_start_matches('/')
            ));
        }
    }

    normalize_path(expanded_path)
}

pub fn resolve_path(
    raw_path: &str,
    context: &PathResolutionContext,
    token_map: &TokenMap,
) -> ResolvedPath {
    let tokens = tokens_used_by_path(raw_path);
    let unresolved_tokens = tokens
        .iter()
        .filter(|token| token_map.get(**token).is_none_or(Vec::is_empty))
        .map(|token| (*token).to_string())
        .collect::<Vec<_>>();

    if !unresolved_tokens.is_empty() {
        return ResolvedPath {
            resolved_paths: Vec::new(),
            unresolved_tokens,
        };
    }

    let mut seen = HashSet::new();
    let resolved_paths = expand_tokens(raw_path, token_map, &tokens)
        .into_iter()
        .map(|path| apply_runtime_resolution(&path, raw_path, context))
        .filter(|path| seen.insert(path.clone()))
        .collect();

    ResolvedPath {
        resolved_paths,
        unresolved_tokens: Vec::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    use crate::cloud_save::manifest::{
        get_save_rules_for_game,
        GetSaveRulesForGameInput,
    };
    use crate::cloud_save::path_resolution::context::build_context;
    use crate::cloud_save::path_resolution::tokens::build_token_map;
    use crate::cloud_save::path_resolution::types::ResolveSaveRulesInput;

    use tempfile::tempdir;

    #[tokio::test]
    async fn resolves_real_balatro_save_path_with_wine() {
        let shop = "steam";
        let object_id = "2379780";
        let cache_directory = tempdir().unwrap();

        let game_rules = get_save_rules_for_game(
            GetSaveRulesForGameInput {
                shop: shop.to_string(),
                object_id: object_id.to_string(),
                remote_id: None,
                title: Some("Balatro".to_string()),
                source_url: None,
                user_data_path: cache_directory
                    .path()
                    .display()
                    .to_string(),
            },
        )
        .await
        .unwrap();

        let rule = game_rules
            .rules
            .iter()
            .find(|rule| {
                rule.raw_path == "<winAppData>/Balatro"
            })
            .expect(
                "Balatro Windows Steam save rule should exist",
            );

        let input = ResolveSaveRulesInput {
            shop: shop.to_string(),
            object_id: object_id.to_string(),
            platform: "linux".to_string(),
            home_dir: "/home/spectre".to_string(),
            executable_path: Some(
                "/home/spectre/Games/Balatro/Balatro.exe"
                    .to_string(),
            ),
            documents_dir: None,
            app_data_dir: None,
            wine_prefix_path: Some(
                "/home/spectre/.wine".to_string(),
            ),
            proton_path: None,
            steam_path: None,
            steam_user_ids: Vec::new(),
            rules: Vec::new(),
        };

        let context = build_context(&input).unwrap();
        let token_map = build_token_map(
            &context,
            &input.steam_user_ids,
        );

        let result = resolve_path(
            &rule.raw_path,
            &context,
            &token_map,
        );

        let expected_path = concat!(
            "/home/spectre/.wine/",
            "drive_c/users/spectre/",
            "AppData/Roaming/Balatro"
        );

        println!(
            "Balatro | {} | {} -> {:?}",
            context.platform,
            rule.raw_path,
            result.resolved_paths,
        );

        if !result.unresolved_tokens.is_empty() {
            println!(
                "unresolved tokens: {:?}",
                result.unresolved_tokens,
            );
        }

        assert_eq!(
            game_rules.manifest_key.as_deref(),
            Some(object_id)
        );

        assert_eq!(rule.kind, "dir");
        assert_eq!(rule.source, "ludusavi");

        assert!(
            rule.tags.iter().any(|tag| tag == "save")
        );

        assert!(
            rule.when.iter().any(|condition| {
                condition.os.as_deref() == Some("windows")
                    && condition.store.as_deref()
                        == Some("steam")
            })
        );

        assert_eq!(
            result.resolved_paths,
            vec![expected_path.to_string()]
        );

        assert!(result.unresolved_tokens.is_empty());
    }
}
