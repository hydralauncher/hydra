use crate::cloud_save::path_resolution::types::ResolvedCloudSaveRule;

use std::collections::HashSet;

use super::scan_path::scan_resolved_path;
use super::types::ScannedCloudSaveRule;

pub fn scan_rules(rules: Vec<ResolvedCloudSaveRule>) -> Result<Vec<ScannedCloudSaveRule>, String> {
    rules
        .into_iter()
        .map(|rule| {
            let mut scanned_paths = Vec::new();
            let mut dynamic_roots = HashSet::new();
            if rule.unresolved_tokens.is_empty() {
                for (index, path) in rule.resolved_paths.iter().enumerate() {
                    let case_sensitive = rule
                        .resolved_path_case_sensitive
                        .get(index)
                        .copied()
                        .unwrap_or(true);
                    let dynamic = rule
                        .resolved_path_dynamic
                        .get(index)
                        .copied()
                        .unwrap_or(false);
                    let scan_root = rule
                        .resolved_path_scan_roots
                        .get(index)
                        .filter(|root| !root.is_empty())
                        .map(String::as_str);
                    for scanned in scan_resolved_path(path, case_sensitive, scan_root) {
                        if dynamic && !scanned.files.is_empty() {
                            dynamic_roots.insert(scanned.resolved_path.clone());
                        }
                        scanned_paths.push(scanned);
                    }
                }
            }

            if dynamic_roots.len() > 1 {
                return Err("cloud_save_ambiguous_dynamic_roots".to_string());
            }

            Ok(ScannedCloudSaveRule {
                kind: rule.kind,
                raw_path: rule.raw_path,
                source: rule.source,
                tags: rule.tags,
                when: rule.when,
                resolved_paths: rule.resolved_paths,
                unresolved_tokens: rule.unresolved_tokens,
                scanned_paths,
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cloud_save::manifest::types::CloudSaveRule;
    use crate::cloud_save::path_resolution::{resolve_save_rules, ResolveSaveRulesInput};
    use std::fs;
    use tempfile::tempdir;

    fn resolve(prefix: &std::path::Path, raw_path: &str) -> Vec<ResolvedCloudSaveRule> {
        resolve_save_rules(ResolveSaveRulesInput {
            shop: "steam".into(),
            object_id: "1888930".into(),
            platform: "linux".into(),
            home_dir: "/home/victor".into(),
            documents_dir: None,
            app_data_dir: Some("/home/victor/.config".into()),
            executable_path: Some("/games/TLOU/tlou-i.exe".into()),
            wine_prefix_path: Some(prefix.display().to_string()),
            proton_path: None,
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
    fn scans_tlou_crack_user_independently_of_steam_userdata() {
        let temp = tempdir().unwrap();
        let root = temp.path().join(
            "drive_c/users/steamuser/Saved Games/The Last of Us Part I/users/Goldberg/savedata",
        );
        fs::create_dir_all(&root).unwrap();
        fs::write(root.join("slot.dat"), b"save").unwrap();

        let scanned = scan_rules(resolve(
            temp.path(),
            "<home>/Saved Games/The Last of Us Part I/users/<storeUserId>/savedata",
        ))
        .unwrap();

        assert_eq!(scanned[0].scanned_paths.len(), 1);
        assert_eq!(
            scanned[0].scanned_paths[0].files[0].relative_path,
            "slot.dat"
        );
    }

    #[test]
    fn rejects_multiple_dynamic_save_roots() {
        let temp = tempdir().unwrap();
        for user in ["Goldberg", "Rune"] {
            let root = temp.path().join(format!(
                "drive_c/users/steamuser/Saved Games/The Last of Us Part I/users/{user}/savedata"
            ));
            fs::create_dir_all(&root).unwrap();
            fs::write(root.join("slot.dat"), user.as_bytes()).unwrap();
        }

        let error = scan_rules(resolve(
            temp.path(),
            "<home>/Saved Games/The Last of Us Part I/users/<storeUserId>/savedata",
        ))
        .unwrap_err();

        assert_eq!(error, "cloud_save_ambiguous_dynamic_roots");
    }
}
