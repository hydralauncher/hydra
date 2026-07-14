use napi::bindgen_prelude::Error;
use napi_derive::napi;

use crate::cloud_save::manifest::rules::infer_rule_kind;
use crate::cloud_save::path_resolution::context::build_context;
use crate::cloud_save::path_resolution::resolve_path::resolve_restore_root;
use crate::cloud_save::path_resolution::types::ResolveSaveRulesInput;
use crate::cloud_save::save_scanner::glob::{glob_base_path, has_glob_pattern};

#[napi(object)]
pub struct RestoreManifestFile {
    pub raw_path: String,
    pub relative_path: String,
    pub hash: String,
    pub size_bytes: f64,
}

#[napi(object)]
pub struct ResolveRestoreTargetsInput {
    pub shop: String,
    pub object_id: String,
    pub platform: String,
    pub home_dir: String,
    pub documents_dir: Option<String>,
    pub app_data_dir: Option<String>,
    pub executable_path: Option<String>,
    pub wine_prefix_path: Option<String>,
    pub proton_path: Option<String>,
    pub steam_path: Option<String>,
    pub files: Vec<RestoreManifestFile>,
}

#[napi(object)]
pub struct ResolvedRestoreTarget {
    pub raw_path: String,
    pub relative_path: String,
    pub target_path: String,
    pub hash: String,
    pub size_bytes: f64,
}

fn validate_relative_path(value: &str) -> Result<(), String> {
    let normalized = value.replace('\\', "/");
    if normalized.starts_with('/')
        || normalized.split('/').any(|segment| segment == "..")
        || normalized.len() > 1 && normalized.as_bytes()[1] == b':'
    {
        return Err(format!("Invalid restore relative path: {value}"));
    }
    Ok(())
}

fn join_path(root: &str, relative_path: &str) -> String {
    format!(
        "{}/{}",
        root.trim_end_matches(['/', '\\']),
        relative_path.trim_start_matches(['/', '\\'])
    )
    .replace('\\', "/")
}

#[napi]
pub fn resolve_restore_targets(
    input: ResolveRestoreTargetsInput,
) -> napi::Result<Vec<ResolvedRestoreTarget>> {
    let context_input = ResolveSaveRulesInput {
        shop: input.shop,
        object_id: input.object_id,
        platform: input.platform,
        home_dir: input.home_dir,
        documents_dir: input.documents_dir,
        app_data_dir: input.app_data_dir,
        executable_path: input.executable_path,
        wine_prefix_path: input.wine_prefix_path,
        proton_path: input.proton_path,
        steam_path: input.steam_path,
        rules: Vec::new(),
    };
    let context = build_context(&context_input).map_err(Error::from_reason)?;
    input
        .files
        .into_iter()
        .map(|file| {
            validate_relative_path(&file.relative_path).map_err(Error::from_reason)?;
            let kind = infer_rule_kind(&file.raw_path);
            let root_raw_path = if has_glob_pattern(&file.raw_path) {
                glob_base_path(&file.raw_path)
            } else {
                file.raw_path.clone()
            };
            let resolved_path =
                resolve_restore_root(&root_raw_path, &context).map_err(Error::from_reason)?;
            let target_path = if kind == "dir" || has_glob_pattern(&file.raw_path) {
                join_path(&resolved_path, &file.relative_path)
            } else {
                resolved_path.replace('\\', "/")
            };

            Ok(ResolvedRestoreTarget {
                raw_path: file.raw_path,
                relative_path: file.relative_path,
                target_path,
                hash: file.hash,
                size_bytes: file.size_bytes,
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn input(platform: &str, raw_path: &str, relative_path: &str) -> ResolveRestoreTargetsInput {
        ResolveRestoreTargetsInput {
            shop: "steam".to_string(),
            object_id: "2379780".to_string(),
            platform: platform.to_string(),
            home_dir: if platform == "windows" {
                "C:/Users/spectre".to_string()
            } else {
                "/home/spectre".to_string()
            },
            documents_dir: (platform == "windows")
                .then(|| "C:/Users/spectre/Documents".to_string()),
            app_data_dir: (platform == "windows")
                .then(|| "C:/Users/spectre/AppData/Roaming".to_string()),
            executable_path: Some(if platform == "windows" {
                "D:/Games/Balatro/Balatro.exe".to_string()
            } else {
                "/games/Balatro/Balatro.exe".to_string()
            }),
            wine_prefix_path: None,
            proton_path: None,
            steam_path: None,
            files: vec![RestoreManifestFile {
                raw_path: raw_path.to_string(),
                relative_path: relative_path.to_string(),
                hash: "abc123".to_string(),
                size_bytes: 10.0,
            }],
        }
    }

    #[test]
    fn resolves_directory_file_and_glob_targets() {
        let directory =
            resolve_restore_targets(input("windows", "<winAppData>/Balatro", "1.jkr")).unwrap();
        assert_eq!(
            directory[0].target_path,
            "C:/Users/spectre/AppData/Roaming/Balatro/1.jkr"
        );

        let file = resolve_restore_targets(input(
            "windows",
            "<winAppData>/Balatro/settings.jkr",
            "settings.jkr",
        ))
        .unwrap();
        assert_eq!(
            file[0].target_path,
            "C:/Users/spectre/AppData/Roaming/Balatro/settings.jkr"
        );

        let glob = resolve_restore_targets(input("windows", "<winAppData>/Balatro/*.jkr", "1.jkr"))
            .unwrap();
        assert_eq!(
            glob[0].target_path,
            "C:/Users/spectre/AppData/Roaming/Balatro/1.jkr"
        );
    }

    #[test]
    fn resolves_windows_path_inside_wine_prefix() {
        let mut value = input("linux", "<winAppData>/Balatro", "1.jkr");
        let prefix = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(prefix.path().join("drive_c/users/steamuser")).unwrap();
        value.wine_prefix_path = Some(prefix.path().display().to_string());

        let targets = resolve_restore_targets(value).unwrap();
        assert_eq!(
            targets[0].target_path,
            format!(
                "{}/drive_c/users/steamuser/AppData/Roaming/Balatro/1.jkr",
                prefix.path().display()
            )
        );
    }

    #[test]
    fn keeps_same_relative_path_distinct_by_raw_path() {
        let mut value = input("windows", "<winAppData>/GameA", "slot.sav");
        value.files.push(RestoreManifestFile {
            raw_path: "<winDocuments>/GameB".to_string(),
            relative_path: "slot.sav".to_string(),
            hash: "def456".to_string(),
            size_bytes: 20.0,
        });

        let targets = resolve_restore_targets(value).unwrap();
        assert_ne!(targets[0].target_path, targets[1].target_path);
    }

    #[test]
    fn rejects_unresolved_ambiguous_and_unsafe_paths() {
        let unresolved = input("linux", "<winAppData>/Balatro", "1.jkr");
        assert!(resolve_restore_targets(unresolved).is_err());

        let ambiguous = input("linux", "<home>/<storeUserId>", "save.dat");
        assert!(resolve_restore_targets(ambiguous).is_err());

        let traversal = input("linux", "<home>/Balatro", "../secret");
        assert!(resolve_restore_targets(traversal).is_err());
    }
}
