use std::collections::HashSet;
use std::path::{Path, PathBuf};

use super::context::normalize_separators;
use super::types::{PathResolutionContext, ResolvedPathCandidate, PATH_RESOLUTION_TOKENS};

const SKIP: &str = "<skip>";

pub struct ResolvedPath {
    pub candidates: Vec<ResolvedPathCandidate>,
    pub unresolved_tokens: Vec<String>,
}

fn escaped(value: &str) -> String {
    globset::escape(&normalize_separators(value))
}

fn optional_escaped(value: Option<&String>) -> String {
    value
        .map(|value| escaped(value))
        .unwrap_or_else(|| SKIP.into())
}

struct CommonReplacements<'a> {
    root: Option<&'a str>,
    home: &'a str,
    app_data: &'a str,
    local_app_data: &'a str,
    local_app_data_low: &'a str,
    documents: &'a str,
    public: &'a str,
    program_data: &'a str,
    windows_dir: &'a str,
    xdg_data: &'a str,
    xdg_config: &'a str,
    os_username: &'a str,
}

fn replace_common(
    path: &str,
    context: &PathResolutionContext,
    replacements: CommonReplacements<'_>,
) -> String {
    path.replace("<root>", replacements.root.unwrap_or(SKIP))
        .replace("<game>", &optional_escaped(context.game_dir.as_ref()))
        .replace("<base>", &optional_escaped(context.install_dir.as_ref()))
        .replace("<home>", replacements.home)
        .replace("<storeGameId>", &globset::escape(&context.object_id))
        .replace("<storeUserId>", "*")
        .replace("<osUserName>", replacements.os_username)
        .replace("<winAppData>", replacements.app_data)
        .replace("%APPDATA%", replacements.app_data)
        .replace("<winLocalAppData>", replacements.local_app_data)
        .replace("%LOCALAPPDATA%", replacements.local_app_data)
        .replace("<winLocalAppDataLow>", replacements.local_app_data_low)
        .replace("<winDocuments>", replacements.documents)
        .replace("<winPublic>", replacements.public)
        .replace("<winProgramData>", replacements.program_data)
        .replace("<winDir>", replacements.windows_dir)
        .replace("<xdgData>", replacements.xdg_data)
        .replace("<xdgConfig>", replacements.xdg_config)
}

fn native_candidate(path: &str, context: &PathResolutionContext, root: Option<&str>) -> String {
    let windows = context.platform == "windows";
    let home = escaped(&context.home_dir);
    let app_data = optional_escaped(context.app_data_dir.as_ref());
    let local_app_data = optional_escaped(context.local_app_data_dir.as_ref());
    let local_app_data_low = optional_escaped(context.local_app_data_low_dir.as_ref());
    let documents = optional_escaped(context.documents_dir.as_ref());
    let public = optional_escaped(context.public_dir.as_ref());
    let program_data = optional_escaped(context.program_data_dir.as_ref());
    let windows_dir = optional_escaped(context.windows_dir.as_ref());
    let xdg_data = optional_escaped(context.xdg_data_dir.as_ref());
    let xdg_config = optional_escaped(context.xdg_config_dir.as_ref());
    let os_username = globset::escape(&context.os_username);
    replace_common(
        path,
        context,
        CommonReplacements {
            root,
            home: &home,
            app_data: if windows { &app_data } else { SKIP },
            local_app_data: if windows { &local_app_data } else { SKIP },
            local_app_data_low: if windows { &local_app_data_low } else { SKIP },
            documents: if windows { &documents } else { SKIP },
            public: if windows { &public } else { SKIP },
            program_data: if windows { &program_data } else { SKIP },
            windows_dir: if windows { &windows_dir } else { SKIP },
            xdg_data: if windows { SKIP } else { &xdg_data },
            xdg_config: if windows { SKIP } else { &xdg_config },
            os_username: &os_username,
        },
    )
}

fn wine_candidates(path: &str, context: &PathResolutionContext, prefix: &str) -> Vec<String> {
    let prefix = escaped(prefix);
    let drive = format!("{prefix}/drive_*");
    let common = |documents: String, app_data: String, local_app_data: String| {
        replace_common(
            path,
            context,
            CommonReplacements {
                root: Some(&prefix),
                home: &format!("{drive}/users/*"),
                app_data: &app_data,
                local_app_data: &local_app_data,
                local_app_data_low: &format!("{drive}/users/*/AppData/LocalLow"),
                documents: &documents,
                public: &format!("{drive}/users/Public"),
                program_data: &format!("{drive}/ProgramData"),
                windows_dir: &format!("{drive}/windows"),
                xdg_data: &optional_escaped(context.xdg_data_dir.as_ref()),
                xdg_config: &optional_escaped(context.xdg_config_dir.as_ref()),
                os_username: "*",
            },
        )
    };

    vec![
        common(
            format!("{drive}/users/*/Documents"),
            format!("{drive}/users/*/AppData/Roaming"),
            format!("{drive}/users/*/AppData/Local"),
        ),
        common(
            format!("{drive}/users/*/My Documents"),
            format!("{drive}/users/*/Application Data"),
            format!("{drive}/users/*/Local Settings/Application Data"),
        ),
    ]
}

fn steam_proton_candidates(path: &str, context: &PathResolutionContext, root: &str) -> Vec<String> {
    let root = escaped(root);
    let prefix = format!(
        "{root}/steamapps/compatdata/{}/pfx/drive_c",
        globset::escape(&context.object_id)
    );
    let common = |documents: String, app_data: String, local_app_data: String| {
        replace_common(
            path,
            context,
            CommonReplacements {
                root: Some(&root),
                home: &format!("{prefix}/users/steamuser"),
                app_data: &app_data,
                local_app_data: &local_app_data,
                local_app_data_low: &format!("{prefix}/users/steamuser/AppData/LocalLow"),
                documents: &documents,
                public: &format!("{prefix}/users/Public"),
                program_data: &format!("{prefix}/ProgramData"),
                windows_dir: &format!("{prefix}/windows"),
                xdg_data: &optional_escaped(context.xdg_data_dir.as_ref()),
                xdg_config: &optional_escaped(context.xdg_config_dir.as_ref()),
                os_username: "steamuser",
            },
        )
    };

    vec![
        common(
            format!("{prefix}/users/steamuser/Documents"),
            format!("{prefix}/users/steamuser/AppData/Roaming"),
            format!("{prefix}/users/steamuser/AppData/Local"),
        ),
        common(
            format!("{prefix}/users/steamuser/My Documents"),
            format!("{prefix}/users/steamuser/Application Data"),
            format!("{prefix}/users/steamuser/Local Settings/Application Data"),
        ),
    ]
}

fn virtual_store_candidate(path: &str, context: &PathResolutionContext) -> Option<String> {
    if context.platform != "windows" {
        return None;
    }
    let local = optional_escaped(context.local_app_data_dir.as_ref());
    [
        "C:/Program Files/",
        "C:/Program Files (x86)/",
        "C:/Windows/",
        "C:/ProgramData/",
    ]
    .into_iter()
    .find_map(|prefix| {
        path.strip_prefix(prefix).map(|suffix| {
            format!(
                "{local}/VirtualStore/{}/{}",
                prefix.trim_start_matches("C:/").trim_end_matches('/'),
                suffix
            )
        })
    })
}

fn remaining_tokens(path: &str) -> Vec<String> {
    let mut tokens = Vec::new();
    let mut rest = path;
    while let Some(start) = rest.find('<') {
        let after = &rest[start..];
        let Some(end) = after.find('>') else {
            break;
        };
        let token = &after[..=end];
        if !tokens.iter().any(|existing| existing == token) {
            tokens.push(token.to_string());
        }
        rest = &after[end + 1..];
    }
    tokens
}

fn add_candidate(
    candidates: &mut Vec<ResolvedPathCandidate>,
    seen: &mut HashSet<(String, bool)>,
    path: String,
    case_sensitive: bool,
    dynamic: bool,
) {
    if path.contains('<') {
        return;
    }
    let path = normalize_separators(&path);
    if seen.insert((path.clone(), case_sensitive)) {
        candidates.push(ResolvedPathCandidate {
            path,
            case_sensitive,
            has_dynamic_root: dynamic,
            scan_root: None,
        });
    }
}

pub fn resolve_path(raw_path: &str, context: &PathResolutionContext) -> ResolvedPath {
    let raw_path = normalize_separators(raw_path)
        .replace("*<storeUserId>", "<storeUserId>")
        .replace("<storeUserId>*", "<storeUserId>");
    let dynamic_store_user = raw_path.contains("<storeUserId>");
    let mut candidates = Vec::new();
    let mut seen = HashSet::new();
    let case_sensitive = context.platform == "linux";

    add_candidate(
        &mut candidates,
        &mut seen,
        native_candidate(&raw_path, context, None),
        case_sensitive,
        dynamic_store_user,
    );

    for root in &context.steam_roots {
        let root = escaped(root);
        add_candidate(
            &mut candidates,
            &mut seen,
            native_candidate(&raw_path, context, Some(&root)),
            case_sensitive,
            dynamic_store_user,
        );
    }

    if context.platform == "windows" && raw_path.contains("<home>/Saved Games/") {
        if let Some(saved_games) = &context.saved_games_dir {
            let replaced =
                raw_path.replace("<home>/Saved Games/", &format!("{}/", escaped(saved_games)));
            add_candidate(
                &mut candidates,
                &mut seen,
                native_candidate(&replaced, context, None),
                false,
                dynamic_store_user,
            );
        }
    }

    if let Some(candidate) = virtual_store_candidate(&raw_path, context) {
        add_candidate(
            &mut candidates,
            &mut seen,
            candidate,
            false,
            dynamic_store_user,
        );
    }

    if context.platform == "linux" && context.shop == "steam" {
        for root in &context.steam_roots {
            for candidate in steam_proton_candidates(&raw_path, context, root) {
                add_candidate(
                    &mut candidates,
                    &mut seen,
                    candidate,
                    false,
                    dynamic_store_user,
                );
            }
        }
    }

    if let Some(prefix) = &context.wine_prefix_path {
        for candidate in wine_candidates(&raw_path, context, prefix) {
            add_candidate(&mut candidates, &mut seen, candidate, false, true);
        }
    }

    if let Some(scan_root_raw) = raw_glob_base(&raw_path) {
        let scan_roots = resolve_path(&scan_root_raw, context).candidates;
        for candidate in &mut candidates {
            candidate.scan_root = scan_roots
                .iter()
                .filter(|root| {
                    candidate.path == root.path
                        || candidate.path.starts_with(&format!("{}/", root.path))
                })
                .max_by_key(|root| root.path.len())
                .map(|root| root.path.clone());
        }
    }

    let unresolved_tokens = if candidates.is_empty() {
        let mut tokens = remaining_tokens(&raw_path);
        if tokens.is_empty() {
            tokens = PATH_RESOLUTION_TOKENS
                .iter()
                .filter(|token| raw_path.contains(**token))
                .map(|token| (*token).to_string())
                .collect();
        }
        tokens
    } else {
        Vec::new()
    };

    ResolvedPath {
        candidates,
        unresolved_tokens,
    }
}

fn raw_glob_base(raw_path: &str) -> Option<String> {
    let normalized = normalize_separators(raw_path);
    let parts = normalized.split('/').collect::<Vec<_>>();
    let first_glob = parts.iter().position(|segment| is_glob_segment(segment))?;
    Some(match first_glob {
        0 => ".".to_string(),
        index => parts[..index].join("/"),
    })
}

fn is_glob_segment(segment: &str) -> bool {
    segment.contains(['*', '?', '[', '{'])
}

fn is_system_wine_profile(parent: &Path, name: &str) -> bool {
    let parent = parent
        .to_string_lossy()
        .replace('\\', "/")
        .to_ascii_lowercase();
    if !parent.ends_with("/users") {
        return false;
    }
    matches!(
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

fn materialize_dynamic_candidate(pattern: &str, case_sensitive: bool) -> Vec<String> {
    let normalized = normalize_separators(pattern);
    let absolute = normalized.starts_with('/');
    let segments = normalized
        .split('/')
        .filter(|segment| !segment.is_empty())
        .collect::<Vec<_>>();
    let Some(last_dynamic) = segments
        .iter()
        .rposition(|segment| is_glob_segment(segment))
    else {
        return vec![normalized];
    };
    let mut paths = if absolute {
        vec![PathBuf::from("/")]
    } else if segments
        .first()
        .is_some_and(|segment| segment.ends_with(':'))
    {
        vec![PathBuf::from(format!("{}/", segments[0]))]
    } else {
        vec![PathBuf::new()]
    };
    let start = usize::from(
        !absolute
            && segments
                .first()
                .is_some_and(|segment| segment.ends_with(':')),
    );

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
                if is_system_wine_profile(&parent, &name) {
                    continue;
                }
                if segment_matches(segment, &name, case_sensitive) {
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

fn complete_matches(candidate: &ResolvedPathCandidate, directories_only: bool) -> Vec<String> {
    let options = globetter::MatchOptions {
        case_sensitive: candidate.case_sensitive,
        require_literal_separator: true,
        require_literal_leading_dot: false,
        follow_links: true,
    };
    globetter::glob_with(&candidate.path, options)
        .ok()
        .into_iter()
        .flatten()
        .filter_map(Result::ok)
        .filter(|path| !directories_only || path.is_dir())
        .map(|path| normalize_separators(&path.to_string_lossy()))
        .collect()
}

pub fn resolve_restore_root(
    raw_path: &str,
    context: &PathResolutionContext,
    directories_only: bool,
) -> Result<String, String> {
    let resolved = resolve_path(raw_path, context);
    if resolved.candidates.is_empty() {
        return Err(format!(
            "Unresolved restore path tokens: {}",
            resolved.unresolved_tokens.join(", ")
        ));
    }
    let candidates = if context.wine_prefix_path.is_some()
        && resolved
            .candidates
            .iter()
            .any(|candidate| candidate.has_dynamic_root)
    {
        resolved
            .candidates
            .iter()
            .filter(|candidate| candidate.has_dynamic_root)
            .collect::<Vec<_>>()
    } else {
        resolved.candidates.iter().collect::<Vec<_>>()
    };

    let complete = candidates
        .iter()
        .flat_map(|candidate| complete_matches(candidate, directories_only))
        .collect::<HashSet<_>>();
    if complete.len() == 1 {
        return Ok(complete.into_iter().next().unwrap());
    }
    if complete.len() > 1 {
        return Err("cloud_save_ambiguous_restore_roots".to_string());
    }

    for candidate in candidates {
        let materialized = materialize_dynamic_candidate(&candidate.path, candidate.case_sensitive)
            .into_iter()
            .collect::<HashSet<_>>();
        if materialized.len() == 1 {
            return Ok(materialized.into_iter().next().unwrap());
        }
        if materialized.len() > 1 {
            return Err("cloud_save_ambiguous_restore_roots".to_string());
        }
    }

    Err("cloud_save_restore_root_not_found".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cloud_save::path_resolution::context::build_context;
    use crate::cloud_save::path_resolution::types::ResolveSaveRulesInput;
    use std::fs;
    use tempfile::tempdir;

    fn wine_context(prefix: &Path) -> PathResolutionContext {
        build_context(&ResolveSaveRulesInput {
            shop: "steam".into(),
            object_id: "1091500".into(),
            platform: "linux".into(),
            home_dir: "/home/victor".into(),
            documents_dir: None,
            app_data_dir: Some("/home/victor/.config".into()),
            executable_path: Some("/games/Cyberpunk 2077/bin/x64/game.exe".into()),
            wine_prefix_path: Some(prefix.display().to_string()),
            proton_path: None,
            steam_path: None,
            rules: vec![],
        })
        .unwrap()
    }

    fn windows_context(home: &Path) -> PathResolutionContext {
        build_context(&ResolveSaveRulesInput {
            shop: "steam".into(),
            object_id: "1245620".into(),
            platform: "windows".into(),
            home_dir: home.display().to_string(),
            documents_dir: Some(home.join("Documents").display().to_string()),
            app_data_dir: Some(home.join("AppData/Roaming").display().to_string()),
            executable_path: Some("C:/Games/ELDEN RING/Game/eldenring.exe".into()),
            wine_prefix_path: None,
            proton_path: None,
            steam_path: None,
            rules: vec![],
        })
        .unwrap()
    }

    #[test]
    fn ignores_files_when_resolving_dynamic_directory_root() {
        let temp = tempdir().unwrap();
        let elden_ring = temp.path().join("AppData/Roaming/EldenRing");
        let save_root = elden_ring.join("76561198000000000");
        fs::create_dir_all(&save_root).unwrap();
        fs::write(elden_ring.join("GraphicsConfig.xml"), b"config").unwrap();
        let context = windows_context(temp.path());

        let resolved =
            resolve_restore_root("<winAppData>/EldenRing/<storeUserId>", &context, true).unwrap();

        assert_eq!(resolved, normalize_separators(&save_root.to_string_lossy()));
    }

    #[test]
    fn resolves_cyberpunk_saved_games_in_wine() {
        let temp = tempdir().unwrap();
        let save_root = temp
            .path()
            .join("drive_c/users/steamuser/Saved Games/CD Projekt Red/Cyberpunk 2077");
        fs::create_dir_all(&save_root).unwrap();
        let context = wine_context(temp.path());

        let resolved = resolve_restore_root(
            "<home>/Saved Games/CD Projekt Red/Cyberpunk 2077",
            &context,
            true,
        )
        .unwrap();

        assert_eq!(resolved, normalize_separators(&save_root.to_string_lossy()));
    }

    #[test]
    fn materializes_deleted_cyberpunk_folder_for_restore() {
        let temp = tempdir().unwrap();
        fs::create_dir_all(temp.path().join("drive_c/users/steamuser")).unwrap();
        let context = wine_context(temp.path());

        let resolved = resolve_restore_root(
            "<home>/Saved Games/CD Projekt Red/Cyberpunk 2077",
            &context,
            true,
        )
        .unwrap();

        assert_eq!(
            resolved,
            normalize_separators(
                &temp
                    .path()
                    .join("drive_c/users/steamuser/Saved Games/CD Projekt Red/Cyberpunk 2077")
                    .to_string_lossy()
            )
        );
    }

    #[test]
    fn resolves_tlou_store_user_id_as_wildcard() {
        let temp = tempdir().unwrap();
        let save_root = temp.path().join(
            "drive_c/users/steamuser/Saved Games/The Last of Us Part I/users/Goldberg/savedata",
        );
        fs::create_dir_all(&save_root).unwrap();
        let context = wine_context(temp.path());

        let resolved = resolve_restore_root(
            "<home>/Saved Games/The Last of Us Part I/users/<storeUserId>/savedata",
            &context,
            true,
        )
        .unwrap();

        assert_eq!(resolved, normalize_separators(&save_root.to_string_lossy()));
    }

    #[test]
    fn rejects_multiple_tlou_users() {
        let temp = tempdir().unwrap();
        for user in ["Goldberg", "Rune"] {
            fs::create_dir_all(temp.path().join(format!(
                "drive_c/users/steamuser/Saved Games/The Last of Us Part I/users/{user}/savedata"
            )))
            .unwrap();
        }
        let context = wine_context(temp.path());

        let error = resolve_restore_root(
            "<home>/Saved Games/The Last of Us Part I/users/<storeUserId>/savedata",
            &context,
            true,
        )
        .unwrap_err();

        assert_eq!(error, "cloud_save_ambiguous_restore_roots");
    }

    #[test]
    fn exposes_ludusavi_wine_aliases_and_placeholders() {
        let temp = tempdir().unwrap();
        let context = wine_context(temp.path());
        let resolved = resolve_path(
            "<root>/<game>/<storeGameId>/<winDocuments>/<winAppData>/<winLocalAppData>/<winLocalAppDataLow>/<winDir>/<xdgData>/<xdgConfig>/<osUserName>",
            &context,
        );

        assert!(resolved.unresolved_tokens.is_empty());
        assert!(resolved.candidates.iter().any(|candidate| {
            candidate.path.contains("users/*/Documents")
                && candidate.path.contains("users/*/AppData/Roaming")
        }));
        assert!(resolved.candidates.iter().any(|candidate| {
            candidate.path.contains("users/*/My Documents")
                && candidate.path.contains("users/*/Application Data")
        }));
        assert!(resolved
            .candidates
            .iter()
            .all(|candidate| !candidate.path.contains('<')));
    }

    #[test]
    fn resolves_balatro_on_mac_linux_and_wine() {
        let temp = tempdir().unwrap();
        let wine = wine_context(temp.path());
        let wine_rule = resolve_path("<winAppData>/Balatro", &wine);
        assert!(wine_rule.candidates.iter().any(|candidate| candidate
            .path
            .contains("drive_*/users/*/AppData/Roaming/Balatro")));

        let mut linux_input = ResolveSaveRulesInput {
            shop: "steam".into(),
            object_id: "2379780".into(),
            platform: "linux".into(),
            home_dir: "/home/player".into(),
            documents_dir: Some("/home/player/Documents".into()),
            app_data_dir: Some("/home/player/.config".into()),
            executable_path: None,
            wine_prefix_path: None,
            proton_path: None,
            steam_path: None,
            rules: vec![],
        };
        let linux = build_context(&linux_input).unwrap();
        assert!(resolve_path("<xdgConfig>/Balatro", &linux)
            .candidates
            .iter()
            .any(|candidate| candidate.path == "/home/player/.config/Balatro"));
        let recursive = resolve_path("<home>/Profiles/**/*.dat", &linux);
        assert!(recursive
            .candidates
            .iter()
            .any(|candidate| { candidate.scan_root.as_deref() == Some("/home/player/Profiles") }));

        linux_input.platform = "mac".into();
        linux_input.home_dir = "/Users/player".into();
        linux_input.app_data_dir = Some("/Users/player/Library/Application Support".into());
        let mac = build_context(&linux_input).unwrap();
        assert!(
            resolve_path("<home>/Library/Application Support/Balatro", &mac)
                .candidates
                .iter()
                .any(|candidate| {
                    candidate.path == "/Users/player/Library/Application Support/Balatro"
                        && !candidate.case_sensitive
                })
        );
    }

    #[test]
    fn discards_unknown_manifest_placeholders() {
        let temp = tempdir().unwrap();
        let context = wine_context(temp.path());

        let resolved = resolve_path("<futureToken>/save.dat", &context);

        assert!(resolved.candidates.is_empty());
        assert_eq!(resolved.unresolved_tokens, vec!["<futureToken>"]);
    }
}
