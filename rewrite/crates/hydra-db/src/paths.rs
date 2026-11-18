//! Where the Electron app keeps its data, and where the rewrite keeps its own.

use std::path::PathBuf;

/// Electron's `app.getPath("userData")` for the `hydralauncher` package.
/// `HYDRA_ELECTRON_USER_DATA` overrides it (the `MAIN_VITE_USER_DATA_PATH`
/// folder of a development build, for example).
pub fn electron_user_data() -> Option<PathBuf> {
    if let Some(path) = std::env::var_os("HYDRA_ELECTRON_USER_DATA") {
        return Some(PathBuf::from(path));
    }
    platform_config_dir().map(|dir| dir.join("hydralauncher"))
}

/// The rewrite's own data folder, next to Electron's so uninstalling one
/// never removes the other's files. `HYDRA_USER_DATA` overrides it.
pub fn native_user_data() -> Option<PathBuf> {
    if let Some(path) = std::env::var_os("HYDRA_USER_DATA") {
        return Some(PathBuf::from(path));
    }
    platform_config_dir().map(|dir| dir.join("hydralauncher-native"))
}

/// `hydra-db` or `hydra-db-staging` (`constants.ts`: staging when the API URL says so).
pub fn database_name(api_url: &str) -> &'static str {
    if api_url.contains("staging") {
        "hydra-db-staging"
    } else {
        "hydra-db"
    }
}

fn platform_config_dir() -> Option<PathBuf> {
    if cfg!(windows) {
        std::env::var_os("APPDATA").map(PathBuf::from)
    } else if cfg!(target_os = "macos") {
        std::env::var_os("HOME").map(|home| PathBuf::from(home).join("Library/Application Support"))
    } else {
        std::env::var_os("XDG_CONFIG_HOME")
            .map(PathBuf::from)
            .filter(|p| p.is_absolute())
            .or_else(|| std::env::var_os("HOME").map(|home| PathBuf::from(home).join(".config")))
    }
}
