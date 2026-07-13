use std::fs;
use std::path::Path;

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

fn windows_profile_to_prefix_path(value: &str) -> Option<String> {
    let normalized = normalize_separators(value.trim_matches('"'));
    let (_, profile_path) = normalized.split_once(':')?;
    let profile_path = profile_path.trim_start_matches('/');
    (!profile_path.is_empty()).then(|| format!("drive_c/{profile_path}"))
}

fn read_wine_user_profile(wine_prefix_path: &str) -> Option<String> {
    let contents = fs::read_to_string(Path::new(wine_prefix_path).join("user.reg")).ok()?;
    let mut in_volatile_environment = false;

    for line in contents.lines() {
        let line = line.trim();
        if line.starts_with('[') {
            in_volatile_environment = line.starts_with("[Volatile Environment]");
            continue;
        }
        if !in_volatile_environment {
            continue;
        }
        let Some(value) = line.strip_prefix("\"USERPROFILE\"=") else {
            continue;
        };
        let unescaped = value.trim_matches('"').replace("\\\\", "\\");
        return windows_profile_to_prefix_path(&unescaped);
    }

    None
}

fn fallback_wine_user_profile(home_dir: &str) -> Option<String> {
    windows_like_username(home_dir).map(|username| format!("drive_c/users/{username}"))
}

pub fn build_context(input: &ResolveSaveRulesInput) -> Result<PathResolutionContext, String> {
    if input.platform != "windows" && input.platform != "linux" {
        return Err(format!(
            "Unsupported cloud save path platform: {}",
            input.platform
        ));
    }

    let host_home_dir = normalize_separators(&input.home_dir);
    let executable_path = input.executable_path.as_deref().map(normalize_separators);
    let install_dir = executable_path.as_deref().and_then(parent_path);
    let wine_prefix_path = input.wine_prefix_path.as_deref().map(normalize_separators);

    let wine_user_profile = wine_prefix_path.as_deref().and_then(read_wine_user_profile);
    let home_dir = if wine_prefix_path.is_some() {
        wine_user_profile
            .clone()
            .or_else(|| fallback_wine_user_profile(&host_home_dir))
            .unwrap_or(host_home_dir)
    } else {
        host_home_dir
    };

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
            (
                Some(join_path(&home_dir, "Documents")),
                Some(join_path(&home_dir, "AppData/Roaming")),
                Some(join_path(&home_dir, "AppData/Local")),
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cloud_save::path_resolution::resolve_path::resolve_path;
    use crate::cloud_save::path_resolution::tokens::build_token_map;
    use tempfile::tempdir;

    fn input(wine_prefix_path: String) -> ResolveSaveRulesInput {
        ResolveSaveRulesInput {
            shop: "steam".to_string(),
            object_id: "1091500".to_string(),
            platform: "linux".to_string(),
            home_dir: "/home/victor".to_string(),
            documents_dir: None,
            app_data_dir: None,
            executable_path: None,
            wine_prefix_path: Some(wine_prefix_path),
            proton_path: None,
            steam_path: None,
            steam_user_ids: Vec::new(),
            rules: Vec::new(),
        }
    }

    #[test]
    fn reads_windows_user_profile_from_wine_registry() {
        let prefix = tempdir().unwrap();
        fs::write(
            prefix.path().join("user.reg"),
            r#"WINE REGISTRY Version 2

[Volatile Environment] 123
"USERPROFILE"="C:\\users\\steamuser"
"#,
        )
        .unwrap();

        let context = build_context(&input(prefix.path().display().to_string())).unwrap();

        assert_eq!(context.home_dir, "drive_c/users/steamuser");
        assert_eq!(
            context.local_app_data_dir.as_deref(),
            Some("drive_c/users/steamuser/AppData/Local")
        );

        let token_map = build_token_map(&context, &[]);
        let resolved = resolve_path(
            "<home>/Saved Games/CD Projekt Red/Cyberpunk 2077",
            &context,
            &token_map,
        );
        assert_eq!(
            resolved.resolved_paths,
            vec![format!(
                "{}/drive_c/users/steamuser/Saved Games/CD Projekt Red/Cyberpunk 2077",
                prefix.path().display()
            )]
        );
    }

    #[test]
    fn falls_back_to_host_username_before_prefix_is_initialized() {
        let prefix = tempdir().unwrap();
        let context = build_context(&input(prefix.path().display().to_string())).unwrap();

        assert_eq!(context.home_dir, "drive_c/users/victor");
    }
}
