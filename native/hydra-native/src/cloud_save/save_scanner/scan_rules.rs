use std::collections::HashSet;

use crate::cloud_save::identity::{local_id, UserLocationCoverage};
use crate::cloud_save::path_resolution::{capture_template, ResolvedCloudSaveRule};

use super::scan_path::scan_resolved_path_with_capture;
use super::types::{ScannedCloudSavePath, ScannedCloudSaveRule};

pub fn scan_rules(rules: Vec<ResolvedCloudSaveRule>) -> Result<Vec<ScannedCloudSaveRule>, String> {
    rules
        .into_iter()
        .map(|rule| {
            let mut selected_paths = Vec::<ScannedCloudSavePath>::new();
            let mut coverage = Vec::<UserLocationCoverage>::new();
            let user_bound = rule.raw_path.contains("<storeUserId>");

            if rule.unresolved_tokens.is_empty() {
                for candidate in &rule.resolved_paths {
                    let template = capture_template(&rule.raw_path, &candidate.path);
                    let scanned_paths = match scan_resolved_path_with_capture(
                        &candidate.path,
                        candidate.case_sensitive,
                        candidate.scan_root.as_deref(),
                        template.as_deref(),
                    ) {
                        Ok(paths) => paths,
                        Err(error) => {
                            coverage.push(UserLocationCoverage {
                                candidate_id: local_id(&[&candidate.path]),
                                rule_id: rule.rule_id.clone(),
                                variant_id: None,
                                logical_file_id: None,
                                authority: "inferred".to_string(),
                                outcome: "failed".to_string(),
                                enumerated_completely: false,
                                warning_codes: vec![error
                                    .split(':')
                                    .next()
                                    .unwrap_or("cloud_save_filesystem_error")
                                    .to_string()],
                            });
                            continue;
                        }
                    };
                    let shared_scan_root = candidate.scan_root.as_deref().and_then(|root| {
                        std::fs::canonicalize(root)
                            .ok()
                            .map(|root| root.to_string_lossy().replace('\\', "/"))
                    });
                    if scanned_paths.is_empty() {
                        coverage.push(UserLocationCoverage {
                            candidate_id: local_id(&[&candidate.path]),
                            rule_id: rule.rule_id.clone(),
                            variant_id: None,
                            logical_file_id: None,
                            authority: "inferred".to_string(),
                            outcome: "confirmed-missing".to_string(),
                            enumerated_completely: true,
                            warning_codes: vec![],
                        });
                    }
                    let mut selected_concrete_root = false;
                    for scanned in scanned_paths {
                        let is_shared_scan_root = shared_scan_root
                            .as_ref()
                            .is_some_and(|root| root == &scanned.resolved_path);
                        let outcome = if scanned.files.is_empty() {
                            "scanned"
                        } else {
                            "scanned"
                        };
                        coverage.push(UserLocationCoverage {
                            candidate_id: scanned.candidate_id.clone(),
                            rule_id: rule.rule_id.clone(),
                            variant_id: None,
                            logical_file_id: None,
                            authority: "inferred".to_string(),
                            outcome: outcome.to_string(),
                            enumerated_completely: true,
                            warning_codes: vec![],
                        });

                        if scanned.files.is_empty() {
                            continue;
                        }
                        if user_bound {
                            if !is_shared_scan_root && scanned.store_user_id.is_some() {
                                selected_paths.push(scanned);
                            }
                        } else if is_shared_scan_root || !selected_concrete_root {
                            selected_concrete_root |= !is_shared_scan_root;
                            selected_paths.push(scanned);
                        }
                    }

                    if !user_bound && !selected_paths.is_empty() {
                        let mut seen_absolute_paths = HashSet::new();
                        let mut seen_relative_paths = HashSet::new();
                        for scanned in &mut selected_paths {
                            scanned.files.retain(|file| {
                                seen_absolute_paths.insert(file.absolute_path.clone())
                                    && seen_relative_paths.insert(file.relative_path.clone())
                            });
                        }
                        selected_paths.retain(|scanned| !scanned.files.is_empty());
                        break;
                    }
                }
            }

            if user_bound {
                let mut seen = HashSet::new();
                for scanned in &mut selected_paths {
                    scanned.files.retain(|file| {
                        seen.insert((scanned.store_user_id.clone(), file.absolute_path.clone()))
                    });
                }
                selected_paths.retain(|scanned| !scanned.files.is_empty());
                selected_paths.sort_by(|left, right| {
                    left.store_user_id
                        .cmp(&right.store_user_id)
                        .then_with(|| left.resolved_path.cmp(&right.resolved_path))
                });
            }

            Ok(ScannedCloudSaveRule {
                rule_id: rule.rule_id,
                kind: rule.kind,
                raw_path: rule.raw_path,
                source: rule.source,
                tags: rule.tags,
                when: rule.when,
                resolved_paths: rule.resolved_paths,
                unresolved_tokens: rule.unresolved_tokens,
                scanned_paths: selected_paths,
                coverage,
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
            steam_path: None,
            rules: vec![CloudSaveRule {
                rule_id: "test-rule".into(),
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
    fn preserves_same_relative_file_across_store_users() {
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

        assert_eq!(scanned[0].scanned_paths.len(), 2);
        assert_eq!(
            scanned[0]
                .scanned_paths
                .iter()
                .flat_map(|path| &path.files)
                .count(),
            2
        );
        let users = scanned[0]
            .scanned_paths
            .iter()
            .filter_map(|path| path.store_user_id.as_deref())
            .collect::<Vec<_>>();
        assert_eq!(users, vec!["Goldberg", "Rune"]);
    }

    #[test]
    fn does_not_mix_different_logical_files_across_store_users() {
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

        let paths = &scanned[0].scanned_paths;
        assert_eq!(paths.len(), 2);
        assert_eq!(paths[0].files.len(), 1);
        assert_eq!(paths[1].files.len(), 1);
        assert_eq!(paths[0].store_user_id.as_deref(), Some("Goldberg"));
        assert_eq!(paths[1].store_user_id.as_deref(), Some("Rune"));
        assert_eq!(paths[0].files[0].relative_path, "slot.dat");
        assert_eq!(paths[1].files[0].relative_path, "profile.dat");
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
            rule_id: "test-rule".into(),
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
    fn scans_hydra_launcher_prefix_without_mixing_steam_compatdata() {
        let temp = tempdir().unwrap();
        let steam_root = temp.path().join("SteamLibrary");
        let executable = steam_root.join("steamapps/common/Cyberpunk 2077/game.exe");
        let proton_save = steam_root.join(
            "steamapps/compatdata/1091500/pfx/drive_c/users/steamuser/AppData/Local/CD Projekt Red/Cyberpunk 2077",
        );
        let hydra_prefix = temp.path().join("hydra-prefix");
        let hydra_save = hydra_prefix
            .join("drive_c/users/steamuser/AppData/Local/CD Projekt Red/Cyberpunk 2077");
        fs::create_dir_all(executable.parent().unwrap()).unwrap();
        fs::write(&executable, b"exe").unwrap();
        fs::create_dir_all(&proton_save).unwrap();
        fs::create_dir_all(&hydra_save).unwrap();
        fs::write(proton_save.join("UserSettings.json"), b"steam-old").unwrap();
        fs::write(hydra_save.join("UserSettings.json"), b"hydra-active").unwrap();

        let rules = resolve_save_rules(ResolveSaveRulesInput {
            shop: "steam".into(),
            object_id: "1091500".into(),
            platform: "linux".into(),
            home_dir: "/home/victor".into(),
            documents_dir: None,
            app_data_dir: None,
            executable_path: Some(executable.display().to_string()),
            wine_prefix_path: Some(hydra_prefix.display().to_string()),
            steam_path: None,
            rules: vec![CloudSaveRule {
                rule_id: "test-rule".into(),
                kind: "dir".into(),
                raw_path: "<winLocalAppData>/CD Projekt Red/Cyberpunk 2077".into(),
                source: "ludusavi".into(),
                tags: vec!["save".into()],
                when: vec![],
            }],
        })
        .unwrap();

        let scanned = scan_rules(rules).unwrap();
        let files = scanned[0]
            .scanned_paths
            .iter()
            .flat_map(|path| &path.files)
            .collect::<Vec<_>>();

        assert_eq!(files.len(), 1);
        assert!(files[0].absolute_path.starts_with(
            &fs::canonicalize(hydra_prefix)
                .unwrap()
                .display()
                .to_string()
                .replace('\\', "/")
        ));
        assert!(!files[0].absolute_path.contains("/compatdata/"));
    }

    #[test]
    fn active_empty_prefix_does_not_fall_back_to_host_home() {
        let temp = tempdir().unwrap();
        let active_prefix = temp.path().join("hydralauncher/wine-prefixes/953490");
        let active_profile = active_prefix.join("drive_c/users/steamuser");
        let old_home = temp.path().join("old-prefix/drive_c/users/steamuser");
        let old_save = old_home.join("AppData/LocalLow/Phobia/Carrion");
        fs::create_dir_all(&active_profile).unwrap();
        fs::create_dir_all(&old_save).unwrap();
        fs::write(old_save.join("settings.json"), b"old").unwrap();

        let rules = resolve_save_rules(ResolveSaveRulesInput {
            shop: "steam".into(),
            object_id: "953490".into(),
            platform: "linux".into(),
            home_dir: old_home.display().to_string(),
            documents_dir: None,
            app_data_dir: None,
            executable_path: Some("/games/Carrion/Carrion.exe".into()),
            wine_prefix_path: Some(active_prefix.display().to_string()),
            steam_path: None,
            rules: vec![CloudSaveRule {
                rule_id: "test-rule".into(),
                kind: "dir".into(),
                raw_path: "<home>/AppData/LocalLow/Phobia/Carrion".into(),
                source: "ludusavi".into(),
                tags: vec!["save".into()],
                when: vec![],
            }],
        })
        .unwrap();

        let scanned = scan_rules(rules).unwrap();

        assert!(scanned[0].scanned_paths.is_empty());
        let active_prefix = active_prefix.display().to_string().replace('\\', "/");
        assert!(scanned[0]
            .resolved_paths
            .iter()
            .all(|candidate| candidate.path.starts_with(&active_prefix)));
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
            rule_id: "test-rule".into(),
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

        assert_eq!(files.len(), 1);
        assert!(files.iter().any(|path| path.ends_with("ER0000.sl2")));
    }

    #[test]
    fn unresolved_rule_returns_empty_scan() {
        let scanned = scan_rules(vec![ResolvedCloudSaveRule {
            rule_id: "test-rule".into(),
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
            rule_id: "test-rule".into(),
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
