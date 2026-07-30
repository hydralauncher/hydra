use std::collections::HashSet;
use std::path::Path;

use super::candidates::{native_paths, normalize_candidate, steam_proton_paths, wine_paths};
use super::custom::{decode_custom_path, CUSTOM_PATH_PREFIX};
use super::tokens::{has_unresolved_placeholder, tokens_in_path, uses_windows_profile};
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

fn collect_native_paths(
    paths: &mut Vec<ResolvedCloudSavePath>,
    seen: &mut HashSet<(String, bool)>,
    raw_path: &str,
    context: &PathResolutionContext,
    root: Option<&str>,
    dynamic: bool,
) {
    collect_paths(
        paths,
        seen,
        native_paths(raw_path, context, root),
        context.platform == "linux",
        dynamic,
    );
}

fn collect_wine_paths(
    paths: &mut Vec<ResolvedCloudSavePath>,
    seen: &mut HashSet<(String, bool)>,
    raw_path: &str,
    context: &PathResolutionContext,
    prefix: &str,
) {
    collect_paths(
        paths,
        seen,
        wine_paths(raw_path, context, prefix),
        false,
        true,
    );
}

fn collect_steam_root_paths(
    paths: &mut Vec<ResolvedCloudSavePath>,
    seen: &mut HashSet<(String, bool)>,
    raw_path: &str,
    context: &PathResolutionContext,
    root: &str,
    dynamic: bool,
) {
    if context.platform == "linux" && context.shop == "steam" {
        collect_paths(
            paths,
            seen,
            steam_proton_paths(raw_path, context, root),
            false,
            dynamic,
        );
    }

    collect_native_paths(paths, seen, raw_path, context, Some(root), dynamic);
}

fn is_glob_segment(segment: &str) -> bool {
    segment.contains(['*', '?', '[', '{'])
}

pub(crate) fn glob_base_path(raw_path: &str) -> Option<String> {
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

fn is_absolute_candidate(path: &str, platform: &str) -> bool {
    if Path::new(path).is_absolute() {
        return true;
    }
    if platform == "windows" {
        let bytes = path.as_bytes();
        return (bytes.len() >= 3
            && bytes[0].is_ascii_alphabetic()
            && bytes[1] == b':'
            && bytes[2] == b'/')
            || path.starts_with("//");
    }

    path.starts_with('/')
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

fn resolve_standard_path(raw_path: &str, context: &PathResolutionContext) -> ResolvedPath {
    let raw_path = normalize_candidate(raw_path)
        .replace("*<storeUserId>", "<storeUserId>")
        .replace("<storeUserId>*", "<storeUserId>");
    let store_user_dynamic = raw_path.contains("<storeUserId>");
    let mut paths = Vec::new();
    let mut seen = HashSet::new();

    if context.windows_compatibility {
        if let Some(prefix) = &context.wine_prefix_path {
            // This is the prefix Hydra passes to the launcher. Other Proton
            // prefixes are independent environments, not mirrors of it.
            collect_wine_paths(&mut paths, &mut seen, &raw_path, context, prefix);

            // Keep store-root expansion for rules that use <root>, but bind
            // Windows profile paths to the exact launcher prefix.
            if !uses_windows_profile(&raw_path) {
                if let Some(root) = &context.derived_steam_root {
                    collect_native_paths(
                        &mut paths,
                        &mut seen,
                        &raw_path,
                        context,
                        Some(root),
                        store_user_dynamic,
                    );
                }
                if let Some(root) = &context.configured_steam_root {
                    collect_native_paths(
                        &mut paths,
                        &mut seen,
                        &raw_path,
                        context,
                        Some(root),
                        store_user_dynamic,
                    );
                }
            }
        } else {
            // Compatibility callers without a known launcher prefix may still
            // derive Proton's active prefix from the executable's Steam root.
            if let Some(root) = &context.derived_steam_root {
                collect_steam_root_paths(
                    &mut paths,
                    &mut seen,
                    &raw_path,
                    context,
                    root,
                    store_user_dynamic,
                );
            }
            if let Some(root) = &context.configured_steam_root {
                collect_steam_root_paths(
                    &mut paths,
                    &mut seen,
                    &raw_path,
                    context,
                    root,
                    store_user_dynamic,
                );
            }
            collect_native_paths(
                &mut paths,
                &mut seen,
                &raw_path,
                context,
                None,
                store_user_dynamic,
            );
        }
    } else {
        collect_native_paths(
            &mut paths,
            &mut seen,
            &raw_path,
            context,
            None,
            store_user_dynamic,
        );
        if let Some(root) = &context.derived_steam_root {
            collect_native_paths(
                &mut paths,
                &mut seen,
                &raw_path,
                context,
                Some(root),
                store_user_dynamic,
            );
        }
        if let Some(root) = &context.configured_steam_root {
            collect_native_paths(
                &mut paths,
                &mut seen,
                &raw_path,
                context,
                Some(root),
                store_user_dynamic,
            );
        }
    }

    paths.retain(|candidate| is_absolute_candidate(&candidate.path, &context.platform));

    if let Some(raw_scan_root) = glob_base_path(&raw_path) {
        let roots = resolve_path(&raw_scan_root, context).paths;
        assign_scan_roots(&mut paths, &roots);
    }

    let unresolved_tokens = if paths.is_empty() {
        let tokens = tokens_in_path(&raw_path);
        if tokens.is_empty() {
            vec!["cloud_save_relative_path".to_string()]
        } else {
            tokens
        }
    } else {
        Vec::new()
    };

    ResolvedPath {
        paths,
        unresolved_tokens,
    }
}

fn unresolved_custom_path(error: &str) -> ResolvedPath {
    ResolvedPath {
        paths: vec![],
        unresolved_tokens: vec![error.to_string()],
    }
}

fn resolve_custom_path(raw_path: &str, context: &PathResolutionContext) -> ResolvedPath {
    let decoded = match decode_custom_path(raw_path) {
        Some(Ok(decoded)) => decoded,
        Some(Err(error)) => return unresolved_custom_path(&error),
        None => return unresolved_custom_path("cloud_save_custom_path_invalid"),
    };
    if decoded.platform == "windows" {
        if context.platform != "windows"
            && !(context.platform == "linux" && context.windows_compatibility)
        {
            return unresolved_custom_path("cloud_save_custom_path_foreign_platform");
        }
        if context.platform == "linux" && !decoded.path.starts_with('<') {
            return unresolved_custom_path("cloud_save_custom_path_non_portable");
        }
        if context.platform == "linux" && decoded.path.starts_with("<root>") {
            let mut paths = Vec::new();
            let mut seen = HashSet::new();
            if let Some(root) = &context.derived_steam_root {
                collect_native_paths(
                    &mut paths,
                    &mut seen,
                    &decoded.path,
                    context,
                    Some(root),
                    decoded.path.contains("<storeUserId>"),
                );
            }
            if let Some(root) = &context.configured_steam_root {
                collect_native_paths(
                    &mut paths,
                    &mut seen,
                    &decoded.path,
                    context,
                    Some(root),
                    decoded.path.contains("<storeUserId>"),
                );
            }
            return ResolvedPath {
                unresolved_tokens: paths
                    .is_empty()
                    .then(|| tokens_in_path(&decoded.path))
                    .unwrap_or_default(),
                paths,
            };
        }
        if decoded.path.starts_with('<') {
            return resolve_standard_path(&decoded.path, context);
        }
    }

    if decoded.platform != context.platform {
        return unresolved_custom_path("cloud_save_custom_path_foreign_platform");
    }

    if decoded.path.starts_with('<') {
        return resolve_standard_path(&decoded.path, context);
    }
    let candidates = vec![decoded.path.clone()];
    let mut paths = Vec::new();
    let mut seen = HashSet::new();
    collect_paths(
        &mut paths,
        &mut seen,
        candidates,
        context.platform == "linux",
        false,
    );
    let unresolved_tokens = paths
        .is_empty()
        .then(|| tokens_in_path(&decoded.path))
        .unwrap_or_default();
    ResolvedPath {
        paths,
        unresolved_tokens,
    }
}

pub fn resolve_path(raw_path: &str, context: &PathResolutionContext) -> ResolvedPath {
    if raw_path.starts_with(CUSTOM_PATH_PREFIX) {
        resolve_custom_path(raw_path, context)
    } else {
        resolve_standard_path(raw_path, context)
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

    #[test]
    fn rejects_manifest_paths_that_remain_relative() {
        let input = ResolveSaveRulesInput {
            shop: "steam".to_string(),
            object_id: "1".to_string(),
            platform: "linux".to_string(),
            home_dir: "/home/player".to_string(),
            executable_path: Some("/games/Game/game".to_string()),
            documents_dir: None,
            app_data_dir: None,
            wine_prefix_path: None,
            steam_path: None,
            rules: Vec::new(),
        };
        let context = build_context(&input).unwrap();

        let relative = resolve_path("Saves/profile", &context);
        let rooted = resolve_path("<home>/Saves/profile", &context);

        assert!(relative.paths.is_empty());
        assert_eq!(relative.unresolved_tokens, vec!["cloud_save_relative_path"]);
        assert_eq!(rooted.paths[0].path, "/home/player/Saves/profile");
    }

    #[test]
    fn rebases_portable_custom_paths_but_keeps_absolute_paths_exact() {
        let input = ResolveSaveRulesInput {
            shop: "steam".to_string(),
            object_id: "1".to_string(),
            platform: "windows".to_string(),
            home_dir: "D:/Users/Maria".to_string(),
            executable_path: Some("D:/Games/Game/game.exe".to_string()),
            documents_dir: Some("D:/Users/Maria/Documents".to_string()),
            app_data_dir: Some("D:/Users/Maria/AppData/Roaming".to_string()),
            wine_prefix_path: None,
            steam_path: None,
            rules: Vec::new(),
        };
        let context = build_context(&input).unwrap();

        let portable = resolve_path("<custom><windows><home>/Downloads/Game/Saves", &context);
        let absolute = resolve_path(
            "<custom><windows><absolute>C:/Users/Rodrigo/Downloads/Game/Saves",
            &context,
        );
        let absolute_app_data = resolve_path(
            "<custom><windows><absolute>C:/Users/Rodrigo/AppData/Roaming/Game/Saves",
            &context,
        );
        let legacy = resolve_path(
            "<custom><windows>C:/Users/Rodrigo/AppData/Roaming/Game/Saves",
            &context,
        );

        assert_eq!(
            portable.paths[0].path,
            "D:/Users/Maria/Downloads/Game/Saves"
        );
        assert_eq!(
            absolute.paths[0].path,
            "C:/Users/Rodrigo/Downloads/Game/Saves"
        );
        assert_eq!(
            absolute_app_data.paths[0].path,
            "C:/Users/Rodrigo/AppData/Roaming/Game/Saves"
        );
        assert!(portable.unresolved_tokens.is_empty());
        assert!(absolute.unresolved_tokens.is_empty());
        assert!(absolute_app_data.unresolved_tokens.is_empty());
        assert!(legacy.paths.is_empty());
        assert_eq!(
            legacy.unresolved_tokens,
            vec!["cloud_save_custom_path_legacy"]
        );
    }

    #[test]
    fn resolves_one_windows_custom_identity_natively_and_inside_wine() {
        let native_input = ResolveSaveRulesInput {
            shop: "steam".to_string(),
            object_id: "1".to_string(),
            platform: "windows".to_string(),
            home_dir: "C:/Users/Rodrigo".to_string(),
            executable_path: Some("C:/Games/Game/game.exe".to_string()),
            documents_dir: Some("C:/Users/Rodrigo/Documents".to_string()),
            app_data_dir: Some("C:/Users/Rodrigo/AppData/Roaming".to_string()),
            wine_prefix_path: None,
            steam_path: None,
            rules: Vec::new(),
        };
        let native_context = build_context(&native_input).unwrap();
        let native = resolve_path("<custom><windows><winAppData>/Game/Saves", &native_context);
        assert_eq!(
            native.paths[0].path,
            "C:/Users/Rodrigo/AppData/Roaming/Game/Saves"
        );

        let temp = tempdir().unwrap();
        let prefix = temp.path().join("prefix");
        let wine_input = ResolveSaveRulesInput {
            shop: "steam".to_string(),
            object_id: "1".to_string(),
            platform: "linux".to_string(),
            home_dir: temp.path().join("home/maria").display().to_string(),
            executable_path: Some(temp.path().join("Game/game.exe").display().to_string()),
            documents_dir: None,
            app_data_dir: None,
            wine_prefix_path: Some(prefix.display().to_string()),
            steam_path: None,
            rules: Vec::new(),
        };
        let wine_context = build_context(&wine_input).unwrap();
        let wine = resolve_path("<custom><windows><winAppData>/Game/Saves", &wine_context);
        let expected = prefix
            .join("drive_c/users/steamuser/AppData/Roaming/Game/Saves")
            .display()
            .to_string()
            .replace('\\', "/");
        assert_eq!(wine.paths[0].path, expected);
        assert!(wine.unresolved_tokens.is_empty());
    }

    #[test]
    fn keeps_linux_custom_paths_platform_specific_and_rejects_unmapped_drives() {
        let input = ResolveSaveRulesInput {
            shop: "steam".to_string(),
            object_id: "1".to_string(),
            platform: "windows".to_string(),
            home_dir: "D:/Users/Maria".to_string(),
            executable_path: Some("D:/Games/Game/game.exe".to_string()),
            documents_dir: Some("D:/Users/Maria/Documents".to_string()),
            app_data_dir: Some("D:/Users/Maria/AppData/Roaming".to_string()),
            wine_prefix_path: None,
            steam_path: None,
            rules: Vec::new(),
        };
        let context = build_context(&input).unwrap();
        let linux_custom = resolve_path(
            "<custom><linux><home>/.local/share/hydra/prefix/drive_c/users/steamuser/AppData/Roaming/Game",
            &context,
        );
        assert!(linux_custom.paths.is_empty());
        assert_eq!(
            linux_custom.unresolved_tokens,
            vec!["cloud_save_custom_path_foreign_platform"]
        );

        let mut wine_input = input;
        wine_input.platform = "linux".to_string();
        wine_input.home_dir = "/home/maria".to_string();
        wine_input.executable_path = Some("/games/Game/game.exe".to_string());
        wine_input.wine_prefix_path = Some("/home/maria/.wine".to_string());
        let wine_context = build_context(&wine_input).unwrap();
        let unmapped = resolve_path(
            "<custom><windows><absolute>D:/Unmapped/Saves",
            &wine_context,
        );
        assert!(unmapped.paths.is_empty());
        assert_eq!(
            unmapped.unresolved_tokens,
            vec!["cloud_save_custom_path_non_portable"]
        );
    }

    #[test]
    fn uses_active_launcher_prefix_without_scanning_other_compatdata() {
        let input = ResolveSaveRulesInput {
            shop: "steam".into(),
            object_id: "123".into(),
            platform: "linux".into(),
            home_dir: "/home/victor".into(),
            executable_path: Some("/mnt/games/SteamLibrary/steamapps/common/Game/game.exe".into()),
            documents_dir: None,
            app_data_dir: None,
            wine_prefix_path: Some("/hydra/prefix".into()),
            steam_path: Some("/home/victor/.steam/steam".into()),
            rules: Vec::new(),
        };
        let context = build_context(&input).unwrap();

        let result = resolve_path("<winAppData>/Game", &context);
        let paths = result
            .paths
            .iter()
            .map(|candidate| candidate.path.as_str())
            .collect::<Vec<_>>();

        assert_eq!(
            paths[0],
            "/hydra/prefix/drive_c/users/steamuser/AppData/Roaming/Game"
        );
        assert_eq!(
            paths[1],
            "/hydra/prefix/drive_c/users/victor/AppData/Roaming/Game"
        );
        assert_eq!(
            paths[2],
            "/hydra/prefix/drive_*/users/*/AppData/Roaming/Game"
        );
        assert_eq!(
            paths[3],
            "/hydra/prefix/drive_c/users/steamuser/Application Data/Game"
        );
        assert!(paths.iter().all(|path| path.starts_with("/hydra/prefix/")));
        assert!(paths.iter().all(|path| !path.contains("/compatdata/")));
    }

    #[test]
    fn custom_store_root_stays_on_the_host_across_windows_compatibility() {
        let input = ResolveSaveRulesInput {
            shop: "steam".into(),
            object_id: "123".into(),
            platform: "linux".into(),
            home_dir: "/home/victor".into(),
            executable_path: Some("/mnt/games/SteamLibrary/steamapps/common/Game/game.exe".into()),
            documents_dir: None,
            app_data_dir: None,
            wine_prefix_path: Some("/hydra/prefix".into()),
            steam_path: None,
            rules: Vec::new(),
        };
        let context = build_context(&input).unwrap();

        let root = resolve_path(
            "<custom><windows><root>/userdata/<storeUserId>/123/remote",
            &context,
        );
        let base = resolve_path("<custom><windows><base>/saves", &context);

        assert_eq!(
            root.paths[0].path,
            "/mnt/games/SteamLibrary/userdata/*/123/remote"
        );
        assert!(root
            .paths
            .iter()
            .all(|candidate| !candidate.path.starts_with("/hydra/prefix")));
        assert_eq!(
            base.paths[0].path,
            "/mnt/games/SteamLibrary/steamapps/common/Game/saves"
        );
    }

    #[test]
    fn falls_back_to_derived_proton_without_active_prefix() {
        let input = ResolveSaveRulesInput {
            shop: "steam".into(),
            object_id: "123".into(),
            platform: "linux".into(),
            home_dir: "/home/victor".into(),
            executable_path: Some("/mnt/games/SteamLibrary/steamapps/common/Game/game.exe".into()),
            documents_dir: None,
            app_data_dir: None,
            wine_prefix_path: None,
            steam_path: None,
            rules: Vec::new(),
        };
        let context = build_context(&input).unwrap();

        let result = resolve_path("<winDocuments>/Game", &context);

        assert_eq!(
            result.paths[0].path,
            "/mnt/games/SteamLibrary/steamapps/compatdata/123/pfx/drive_c/users/steamuser/Documents/Game"
        );
    }

    #[test]
    fn ignores_wine_prefix_for_native_linux_executable() {
        let input = ResolveSaveRulesInput {
            shop: "steam".into(),
            object_id: "123".into(),
            platform: "linux".into(),
            home_dir: "/home/victor".into(),
            executable_path: Some("/games/Game/game.x86_64".into()),
            documents_dir: None,
            app_data_dir: None,
            wine_prefix_path: Some("/hydra/prefix".into()),
            steam_path: None,
            rules: Vec::new(),
        };
        let context = build_context(&input).unwrap();

        let result = resolve_path("<home>/.config/Game", &context);

        assert_eq!(result.paths[0].path, "/home/victor/.config/Game");
        assert!(result
            .paths
            .iter()
            .all(|path| !path.path.starts_with("/hydra/prefix")));
    }
}
