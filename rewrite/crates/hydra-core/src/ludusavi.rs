//! services/ludusavi.ts: the bundled Ludusavi binary, run from a copy in the
//! user data folder with its own `config.yaml`, and getGameSaveFolder
//! (events/library/get-game-save-folder.ts) on top of its backup preview.

use std::path::{Path, PathBuf};
use std::process::Command;

use serde_json::Value;

fn binary_name() -> &'static str {
    if cfg!(windows) {
        "ludusavi.exe"
    } else {
        "ludusavi"
    }
}

/// Where the app ships Ludusavi: `ludusavi/` next to the executable when
/// packaged, else the repository's `ludusavi/` folder (scripts/postinstall.cjs).
pub fn resources_dir() -> PathBuf {
    let beside = std::env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(|d| d.join("ludusavi")))
        .filter(|d| d.join("config.yaml").exists());
    beside.unwrap_or_else(|| Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../ludusavi"))
}

/// `<userData>/ludusavi`
pub fn config_dir(user_data: &Path) -> PathBuf {
    user_data.join("ludusavi")
}

/// copyConfigFileToUserData + copyBinaryToUserData.
pub fn install(user_data: &Path) -> std::io::Result<PathBuf> {
    let dir = config_dir(user_data);
    let resources = resources_dir();
    if !dir.exists() {
        std::fs::create_dir_all(&dir)?;
        std::fs::copy(resources.join("config.yaml"), dir.join("config.yaml"))?;
    }
    let binary = dir.join(binary_name());
    if !binary.exists() {
        std::fs::copy(resources.join(binary_name()), &binary)?;
    }
    Ok(binary)
}

/// backupGame(..., preview: true): `ludusavi --config <dir> backup <objectId>
/// --api --force --preview [--wine-prefix <prefix>]`.
pub fn backup_preview(
    user_data: &Path,
    object_id: &str,
    wine_prefix: Option<&str>,
) -> Result<Value, String> {
    let binary = install(user_data).map_err(|e| format!("ludusavi install: {e}"))?;
    let dir = config_dir(user_data);
    let mut command = Command::new(&binary);
    command
        .arg("--config")
        .arg(&dir)
        .args(["backup", object_id, "--api", "--force", "--preview"]);
    if let Some(prefix) = wine_prefix {
        command.arg("--wine-prefix").arg(prefix);
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // CREATE_NO_WINDOW: no console flashing up (execFile has none either).
        command.creation_flags(0x0800_0000);
    }
    let output = command.output().map_err(|e| format!("ludusavi: {e}"))?;
    if !output.status.success() && output.stdout.is_empty() {
        return Err(format!(
            "ludusavi exited with {}: {}",
            output.status,
            String::from_utf8_lossy(&output.stderr)
        ));
    }
    serde_json::from_slice(&output.stdout).map_err(|e| format!("ludusavi output: {e}"))
}

/// getGameSaveFolder: the folder of the first save file in the preview.
pub fn save_folder_from_preview(preview: &Value, object_id: &str) -> Option<String> {
    let files = preview
        .get("games")?
        .get(object_id)?
        .get("files")?
        .as_object()?;
    let first = files.keys().next()?;
    let parent = Path::new(first).parent()?;
    let text = parent.to_string_lossy().to_string();
    (!text.is_empty()).then_some(text)
}

pub fn game_save_folder(user_data: &Path, object_id: &str) -> Option<String> {
    match backup_preview(user_data, object_id, None) {
        Ok(preview) => save_folder_from_preview(&preview, object_id),
        Err(error) => {
            eprintln!("[getGameSaveFolder] Error getting save folder: {error}");
            None
        }
    }
}

/// open-game-save-folder-core.ts getGameSaveFolderShellPath: backslashes and
/// no `\\?\` prefix for the Windows shell.
pub fn shell_path(folder: &str) -> String {
    if !cfg!(windows) {
        return folder.to_string();
    }
    let path = folder.replace('/', "\\");
    let lower = path.to_lowercase();
    if lower.starts_with("\\\\?\\unc\\") {
        return format!("\\\\{}", &path[8..]);
    }
    let bytes = path.as_bytes();
    if lower.starts_with("\\\\?\\")
        && bytes.len() > 6
        && bytes[4].is_ascii_alphabetic()
        && bytes[5] == b':'
        && bytes[6] == b'\\'
    {
        return path[4..].to_string();
    }
    path
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn finds_the_first_save_folder() {
        let preview = json!({ "games": { "123": { "files": {
            "C:/Users/me/AppData/LocalLow/Team Cherry/Hollow Knight/user1.dat": {},
        } } } });
        assert_eq!(
            save_folder_from_preview(&preview, "123").as_deref(),
            Some("C:/Users/me/AppData/LocalLow/Team Cherry/Hollow Knight")
        );
        assert_eq!(save_folder_from_preview(&preview, "9"), None);
    }

    #[cfg(windows)]
    #[test]
    fn shell_paths_drop_the_long_path_prefix() {
        assert_eq!(shell_path("C:/a/b"), "C:\\a\\b");
        assert_eq!(shell_path("\\\\?\\C:\\a"), "C:\\a");
        assert_eq!(shell_path("\\\\?\\UNC\\srv\\share"), "\\\\srv\\share");
    }
}
