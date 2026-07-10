use std::fs;
use std::io;

use crate::cloud_save::path_resolution::types::ResolvedCloudSaveRule;

use super::glob::{glob_base_path, has_glob_pattern, matches_glob_pattern};
use super::types::{ScannedCloudSaveFile, ScannedCloudSavePath};
use super::walk::walk_directory_files;

pub fn normalize_scanned_path(value: &str) -> String {
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

fn relative_path(root: &str, absolute_path: &str) -> String {
    absolute_path
        .strip_prefix(root.trim_end_matches('/'))
        .unwrap_or(absolute_path)
        .trim_start_matches('/')
        .to_string()
}

fn scanned_file(absolute_path: String, relative_path: String) -> ScannedCloudSaveFile {
    ScannedCloudSaveFile {
        absolute_path: normalize_scanned_path(&absolute_path),
        relative_path: normalize_scanned_path(&relative_path),
    }
}

fn sort_files(files: &mut [ScannedCloudSaveFile]) {
    files.sort_by(|left, right| left.relative_path.cmp(&right.relative_path));
}

fn scan_directory(resolved_path: &str) -> Result<ScannedCloudSavePath, String> {
    let root = normalize_scanned_path(resolved_path);
    let mut files = walk_directory_files(resolved_path)?
        .into_iter()
        .map(|absolute_path| {
            let relative = relative_path(&root, &absolute_path);
            scanned_file(absolute_path, relative)
        })
        .collect::<Vec<_>>();
    sort_files(&mut files);

    Ok(ScannedCloudSavePath {
        resolved_path: root,
        files,
    })
}

fn scan_file(resolved_path: &str) -> Result<ScannedCloudSavePath, String> {
    let normalized = normalize_scanned_path(resolved_path);
    let metadata = match fs::metadata(resolved_path) {
        Ok(metadata) => Some(metadata),
        Err(error) if error.kind() == io::ErrorKind::NotFound => None,
        Err(error) => return Err(error.to_string()),
    };
    let files = if metadata.is_some_and(|metadata| metadata.is_file()) {
        let basename = normalized
            .rsplit('/')
            .next()
            .unwrap_or(&normalized)
            .to_string();
        vec![scanned_file(resolved_path.to_string(), basename)]
    } else {
        Vec::new()
    };

    Ok(ScannedCloudSavePath {
        resolved_path: normalized,
        files,
    })
}

fn scan_glob(resolved_path: &str) -> Result<ScannedCloudSavePath, String> {
    let pattern = normalize_scanned_path(resolved_path);
    let base = glob_base_path(&pattern);
    let mut files = walk_directory_files(&base)?
        .into_iter()
        .filter_map(|absolute_path| {
            let relative = relative_path(&base, &absolute_path);
            matches_glob_pattern(&pattern, &relative).then(|| scanned_file(absolute_path, relative))
        })
        .collect::<Vec<_>>();
    sort_files(&mut files);

    Ok(ScannedCloudSavePath {
        resolved_path: pattern,
        files,
    })
}

pub fn scan_resolved_path(
    rule: &ResolvedCloudSaveRule,
    resolved_path: &str,
) -> Result<ScannedCloudSavePath, String> {
    if rule.kind == "dir" {
        scan_directory(resolved_path)
    } else if has_glob_pattern(resolved_path) {
        scan_glob(resolved_path)
    } else {
        scan_file(resolved_path)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    use crate::cloud_save::manifest::{
        get_save_rules_for_game, GetSaveRulesForGameInput,
    };
    use crate::cloud_save::path_resolution::{
        resolve_save_rules, types::ResolveSaveRulesInput,
    };

    use std::fs;
    use tempfile::tempdir;

    #[tokio::test]
    async fn scans_balatro_from_real_manifest() {
        let temp = tempdir().unwrap();
        let home = temp.path().join("users/test-user");
        let prefix = temp.path().join("wine");

        let game = get_save_rules_for_game(GetSaveRulesForGameInput {
            shop: "steam".into(),
            object_id: "2379780".into(),
            remote_id: None,
            title: Some("Balatro".into()),
            source_url: None,
            user_data_path: temp.path().display().to_string(),
        })
        .await
        .unwrap();

        let rule = game
            .rules
            .into_iter()
            .find(|rule| rule.raw_path == "<winAppData>/Balatro")
            .unwrap();

        let resolved = resolve_save_rules(ResolveSaveRulesInput {
            shop: "steam".into(),
            object_id: "2379780".into(),
            platform: "linux".into(),
            home_dir: home.display().to_string(),
            executable_path: None,
            documents_dir: None,
            app_data_dir: None,
            wine_prefix_path: Some(prefix.display().to_string()),
            proton_path: None,
            steam_path: None,
            steam_user_ids: vec![],
            rules: vec![rule],
        })
        .unwrap()
        .remove(0);

        let directory = &resolved.resolved_paths[0];

        fs::create_dir_all(directory).unwrap();
        fs::write(format!("{directory}/1.jkr"), b"save").unwrap();

        let scanned = scan_resolved_path(&resolved, directory).unwrap();

        println!(
            "Balatro | {} -> {:?}",
            resolved.raw_path, scanned.files
        );

        assert_eq!(scanned.files.len(), 1);
        assert_eq!(scanned.files[0].relative_path, "1.jkr");
    }
}
