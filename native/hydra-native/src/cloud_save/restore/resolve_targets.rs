use std::collections::HashMap;
use std::path::PathBuf;

use napi::bindgen_prelude::Error;
use napi_derive::napi;

use crate::cloud_save::manifest::{infer_rule_kind, types::CloudSaveRule};
use crate::cloud_save::path_resolution::{
    build_context, glob_base_path, resolve_restore_roots, ResolveSaveRulesInput,
};

use super::types::{ResolveRestoreTargetsInput, ResolvedRestoreTarget, RestoreManifestFile};
use super::validation::{validate_hash, validate_relative_path, validate_size};

fn join_path(root: &str, relative_path: &str) -> String {
    format!(
        "{}/{}",
        root.trim_end_matches(['/', '\\']),
        relative_path.trim_start_matches(['/', '\\'])
    )
    .replace('\\', "/")
}

fn validate_file(file: &RestoreManifestFile) -> Result<(), String> {
    if file.raw_path.is_empty() {
        return Err("cloud_save_invalid_restore_raw_path".to_string());
    }
    validate_relative_path(&file.relative_path)?;
    validate_hash(&file.hash)?;
    validate_size(file.size_bytes)
}

fn canonical_target_key(path: &str, case_sensitive: bool) -> String {
    let mut existing = PathBuf::from(path);
    let mut missing = Vec::new();
    while !existing.exists() {
        let Some(name) = existing.file_name().map(|name| name.to_os_string()) else {
            break;
        };
        missing.push(name);
        if !existing.pop() {
            break;
        }
    }

    let mut canonical = std::fs::canonicalize(&existing).unwrap_or(existing);
    for segment in missing.into_iter().rev() {
        canonical.push(segment);
    }
    let normalized = canonical.to_string_lossy().replace('\\', "/");
    if case_sensitive {
        normalized
    } else {
        normalized.to_ascii_lowercase()
    }
}

#[napi]
pub fn resolve_restore_targets(
    input: ResolveRestoreTargetsInput,
) -> napi::Result<Vec<ResolvedRestoreTarget>> {
    let context = build_context(&ResolveSaveRulesInput {
        shop: input.shop,
        object_id: input.object_id,
        platform: input.platform,
        home_dir: input.home_dir,
        documents_dir: input.documents_dir,
        app_data_dir: input.app_data_dir,
        executable_path: input.executable_path,
        wine_prefix_path: input.wine_prefix_path,
        wine_prefix_is_explicit: input.wine_prefix_is_explicit,
        steam_path: input.steam_path,
        rules: Vec::<CloudSaveRule>::new(),
    })
    .map_err(Error::from_reason)?;
    let case_sensitive_targets = context.platform != "windows";
    let mut targets = Vec::with_capacity(input.files.len());
    let mut hash_by_target = HashMap::with_capacity(input.files.len());

    for file in input.files {
        validate_file(&file).map_err(Error::from_reason)?;
        let glob_base = glob_base_path(&file.raw_path);
        let directory = infer_rule_kind(&file.raw_path) == "dir" || glob_base.is_some();
        let root_raw_path = glob_base.as_deref().unwrap_or(&file.raw_path);
        let resolved_roots = resolve_restore_roots(root_raw_path, &context, directory)
            .map_err(Error::from_reason)?;
        for resolved_root in resolved_roots {
            let target_path = if directory {
                join_path(&resolved_root, &file.relative_path)
            } else {
                resolved_root.replace('\\', "/")
            };
            let target_key = canonical_target_key(&target_path, case_sensitive_targets);
            if let Some(existing_hash) = hash_by_target.get(&target_key) {
                if existing_hash != &file.hash {
                    return Err(Error::from_reason("cloud_save_duplicate_restore_target"));
                }
                continue;
            }
            hash_by_target.insert(target_key, file.hash.clone());
            targets.push(ResolvedRestoreTarget {
                raw_path: file.raw_path.clone(),
                relative_path: file.relative_path.clone(),
                target_path,
                hash: file.hash.clone(),
                size_bytes: file.size_bytes,
            });
        }
    }

    Ok(targets)
}

#[cfg(test)]
mod tests {
    use std::fs;

    use tempfile::tempdir;

    use super::*;

    fn file(raw_path: &str, relative_path: &str) -> RestoreManifestFile {
        RestoreManifestFile {
            raw_path: raw_path.to_string(),
            relative_path: relative_path.to_string(),
            hash: "a".repeat(64),
            size_bytes: 4.0,
        }
    }

    fn input(platform: &str, file: RestoreManifestFile) -> ResolveRestoreTargetsInput {
        ResolveRestoreTargetsInput {
            shop: "steam".to_string(),
            object_id: "2379780".to_string(),
            platform: platform.to_string(),
            home_dir: match platform {
                "windows" => "C:/Users/rodrigo".to_string(),
                "mac" => "/Users/rodrigo".to_string(),
                _ => "/home/rodrigo".to_string(),
            },
            documents_dir: (platform == "windows")
                .then(|| "C:/Users/rodrigo/Documents".to_string()),
            app_data_dir: (platform == "windows")
                .then(|| "C:/Users/rodrigo/AppData/Roaming".to_string()),
            executable_path: Some("D:/Games/Game/game.exe".to_string()),
            wine_prefix_path: None,
            wine_prefix_is_explicit: None,
            steam_path: None,
            files: vec![file],
        }
    }

    #[test]
    fn resolves_native_directory_exact_file_and_glob() {
        let directory =
            resolve_restore_targets(input("windows", file("<winAppData>/Balatro", "1.jkr")))
                .unwrap();
        let exact = resolve_restore_targets(input(
            "windows",
            file("<winAppData>/Balatro/settings.jkr", "settings.jkr"),
        ))
        .unwrap();
        let glob = resolve_restore_targets(input(
            "windows",
            file("<winAppData>/Balatro/*.jkr", "1.jkr"),
        ))
        .unwrap();

        assert_eq!(
            directory[0].target_path,
            "C:/Users/rodrigo/AppData/Roaming/Balatro/1.jkr"
        );
        assert_eq!(
            exact[0].target_path,
            "C:/Users/rodrigo/AppData/Roaming/Balatro/settings.jkr"
        );
        assert_eq!(glob[0].target_path, directory[0].target_path);
    }

    #[test]
    fn resolves_native_linux_and_macos_targets() {
        let linux =
            resolve_restore_targets(input("linux", file("<home>/.config/Game", "save.dat")))
                .unwrap();
        let mac = resolve_restore_targets(input(
            "mac",
            file("<home>/Library/Application Support/Game", "save.dat"),
        ))
        .unwrap();

        assert_eq!(linux[0].target_path, "/home/rodrigo/.config/Game/save.dat");
        assert_eq!(
            mac[0].target_path,
            "/Users/rodrigo/Library/Application Support/Game/save.dat"
        );
    }

    #[test]
    fn materializes_deleted_wine_save_directory() {
        let prefix = tempdir().unwrap();
        fs::create_dir_all(prefix.path().join("drive_c/users/steamuser")).unwrap();
        let mut value = input(
            "linux",
            file(
                "<home>/Saved Games/CD Projekt Red/Cyberpunk 2077",
                "slot/sav.dat",
            ),
        );
        value.wine_prefix_path = Some(prefix.path().display().to_string());

        let target = resolve_restore_targets(value).unwrap().remove(0);

        assert_eq!(
            target.target_path,
            format!(
                "{}/drive_c/users/steamuser/Saved Games/CD Projekt Red/Cyberpunk 2077/slot/sav.dat",
                prefix.path().display()
            )
        );
    }

    #[test]
    fn rejects_missing_wine_profile() {
        let prefix = tempdir().unwrap();
        let missing_prefix = prefix.path().join("missing");
        let mut value = input("linux", file("<winAppData>/Game", "save.dat"));
        value.wine_prefix_path = Some(missing_prefix.display().to_string());
        value.wine_prefix_is_explicit = Some(true);

        assert!(resolve_restore_targets(value).is_err());
    }

    #[test]
    fn resolves_all_existing_store_users_deterministically() {
        let prefix = tempdir().unwrap();
        let users = prefix
            .path()
            .join("drive_c/users/steamuser/Saved Games/The Last of Us Part I/users");
        fs::create_dir_all(users.join("Goldberg/savedata")).unwrap();
        let mut value = input(
            "linux",
            file(
                "<home>/Saved Games/The Last of Us Part I/users/<storeUserId>/savedata",
                "slot.dat",
            ),
        );
        value.wine_prefix_path = Some(prefix.path().display().to_string());
        let target = resolve_restore_targets(value).unwrap().remove(0);
        assert!(target.target_path.contains("/Goldberg/savedata/slot.dat"));

        fs::create_dir_all(users.join("Rune/savedata")).unwrap();
        let mut ambiguous = input(
            "linux",
            file(
                "<home>/Saved Games/The Last of Us Part I/users/<storeUserId>/savedata",
                "slot.dat",
            ),
        );
        ambiguous.wine_prefix_path = Some(prefix.path().display().to_string());
        let targets = resolve_restore_targets(ambiguous).unwrap();
        assert_eq!(targets.len(), 2);
        assert!(targets
            .iter()
            .any(|target| target.target_path.contains("/Goldberg/savedata/slot.dat")));
        assert!(targets
            .iter()
            .any(|target| target.target_path.contains("/Rune/savedata/slot.dat")));

        let empty_prefix = tempdir().unwrap();
        fs::create_dir_all(empty_prefix.path().join("drive_c/users/steamuser")).unwrap();
        let mut missing = input(
            "linux",
            file(
                "<home>/Saved Games/The Last of Us Part I/users/<storeUserId>/savedata",
                "slot.dat",
            ),
        );
        missing.wine_prefix_path = Some(empty_prefix.path().display().to_string());
        assert!(resolve_restore_targets(missing).is_err());
    }

    #[test]
    fn resolves_all_existing_wine_profiles_and_layouts() {
        let prefix = tempdir().unwrap();
        let modern = prefix
            .path()
            .join("drive_c/users/steamuser/AppData/Roaming/Game");
        let legacy = prefix
            .path()
            .join("drive_c/users/steamuser/Application Data/Game");
        let os_user = prefix
            .path()
            .join("drive_c/users/rodrigo/AppData/Roaming/Game");
        fs::create_dir_all(&modern).unwrap();
        fs::create_dir_all(&legacy).unwrap();
        fs::create_dir_all(&os_user).unwrap();

        let mut value = input("linux", file("<winAppData>/Game", "save.dat"));
        value.home_dir = "/home/rodrigo".into();
        value.wine_prefix_path = Some(prefix.path().display().to_string());
        value.wine_prefix_is_explicit = Some(true);

        let targets = resolve_restore_targets(value).unwrap();

        assert_eq!(targets.len(), 3);
        for root in [modern, legacy, os_user] {
            assert!(targets
                .iter()
                .any(|target| target.target_path == format!("{}/save.dat", root.display())));
        }
    }

    #[test]
    fn does_not_create_missing_legacy_aliases() {
        let prefix = tempdir().unwrap();
        let modern_base = prefix
            .path()
            .join("drive_c/users/steamuser/AppData/Roaming");
        fs::create_dir_all(&modern_base).unwrap();

        let mut value = input("linux", file("<winAppData>/Game", "save.dat"));
        value.wine_prefix_path = Some(prefix.path().display().to_string());
        value.wine_prefix_is_explicit = Some(true);

        let targets = resolve_restore_targets(value).unwrap();

        assert_eq!(targets.len(), 1);
        assert_eq!(
            targets[0].target_path,
            format!("{}/Game/save.dat", modern_base.display())
        );
        assert!(!prefix
            .path()
            .join("drive_c/users/steamuser/Application Data")
            .exists());
    }

    #[cfg(unix)]
    #[test]
    fn deduplicates_modern_and_legacy_aliases_to_same_physical_target() {
        use std::os::unix::fs::symlink;

        let prefix = tempdir().unwrap();
        let profile = prefix.path().join("drive_c/users/steamuser");
        let documents = profile.join("Documents");
        fs::create_dir_all(documents.join("Game")).unwrap();
        symlink(&documents, profile.join("My Documents")).unwrap();

        let mut value = input("linux", file("<winDocuments>/Game", "save.dat"));
        value.wine_prefix_path = Some(prefix.path().display().to_string());
        value.wine_prefix_is_explicit = Some(true);

        let targets = resolve_restore_targets(value).unwrap();

        assert_eq!(targets.len(), 1);
    }

    #[test]
    fn resolves_derived_proton_and_default_wine_prefix() {
        let temp = tempdir().unwrap();
        let steam_root = temp.path().join("SteamLibrary");
        let proton = steam_root
            .join("steamapps/compatdata/2379780/pfx/drive_c/users/steamuser/AppData/Roaming/Game");
        let wine_prefix = temp.path().join("hydra-prefix");
        let wine = wine_prefix.join("drive_c/users/steamuser/AppData/Roaming/Game");
        fs::create_dir_all(&proton).unwrap();
        fs::create_dir_all(&wine).unwrap();

        let mut value = input("linux", file("<winAppData>/Game", "save.dat"));
        value.executable_path = Some(
            steam_root
                .join("steamapps/common/Game/game.exe")
                .display()
                .to_string(),
        );
        value.wine_prefix_path = Some(wine_prefix.display().to_string());
        value.wine_prefix_is_explicit = Some(false);

        let targets = resolve_restore_targets(value).unwrap();

        assert_eq!(targets.len(), 2);
        assert!(targets
            .iter()
            .any(|target| target.target_path == format!("{}/save.dat", proton.display())));
        assert!(targets
            .iter()
            .any(|target| target.target_path == format!("{}/save.dat", wine.display())));
    }

    #[test]
    fn rejects_unsafe_invalid_and_duplicate_targets() {
        let mut unsafe_path = input("windows", file("<winAppData>/Balatro", "../secret.dat"));
        assert!(resolve_restore_targets(unsafe_path).is_err());

        unsafe_path = input("windows", file("<winAppData>/Balatro", "save.dat"));
        unsafe_path.files[0].hash = "invalid".to_string();
        assert!(resolve_restore_targets(unsafe_path).is_err());

        let mut duplicate = input("windows", file("<winAppData>/Balatro", "save.dat"));
        let mut conflicting = file("<winAppData>/Balatro", "save.dat");
        conflicting.hash = "b".repeat(64);
        duplicate.files.push(conflicting);
        assert!(resolve_restore_targets(duplicate).is_err());
    }
}
