use std::collections::HashSet;

use crate::cloud_save::path_resolution::ResolvedCloudSaveRule;

use super::scan_path::scan_resolved_path;
use super::types::{ScannedCloudSavePath, ScannedCloudSaveRule};

pub fn scan_rules(rules: Vec<ResolvedCloudSaveRule>) -> Result<Vec<ScannedCloudSaveRule>, String> {
    rules
        .into_iter()
        .map(|rule| {
            let mut selected_paths = Vec::<ScannedCloudSavePath>::new();

            if rule.unresolved_tokens.is_empty() {
                for candidate in &rule.resolved_paths {
                    let mut scanned_paths = scan_resolved_path(
                        &candidate.path,
                        candidate.case_sensitive,
                        candidate.scan_root.as_deref(),
                    )?;
                    let mut seen_absolute_paths = HashSet::new();
                    let mut seen_relative_paths = HashSet::new();

                    for scanned in &mut scanned_paths {
                        scanned.files.retain(|file| {
                            if seen_absolute_paths.contains(&file.absolute_path)
                                || seen_relative_paths.contains(&file.relative_path)
                            {
                                return false;
                            }

                            seen_absolute_paths.insert(file.absolute_path.clone());
                            seen_relative_paths.insert(file.relative_path.clone());
                            true
                        });
                    }

                    scanned_paths.retain(|scanned| !scanned.files.is_empty());
                    if !scanned_paths.is_empty() {
                        selected_paths = scanned_paths;
                        break;
                    }
                }
            }

            Ok(ScannedCloudSaveRule {
                kind: rule.kind,
                raw_path: rule.raw_path,
                source: rule.source,
                tags: rule.tags,
                when: rule.when,
                resolved_paths: rule.resolved_paths,
                unresolved_tokens: rule.unresolved_tokens,
                scanned_paths: selected_paths,
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use std::fs;

    use tempfile::tempdir;

    use super::*;
    use crate::cloud_save::manifest::types::CloudSaveRule;
    use crate::cloud_save::path_resolution::{
        resolve_save_rules, ResolveSaveRulesInput, ResolvedCloudSavePath,
    };

    fn resolve(prefix: &std::path::Path, raw_path: &str) -> Vec<ResolvedCloudSaveRule> {
        resolve_save_rules(ResolveSaveRulesInput {
            shop: "steam".into(),
            object_id: "1888930".into(),
            platform: "linux".into(),
            home_dir: "/home/victor".into(),
            documents_dir: None,
            app_data_dir: None,
            executable_path: Some("/games/TLOU/tlou-i.exe".into()),
            wine_prefix_path: Some(prefix.display().to_string()),
            wine_prefix_is_explicit: Some(true),
            steam_path: None,
            rules: vec![CloudSaveRule {
                kind: "dir".into(),
                raw_path: raw_path.into(),
                source: "ludusavi".into(),
                tags: vec!["save".into()],
                when: vec![],
            }],
        })
        .unwrap()
    }

    #[test]
    fn deduplicates_same_logical_file_across_store_users() {
        let temp = tempdir().unwrap();
        for user in ["Goldberg", "Rune"] {
            let root = temp.path().join(format!(
                "drive_c/users/steamuser/Saved Games/The Last of Us Part I/users/{user}/savedata"
            ));
            fs::create_dir_all(&root).unwrap();
            fs::write(root.join("slot.dat"), user.as_bytes()).unwrap();
        }

        let scanned = scan_rules(resolve(
            temp.path(),
            "<home>/Saved Games/The Last of Us Part I/users/<storeUserId>/savedata",
        ))
        .unwrap();

        assert_eq!(scanned[0].scanned_paths.len(), 1);
        assert_eq!(
            scanned[0]
                .scanned_paths
                .iter()
                .flat_map(|path| &path.files)
                .count(),
            1
        );
    }

    #[test]
    fn keeps_different_logical_files_across_store_users() {
        let temp = tempdir().unwrap();
        for (user, file) in [("Goldberg", "slot.dat"), ("Rune", "profile.dat")] {
            let root = temp.path().join(format!(
                "drive_c/users/steamuser/Saved Games/The Last of Us Part I/users/{user}/savedata"
            ));
            fs::create_dir_all(&root).unwrap();
            fs::write(root.join(file), user.as_bytes()).unwrap();
        }

        let scanned = scan_rules(resolve(
            temp.path(),
            "<home>/Saved Games/The Last of Us Part I/users/<storeUserId>/savedata",
        ))
        .unwrap();

        assert_eq!(
            scanned[0]
                .scanned_paths
                .iter()
                .flat_map(|path| &path.files)
                .count(),
            2
        );
    }

    #[test]
    fn prefers_modern_windows_aliases() {
        let temp = tempdir().unwrap();
        let cases = [
            ("<winDocuments>/Docs", "Documents/Docs", "My Documents/Docs"),
            (
                "<winAppData>/Roaming",
                "AppData/Roaming/Roaming",
                "Application Data/Roaming",
            ),
            (
                "<winLocalAppData>/Local",
                "AppData/Local/Local",
                "Local Settings/Application Data/Local",
            ),
        ];

        for (raw_path, modern, legacy) in cases {
            let user = temp.path().join("drive_c/users/steamuser");
            fs::create_dir_all(user.join(modern)).unwrap();
            fs::create_dir_all(user.join(legacy)).unwrap();
            fs::write(user.join(modern).join("save.dat"), b"modern").unwrap();
            fs::write(user.join(legacy).join("save.dat"), b"legacy").unwrap();

            let scanned = scan_rules(resolve(temp.path(), raw_path)).unwrap();
            let files = scanned[0]
                .scanned_paths
                .iter()
                .flat_map(|path| &path.files)
                .collect::<Vec<_>>();

            assert_eq!(files.len(), 1);
            assert!(files[0].absolute_path.contains(modern));
        }
    }

    #[test]
    fn active_root_wins_without_mixing_fallback_files() {
        let temp = tempdir().unwrap();
        let active = temp.path().join("active");
        let fallback = temp.path().join("fallback");
        fs::create_dir_all(&active).unwrap();
        fs::create_dir_all(&fallback).unwrap();
        fs::write(active.join("save.dat"), b"active").unwrap();
        fs::write(fallback.join("save.dat"), b"fallback").unwrap();
        fs::write(fallback.join("extra.dat"), b"fallback-only").unwrap();

        let scanned = scan_rules(vec![ResolvedCloudSaveRule {
            kind: "dir".into(),
            raw_path: "<winAppData>/Game".into(),
            source: "test".into(),
            tags: vec!["save".into()],
            when: vec![],
            resolved_paths: vec![
                ResolvedCloudSavePath {
                    path: active.display().to_string(),
                    case_sensitive: true,
                    dynamic: false,
                    scan_root: None,
                },
                ResolvedCloudSavePath {
                    path: fallback.display().to_string(),
                    case_sensitive: true,
                    dynamic: false,
                    scan_root: None,
                },
            ],
            unresolved_tokens: vec![],
        }])
        .unwrap();
        let files = &scanned[0].scanned_paths[0].files;
        let active = fs::canonicalize(active)
            .unwrap()
            .to_string_lossy()
            .replace('\\', "/");

        assert_eq!(files.len(), 1);
        assert!(files[0].absolute_path.starts_with(&active));
    }

    #[test]
    fn scans_elden_ring_file_and_user_directory() {
        let temp = tempdir().unwrap();
        let root = temp.path().join("EldenRing");
        let user = root.join("76561198000000000");
        fs::create_dir_all(&user).unwrap();
        fs::write(root.join("GraphicsConfig.xml"), b"config").unwrap();
        fs::write(user.join("ER0000.sl2"), b"save").unwrap();

        let scanned = scan_rules(vec![ResolvedCloudSaveRule {
            kind: "dir".into(),
            raw_path: "<winAppData>/EldenRing/<storeUserId>".into(),
            source: "ludusavi".into(),
            tags: vec!["save".into()],
            when: vec![],
            resolved_paths: vec![ResolvedCloudSavePath {
                path: format!("{}/*", root.display()),
                case_sensitive: false,
                dynamic: true,
                scan_root: Some(root.display().to_string()),
            }],
            unresolved_tokens: vec![],
        }])
        .unwrap();

        let files = scanned[0]
            .scanned_paths
            .iter()
            .flat_map(|path| &path.files)
            .map(|file| file.absolute_path.as_str())
            .collect::<Vec<_>>();

        assert_eq!(files.len(), 2);
        assert!(files
            .iter()
            .any(|path| path.ends_with("GraphicsConfig.xml")));
        assert!(files.iter().any(|path| path.ends_with("ER0000.sl2")));
    }

    #[test]
    fn unresolved_rule_returns_empty_scan() {
        let scanned = scan_rules(vec![ResolvedCloudSaveRule {
            kind: "dir".into(),
            raw_path: "<unknown>/save".into(),
            source: "ludusavi".into(),
            tags: vec!["save".into()],
            when: vec![],
            resolved_paths: vec![],
            unresolved_tokens: vec!["<unknown>".into()],
        }])
        .unwrap();

        assert!(scanned[0].scanned_paths.is_empty());
    }

    #[test]
    fn deduplicates_overlapping_paths_within_a_rule() {
        let temp = tempdir().unwrap();
        fs::write(temp.path().join("save.dat"), b"save").unwrap();
        let candidate = ResolvedCloudSavePath {
            path: temp.path().display().to_string(),
            case_sensitive: true,
            dynamic: false,
            scan_root: None,
        };

        let scanned = scan_rules(vec![ResolvedCloudSaveRule {
            kind: "file".into(),
            raw_path: "ignored-kind".into(),
            source: "ludusavi".into(),
            tags: vec!["save".into()],
            when: vec![],
            resolved_paths: vec![candidate.clone(), candidate],
            unresolved_tokens: vec![],
        }])
        .unwrap();

        assert_eq!(scanned[0].scanned_paths.len(), 1);
        assert_eq!(scanned[0].scanned_paths[0].files.len(), 1);
    }
}
