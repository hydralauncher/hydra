//! userPreferences: reading them and update-user-preferences.ts (merge,
//! normalized download directories, the language side effects).

use hydra_core::download_directories;
use hydra_db::keys;
use serde_json::{Map, Value, json};

use crate::shell;

/// getDefaultDownloadsPath: app.getPath("downloads")
pub fn default_downloads_path() -> String {
    dirs::download_dir()
        .or_else(xdg_downloads_fallback)
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_default()
}

/// Chromium on Linux asks xdg-user-dirs for DOWNLOAD and falls back to
/// `$HOME/Downloads` when the user has no `user-dirs.dirs` (dirs returns None).
fn xdg_downloads_fallback() -> Option<std::path::PathBuf> {
    if cfg!(target_os = "linux") {
        dirs::home_dir().map(|home| home.join("Downloads"))
    } else {
        None
    }
}

pub fn get() -> Map<String, Value> {
    shell::db()
        .and_then(|db| db.get::<Map<String, Value>>(keys::USER_PREFERENCES))
        .unwrap_or_default()
}

pub fn flag(prefs: &Map<String, Value>, key: &str) -> bool {
    prefs.get(key).and_then(Value::as_bool) == Some(true)
}

/// updateUserPreferences(patch): merge, normalize the download directories,
/// write, then the language side effects. Returns the stored preferences.
pub fn update(patch: Map<String, Value>) -> Map<String, Value> {
    let Some(db) = shell::db() else {
        return Map::new();
    };
    let current = get();
    if let Some(language) = patch
        .get("language")
        .and_then(Value::as_str)
        .filter(|l| !l.is_empty())
    {
        // updateLanguagePreference
        let _ = db.put_utf8(keys::LANGUAGE, language);
        shell::set_language(language);
        if shell::signed_in()
            && let Some(api) = shell::api()
        {
            let language = language.to_string();
            std::thread::spawn(move || {
                let _ = api.patch(
                    "/profile",
                    &json!({ "language": language }),
                    hydra_core::api::Options::default(),
                );
            });
        }
    }
    let mut merged = current;
    for (key, value) in patch {
        merged.insert(key, value);
    }
    let normalized = download_directories::preferences_for(&merged, &default_downloads_path());
    for (key, value) in normalized {
        merged.insert(key, value);
    }
    let _ = db.put(keys::USER_PREFERENCES, &merged);
    // TODO(settings): Wine/screenshot input sync, achievement caches, emulator
    // tracking and the download manager's speed limits on preference changes.
    merged
}
