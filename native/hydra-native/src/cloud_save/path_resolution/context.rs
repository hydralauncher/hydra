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
    if !matches!(input.platform.as_str(), "windows" | "linux" | "mac") {
        return Err(format!(
            "Unsupported cloud save path platform: {}",
            input.platform
        ));
    }

    let home_dir = normalize_separators(&input.home_dir);
    let install_dir = install_directory(input.executable_path.as_deref());
    let game_dir = install_dir.as_deref().and_then(basename);
    let wine_prefix_path = input.wine_prefix_path.as_deref().map(normalize_separators);
    let documents_dir = input.documents_dir.as_deref().map(normalize_separators);
    let app_data_dir = input.app_data_dir.as_deref().map(normalize_separators);
    let os_username = basename(&home_dir).unwrap_or_else(|| "*".to_string());

    let (local_app_data_dir, local_app_data_low_dir, public_dir, program_data_dir, windows_dir) =
        if input.platform == "windows" {
            let app_data_parent = app_data_dir.as_deref().and_then(parent_path);
            (
                app_data_parent
                    .as_deref()
                    .map(|parent| join_path(parent, "Local")),
                app_data_parent
                    .as_deref()
                    .map(|parent| join_path(parent, "LocalLow")),
                Some("C:/Users/Public".to_string()),
                Some("C:/ProgramData".to_string()),
                Some("C:/Windows".to_string()),
            )
        } else {
            (None, None, None, None, None)
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

    let mut steam_roots = Vec::new();
    if let Some(root) = derived_steam_root(input.executable_path.as_deref()) {
        steam_roots.push(root);
    }
    if let Some(root) = input.steam_path.as_deref().map(normalize_separators) {
        if !steam_roots.contains(&root) {
            steam_roots.push(root);
        }
    }

    Ok(PathResolutionContext {
        shop: input.shop.clone(),
        object_id: input.object_id.clone(),
        platform: input.platform.clone(),
        home_dir: home_dir.clone(),
        os_username,
        documents_dir,
        app_data_dir,
        local_app_data_dir,
        local_app_data_low_dir,
        public_dir,
        program_data_dir,
        windows_dir,
        saved_games_dir: (input.platform == "windows")
            .then(|| windows_saved_games_dir(&home_dir))
            .flatten(),
        xdg_data_dir,
        xdg_config_dir,
        install_dir,
        game_dir,
        wine_prefix_path,
        steam_roots,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn input(platform: &str) -> ResolveSaveRulesInput {
        ResolveSaveRulesInput {
            shop: "steam".into(),
            object_id: "1091500".into(),
            platform: platform.into(),
            home_dir: if platform == "windows" {
                "C:/Users/victor".into()
            } else {
                "/home/victor".into()
            },
            documents_dir: None,
            app_data_dir: None,
            executable_path: None,
            wine_prefix_path: None,
            proton_path: None,
            steam_path: None,
            rules: vec![],
        }
    }

    #[test]
    fn supports_all_desktop_platforms() {
        assert!(build_context(&input("windows")).is_ok());
        assert!(build_context(&input("linux")).is_ok());
        assert!(build_context(&input("mac")).is_ok());
    }

    #[test]
    fn derives_steam_install_root_instead_of_executable_directory() {
        let mut value = input("linux");
        value.executable_path =
            Some("/games/SteamLibrary/steamapps/common/Cyberpunk 2077/bin/x64/game.exe".into());

        let context = build_context(&value).unwrap();

        assert_eq!(
            context.install_dir.as_deref(),
            Some("/games/SteamLibrary/steamapps/common/Cyberpunk 2077")
        );
        assert_eq!(context.game_dir.as_deref(), Some("Cyberpunk 2077"));
        assert_eq!(context.steam_roots, vec!["/games/SteamLibrary".to_string()]);
    }
}
