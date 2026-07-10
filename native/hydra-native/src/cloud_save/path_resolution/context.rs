use super::types::{PathResolutionContext, ResolveSaveRulesInput};

fn normalize_separators(value: &str) -> String {
    value.replace('\\', "/")
}

fn parent_path(value: &str) -> Option<String> {
    let normalized = normalize_separators(value);
    normalized
        .rsplit_once('/')
        .map(|(parent, _)| parent.to_string())
        .filter(|parent| !parent.is_empty())
}

fn join_path(parent: &str, child: &str) -> String {
    format!(
        "{}/{}",
        parent.trim_end_matches('/'),
        child.trim_start_matches('/')
    )
}

fn windows_like_username(home_dir: &str) -> Option<&str> {
    home_dir
        .trim_end_matches('/')
        .rsplit('/')
        .next()
        .filter(|username| !username.is_empty())
}

pub fn build_context(input: &ResolveSaveRulesInput) -> Result<PathResolutionContext, String> {
    if input.platform != "windows" && input.platform != "linux" {
        return Err(format!(
            "Unsupported cloud save path platform: {}",
            input.platform
        ));
    }

    let home_dir = normalize_separators(&input.home_dir);
    let executable_path = input.executable_path.as_deref().map(normalize_separators);
    let install_dir = executable_path.as_deref().and_then(parent_path);
    let wine_prefix_path = input.wine_prefix_path.as_deref().map(normalize_separators);

    let (documents_dir, app_data_dir, local_app_data_dir, public_dir, program_data_dir) =
        if input.platform == "windows" {
            let documents = input.documents_dir.as_deref().map(normalize_separators);
            let app_data = input.app_data_dir.as_deref().map(normalize_separators);
            let local_app_data = app_data
                .as_deref()
                .and_then(parent_path)
                .map(|parent| join_path(&parent, "Local"));

            (
                documents,
                app_data,
                local_app_data,
                Some("C:/Users/Public".to_string()),
                Some("C:/ProgramData".to_string()),
            )
        } else if wine_prefix_path.is_some() {
            let username = windows_like_username(&home_dir);
            (
                username.map(|value| format!("drive_c/users/{value}/Documents")),
                username.map(|value| format!("drive_c/users/{value}/AppData/Roaming")),
                username.map(|value| format!("drive_c/users/{value}/AppData/Local")),
                Some("drive_c/users/Public".to_string()),
                Some("drive_c/ProgramData".to_string()),
            )
        } else {
            (None, None, None, None, None)
        };

    Ok(PathResolutionContext {
        platform: input.platform.clone(),
        home_dir,
        documents_dir,
        app_data_dir,
        local_app_data_dir,
        public_dir,
        program_data_dir,
        install_dir,
        wine_prefix_path,
    })
}
