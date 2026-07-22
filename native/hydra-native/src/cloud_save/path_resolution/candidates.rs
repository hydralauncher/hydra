use super::context::normalize_separators;
use super::tokens::{apply, literal, missing, optional_literal, TokenValues};
use super::types::PathResolutionContext;

#[derive(Clone, Copy)]
enum WindowsLayout {
    Modern,
    Legacy,
}

fn native_values(context: &PathResolutionContext, root: Option<&str>) -> TokenValues {
    let windows = context.platform == "windows";
    let windows_path = |path| {
        if windows {
            optional_literal(path)
        } else {
            missing()
        }
    };
    let unix_path = |path| {
        if windows {
            missing()
        } else {
            optional_literal(path)
        }
    };

    TokenValues {
        root: optional_literal(root),
        base: optional_literal(context.install_dir.as_deref()),
        home: literal(&context.home_dir),
        os_username: literal(&context.os_username),
        app_data: windows_path(context.app_data_dir.as_deref()),
        local_app_data: windows_path(context.local_app_data_dir.as_deref()),
        documents: windows_path(context.documents_dir.as_deref()),
        public: windows_path(context.public_dir.as_deref()),
        program_data: windows_path(context.program_data_dir.as_deref()),
        windows_dir: windows_path(context.windows_dir.as_deref()),
        xdg_data: unix_path(context.xdg_data_dir.as_deref()),
        xdg_config: unix_path(context.xdg_config_dir.as_deref()),
    }
}

fn windows_values(
    context: &PathResolutionContext,
    root: &str,
    drive: &str,
    home: &str,
    layout: WindowsLayout,
) -> TokenValues {
    let (documents, app_data, local_app_data) = match layout {
        WindowsLayout::Modern => (
            format!("{home}/Documents"),
            format!("{home}/AppData/Roaming"),
            format!("{home}/AppData/Local"),
        ),
        WindowsLayout::Legacy => (
            format!("{home}/My Documents"),
            format!("{home}/Application Data"),
            format!("{home}/Local Settings/Application Data"),
        ),
    };

    TokenValues {
        root: root.to_string(),
        base: optional_literal(context.install_dir.as_deref()),
        home: home.to_string(),
        os_username: home.rsplit('/').next().unwrap_or("*").to_string(),
        app_data,
        local_app_data,
        documents,
        public: format!("{drive}/users/Public"),
        program_data: format!("{drive}/ProgramData"),
        windows_dir: format!("{drive}/windows"),
        xdg_data: optional_literal(context.xdg_data_dir.as_deref()),
        xdg_config: optional_literal(context.xdg_config_dir.as_deref()),
    }
}

fn windows_environment_paths(
    path: &str,
    context: &PathResolutionContext,
    root: String,
    drive: String,
    home: String,
) -> Vec<String> {
    [WindowsLayout::Modern, WindowsLayout::Legacy]
        .into_iter()
        .map(|layout| apply(path, &windows_values(context, &root, &drive, &home, layout)))
        .collect()
}

fn windows_environment_path(
    path: &str,
    context: &PathResolutionContext,
    root: &str,
    drive: &str,
    home: &str,
    layout: WindowsLayout,
) -> String {
    apply(path, &windows_values(context, root, drive, home, layout))
}

pub fn native_paths(
    path: &str,
    context: &PathResolutionContext,
    root: Option<&str>,
) -> Vec<String> {
    let mut paths = vec![apply(path, &native_values(context, root))];

    if root.is_none() && context.platform == "windows" && path.contains("<home>/Saved Games/") {
        if let Some(saved_games) = &context.saved_games_dir {
            let replaced =
                path.replace("<home>/Saved Games/", &format!("{}/", literal(saved_games)));
            paths.push(apply(&replaced, &native_values(context, None)));
        }
    }

    paths
}

pub fn wine_paths(path: &str, context: &PathResolutionContext, prefix: &str) -> Vec<String> {
    let root = literal(prefix);
    let preferred_users = [
        "steamuser".to_string(),
        globset::escape(&context.os_username),
    ];
    let mut paths = Vec::new();

    for layout in [WindowsLayout::Modern, WindowsLayout::Legacy] {
        for user in &preferred_users {
            let drive = format!("{root}/drive_c");
            let home = format!("{drive}/users/{user}");
            paths.push(windows_environment_path(
                path, context, &root, &drive, &home, layout,
            ));
        }

        let drive = format!("{root}/drive_*");
        let home = format!("{drive}/users/*");
        paths.push(windows_environment_path(
            path, context, &root, &drive, &home, layout,
        ));
    }

    paths
}

pub fn steam_proton_paths(
    path: &str,
    context: &PathResolutionContext,
    steam_root: &str,
) -> Vec<String> {
    let root = literal(steam_root);
    let drive = format!(
        "{root}/steamapps/compatdata/{}/pfx/drive_c",
        globset::escape(&context.object_id)
    );
    let home = format!("{drive}/users/steamuser");
    windows_environment_paths(path, context, root, drive, home)
}

pub fn normalize_candidate(path: &str) -> String {
    normalize_separators(path)
}
