use std::collections::HashSet;
use std::path::Path;

use crate::cloud_save::identity::{local_id, UserLocationCoverage};
use crate::cloud_save::path_resolution::{
    capture_template, ResolvedCloudSaveRule, FOREIGN_ENVIRONMENT_TOKEN,
};

use super::scan_path::scan_resolved_path_with_capture;
use super::types::{ScannedCloudSavePath, ScannedCloudSaveRule};

fn store_user_capture_is_in_leaf(raw_path: &str) -> bool {
    raw_path
        .rsplit(|character| character == '/' || character == '\\')
        .next()
        .is_some_and(|leaf| leaf.contains("<storeUserId>"))
}

pub fn scan_rules(rules: Vec<ResolvedCloudSaveRule>) -> Result<Vec<ScannedCloudSaveRule>, String> {
    rules
        .into_iter()
        .map(|rule| {
            let mut selected_paths = Vec::<ScannedCloudSavePath>::new();
            let mut coverage = Vec::<UserLocationCoverage>::new();
            let user_bound = rule.raw_path.contains("<storeUserId>");
            let store_user_capture_in_leaf =
                rule.kind == "file" && store_user_capture_is_in_leaf(&rule.raw_path);
            if rule
                .unresolved_tokens
                .iter()
                .any(|token| token == FOREIGN_ENVIRONMENT_TOKEN)
            {
                coverage.push(UserLocationCoverage {
                    candidate_id: local_id(&[
                        FOREIGN_ENVIRONMENT_TOKEN,
                        &rule.rule_id,
                        &rule.raw_path,
                    ]),
                    rule_id: rule.rule_id.clone(),
                    variant_id: None,
                    raw_path: Some(rule.raw_path.clone()),
                    relative_path: None,
                    selected_root: false,
                    authority: "inferred".to_string(),
                    outcome: "foreign-environment".to_string(),
                    enumerated_completely: false,
                    warning_codes: vec![],
                });
            }

            if rule.unresolved_tokens.is_empty() {
                for candidate in &rule.resolved_paths {
                    let template = capture_template(&rule.raw_path, &candidate.path);
                    let mut scanned_paths = match scan_resolved_path_with_capture(
                        &candidate.path,
                        candidate.case_sensitive,
                        candidate.scan_root.as_deref(),
                        template.as_deref(),
                        rule.kind == "file",
                        !rule.raw_path.starts_with("<custom>"),
                    ) {
                        Ok(paths) => paths,
                        Err(error) => {
                            coverage.push(UserLocationCoverage {
                                candidate_id: local_id(&[&candidate.path]),
                                rule_id: rule.rule_id.clone(),
                                variant_id: None,
                                raw_path: Some(rule.raw_path.clone()),
                                relative_path: None,
                                selected_root: false,
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
                    if scanned_paths.is_empty() && rule.kind == "file" {
                        let exact_parent = || {
                            Path::new(&candidate.path)
                                .parent()
                                .filter(|path| path.is_dir())
                        };
                        let existing_root = if store_user_capture_in_leaf {
                            exact_parent()
                        } else {
                            candidate
                                .scan_root
                                .as_deref()
                                .map(Path::new)
                                .filter(|path| path.is_dir())
                                .or_else(exact_parent)
                        };
                        if let Some(root) = existing_root {
                            if let Ok(root) = std::fs::canonicalize(root) {
                                let resolved_path = root.to_string_lossy().replace('\\', "/");
                                scanned_paths.push(ScannedCloudSavePath {
                                    candidate_id: local_id(&[&candidate.path, &resolved_path]),
                                    resolved_path,
                                    store_user_id: None,
                                    case_sensitive: candidate.case_sensitive,
                                    files: vec![],
                                });
                            }
                        }
                    }
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
                            raw_path: Some(rule.raw_path.clone()),
                            relative_path: None,
                            selected_root: false,
                            authority: "inferred".to_string(),
                            outcome: "confirmed-missing".to_string(),
                            enumerated_completely: true,
                            warning_codes: vec![],
                        });
                    }
                    let mut selected_concrete_root = false;
                    let mut candidate_selected_paths = Vec::new();
                    let candidate_has_files = scanned_paths
                        .iter()
                        .any(|scanned| !scanned.files.is_empty());
                    if !user_bound && candidate_has_files {
                        for item in &mut coverage {
                            item.selected_root = false;
                        }
                        selected_paths.clear();
                    }
                    for scanned in &scanned_paths {
                        let is_shared_scan_root = shared_scan_root
                            .as_ref()
                            .is_some_and(|root| root == &scanned.resolved_path);
                        let selected_root = if user_bound {
                            scanned.store_user_id.is_some() || store_user_capture_in_leaf
                        } else if !selected_paths.is_empty() && !candidate_has_files {
                            false
                        } else {
                            is_shared_scan_root || !selected_concrete_root
                        };
                        if selected_root && !is_shared_scan_root {
                            selected_concrete_root = true;
                        }
                        coverage.push(UserLocationCoverage {
                            candidate_id: scanned.candidate_id.clone(),
                            rule_id: rule.rule_id.clone(),
                            variant_id: None,
                            raw_path: Some(rule.raw_path.clone()),
                            relative_path: None,
                            selected_root,
                            authority: "inferred".to_string(),
                            outcome: "scanned".to_string(),
                            enumerated_completely: true,
                            warning_codes: vec![],
                        });

                        let coverage_only =
                            store_user_capture_in_leaf && scanned.store_user_id.is_none();
                        if selected_root && !coverage_only {
                            candidate_selected_paths.push(scanned.clone());
                        }
                    }
                    selected_paths.extend(candidate_selected_paths);

                    if !user_bound && candidate_has_files {
                        let mut seen_absolute_paths = HashSet::new();
                        let mut seen_relative_paths = HashSet::new();
                        for scanned in &mut selected_paths {
                            scanned.files.retain(|file| {
                                seen_absolute_paths.insert(file.absolute_path.clone())
                                    && seen_relative_paths.insert(file.relative_path.clone())
                            });
                        }
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
                selected_paths.sort_by(|left, right| {
                    left.store_user_id
                        .cmp(&right.store_user_id)
                        .then_with(|| left.resolved_path.cmp(&right.resolved_path))
                });
                selected_paths.dedup_by(|left, right| {
                    left.store_user_id == right.store_user_id
                        && left.resolved_path == right.resolved_path
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
                preferred_path: None,
            }],
        })
        .unwrap()
    }

    fn leaf_capture_rule(root: &Path, raw_leaf: &str) -> ResolvedCloudSaveRule {
        ResolvedCloudSaveRule {
            rule_id: raw_leaf.into(),
            kind: "file".into(),
            raw_path: format!("<home>/Game/{raw_leaf}"),
            source: "ludusavi".into(),
            tags: vec!["save".into()],
            when: vec![],
            resolved_paths: vec![ResolvedCloudSavePath {
                path: root
                    .join(raw_leaf.replace("<storeUserId>", "*"))
                    .display()
                    .to_string()
                    .replace('\\', "/"),
                case_sensitive: true,
                dynamic: true,
                scan_root: Some(root.display().to_string().replace('\\', "/")),
            }],
            unresolved_tokens: vec![],
        }
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
    fn captures_a_profile_directory_above_a_matched_file() {
        let temp = tempdir().unwrap();
        let users = temp.path().join("users");
        let profile = users.join("1312205131");
        fs::create_dir_all(&profile).unwrap();
        fs::write(profile.join("screeninfo.cfg"), b"settings").unwrap();

        let scanned = scan_rules(vec![ResolvedCloudSaveRule {
            rule_id: "screeninfo".into(),
            kind: "file".into(),
            raw_path: "<home>/Game/users/<storeUserId>/screeninfo.cfg".into(),
            source: "ludusavi".into(),
            tags: vec!["save".into()],
            when: vec![],
            resolved_paths: vec![ResolvedCloudSavePath {
                path: format!("{}/*/screeninfo.cfg", users.display()),
                case_sensitive: false,
                dynamic: true,
                scan_root: Some(users.display().to_string()),
            }],
            unresolved_tokens: vec![],
        }])
        .unwrap();

        assert_eq!(scanned[0].scanned_paths.len(), 1);
        assert_eq!(
            scanned[0].scanned_paths[0].store_user_id.as_deref(),
            Some("1312205131")
        );
        assert_eq!(scanned[0].scanned_paths[0].files.len(), 1);
    }

    #[test]
    fn preserves_an_empty_profile_for_a_missing_leaf_file() {
        let temp = tempdir().unwrap();
        let profiles = temp.path().join("Sekiro");
        let empty_profile = profiles.join("76561197960267366");
        let populated_profile = profiles.join("76561199873967367");
        fs::create_dir_all(&empty_profile).unwrap();
        fs::create_dir_all(&populated_profile).unwrap();
        fs::write(populated_profile.join("S0000.sl2"), b"save").unwrap();

        let scanned = scan_rules(vec![ResolvedCloudSaveRule {
            rule_id: "sekiro-save".into(),
            kind: "file".into(),
            raw_path: "<winAppData>/Sekiro/<storeUserId>/S0000.sl2".into(),
            source: "ludusavi".into(),
            tags: vec!["save".into()],
            when: vec![],
            resolved_paths: vec![ResolvedCloudSavePath {
                path: format!("{}/*/S0000.sl2", profiles.display()),
                case_sensitive: false,
                dynamic: true,
                scan_root: Some(profiles.display().to_string()),
            }],
            unresolved_tokens: vec![],
        }])
        .unwrap();

        assert_eq!(scanned[0].scanned_paths.len(), 2);
        let empty = scanned[0]
            .scanned_paths
            .iter()
            .find(|path| path.store_user_id.as_deref() == Some("76561197960267366"))
            .unwrap();
        assert!(empty.files.is_empty());
        assert!(scanned[0].coverage.iter().any(|coverage| {
            coverage.candidate_id == empty.candidate_id
                && coverage.selected_root
                && coverage.outcome == "scanned"
                && coverage.enumerated_completely
        }));
    }

    #[test]
    fn captures_every_profile_file_matched_by_a_filename_glob() {
        let temp = tempdir().unwrap();
        let profiles = temp.path().join("Spider-Man");
        let profile = profiles.join("76561197960271872");
        fs::create_dir_all(&profile).unwrap();
        fs::write(profile.join("slot0-s.save"), b"automatic").unwrap();
        fs::write(profile.join("slot0-s-manual-0.save"), b"manual").unwrap();

        let scanned = scan_rules(vec![ResolvedCloudSaveRule {
            rule_id: "spider-man-slots".into(),
            kind: "file".into(),
            raw_path: "<winDocuments>/Marvel's Spider-Man Remastered/<storeUserId>/slot*.save"
                .into(),
            source: "ludusavi".into(),
            tags: vec!["save".into()],
            when: vec![],
            resolved_paths: vec![ResolvedCloudSavePath {
                path: format!("{}/*/slot*.save", profiles.display()),
                case_sensitive: false,
                dynamic: true,
                scan_root: Some(format!("{}/*", profiles.display())),
            }],
            unresolved_tokens: vec![],
        }])
        .unwrap();

        assert_eq!(scanned[0].scanned_paths.len(), 1);
        assert_eq!(
            scanned[0].scanned_paths[0].store_user_id.as_deref(),
            Some("76561197960271872")
        );
        assert_eq!(
            scanned[0].scanned_paths[0]
                .files
                .iter()
                .map(|file| file.relative_path.as_str())
                .collect::<Vec<_>>(),
            vec!["slot0-s-manual-0.save", "slot0-s.save"]
        );
    }

    #[test]
    fn preserves_intermediate_file_glob_matches_below_a_captured_profile() {
        let temp = tempdir().unwrap();
        let profiles = temp.path().join("Stray");
        let slots = profiles.join("76561197960267366/Slots");
        for slot in ["Slot_1", "Slot_2"] {
            let directory = slots.join(slot);
            fs::create_dir_all(&directory).unwrap();
            fs::write(directory.join("Data.sav"), slot.as_bytes()).unwrap();
        }

        let scanned = scan_rules(vec![ResolvedCloudSaveRule {
            rule_id: "stray-slots".into(),
            kind: "file".into(),
            raw_path:
                "<winLocalAppData>/Hk_project/Saved/SaveGames/<storeUserId>/Slots/Slot_*/Data.sav"
                    .into(),
            source: "ludusavi".into(),
            tags: vec!["save".into()],
            when: vec![],
            resolved_paths: vec![ResolvedCloudSavePath {
                path: format!("{}/*/Slots/Slot_*/Data.sav", profiles.display()),
                case_sensitive: false,
                dynamic: true,
                scan_root: Some(format!("{}/*/Slots", profiles.display())),
            }],
            unresolved_tokens: vec![],
        }])
        .unwrap();

        assert_eq!(scanned[0].scanned_paths.len(), 1);
        let profile = &scanned[0].scanned_paths[0];
        assert_eq!(profile.store_user_id.as_deref(), Some("76561197960267366"));
        assert!(profile
            .resolved_path
            .replace('\\', "/")
            .ends_with("/76561197960267366/Slots"));
        assert_eq!(
            profile
                .files
                .iter()
                .map(|file| file.relative_path.as_str())
                .collect::<Vec<_>>(),
            vec!["Slot_1/Data.sav", "Slot_2/Data.sav"]
        );
    }

    #[test]
    fn preserves_intermediate_directory_glob_matches_below_a_captured_profile() {
        let temp = tempdir().unwrap();
        let profiles = temp.path().join("Game");
        let slots = profiles.join("Goldberg/Slots");
        for slot in ["Slot_A", "Slot_B"] {
            let directory = slots.join(slot);
            fs::create_dir_all(&directory).unwrap();
            fs::write(directory.join("save.dat"), slot.as_bytes()).unwrap();
        }

        let scanned = scan_rules(vec![ResolvedCloudSaveRule {
            rule_id: "directory-slots".into(),
            kind: "dir".into(),
            raw_path: "<home>/Game/<storeUserId>/Slots/Slot_*".into(),
            source: "ludusavi".into(),
            tags: vec!["save".into()],
            when: vec![],
            resolved_paths: vec![ResolvedCloudSavePath {
                path: format!("{}/*/Slots/Slot_*", profiles.display()),
                case_sensitive: false,
                dynamic: true,
                scan_root: Some(format!("{}/*/Slots", profiles.display())),
            }],
            unresolved_tokens: vec![],
        }])
        .unwrap();

        assert_eq!(scanned[0].scanned_paths.len(), 1);
        let profile = &scanned[0].scanned_paths[0];
        assert_eq!(profile.store_user_id.as_deref(), Some("Goldberg"));
        assert_eq!(
            profile
                .files
                .iter()
                .map(|file| file.relative_path.as_str())
                .collect::<Vec<_>>(),
            vec!["Slot_A/save.dat", "Slot_B/save.dat"]
        );
    }

    #[test]
    fn preserves_wildcard_segments_that_precede_a_captured_profile() {
        let temp = tempdir().unwrap();
        let games = temp.path().join("Games");
        let profile = games.join("Game_A/Goldberg");
        fs::create_dir_all(&profile).unwrap();
        fs::write(profile.join("slot.dat"), b"save").unwrap();

        let scanned = scan_rules(vec![ResolvedCloudSaveRule {
            rule_id: "wildcard-before-profile".into(),
            kind: "file".into(),
            raw_path: "<home>/Games/Game_*/<storeUserId>/slot.dat".into(),
            source: "test".into(),
            tags: vec!["save".into()],
            when: vec![],
            resolved_paths: vec![ResolvedCloudSavePath {
                path: format!("{}/Game_*/*/slot.dat", games.display()),
                case_sensitive: false,
                dynamic: true,
                scan_root: Some(games.display().to_string()),
            }],
            unresolved_tokens: vec![],
        }])
        .unwrap();

        assert_eq!(scanned[0].scanned_paths.len(), 1);
        let profile = &scanned[0].scanned_paths[0];
        assert_eq!(profile.store_user_id.as_deref(), Some("Goldberg"));
        assert_eq!(profile.files[0].relative_path, "Game_A/Goldberg/slot.dat");
    }

    #[test]
    fn captures_profiles_embedded_in_leaf_file_names() {
        let temp = tempdir().unwrap();
        let root = temp.path().join("profiles");
        fs::create_dir_all(&root).unwrap();

        for (raw_leaf, concrete_leaf, expected_user) in [
            (
                "PlayerProfile<storeUserId>.sav",
                "PlayerProfileGoldberg.sav",
                "Goldberg",
            ),
            ("<storeUserId>.ini", "Rune.ini", "Rune"),
        ] {
            fs::write(root.join(concrete_leaf), expected_user.as_bytes()).unwrap();
            let scanned = scan_rules(vec![leaf_capture_rule(&root, raw_leaf)]).unwrap();

            assert_eq!(scanned[0].scanned_paths.len(), 1);
            assert_eq!(
                scanned[0].scanned_paths[0].store_user_id.as_deref(),
                Some(expected_user)
            );
            assert_eq!(
                scanned[0].scanned_paths[0].files[0].relative_path,
                concrete_leaf
            );
        }
    }

    #[test]
    fn keeps_multiple_leaf_file_profiles_separate() {
        let temp = tempdir().unwrap();
        let root = temp.path().join("profiles");
        fs::create_dir_all(&root).unwrap();
        for user in ["Goldberg", "Rune"] {
            fs::write(
                root.join(format!("PlayerProfile{user}.sav")),
                user.as_bytes(),
            )
            .unwrap();
        }

        let scanned = scan_rules(vec![leaf_capture_rule(
            &root,
            "PlayerProfile<storeUserId>.sav",
        )])
        .unwrap();
        let paths = &scanned[0].scanned_paths;

        assert_eq!(paths.len(), 2);
        assert_eq!(paths[0].store_user_id.as_deref(), Some("Goldberg"));
        assert_eq!(paths[0].files.len(), 1);
        assert_eq!(paths[0].files[0].relative_path, "PlayerProfileGoldberg.sav");
        assert_eq!(paths[1].store_user_id.as_deref(), Some("Rune"));
        assert_eq!(paths[1].files.len(), 1);
        assert_eq!(paths[1].files[0].relative_path, "PlayerProfileRune.sav");
        assert_ne!(paths[0].candidate_id, paths[1].candidate_id);
    }

    #[test]
    fn leaf_file_capture_keeps_complete_parent_coverage_after_a_profile_is_deleted() {
        let temp = tempdir().unwrap();
        let root = temp.path().join("profiles");
        fs::create_dir_all(&root).unwrap();
        fs::write(root.join("PlayerProfileRune.sav"), b"Rune").unwrap();

        let scanned = scan_rules(vec![leaf_capture_rule(
            &root,
            "PlayerProfile<storeUserId>.sav",
        )])
        .unwrap();
        let rule = &scanned[0];
        let selected_candidate_ids = rule
            .scanned_paths
            .iter()
            .map(|path| path.candidate_id.as_str())
            .collect::<HashSet<_>>();

        assert_eq!(rule.scanned_paths.len(), 1);
        assert_eq!(rule.scanned_paths[0].store_user_id.as_deref(), Some("Rune"));
        assert!(rule.coverage.iter().any(|coverage| {
            coverage.selected_root
                && coverage.enumerated_completely
                && !selected_candidate_ids.contains(coverage.candidate_id.as_str())
        }));
    }

    #[test]
    fn leaf_file_capture_proves_all_profiles_missing_only_when_parent_exists() {
        let temp = tempdir().unwrap();
        let existing_root = temp.path().join("existing-profiles");
        fs::create_dir_all(&existing_root).unwrap();

        let existing =
            scan_rules(vec![leaf_capture_rule(&existing_root, "<storeUserId>.ini")]).unwrap();
        assert!(existing[0].scanned_paths.is_empty());
        assert!(existing[0]
            .coverage
            .iter()
            .any(|coverage| coverage.selected_root && coverage.enumerated_completely));

        let missing_root = temp.path().join("missing-profiles");
        let missing =
            scan_rules(vec![leaf_capture_rule(&missing_root, "<storeUserId>.ini")]).unwrap();
        assert!(missing[0].scanned_paths.is_empty());
        assert!(missing[0]
            .coverage
            .iter()
            .all(|coverage| !coverage.selected_root));
    }

    #[test]
    fn preserves_selected_empty_store_user_roots_as_complete_coverage() {
        let temp = tempdir().unwrap();
        let root = temp.path().join(
            "drive_c/users/steamuser/Saved Games/The Last of Us Part I/users/Goldberg/savedata",
        );
        fs::create_dir_all(&root).unwrap();

        let scanned = scan_rules(resolve(
            temp.path(),
            "<home>/Saved Games/The Last of Us Part I/users/<storeUserId>/savedata",
        ))
        .unwrap();

        assert_eq!(scanned[0].scanned_paths.len(), 1);
        assert!(scanned[0].scanned_paths[0].files.is_empty());
        assert_eq!(
            scanned[0].scanned_paths[0].store_user_id.as_deref(),
            Some("Goldberg")
        );
        assert!(scanned[0].coverage.iter().any(|coverage| {
            coverage.selected_root
                && coverage.outcome == "scanned"
                && coverage.enumerated_completely
        }));
    }

    #[test]
    fn proves_an_exact_file_is_absent_when_its_parent_was_enumerated() {
        let temp = tempdir().unwrap();
        let root = temp.path().join("game");
        fs::create_dir_all(&root).unwrap();
        let rules = resolve_save_rules(ResolveSaveRulesInput {
            shop: "steam".into(),
            object_id: "1".into(),
            platform: "linux".into(),
            home_dir: temp.path().display().to_string(),
            documents_dir: None,
            app_data_dir: None,
            executable_path: None,
            wine_prefix_path: None,
            steam_path: None,
            rules: vec![CloudSaveRule {
                rule_id: "file-rule".into(),
                kind: "file".into(),
                raw_path: "<home>/game/slot.sav".into(),
                source: "test".into(),
                tags: vec!["save".into()],
                when: vec![],
                preferred_path: None,
            }],
        })
        .unwrap();

        let scanned = scan_rules(rules).unwrap();

        assert_eq!(scanned[0].scanned_paths.len(), 1);
        assert!(scanned[0].scanned_paths[0].files.is_empty());
        assert!(scanned[0].coverage.iter().any(|coverage| {
            coverage.selected_root
                && coverage.outcome == "scanned"
                && coverage.enumerated_completely
        }));
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
                preferred_path: None,
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
                preferred_path: None,
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
        fs::write(root.join("users.zip"), b"not-a-profile").unwrap();
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
    fn records_a_foreign_rule_without_treating_it_as_incomplete() {
        let scanned = scan_rules(vec![ResolvedCloudSaveRule {
            rule_id: "linux-rule".into(),
            kind: "dir".into(),
            raw_path: "<xdgConfig>/Game".into(),
            source: "ludusavi".into(),
            tags: vec!["save".into()],
            when: vec![],
            resolved_paths: vec![],
            unresolved_tokens: vec![FOREIGN_ENVIRONMENT_TOKEN.into()],
        }])
        .unwrap();

        assert!(scanned[0].scanned_paths.is_empty());
        assert_eq!(scanned[0].coverage.len(), 1);
        assert_eq!(scanned[0].coverage[0].outcome, "foreign-environment");
        assert!(!scanned[0].coverage[0].enumerated_completely);
        assert!(scanned[0].coverage[0].warning_codes.is_empty());
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
