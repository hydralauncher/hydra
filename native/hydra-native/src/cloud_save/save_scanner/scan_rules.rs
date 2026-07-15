use crate::cloud_save::path_resolution::types::ResolvedCloudSaveRule;

use super::scan_path::scan_resolved_path;
use super::types::ScannedCloudSaveRule;

pub fn scan_rules(rules: Vec<ResolvedCloudSaveRule>) -> Result<Vec<ScannedCloudSaveRule>, String> {
    rules
        .into_iter()
        .map(|rule| {
            let mut scanned_paths = Vec::new();
            if rule.unresolved_tokens.is_empty() {
                for (index, path) in rule.resolved_paths.iter().enumerate() {
                    let case_sensitive = rule
                        .resolved_path_case_sensitive
                        .get(index)
                        .copied()
                        .unwrap_or(true);
                    let scan_root = rule
                        .resolved_path_scan_roots
                        .get(index)
                        .filter(|root| !root.is_empty())
                        .map(String::as_str);
                    for scanned in scan_resolved_path(path, case_sensitive, scan_root) {
                        scanned_paths.push(scanned);
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
    fn scans_multiple_dynamic_save_roots() {
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
    }

    #[test]
    fn scans_file_and_directory_matched_by_store_user_wildcard() {
        let temp = tempdir().unwrap();
        let elden_ring = temp.path().join("EldenRing");
        let save_root = elden_ring.join("76561198000000000");
        fs::create_dir_all(&save_root).unwrap();
        fs::write(elden_ring.join("GraphicsConfig.xml"), b"config").unwrap();
        fs::write(save_root.join("ER0000.sl2"), b"save").unwrap();

        let scanned = scan_rules(vec![ResolvedCloudSaveRule {
            kind: "dir".into(),
            raw_path: "<winAppData>/EldenRing/<storeUserId>".into(),
            source: "ludusavi".into(),
            tags: vec!["save".into()],
            when: vec![],
            resolved_paths: vec![format!("{}/*", elden_ring.display())],
            resolved_path_case_sensitive: vec![false],
            resolved_path_dynamic: vec![true],
            resolved_path_scan_roots: vec![String::new()],
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
}
