use super::types::{PathResolutionContext, ResolveSaveRulesInput};

pub(crate) fn normalize_separators(value: &str) -> String {
    value.replace('\\', "/").trim_end_matches('/').to_string()
}

fn parent_path(value: &str) -> Option<String> {
    let normalized = normalize_separators(value);
    normalized
        .rsplit_once('/')
        .map(|(parent, _)| parent.to_string())
        .filter(|parent| !parent.is_empty())
}

fn basename(value: &str) -> Option<String> {
    normalize_separators(value)
        .rsplit('/')
        .next()
        .filter(|name| !name.is_empty())
        .map(ToString::to_string)
}

fn install_directory(executable_path: Option<&str>) -> Option<String> {
    let executable_path = normalize_separators(executable_path?);
    let marker = "/steamapps/common/";

    if let Some(index) = executable_path.to_ascii_lowercase().find(marker) {
        let game_start = index + marker.len();
        let game_end = executable_path[game_start..]
            .find('/')
            .map(|offset| game_start + offset)
            .unwrap_or(executable_path.len());

        return Some(executable_path[..game_end].to_string());
    }
    parent_path(&executable_path)
}

fn join_path(parent: &str, child: &str) -> String {
    format!(
        "{}/{}",
        parent.trim_end_matches('/'),
        child.trim_start_matches('/')
    )
}

type WindowsDirectories = (
    Option<String>,
    Option<String>,
    Option<String>,
    Option<String>,
);

#[derive(Default)]
struct WindowsPaths {
    local_app_data_dir: Option<String>,
    public_dir: Option<String>,
    program_data_dir: Option<String>,
    windows_dir: Option<String>,
    saved_games_dir: Option<String>,
}

fn fallback_windows_directories(home_dir: &str, app_data_dir: Option<&str>) -> WindowsDirectories {
    let local_app_data = app_data_dir
        .and_then(parent_path)
        .map(|parent| join_path(&parent, "Local"));
    let public = parent_path(home_dir).map(|users| join_path(&users, "Public"));
    let system_drive = home_dir
        .split_once('/')
        .map(|(root, _)| root)
        .filter(|root| root.ends_with(':'));

    (
        local_app_data,
        public,
        system_drive.map(|root| join_path(root, "ProgramData")),
        system_drive.map(|root| join_path(root, "Windows")),
    )
}

#[cfg(windows)]
fn windows_directories(home_dir: &str, app_data_dir: Option<&str>) -> WindowsDirectories {
    let fallback = fallback_windows_directories(home_dir, app_data_dir);
    let known = |folder| {
        known_folders::get_known_folder_path(folder)
            .map(|path| normalize_separators(&path.to_string_lossy()))
    };

    (
        known(known_folders::KnownFolder::LocalAppData).or(fallback.0),
        known(known_folders::KnownFolder::Public).or(fallback.1),
        known(known_folders::KnownFolder::ProgramData).or(fallback.2),
        known(known_folders::KnownFolder::Windows).or(fallback.3),
    )
}

#[cfg(not(windows))]
fn windows_directories(home_dir: &str, app_data_dir: Option<&str>) -> WindowsDirectories {
    fallback_windows_directories(home_dir, app_data_dir)
}

fn derived_steam_root(executable_path: Option<&str>) -> Option<String> {
    let executable_path = normalize_separators(executable_path?);
    let marker = "/steamapps/common/";
    let index = executable_path.to_ascii_lowercase().find(marker)?;

    Some(executable_path[..index].to_string())
}

#[cfg(windows)]
fn windows_saved_games_dir(home_dir: &str) -> Option<String> {
    known_folders::get_known_folder_path(known_folders::KnownFolder::SavedGames)
        .map(|path| normalize_separators(&path.to_string_lossy()))
        .or_else(|| Some(join_path(home_dir, "Saved Games")))
}

#[cfg(not(windows))]
fn windows_saved_games_dir(home_dir: &str) -> Option<String> {
    Some(join_path(home_dir, "Saved Games"))
}

pub fn build_context(input: &ResolveSaveRulesInput) -> Result<PathResolutionContext, String> {
    build_context_with_windows_paths(input, None)
}

fn build_context_with_windows_paths(
    input: &ResolveSaveRulesInput,
    windows_paths: Option<WindowsPaths>,
) -> Result<PathResolutionContext, String> {
    if !matches!(input.platform.as_str(), "windows" | "linux" | "mac") {
        return Err(format!(
            "Unsupported cloud save path platform: {}",
            input.platform
        ));
    }

    let home_dir = normalize_separators(&input.home_dir);
    let install_dir = install_directory(input.executable_path.as_deref());
    let wine_prefix_path = input.wine_prefix_path.as_deref().map(normalize_separators);
    let documents_dir = input.documents_dir.as_deref().map(normalize_separators);
    let app_data_dir = input.app_data_dir.as_deref().map(normalize_separators);
    let os_username = basename(&home_dir).unwrap_or_else(|| "*".to_string());

    let windows_paths = if input.platform == "windows" {
        windows_paths.unwrap_or_else(|| {
            let (local_app_data_dir, public_dir, program_data_dir, windows_dir) =
                windows_directories(&home_dir, app_data_dir.as_deref());
            WindowsPaths {
                local_app_data_dir,
                public_dir,
                program_data_dir,
                windows_dir,
                saved_games_dir: windows_saved_games_dir(&home_dir),
            }
        })
    } else {
        WindowsPaths::default()
    };

    let (xdg_data_dir, xdg_config_dir) = match input.platform.as_str() {
        "windows" => (None, None),
        "mac" => (
            app_data_dir
                .clone()
                .or_else(|| Some(join_path(&home_dir, "Library"))),
            Some(join_path(&home_dir, "Library/Preferences")),
        ),
        _ => (
            Some(join_path(&home_dir, ".local/share")),
            app_data_dir
                .clone()
                .or_else(|| Some(join_path(&home_dir, ".config"))),
        ),
    };

    let derived_steam_root = (!input.shop.eq_ignore_ascii_case("epic"))
        .then(|| derived_steam_root(input.executable_path.as_deref()))
        .flatten();
    let configured_steam_root = (!input.shop.eq_ignore_ascii_case("epic"))
        .then(|| input.steam_path.as_deref().map(normalize_separators))
        .flatten()
        .filter(|root| derived_steam_root.as_ref() != Some(root));
    let windows_compatibility = input.platform == "linux"
        && input
            .executable_path
            .as_deref()
            .is_some_and(|path| path.to_ascii_lowercase().ends_with(".exe"));

    Ok(PathResolutionContext {
        shop: input.shop.clone(),
        object_id: input.object_id.clone(),
        platform: input.platform.clone(),
        home_dir: home_dir.clone(),
        os_username,
        documents_dir,
        app_data_dir,
        local_app_data_dir: windows_paths.local_app_data_dir,
        public_dir: windows_paths.public_dir,
        program_data_dir: windows_paths.program_data_dir,
        windows_dir: windows_paths.windows_dir,
        saved_games_dir: windows_paths.saved_games_dir,
        xdg_data_dir,
        xdg_config_dir,
        install_dir,
        wine_prefix_path,
        windows_compatibility,
        derived_steam_root,
        configured_steam_root,
        store_user_id: None,
    })
}

#[cfg(test)]
mod tests {
    use std::fs;

    use tempfile::tempdir;

    use super::*;
    use crate::cloud_save::manifest::types::{CloudSaveRule, CloudSaveRuleCondition};
    use crate::cloud_save::path_resolution::resolve_rules::resolve_rules;
    use crate::cloud_save::save_scanner::scan_resolved_save_rules;

    #[tokio::test]
    async fn epic_windows_known_folder_rule_discovers_each_account() {
        let temp = tempdir().unwrap();
        let home = temp.path().join("Users/Hydra");
        let roaming = home.join("AppData/Roaming");
        let local = home.join("AppData/Local");
        for account in ["EpicUserA", "EpicUserB"] {
            let save = local.join(format!("FactoryGame/Saved/SaveGames/{account}/slot.sav"));
            fs::create_dir_all(save.parent().unwrap()).unwrap();
            fs::write(save, account.as_bytes()).unwrap();
        }
        let steam_root = temp.path().join("Steam");
        let steam_save = steam_root.join("userdata/steam-only.sav");
        fs::create_dir_all(steam_save.parent().unwrap()).unwrap();
        fs::write(steam_save, b"steam only").unwrap();

        let input = ResolveSaveRulesInput {
            shop: "epic".into(),
            object_id: "namespace:playable-item".into(),
            platform: "windows".into(),
            home_dir: home.to_string_lossy().into_owned(),
            documents_dir: Some(home.join("Documents").to_string_lossy().into_owned()),
            app_data_dir: Some(roaming.to_string_lossy().into_owned()),
            executable_path: Some(
                steam_root
                    .join("steamapps/common/Satisfactory/FactoryGame.exe")
                    .to_string_lossy()
                    .into_owned(),
            ),
            wine_prefix_path: None,
            steam_path: Some(steam_root.to_string_lossy().into_owned()),
            rules: vec![],
        };
        let context = build_context_with_windows_paths(
            &input,
            Some(WindowsPaths {
                local_app_data_dir: Some(normalize_separators(&local.to_string_lossy())),
                saved_games_dir: Some(normalize_separators(
                    &home.join("Saved Games").to_string_lossy(),
                )),
                ..WindowsPaths::default()
            }),
        )
        .unwrap();
        assert!(context.configured_steam_root.is_none());
        assert!(context.derived_steam_root.is_none());

        let rule = |raw_path: &str, store: Option<&str>| CloudSaveRule {
            rule_id: raw_path.into(),
            kind: "dir".into(),
            raw_path: raw_path.into(),
            source: "ludusavi".into(),
            tags: vec!["save".into()],
            when: store
                .map(|store| CloudSaveRuleCondition {
                    os: Some("windows".into()),
                    store: Some(store.into()),
                })
                .into_iter()
                .collect(),
            preferred_path: None,
        };
        let resolved = resolve_rules(
            vec![
                rule(
                    "<winLocalAppData>/FactoryGame/Saved/SaveGames/<storeUserId>",
                    Some("epic"),
                ),
                rule("<root>/userdata/steam-only.sav", None),
            ],
            &context,
        );
        assert_eq!(resolved.len(), 2);
        assert!(resolved[0].unresolved_tokens.is_empty());
        assert_eq!(resolved[0].resolved_paths.len(), 1);
        assert!(resolved[1].resolved_paths.is_empty());
        assert!(!resolved[1].unresolved_tokens.is_empty());

        let scanned = scan_resolved_save_rules(resolved).await.unwrap();
        let accounts = &scanned[0].scanned_paths;
        assert_eq!(accounts.len(), 2);
        assert_eq!(
            accounts
                .iter()
                .map(|path| path.store_user_id.as_deref().unwrap())
                .collect::<Vec<_>>(),
            ["EpicUserA", "EpicUserB"]
        );
        assert!(accounts
            .iter()
            .all(|path| { path.files.len() == 1 && path.files[0].relative_path == "slot.sav" }));
        assert!(scanned[1].scanned_paths.is_empty());
    }
}
